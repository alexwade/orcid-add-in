// Fetches name and current affiliations from the ORCID Public API.
function fetchOrcidProfile(orcid, accessToken) {
  const headers = { 'Accept': 'application/vnd.orcid+json' };
  if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;

  function getJson(path) {
    const resp = UrlFetchApp.fetch(ORCID_API + '/' + orcid + path, {
      headers,
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) return null;
    return JSON.parse(resp.getContentText());
  }

  const person      = getJson('/person');
  const employments = getJson('/employments');

  return {
    orcid,
    name:         parseName_(person),
    affiliations: parseAffiliations_(employments),
  };
}

function parseName_(person) {
  if (!person || !person.name) return 'Unknown';
  const n = person.name;
  const credit = (n['credit-name']  || {}).value;
  const given  = ((n['given-names'] || {}).value || '').trim();
  const family = ((n['family-name'] || {}).value || '').trim();
  return credit || [given, family].filter(Boolean).join(' ') || 'Unknown';
}

function parseAffiliations_(employments) {
  if (!employments || !employments['affiliation-group']) return [];

  const all = [];
  for (const group of employments['affiliation-group']) {
    for (const s of (group.summaries || [])) {
      const emp = s['employment-summary'];
      if (!emp) continue;
      const org     = emp.organization || {};
      const disambig = org['disambiguated-organization'] || {};

      let rorId = null;
      if (disambig['disambiguation-source'] === 'ROR') {
        rorId = disambig['disambiguated-organization-identifier'] || null;
        // Normalise: ensure it starts with https://ror.org/
        if (rorId && !rorId.startsWith('http')) {
          rorId = 'https://ror.org/' + rorId;
        }
      }

      all.push({
        name:      org.name || '',
        rorId,
        isCurrent: !emp['end-date'],
      });
    }
  }

  // Prefer current positions; fall back to all if none are current.
  const current = all.filter(a => a.isCurrent);
  const toUse   = current.length > 0 ? current : all;

  // Deduplicate by organisation name.
  const seen = new Set();
  return toUse.filter(a => {
    if (!a.name || seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  }).map(({ name, rorId }) => ({ name, rorId }));
}
