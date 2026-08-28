# ORCID Author Add-on

A Google Docs™ add-on that lets co-authors add themselves to a shared paper by
signing in with ORCID OAuth. On successful authentication it pulls the author's public
name, current affiliations and ROR identifiers, and inserts a formatted entry under
an **Authors** heading.

Each co-author repeats this independently, so the author list assembles itself with
correctly spelled names and real identifiers instead of the usual hand-typed drift.

```
Add Author via ORCID
  → Sign in with ORCID  →  preview name + affiliations  →  Insert into Document
```

Inserted entry:

> **Jane Q. Researcher**  https://orcid.org/0000-0002-1825-0097
> &nbsp;&nbsp;&nbsp;&nbsp;University of Somewhere  https://ror.org/012a34b56

## What it does

- **ORCID OAuth sign-in** using the `/authenticate` scope. It returns the person's ORCID iD and nothing private.
- **Public profile lookup** against the ORCID Public API v3.0 (`/person`,
  `/employments`), preferring current positions and de-duplicating by organisation.
- **ROR identifiers** for affiliations, when available in ORCID
- **Idempotent insertion** — an author whose ORCID iD already appears in the document is skipped rather than duplicated.
- **Finds or creates the section** — inserts after an existing `Authors` or Author contributions` paragraph, otherwise appends a new `Authors` heading.

## Architecture in one paragraph

One Apps Script project plays two roles. As a **container-bound add-on** it draws
the menu and dialog inside the Doc. As a **web app** (`doGet`) it is the OAuth
redirect target ORCID calls back to. Those run in separate execution contexts and
cannot share variables, so they hand off through `CacheService`: the dialog stores a
`state` UUID in the user cache, the callback writes the fetched profile into the
script cache under that UUID, and the dialog polls until it appears. Full detail in
[DESIGN.md](DESIGN.md).

## Setup

Requires an ORCID developer app and a deployed Apps Script web app, and the two
reference each other — see **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** 

Short version:

```bash
npm install -g @google/clasp
clasp login
clasp clone <your scriptId>      # or create a bound script from Extensions → Apps Script
cp Credentials.example.gs Credentials.gs
clasp push
```

Then fill in `Credentials.gs` **in the Apps Script editor** — it is excluded from
`clasp push` 

## Files

| File | Role |
|---|---|
| `Code.gs` | Menu, OAuth initiation, `doGet` callback, document insertion |
| `OrcidApi.gs` | ORCID Public API calls, name and affiliation parsing |
| `Dialog.html` | The modal: sign-in step, then preview-and-confirm |
| `Callback.html` | Page rendered in the OAuth popup after ORCID redirects |
| `Credentials.example.gs` | Template for the three OAuth constants |
| `appsscript.json` | Apps Script manifest |
| `DESIGN.md` | Architecture, OAuth sequence, cache design, security notes |

`Credentials.gs` and `.clasp.json` are gitignored — the first holds secrets, the
second binds one developer to one script and Doc.

## Privacy and scope

Only **public** ORCID data is read. The `/authenticate` scope grants an ORCID iD,
not access to limited-visibility or private records, and the access token is used
for the profile fetch and then discarded. Cached values (the OAuth `state` and the pending profile) expire after 10 minutes.

## License

See [LICENSE](LICENSE).

