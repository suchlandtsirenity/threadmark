// Checks a model's episodes against the burst they were made from. The model's
// answer is a claim: anything that doesn't hold up is corrected and recorded as
// an issue, never silently trusted. The JSON schema should rule out most of the
// malformed shapes handled here, but this function doesn't rely on it: given any
// JSON value it returns a well-formed result and never throws.
//
// Returns { episodes, issues, stats }, where stats counts citations before
// correction so the eval can report how often the model cited correctly.
export const STATUSES = new Set(['resolved', 'open', 'info']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

export function verifyEpisodes(raw, burst) {
  const known = new Set(burst.map((m) => m.id));
  const claimed = new Set();
  const issues = [];
  const stats = { cites: 0, validCites: 0, points: 0, uncitedPoints: 0 };
  const episodes = [];

  const list = isObject(raw) ? raw.episodes : undefined;
  if (!Array.isArray(list)) {
    issues.push({ kind: 'malformed-answer', where: 'answer' });
    return { episodes, issues, stats };
  }

  for (const [i, ep] of list.entries()) {
    if (!isObject(ep)) {
      issues.push({ kind: 'malformed-episode', where: `episode ${i + 1}` });
      continue;
    }
    const title = isText(ep.title) ? ep.title : '(untitled)';
    const where = `episode ${i + 1} ("${title}")`;
    if (title !== ep.title) issues.push({ kind: 'missing-title', where });
    const status = STATUSES.has(ep.status) ? ep.status : null;
    if (status === null) issues.push({ kind: 'bad-status', where, value: ep.status });

    if (!Array.isArray(ep.message_ids)) issues.push({ kind: 'malformed-episode', where, field: 'message_ids' });
    const ids = [];
    for (const id of Array.isArray(ep.message_ids) ? ep.message_ids : []) {
      if (typeof id !== 'string' || !known.has(id)) issues.push({ kind: 'unknown-message', where, id });
      else if (claimed.has(id)) issues.push({ kind: 'claimed-twice', where, id });
      else { ids.push(id); claimed.add(id); }
    }
    if (!ids.length) {
      issues.push({ kind: 'empty-episode', where });
      continue;
    }

    const own = new Set(ids);
    if (!Array.isArray(ep.points)) issues.push({ kind: 'malformed-episode', where, field: 'points' });
    const points = [];
    for (const p of Array.isArray(ep.points) ? ep.points : []) {
      if (!isObject(p) || !isText(p.text)) {
        issues.push({ kind: 'malformed-point', where });
        continue;
      }
      stats.points++;
      if (!Array.isArray(p.cites)) issues.push({ kind: 'malformed-cites', where });
      const cites = [];
      const seen = new Set();
      for (const id of Array.isArray(p.cites) ? p.cites : []) {
        if (seen.has(id)) { issues.push({ kind: 'duplicate-cite', where, id }); continue; }
        seen.add(id);
        stats.cites++;
        if (typeof id === 'string' && own.has(id)) { cites.push(id); stats.validCites++; }
        else issues.push({ kind: typeof id === 'string' && known.has(id) ? 'cite-outside-episode' : 'unknown-cite', where, id });
      }
      if (!cites.length) stats.uncitedPoints++;
      points.push({ text: p.text, cites, uncited: cites.length === 0 });
    }

    // Keep the transcript order, whatever order the model listed them in.
    const order = burst.filter((m) => own.has(m.id)).map((m) => m.id);
    episodes.push({ title, status, messageIds: order, points });
  }
  return { episodes, issues, stats };
}
