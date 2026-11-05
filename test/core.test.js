import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlack, parseDiscord } from '../src/import.js';
import { splitBursts } from '../src/bursts.js';
import { verifyEpisodes } from '../src/verify.js';

const at = (min) => new Date(Date.UTC(2026, 2, 2, 9, 0) + min * 60_000).toISOString();
const msg = (id, min, text = 'hi') => ({ id, at: at(min), author: 'a', text });

test('Slack rows: skips joins, unescapes text, sorts by time', () => {
  const rows = [
    { type: 'message', ts: '1772442000.000200', user: 'U2', user_profile: { display_name: 'mo' }, text: 'see <https://x.io/a|the doc> &amp; <#C1|general>' },
    { type: 'message', subtype: 'channel_join', ts: '1772441000.000100', user: 'U3', text: 'joined' },
    { type: 'message', ts: '1772441900.000100', user: 'U1', text: 'a &lt; b' },
  ];
  assert.deepEqual(parseSlack(rows), [
    { id: '1772441900.000100', at: '2026-03-02T08:58:20.000Z', author: 'U1', text: 'a < b' },
    { id: '1772442000.000200', at: '2026-03-02T09:00:00.000Z', author: 'mo', text: 'see the doc & #general' },
  ]);
});

test('Discord export: nickname wins, empty messages are dropped', () => {
  const out = parseDiscord({ messages: [
    { id: '2', timestamp: '2026-03-02T09:01:00+00:00', author: { name: 'b', nickname: 'Bee' }, content: 'second' },
    { id: '1', timestamp: '2026-03-02T09:00:00+00:00', author: { name: 'a' }, content: 'first' },
    { id: '3', timestamp: '2026-03-02T09:02:00+00:00', author: { name: 'a' }, content: '' },
  ] });
  assert.deepEqual(out.map((m) => [m.id, m.author]), [['1', 'a'], ['2', 'Bee']]);
});

test('bursts split on quiet gaps and on size', () => {
  const msgs = [msg('a', 0), msg('b', 30), msg('c', 200), msg('d', 201), msg('e', 202)];
  assert.deepEqual(splitBursts(msgs).map((b) => b.map((m) => m.id)), [['a', 'b'], ['c', 'd', 'e']]);
  assert.deepEqual(splitBursts(msgs, { maxBurst: 2 }).map((b) => b.length), [2, 2, 1]);
});

test('verification keeps what holds up and records the rest', () => {
  const burst = [msg('1', 0), msg('2', 1), msg('3', 2), msg('4', 3)];
  const raw = { episodes: [
    { title: 'Login bug', status: 'resolved', message_ids: ['3', '1', '99'],
      points: [{ text: 'Reported', cites: ['1'] }, { text: 'Fixed', cites: ['4', '3'] }, { text: 'Vibes', cites: [] }] },
    { title: 'Dup', status: 'open', message_ids: ['1', '2'], points: [{ text: 'x', cites: ['1'] }] },
    { title: 'Ghost', status: 'open', message_ids: ['98'], points: [] },
  ] };
  const { episodes, issues, stats } = verifyEpisodes(raw, burst);

  assert.deepEqual(episodes[0].messageIds, ['1', '3'], 'unknown id dropped, transcript order restored');
  assert.deepEqual(episodes[0].points.map((p) => p.cites), [['1'], ['3'], []]);
  assert.equal(episodes[0].points[2].uncited, true);
  assert.deepEqual(episodes[1].messageIds, ['2'], 'message 1 already belongs to episode 1');
  assert.equal(episodes[1].points[0].uncited, true, 'its cite now points outside the episode');
  assert.equal(episodes.length, 2, 'an episode with no real messages is dropped');

  assert.deepEqual(issues.map((i) => i.kind).sort(), [
    'cite-outside-episode', 'cite-outside-episode', 'claimed-twice', 'empty-episode', 'unknown-message', 'unknown-message',
  ]);
  assert.deepEqual(stats, { cites: 4, validCites: 2, points: 4, uncitedPoints: 2 });
});

test('verification survives a malformed answer', () => {
  assert.deepEqual(verifyEpisodes(null, [msg('1', 0)]).episodes, []);
  assert.deepEqual(verifyEpisodes({ episodes: [{ title: 't', message_ids: ['1'] }] }, [msg('1', 0)]).episodes[0].points, []);
});
