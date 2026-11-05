// Splits a sorted timeline into bursts of activity. A quiet gap of more than
// `gapMinutes` starts a new burst; a burst longer than `maxBurst` messages is cut
// into consecutive windows so a single model request stays a sensible size.
// `gapMinutes` may be Infinity, meaning bursts are cut on size alone.
export function splitBursts(messages, { gapMinutes = 90, maxBurst = 150 } = {}) {
  if (typeof gapMinutes !== 'number' || !(gapMinutes > 0)) throw new RangeError(`gapMinutes must be a positive number, got ${gapMinutes}`);
  if (!Number.isInteger(maxBurst) || maxBurst < 1) throw new RangeError(`maxBurst must be a positive whole number, got ${maxBurst}`);

  const bursts = [];
  let current = [];
  let last = null;
  for (const m of messages) {
    const t = Date.parse(m.at);
    if (Number.isNaN(t)) throw new Error(`message ${m.id} has an invalid timestamp`);
    if (last !== null && t < last) throw new Error(`messages are not in time order at ${m.id}`);
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
