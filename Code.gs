// Credentials are defined in Credentials.gs (excluded from clasp push).

const ORCID_BASE = 'https://orcid.org';
const ORCID_API  = 'https://pub.orcid.org/v3.0';

// ── Menu ─────────────────────────────────────────────────────────────────────

function onOpen() {
  DocumentApp.getUi()
    .createMenu('The Stacks')
    .addItem('Add Author via ORCID', 'showAddAuthorDialog')
    .addToUi();
}

// ── Dialog entry point ────────────────────────────────────────────────────────

function showAddAuthorDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Dialog')
    .setWidth(440)
    .setHeight(340);
  DocumentApp.getUi().showModalDialog(html, 'Add Author via ORCID');
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

function startOAuth() {
  if (ORCID_CLIENT_ID_ === 'APP-XXXXXXXXXXXXXXXX') {
    return { error: 'Edit Code.gs and set ORCID_CLIENT_ID_, ORCID_CLIENT_SECRET_, and ORCID_CALLBACK_URL_.' };
  }

  const state = Utilities.getUuid();
  // Store state in per-user cache (10 min — plenty for an OAuth round-trip).
  CacheService.getUserCache().put('orcid_oauth_state', state, 600);

  const authUrl = ORCID_BASE + '/oauth/authorize'
    + '?client_id='     + encodeURIComponent(ORCID_CLIENT_ID_)
    + '&response_type=code'
    + '&scope=/authenticate'
    + '&redirect_uri='  + encodeURIComponent(ORCID_CALLBACK_URL_)
    + '&state='         + encodeURIComponent(state);

  return { authUrl };
}

// Called by ORCID after authorization (web app doGet endpoint).
function doGet(e) {
  const p = e.parameter || {};
  if (p.code && p.state) {
    return handleOAuthCallback_(p);
  }
  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;padding:24px">ORCID Author Add-on — OAuth callback endpoint.</p>'
  );
}

function handleOAuthCallback_(p) {
  const tpl = HtmlService.createTemplateFromFile('Callback');

  let tokenResp;
  try {
    tokenResp = UrlFetchApp.fetch(ORCID_BASE + '/oauth/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: 'client_id='     + encodeURIComponent(ORCID_CLIENT_ID_)
             + '&client_secret=' + encodeURIComponent(ORCID_CLIENT_SECRET_)
             + '&grant_type=authorization_code'
             + '&code='          + encodeURIComponent(p.code)
             + '&redirect_uri='  + encodeURIComponent(ORCID_CALLBACK_URL_),
      headers: { 'Accept': 'application/json' },
      muteHttpExceptions: true,
    });
  } catch (err) {
    tpl.success  = false;
    tpl.message  = 'Token request failed: ' + err.message;
    tpl.debugUri = ORCID_CALLBACK_URL_;
    return tpl.evaluate();
  }

  if (tokenResp.getResponseCode() !== 200) {
    tpl.success  = false;
    tpl.message  = 'ORCID error ' + tokenResp.getResponseCode() + ': ' + tokenResp.getContentText();
    tpl.debugUri = ORCID_CALLBACK_URL_;
    return tpl.evaluate();
  }

  const token = JSON.parse(tokenResp.getContentText());
  if (!token.orcid) {
    tpl.success  = false;
    tpl.message  = 'No ORCID iD in token response.';
    tpl.debugUri = '';
    return tpl.evaluate();
  }

  const author = fetchOrcidProfile(token.orcid, token.access_token);

  // Store result in script-level cache keyed by state UUID so pollForAuthor()
  // can retrieve it regardless of which user context is running.
  CacheService.getScriptCache().put('orcid_pending_' + p.state, JSON.stringify(author), 600);

  tpl.success  = true;
  tpl.message  = author.name;
  tpl.orcid    = token.orcid;
  tpl.debugUri = '';
  return tpl.evaluate();
}

// Polled by the dialog every 2.5 s until the author profile is ready.
function pollForAuthor() {
  const userCache   = CacheService.getUserCache();
  const scriptCache = CacheService.getScriptCache();

  const state = userCache.get('orcid_oauth_state');
  if (!state) return null;

  const authorJson = scriptCache.get('orcid_pending_' + state);
  if (!authorJson) return null;

  userCache.remove('orcid_oauth_state');
  scriptCache.remove('orcid_pending_' + state);

  return JSON.parse(authorJson);
}

// ── Document insertion ────────────────────────────────────────────────────────

function insertAuthor(author) {
  const doc  = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  if (author.orcid && body.findText(author.orcid)) {
    return { skipped: true, reason: author.name + ' is already in the document.' };
  }

  let insertIdx = findOrCreateAuthorSection_(body);

  // Name line: bold name + ORCID iD as hyperlink.
  const namePara = body.insertParagraph(insertIdx++, '');
  const nameEl   = namePara.editAsText();
  const orcidUrl = 'https://orcid.org/' + author.orcid;
  nameEl.setText(author.name);
  nameEl.setBold(0, author.name.length - 1, true);
  nameEl.appendText('  ');
  const orcidStart = nameEl.getText().length;
  nameEl.appendText(orcidUrl);
  nameEl.setLinkUrl(orcidStart, nameEl.getText().length - 1, orcidUrl);

  // Affiliation lines (indented), ROR ID as hyperlink.
  for (const aff of (author.affiliations || [])) {
    const affPara = body.insertParagraph(insertIdx++, '');
    affPara.setIndentStart(36);
    const affEl = affPara.editAsText();
    affEl.setText(aff.name);
    if (aff.rorId) {
      affEl.appendText('  ');
      const rorStart = affEl.getText().length;
      affEl.appendText(aff.rorId);
      affEl.setLinkUrl(rorStart, affEl.getText().length - 1, aff.rorId);
    }
  }

  return { success: true };
}

function findOrCreateAuthorSection_(body) {
  const n = body.getNumChildren();
  for (let i = 0; i < n; i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const t = child.asParagraph().getText().trim().toLowerCase();
    if (t === 'authors' || t === 'authors:' || t.startsWith('author contributions')) {
      return i + 1;
    }
  }
  body.appendHorizontalRule();
  const heading = body.appendParagraph('Authors');
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  return body.getChildIndex(heading) + 1;
}
