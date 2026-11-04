import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequest, readResponse, transcript } from '../src/episodes.js';
import { createModel, requestKey } from '../src/model.js';
import { digest, totals } from '../src/digest.js';

const at = (min) => new Date(Date.UTC(2026, 2, 2, 23, 58) + min * 60_000).toISOString();
const msgs = [
  { id: 'a', at: at(0), author: 'kim', text: 'export is timing out' },
  { id: 'b', at: at(3), author: 'raj', text: 'which org?\nlink pls' },
  { id: 'c', at: at(300), author: 'kim', text: 'release notes are up' },
];
const answer = (episodes) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ episodes }) }] });

test('transcript marks days and indents continuation lines', () => {
  assert.equal(transcript(msgs.slice(0, 2)), [
    '--- 2026-03-02 (UTC) ---',
    '[a] 23:58 kim: export is timing out',
    '--- 2026-03-03 (UTC) ---',
    '[b] 00:01 raj: which org?',
    '    link pls',
  ].join('\n'));
});

test('the request is stable, so its recording key is too', () => {
  assert.equal(requestKey(buildRequest(msgs)), requestKey(buildRequest(structuredClone(msgs))));
  assert.notEqual(requestKey(buildRequest(msgs)), requestKey(buildRequest(msgs.slice(1))));
});

test('refusals and truncation are errors, not empty digests', () => {
  assert.throws(() => readResponse({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), /declined: cyber/);
  assert.throws(() => readResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"epi' }] }), /max-burst/);
});

test('digest runs one request per burst and verifies each answer', async () => {
  const seen = [];
  const model = { complete: async (req) => {
    seen.push(req.messages[0].content);
    return req.messages[0].content.includes('[a]')
      ? answer([{ title: 'Export timeout', status: 'open', message_ids: ['a', 'b'], points: [{ text: 'Export times out', cites: ['a', 'zz'] }] }])
      : answer([{ title: 'Release notes', status: 'info', message_ids: ['c'], points: [{ text: 'Notes published', cites: ['c'] }] }]);
  } };
  const bursts = await digest(msgs, model);
  assert.equal(seen.length, 2);
  assert.deepEqual(bursts.map((b) => b.episodes.map((e) => e.title)), [['Export timeout'], ['Release notes']]);
  assert.deepEqual(totals(bursts), { episodes: 2, issues: 1, cites: 3, validCites: 2, points: 2, uncitedPoints: 0 });
});

test('replay answers from a recording and refuses to make up a missing one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadmark-'));
  try {
    const req = buildRequest(msgs.slice(2));
    writeFileSync(join(dir, `${requestKey(req).slice(0, 16)}.json`), JSON.stringify({ request: req, response: answer([]) }));
    const model = createModel({ mode: 'replay', dir });
    assert.deepEqual(readResponse(await model.complete(req)), { episodes: [] });
    await assert.rejects(model.complete(buildRequest(msgs)), /no recording/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
