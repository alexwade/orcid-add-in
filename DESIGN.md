# ORCID Author Add-on — Design Document

## Overview

A Google Docs container-bound Apps Script add-on that lets co-authors add themselves to a shared research paper by authenticating with their ORCID account. On successful authentication the add-on fetches the author's public profile — name, current affiliation(s), and ROR identifiers — and inserts a formatted author entry into the document body.

---

## User Flow

```
Author opens the shared Google Doc
  → The Stacks → Add Author via ORCID
    → "Add Author" modal dialog opens
      → Author clicks "Sign in with ORCID"
        → ORCID OAuth popup opens
          → Author authenticates with ORCID credentials
            → Popup shows success and auto-closes
              → Dialog shows a preview of name + affiliations
                → Author clicks "Insert into Document"
                  → Author entry is inserted into the document
                    → Dialog closes
```

Each co-author repeats this independently. The document accumulates one entry per author under an **The Stacks** heading.

---

## Architecture

The add-on serves two distinct roles from a single Apps Script project:

| Role | Trigger | Entry point |
|------|---------|-------------|
| **Docs add-on** | User selects menu item in the Doc | `onOpen()`, `showAddAuthorDialog()` |
| **OAuth callback server** | ORCID redirects after authentication | `doGet(e)` (web app deployment) |

The two roles share the same codebase and credential constants but run in separate execution contexts. Communication between them uses `CacheService` as a short-lived message bus.

```
┌─────────────────────────────────────────┐
│           Google Doc (browser)          │
│                                         │
│  ┌─────────────┐    ┌────────────────┐  │
│  │  The Stacks    │    │  Dialog iframe │  │
│  │  menu       │───▶│  (HtmlService) │  │
│  └─────────────┘    └───────┬────────┘  │
│                             │           │
│                    google.script.run    │
└─────────────────────────────┼───────────┘
                              │
              ┌───────────────▼──────────────┐
              │      Apps Script runtime     │
              │                              │
              │  startOAuth()                │
              │  pollForAuthor()             │
              │  insertAuthor()              │
              │                              │
              │  ┌──────────────────────┐    │
              │  │    CacheService      │    │
              │  │  (state + pending    │    │
              │  │   author profile)    │    │
              │  └──────────────────────┘    │
              └───────────────┬──────────────┘
                              │
              ┌───────────────▼──────────────┐
              │   Web app /exec endpoint     │
              │                              │
              │  doGet(e)                    │
              │  handleOAuthCallback_()      │
              │  fetchOrcidProfile()         │
              └──────────────────────────────┘
                              ▲
                              │  HTTP redirect (code + state)
                    ┌─────────┴──────────┐
                    │    orcid.org        │
                    │  OAuth 2.0 server  │
                    └────────────────────┘
```

---

## OAuth Flow (step by step)

ORCID uses the standard **Authorization Code** flow. Because Apps Script dialogs run in a sandboxed iframe and cannot directly receive OAuth redirects, the flow uses a popup window and a polling loop.

### 1. `startOAuth()` — initiate

Called via `google.script.run` when the user clicks "Sign in with ORCID".

1. Generates a random UUID as the `state` parameter (CSRF protection).
2. Stores `state` in the **calling user's** `CacheService.getUserCache()` with a 10-minute TTL.
3. Constructs the ORCID authorization URL:
   ```
   https://orcid.org/oauth/authorize
     ?client_id=APP-...
     &response_type=code
     &scope=/authenticate
     &redirect_uri=ORCID_CALLBACK_URL_
     &state=<uuid>
   ```
4. Returns `{ authUrl }` to the dialog.

The dialog opens `authUrl` in a popup window (`window.open`).

### 2. User authenticates on ORCID

The popup shows the ORCID login page. After the user signs in and grants access, ORCID redirects the popup to:

```
ORCID_CALLBACK_URL_?code=<auth_code>&state=<uuid>
```

### 3. `doGet(e)` — receive the callback

The web app deployment handles this redirect. `doGet` detects `code` and `state` in the query parameters and calls `handleOAuthCallback_`.

### 4. `handleOAuthCallback_()` — exchange code for token

1. Makes a POST to `https://orcid.org/oauth/token` with:
   - `grant_type=authorization_code`
   - `code=<auth_code>`
   - `redirect_uri=ORCID_CALLBACK_URL_` (must exactly match the authorization request)
   - Client credentials (`ORCID_CLIENT_ID_`, `ORCID_CLIENT_SECRET_`)
2. ORCID returns an access token and the user's ORCID iD.
3. Calls `fetchOrcidProfile(orcid, accessToken)` to retrieve public profile data.
4. Stores the author profile JSON in `CacheService.getScriptCache()` under the key `orcid_pending_<state>` (10-minute TTL).
5. Returns `Callback.html` to the popup (success or error message).

### 5. `pollForAuthor()` — detect completion

The dialog polls `google.script.run.pollForAuthor()` every 2.5 seconds.

