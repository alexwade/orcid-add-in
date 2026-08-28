// Template. Copy to Credentials.gs and fill in — Credentials.gs is gitignored
// AND excluded from `clasp push`, so the real values live only in the Apps Script
// editor copy and are never overwritten by a push or committed to the repo.
//
// See docs/CONFIGURATION.md for where each value comes from. The callback URL
// must match the redirect URI registered with ORCID byte for byte.
const ORCID_CLIENT_ID_     = 'APP-XXXXXXXXXXXXXXXX';
const ORCID_CLIENT_SECRET_ = 'your-client-secret-here';
const ORCID_CALLBACK_URL_  = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
