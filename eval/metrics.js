// Scores predicted episodes against hand labels.
//
// Grouping is scored on pairs: two messages form a pair when they share an
// episode. Precision is the share of predicted pairs that are real; recall is
// the share of real pairs that were found. Messages left out of every episode
// (or labelled null) form no pairs, so leaving chatter out costs nothing and
// leaving real messages out costs recall.

// groups: arrays of message IDs. Returns a Set of "a|b" pair keys.
function pairs(groups) {
  const out = new Set();
  for (const g of groups) {
    const ids = [...g].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.add(`${ids[i]}|${ids[j]}`);
  }
  return out;
}

export function goldGroups(messages) {
  const byLabel = new Map();
  for (const m of messages) if (m.label) byLabel.set(m.label, [...(byLabel.get(m.label) ?? []), m.id]);
  return [...byLabel.values()];
}

export function pairScores(predicted, gold) {
  const p = pairs(predicted), g = pairs(gold);
  const hit = [...p].filter((k) => g.has(k)).length;
  const precision = p.size ? hit / p.size : 0;
  const recall = g.size ? hit / g.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

// For each predicted episode, the label most of its messages carry, and whether
// its status matches how that labelled conversation actually ended.
export function statusAccuracy(episodes, messages, statusByLabel) {
  const label = new Map(messages.map((m) => [m.id, m.label]));
  let judged = 0, right = 0;
  for (const ep of episodes) {
    const counts = {};
    for (const id of ep.messageIds) if (label.get(id)) counts[label.get(id)] = (counts[label.get(id)] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!top || !ep.status) continue;
    judged++;
    if (ep.status === statusByLabel[top]) right++;
  }
  return judged ? right / judged : null;
}
