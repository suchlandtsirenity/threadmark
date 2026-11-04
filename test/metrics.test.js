import test from 'node:test';
import assert from 'node:assert/strict';
import { goldGroups, pairScores, statusAccuracy } from '../eval/metrics.js';
import { labelledMessages, STATUS } from '../eval/dataset.js';
import { splitBursts } from '../src/bursts.js';

test('pair scores', () => {
  const gold = [['a', 'b', 'c'], ['d', 'e']];
  assert.deepEqual(pairScores(gold, gold), { precision: 1, recall: 1, f1: 1 });
  // One big group: every gold pair found (recall 1), but most pairs are wrong.
  const lumped = pairScores([['a', 'b', 'c', 'd', 'e']], gold);
  assert.equal(lumped.recall, 1);
  assert.equal(lumped.precision, 0.4);
  // Leaving a message out loses its pairs but adds no wrong ones.
  assert.deepEqual(pairScores([['a', 'b'], ['d', 'e']], gold), { precision: 1, recall: 0.5, f1: 2 / 3 });
  assert.deepEqual(pairScores([], gold), { precision: 0, recall: 0, f1: 0 });
});

test('status is judged against the majority label', () => {
  const msgs = [{ id: '1', label: 'x' }, { id: '2', label: 'x' }, { id: '3', label: 'y' }, { id: '4', label: null }];
  const eps = [{ messageIds: ['1', '2', '3'], status: 'open' }, { messageIds: ['3'], status: 'open' }, { messageIds: ['4'], status: 'info' }];
  assert.equal(statusAccuracy(eps, msgs, { x: 'resolved', y: 'open' }), 0.5);
});

test('the dataset is consistent', () => {
  const msgs = labelledMessages();
  assert.equal(new Set(msgs.map((m) => m.id)).size, msgs.length, 'unique IDs');
  assert.deepEqual([...msgs].sort((a, b) => a.at.localeCompare(b.at)), msgs, 'in time order');
  for (const m of msgs) if (m.label) assert.ok(STATUS[m.label], `label ${m.label} has a status`);
  // Three bursts, and the first one mixes two real conversations.
  const bursts = splitBursts(msgs);
  assert.equal(bursts.length, 3);
  assert.deepEqual(new Set(bursts[0].map((m) => m.label).filter(Boolean)), new Set(['export', 'sso']));
  assert.equal(goldGroups(msgs).length, 6);
});