1. Reads `state` from the calling user's `getUserCache()`.
2. Looks up `orcid_pending_<state>` in `getScriptCache()`.
3. If found: removes both cache entries and returns the author profile to the dialog.
4. If not found: returns `null` (dialog keeps polling).

### 6. User confirms and inserts

The dialog renders a preview of the author profile. On "Insert into Document", `google.script.run.insertAuthor(author)` is called.

---

## Cache Architecture

| Cache | Key | Value | TTL | Purpose |
|-------|-----|-------|-----|---------|
| `getUserCache()` | `orcid_oauth_state` | UUID string | 10 min | Ties the user's dialog session to the callback |
| `getScriptCache()` | `orcid_pending_<uuid>` | Author JSON | 10 min | Passes the profile from `doGet` context to dialog context |

Using `getUserCache` for the state (rather than `getScriptCache`) ensures that two authors authenticating simultaneously don't collide — each user's state is isolated.

Using `getScriptCache` for the pending profile (rather than `getUserCache`) is necessary because `doGet` runs in the deploying user's context, not the author's context, so it cannot write to the author's user cache.

---

## Document Insertion

`insertAuthor(author)` inserts a block of two or more paragraphs:

```
[Bold name]  https://orcid.org/0000-0000-0000-0000  ← ORCID iD as hyperlink
    [Affiliation name]  https://ror.org/...           ← indented, ROR as hyperlink
    [Affiliation name]  https://ror.org/...
```

**Placement logic** (`findOrCreateAuthorSection_`):

1. Scans the document body for a paragraph whose text matches `authors`, `authors:`, or starts with `author contributions` (case-insensitive).
2. If found: inserts new entries immediately after that heading.
3. If not found: appends a horizontal rule and a `Heading 2` paragraph labelled **"Authors"**, then inserts after it.

**Deduplication**: before inserting, `body.findText(author.orcid)` checks whether the ORCID iD already appears in the document. If so, insertion is skipped and the dialog shows a notice.

---

## ORCID Profile Data

Two endpoints are called against the ORCID Public API (no special scope required beyond `/authenticate`):

| Endpoint | Data retrieved |
|----------|----------------|
| `GET /v3.0/{orcid}/person` | Credit name, given name, family name |
| `GET /v3.0/{orcid}/employments` | Organisation names, ROR identifiers, employment end dates |

**Name resolution** (in priority order):
1. `credit-name` (the author's preferred display name)
2. `given-names` + `family-name`
3. ORCID iD (fallback)

**Affiliation filtering**:
- Prefers employments with no `end-date` (current positions).
- Falls back to all employments if none are marked current.
- Deduplicates by organisation name.
- Extracts ROR identifier from `disambiguated-organization` where `disambiguation-source = "ROR"`.

---

## File Structure

```
orcid-author-addon/
├── appsscript.json          Manifest: scopes, web app config, runtime
├── Code.gs                  Menu, OAuth flow, document insertion
├── OrcidApi.gs              ORCID Public API calls and profile parsing
├── Credentials.gs           The three OAuth constants — gitignored, and
│                            excluded from clasp push so a push neither
│                            overwrites nor uploads them
├── Credentials.example.gs   Template for the above
├── Dialog.html              "Add Author" modal (auth step + preview step)
└── Callback.html            OAuth callback page shown in the popup window
```

---

## Configuration

Three constants in `Credentials.gs` must be set by the script owner (they were
originally at the top of `Code.gs`; `startOAuth()`'s error message still says
"Edit Code.gs" and is stale). See [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
for the step ordering.

| Constant | Example | Description |
|----------|---------|-------------|
| `ORCID_CLIENT_ID_` | `APP-XXXXXXXXXXXXXXXX` | Client ID from orcid.org/developer-tools |
| `ORCID_CLIENT_SECRET_` | `xxxxxxxx-xxxx-...` | Client secret from orcid.org/developer-tools |
| `ORCID_CALLBACK_URL_` | `https://script.google.com/macros/s/AKfycb.../exec` | Web app deployment URL; must exactly match the redirect URI registered with ORCID |

---

## Deployment Requirements

1. **ORCID developer app** registered at [orcid.org/developer-tools](https://orcid.org/developer-tools) with the web app URL set as the redirect URI.
2. **Apps Script web app** deployed as:
   - Execute as: **Me** (the script owner)
   - Who has access: **Anyone**
3. **GCP project** linked to the script with:
   - OAuth consent screen configured (External, with script owner added as test user)
   - Google Docs API and Apps Script API enabled

---

## Security Notes

- The `state` UUID prevents CSRF on the OAuth callback.
- Client credentials are stored as script constants (in the script source), not in user-facing storage. The script should not be shared publicly.
- Only **public** ORCID data is accessed — the `/authenticate` scope does not grant access to private or limited-visibility records.
- The access token received from ORCID is used only for the profile fetch and is not stored beyond the request.
