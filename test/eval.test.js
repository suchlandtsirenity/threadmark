// Checks the evaluation itself. Fake models with known behaviour run through
// the real pipeline (bursts, request, verification, scoring), so a mistake in
// the eval shows up as a wrong score for a model whose right score is known.
import test from 'node:test';
import assert from 'node:assert/strict';
import { labelledMessages, STATUS } from '../eval/dataset.js';
import { goldGroups, pairScores, statusAccuracy } from '../eval/metrics.js';
import { digest, totals } from '../src/digest.js';

const messages = labelledMessages();
const gold = goldGroups(messages);
const labelOf = new Map(messages.map((m) => [m.id, m.label]));
const idsIn = (req) => [...req.messages[0].content.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
const reply = (episodes) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ episodes }) }] });

async function score(answerFor) {
  const bursts = await digest(messages, { complete: async (req) => reply(answerFor(idsIn(req))) });
  const episodes = bursts.flatMap((b) => b.episodes);
  const t = totals(bursts);
  return {
    ...pairScores(episodes.map((e) => e.messageIds), gold),
    status: statusAccuracy(episodes, messages, STATUS),
    validCitations: t.cites ? t.validCites / t.cites : null,
    issues: t.issues,
  };
}

// Groups a burst's IDs by their hand label, leaving chatter out.
function byLabel(ids) {
  const groups = new Map();
  for (const id of ids) if (labelOf.get(id)) groups.set(labelOf.get(id), [...(groups.get(labelOf.get(id)) ?? []), id]);
  return groups;
}

test('eval: a model that knows the labels scores 100% on everything', async () => {
  const s = await score((ids) => [...byLabel(ids)].map(([label, mids]) => ({
    title: label, status: STATUS[label], message_ids: mids, points: [{ text: `about ${label}`, cites: [mids[0]] }],
  })));
  assert.deepEqual(s, { precision: 1, recall: 1, f1: 1, status: 1, validCitations: 1, issues: 0 });
});

test('eval: lumping each burst into one episode scores exactly the time-gap baseline', async () => {
  const s = await score((ids) => [{ title: 'all', status: 'open', message_ids: ids, points: [] }]);
  assert.equal(Math.round(s.precision * 100), 33);
  assert.equal(s.recall, 1);
  assert.equal(Math.round(s.f1 * 100), 50);
});

test('eval: one episode per message finds no pairs at all', async () => {
  const s = await score((ids) => ids.map((id) => ({ title: id, status: 'info', message_ids: [id], points: [] })));
  assert.deepEqual([s.precision, s.recall, s.f1], [0, 0, 0]);
});

test('eval: perfect groups with wrong statuses lose only status accuracy', async () => {
  const flip = { resolved: 'open', open: 'resolved', info: 'open' };
  const s = await score((ids) => [...byLabel(ids)].map(([label, mids]) => ({ title: label, status: flip[STATUS[label]], message_ids: mids, points: [] })));
  assert.deepEqual([s.precision, s.recall, s.status], [1, 1, 0]);
});

test('eval: citing outside the episode is caught and lowers the citation score', async () => {
  const s = await score((ids) => {
    const groups = [...byLabel(ids)];
    return groups.map(([label, mids], i) => ({
      title: label, status: STATUS[label], message_ids: mids,
      // Cite one message from this episode and one from the next (wrapping).
      points: [{ text: 'mixed', cites: [mids[0], groups[(i + 1) % groups.length][1][0]] }],
    }));
  });
  assert.equal(s.f1, 1, 'grouping is still perfect');
  assert.ok(s.validCitations < 1 && s.validCitations >= 0.5, `got ${s.validCitations}`);
  assert.ok(s.issues > 0);
});

test('eval: a model claiming the same message in two episodes cannot double-count it', async () => {
  const answer = (ids) => [
    ...[...byLabel(ids)].map(([label, mids]) => ({ title: label, status: STATUS[label], message_ids: mids, points: [] })),
    { title: 'everything again', status: 'open', message_ids: ids, points: [] },
  ];
  const bursts = await digest(messages, { complete: async (req) => reply(answer(idsIn(req))) });
  const labelled = messages.filter((m) => m.label).length;
  const claimedTwice = bursts.flatMap((b) => b.issues).filter((i) => i.kind === 'claimed-twice').length;
  assert.equal(claimedTwice, labelled, 'every repeat claim on a labelled message is refused');
  // All that's left in the catch-all is chatter nobody claimed first.
  const leftovers = bursts.flatMap((b) => b.episodes).filter((e) => e.title === 'everything again').flatMap((e) => e.messageIds);
  assert.deepEqual(leftovers, messages.filter((m) => !m.label).map((m) => m.id));
  assert.equal(pairScores(bursts.flatMap((b) => b.episodes).map((e) => e.messageIds), gold).recall, 1);
});
