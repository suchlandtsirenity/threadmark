// Checks a model's episodes against the burst they were made from. The model's
// answer is a claim: anything that doesn't hold up is corrected and recorded as
// an issue, never silently trusted.
//
// Returns { episodes, issues, stats }, where stats counts citations before
// correction so the eval can report how often the model cited correctly.
export function verifyEpisodes(raw, burst) {
  const known = new Set(burst.map((m) => m.id));
  const claimed = new Set();
  const issues = [];
  const stats = { cites: 0, validCites: 0, points: 0, uncitedPoints: 0 };
  const episodes = [];

  for (const [i, ep] of (raw?.episodes ?? []).entries()) {
    const where = `episode ${i + 1} ("${ep.title}")`;
    const ids = [];
    for (const id of ep.message_ids ?? []) {
      if (!known.has(id)) issues.push({ kind: 'unknown-message', where, id });
      else if (claimed.has(id)) issues.push({ kind: 'claimed-twice', where, id });
      else { ids.push(id); claimed.add(id); }
    }
    if (!ids.length) {
      issues.push({ kind: 'empty-episode', where });
      continue;
    }

    const own = new Set(ids);
    const points = (ep.points ?? []).map((p) => {
      stats.points++;
      const cites = [];
      for (const id of p.cites ?? []) {
        stats.cites++;
        if (own.has(id)) { cites.push(id); stats.validCites++; }
        else issues.push({ kind: known.has(id) ? 'cite-outside-episode' : 'unknown-cite', where, id });
      }
      if (!cites.length) stats.uncitedPoints++;
      return { text: p.text, cites, uncited: cites.length === 0 };
    });

    // Keep the transcript order, whatever order the model listed them in.
    const order = burst.filter((m) => own.has(m.id)).map((m) => m.id);
    episodes.push({ title: ep.title, status: ep.status, messageIds: order, points });
  }
  return { episodes, issues, stats };
}
