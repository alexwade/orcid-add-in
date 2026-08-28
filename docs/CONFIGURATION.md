# Configuration

Setting this up means wiring three things to each other: an ORCID developer app, an
Apps Script **web app** deployment, and the credentials file. The awkward part is
that ORCID needs the deployment URL, and you only get that URL by deploying — so do
it in the order below rather than the order it seems to want.

## 0. Prerequisites

- A Google account and a Doc to bind the script to.
- An [ORCID account](https://orcid.org) — the developer tools are free.
- `clasp` if you want local development: `npm install -g @google/clasp && clasp login`.

## 1. Create the bound script

From the Doc: **Extensions → Apps Script**. That creates a *container-bound* project,
which is what makes `DocumentApp.getActiveDocument()` work.

To develop locally instead, `clasp clone <scriptId>` and push. `.clasp.json` is
gitignored, so each developer binds to their own script and Doc.

## 2. Deploy as a web app — before registering with ORCID

The OAuth callback (`doGet`) has to be reachable by ORCID's servers, which means a
web app deployment. Deploy **now**, with placeholder credentials still in place, so
that you have a URL to register.

**Deploy → New deployment → Web app**, then:

| Setting | Value | Why |
|---|---|---|
| Execute as | **Me** | The callback exchanges the client secret; it must run as the owner |
| Who has access | **Anyone** | ORCID redirects the user's browser here; it cannot authenticate to Google |

Copy the deployment URL — it looks like:

```
https://script.google.com/macros/s/AKfycb..../exec
```

> **The single biggest footgun.** Creating a *new* deployment mints a *new* URL,
> which no longer matches the redirect URI registered with ORCID, and sign-in fails
> with a redirect-mismatch error. When you change code, use **Deploy → Manage
> deployments → edit (pencil) → New version** on the existing deployment. That keeps
> the `/exec` URL stable. Only create a new deployment if you intend to re-register
> the URL with ORCID.

## 3. Register the ORCID developer app

Go to [orcid.org/developer-tools](https://orcid.org/developer-tools) and register an
application. Set the **redirect URI** to the exact `/exec` URL from step 2 — ORCID
matches it byte for byte, so no trailing slash, no `?`, no `/dev` variant.

You get back a **client ID** (`APP-…`) and a **client secret**.

## 4. Fill in the credentials

`Credentials.gs` is excluded from `clasp push` *and* gitignored. That is deliberate:
a push cannot overwrite your secrets, and consequently a push cannot upload them
either — so the real file has to be created in the Apps Script editor.

In the Apps Script editor, add a file named `Credentials.gs`:

```javascript
const ORCID_CLIENT_ID_     = 'APP-XXXXXXXXXXXXXXXX';
const ORCID_CLIENT_SECRET_ = '••••••••-••••-••••-••••-••••••••••••';
const ORCID_CALLBACK_URL_  = 'https://script.google.com/macros/s/AKfycb..../exec';
```

Locally, `cp Credentials.example.gs Credentials.gs` keeps the editor and your
working copy in sync for reference. Never commit the filled version.

After editing, **publish a new version of the existing deployment** (step 2's note)
or the live callback keeps running the old code.

## 5. OAuth consent screen

The script's own Google authorisation is separate from ORCID's. In the linked Cloud
project, under **Google Auth Platform → Audience**:

- User type **External**
- Publishing status **Testing** is fine for a private team — but add every user,
  **including yourself**, to the Test users list. Owning the project does not make
  you a test user; without it you get `Error 403: access_denied`.
- The 100-test-user cap is counted over the app's lifetime, not concurrently.

## 6. Verify

1. Reload the Doc. **The Stacks → Add Author via ORCID** should appear (`onOpen`
   only runs on load).
2. Click **Sign in with ORCID**. A popup should reach orcid.org, not an error page.
3. Authenticate. The popup should show a success message and close itself.
4. The dialog should display your name and affiliations within a few seconds — it
   polls every 2.5s against a 10-minute cache window.
5. **Insert into Document** should write the entry under an `Authors` heading.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `redirect_uri` mismatch from ORCID | Deployment URL changed (a new deployment was created) or does not exactly equal the registered redirect URI |
| Dialog spins forever after sign-in | The callback ran in a different context and never wrote to the script cache — check the web app is deployed *Execute as: Me*, *Anyone*; check Executions for a `doGet` error |
| `Error 403: access_denied` on the Google consent screen | Your account is not in the OAuth Test users list (step 5) |
| "Edit Code.gs and set ORCID_CLIENT_ID_…" | Placeholders still in place. The message names the wrong file — the constants live in `Credentials.gs` |
| Nothing inserted, no error | The author's ORCID iD is already present; insertion is idempotent by design |
| Blank name or no affiliations | The ORCID record has them set to limited/private visibility. `/authenticate` reads public data only |

## Security notes

- The client secret lives in the script source and is used only server-side, inside
  the callback. It never reaches the browser.
- The OAuth `state` is a UUID held in the per-user cache for 10 minutes, which is
  what prevents CSRF on the callback.
- The ORCID access token is used for one profile fetch and discarded.
- Because the web app is deployed *Anyone* + *Execute as: Me*, treat `doGet` as
  publicly reachable — it only accepts a `code`/`state` pair and returns a static
  page otherwise.
