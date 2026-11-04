// Splits a sorted timeline into bursts of activity. A quiet gap of more than
// `gapMinutes` starts a new burst; a burst longer than `maxBurst` messages is cut
// into consecutive windows so a single model request stays a sensible size.
export function splitBursts(messages, { gapMinutes = 90, maxBurst = 150 } = {}) {
  const bursts = [];
  let current = [];
  let last = null;
  for (const m of messages) {
    const t = Date.parse(m.at);
    if (current.length && (t - last > gapMinutes * 60_000 || current.length >= maxBurst)) {
      bursts.push(current);
      current = [];
    }
    current.push(m);
    last = t;
  }
  if (current.length) bursts.push(current);
  return bursts;
}
