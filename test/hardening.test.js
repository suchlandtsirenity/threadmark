// Tests written from a systematic mutation run (Stryker): each pins behaviour
// that a generated mutant changed without any existing test noticing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSlack, parseDiscord, loadExport } from '../src/import.js';
import { splitBursts } from '../src/bursts.js';
import { verifyEpisodes, STATUSES } from '../src/verify.js';
import { transcript, buildRequest, readResponse, SCHEMA, SYSTEM, MODEL } from '../src/episodes.js';
import { createModel, requestKey } from '../src/model.js';
import { digest } from '../src/digest.js';
import { renderReport } from '../src/report.js';
import { statusAccuracy, pairScores } from '../eval/metrics.js';

const at = (min) => new Date(Date.UTC(2026, 2, 2, 9, 0) + min * 60_000).toISOString();
const msg = (id, min, text = 'x', author = 'a') => ({ id, at: at(min), author, text });
const tmp = () => mkdtempSync(join(tmpdir(), 'threadmark-'));
const slack = (ts, text, extra = {}) => ({ type: 'message', ts, user: 'U1', text, ...extra });
const discord = (m) => parseDiscord({ messages: [{ id: '1', timestamp: '2026-03-02T09:00:00Z', author: { name: 'a' }, content: 'hi', ...m }] });
const answer = (episodes) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ episodes }) }] });
const withDir = (fn) => { const d = tmp(); try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const withDirAsync = async (fn) => { const d = tmp(); try { return await fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

// --- the request sent to the model ---

test('request: the model, effort and output format are what the docs say', () => {
  const req = buildRequest([msg('1', 0)]);
  assert.equal(MODEL, 'claude-opus-5-5');
  assert.deepEqual(Object.keys(req).sort(), ['max_tokens', 'messages', 'model', 'output_config', 'system']);
  assert.equal(req.model, MODEL);
  assert.equal(req.system, SYSTEM);
  assert.equal(req.max_tokens, 16000);
  assert.deepEqual(req.output_config, { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } });
  assert.deepEqual(req.messages, [{ role: 'user', content: transcript([msg('1', 0)]) }]);
});

test('request: the schema asks for exactly what verification checks', () => {
  assert.deepEqual(SCHEMA, {
    type: 'object', additionalProperties: false, required: ['episodes'],
    properties: { episodes: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['title', 'status', 'message_ids', 'points'],
      properties: {
        title: { type: 'string' },
        status: { type: 'string', enum: ['resolved', 'open', 'info'] },
        message_ids: { type: 'array', items: { type: 'string' } },
        points: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['text', 'cites'],
          properties: { text: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } } },
        } },
      },
    } } },
  });
  assert.deepEqual(new Set(SCHEMA.properties.episodes.items.properties.status.enum), STATUSES, 'schema and verifier agree on statuses');
});

test('request: the system prompt is pinned, because changing it invalidates every recording', () => {
  // If this fails because you changed the prompt on purpose: re-record (npm run
  // eval -- --record), update the README's scores, then update this hash.
  assert.equal(createHash('sha256').update(SYSTEM).digest('hex').slice(0, 16), 'e61b960e8aa7e2f2');
});

// --- transcript ---

test('transcript: one date line per day, not per message', () => {
  assert.equal(transcript([msg('1', 0), msg('2', 1)]), '--- 2026-03-02 (UTC) ---\n[1] 09:00 a: x\n[2] 09:01 a: x');
});

test('transcript: an exotic line break becomes an indented continuation, keeping the text', () => {
  assert.equal(transcript([msg('1', 0, 'one\rtwo three\r\nfour')]),
    '--- 2026-03-02 (UTC) ---\n[1] 09:00 a: one\n    two\n    three\n    four');
});

test('transcript: control characters become spaces in text and author', () => {
  assert.equal(transcript([msg('1', 0, 'a\u0000b\tc', 'ki\nm‮')]), '--- 2026-03-02 (UTC) ---\n[1] 09:00 ki m : a b\tc');
});

// --- reading the model's response ---

test('readResponse: survives a missing message and odd content blocks', () => {
  assert.throws(() => readResponse(undefined), /unexpected stop reason: undefined/);
  assert.throws(() => readResponse(null), /unexpected stop reason/);
  assert.throws(() => readResponse({ stop_reason: 'end_turn', content: {} }), /no text/);
  assert.throws(() => readResponse({ stop_reason: 'end_turn', content: [null, { type: 'text', text: 5 }] }), /no text/);
  assert.throws(() => readResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '' }] }), /no text/);
  assert.throws(() => readResponse({ stop_reason: 'refusal', content: [] }), /declined: no category/);
  assert.deepEqual(readResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: '{"episodes":[]}' }] }), { episodes: [] });
});

// --- the model wrapper ---

test('model: modes and directories are checked up front', () => {
  assert.throws(() => createModel({ mode: 'replay' }), /replay mode needs a recordings directory/);
  assert.throws(() => createModel({ mode: 'record' }), /record mode needs a recordings directory/);
  assert.throws(() => createModel({ mode: 'replai', dir: 'x' }), /unknown model mode "replai"/);
  assert.equal(createModel().mode, 'live');
  assert.equal(createModel({ client: {} }).mode, 'live');
});

const fakeClient = (reply) => {
  const calls = [];
  return { calls, beta: { messages: { create: async (body) => { calls.push(body); return reply; } } } };
};

test('model: live mode sends the request with the fallback beta, and writes nothing', async () => {
  await withDirAsync(async (dir) => {
    const client = fakeClient(answer([]));
    const req = buildRequest([msg('1', 0)]);
    const model = createModel({ mode: 'live', dir, client });
    assert.deepEqual(await model.complete(req), answer([]));
    assert.deepEqual(client.calls, [{ ...req, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }]);
    assert.ok(!existsSync(join(dir, `${requestKey(req).slice(0, 16)}.json`)), 'live mode never records');
  });
});

test('model: record then replay round-trips without calling the API again', async () => {
  await withDirAsync(async (root) => {
    const dir = join(root, 'nested', 'recordings');
    const client = fakeClient(answer([{ title: 't' }]));
    const req = buildRequest([msg('1', 0)]);
    await createModel({ mode: 'record', dir, client }).complete(req);
    const file = join(dir, `${requestKey(req).slice(0, 16)}.json`);
    const saved = readFileSync(file, 'utf8');
    assert.ok(saved.endsWith('}\n'), 'pretty-printed with a trailing newline');
    assert.deepEqual(JSON.parse(saved), { request: req, response: answer([{ title: 't' }]) });
    const replayClient = fakeClient('should not be called');
    assert.deepEqual(await createModel({ mode: 'replay', dir, client: replayClient }).complete(req), answer([{ title: 't' }]));
    assert.equal(replayClient.calls.length, 0);
  });
});

test('model: a recording that is null, or has no response, is refused', async () => {
  await withDirAsync(async (dir) => {
    const req = buildRequest([msg('1', 0)]);
    const file = join(dir, `${requestKey(req).slice(0, 16)}.json`);
    writeFileSync(file, 'null');
    await assert.rejects(createModel({ mode: 'replay', dir }).complete(req), /does not match/);
    writeFileSync(file, JSON.stringify({ request: req }));
    await assert.rejects(createModel({ mode: 'replay', dir }).complete(req), /has no response/);
  });
});

// --- digest ---

test('digest: passes the burst options through and reports progress from 1', async () => {
  const msgs = [msg('a', 0), msg('b', 1), msg('c', 2)];
  const progress = [];
  const model = { complete: async () => answer([]) };
  const bursts = await digest(msgs, model, { maxBurst: 1, gapMinutes: 1000, onProgress: (i, n) => progress.push([i, n]) });
  assert.equal(bursts.length, 3);
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.equal((await digest(msgs, model, { gapMinutes: 0.5 })).length, 3, 'gapMinutes is honoured too');
});

// --- bursts ---

test('bursts: edge cases of the contract', () => {
  assert.deepEqual(splitBursts([]), [], 'no messages, no bursts');
  assert.deepEqual(splitBursts([msg('a', 0), msg('b', 0)]).length, 1, 'equal timestamps are in order');
  assert.deepEqual(splitBursts([msg('a', 0), msg('b', 1)], { maxBurst: 1 }).length, 2, 'maxBurst 1 is allowed');
  assert.throws(() => splitBursts([], { gapMinutes: '90' }), /gapMinutes must be a positive number/);
  assert.throws(() => splitBursts([], { maxBurst: '5' }), /maxBurst must be a positive whole number/);
});

// --- import: files and folders ---

test('import: only YYYY-MM-DD.json files in a Slack folder are read', () => withDir((dir) => {
  writeFileSync(join(dir, '2026-03-02.json'), JSON.stringify([slack('1772442000.000100', 'real')]));
  for (const f of ['notes.json', 'x2026-03-02.json', '2026-03-02.json.bak', 'channels.json']) writeFileSync(join(dir, f), 'not json at all');
  assert.deepEqual(loadExport(dir).map((m) => m.text), ['real']);
}));

test('import: errors name the file they came from', () => withDir((dir) => {
  const day = join(dir, '2026-03-02.json');
  writeFileSync(day, '[{"type":');
  assert.throws(() => loadExport(dir), (e) => e.message.startsWith(`${day}: not valid JSON`));
  writeFileSync(day, '{"not":"an array"}');
  assert.throws(() => loadExport(dir), (e) => e.message === `${day}: expected an array of messages`);
  writeFileSync(day, JSON.stringify([{ type: 'message', ts: 'nope', text: 'x' }]));
  assert.throws(() => loadExport(dir), (e) => e.message.startsWith(`${day}: Slack message has a missing or invalid ts`));
  const other = join(dir, 'other.json');
  writeFileSync(other, '{"foo":1}');
  assert.throws(() => loadExport(other), (e) => e.message === `${other}: not a Slack channel folder or a DiscordChatExporter JSON file`);
  writeFileSync(other, 'null');
  assert.throws(() => loadExport(other), /not a Slack channel folder/);
  writeFileSync(other, JSON.stringify({ messages: [{ id: 'x y', timestamp: '2026-03-02T09:00:00Z', content: 'hi' }] }));
  assert.throws(() => loadExport(other), (e) => e.message.startsWith(`${other}: unusable message ID`));
}));

test('import: a byte order mark is only stripped from the start of a file', () => withDir((dir) => {
  const file = join(dir, 'chat.json');
  writeFileSync(file, JSON.stringify({ messages: [{ id: '1', timestamp: '2026-03-02T09:00:00Z', author: { name: 'a' }, content: 'keep﻿this' }] }));
  assert.equal(loadExport(file)[0].text, 'keep﻿this');
}));

test('import: a broken or odd users.json falls back to user IDs', () => withDir((root) => {
  const dir = join(root, 'support');
  mkdirSync(dir);
  writeFileSync(join(dir, '2026-03-02.json'), JSON.stringify([slack('1772442000.000100', '<@U1> <@U2> <@U3> <@U4> <@U5> <@U6>')]));
  writeFileSync(join(root, 'users.json'), JSON.stringify([
    null, 5, { id: 'U1' }, { id: 'U2', profile: { display_name: '' }, name: 'two' }, { id: 7, name: 'seven' },
    { id: 'U3', real_name: 'Three' }, { id: 'U4', profile: { real_name: 'Four' } }, { id: 'U5', name: '' }, { name: 'noid' },
  ]));
  assert.equal(loadExport(dir)[0].text, '@U1 @two @Three @Four @U5 @U6');
  writeFileSync(join(root, 'users.json'), '{"not":"a list"}');
  assert.equal(loadExport(dir)[0].text, '@U1 @U2 @U3 @U4 @U5 @U6');
}));

// --- import: Slack rows ---

test('import: Slack rows that are not chat are skipped, whatever shape they have', () => {
  const out = parseSlack([
    null, 5, { type: 'channel', ts: '1.000001', text: 'x' }, slack('2.000001', null), slack('3.000001', 7), slack('4.000001', ''),
    slack('5.000001', 'file text', { subtype: 'file_share' }), slack('6.000001', 'kept'),
  ]);
  assert.deepEqual(out.map((m) => m.text), ['file text', 'kept']);
});

test('import: Slack ts must be all digits, with an optional fraction', () => {
  assert.equal(parseSlack([slack('1772442000', 'whole seconds')])[0].at, '2026-03-02T09:00:00.000Z');
  for (const ts of ['x1.5', '1.5x', '1.', '.5', '1.5.6', ' 1.5', '1e9', '-1.5', 1772442000]) {
    assert.throws(() => parseSlack([slack(ts, 'x')]), /invalid ts/, JSON.stringify(ts));
  }
});

test('import: a Slack timestamp beyond the range of a Date is refused', () => {
  assert.throws(() => parseSlack([slack('99999999999999', 'x')]), /out-of-range timestamp/);
});

test('import: Slack authors fall back to "unknown"', () => {
  assert.equal(parseSlack([{ type: 'message', ts: '1.000001', text: 'x' }])[0].author, 'unknown');
});

test('import: every kind of Slack link and mention', () => {
  const text = (s) => parseSlack([slack('1.000001', s)])[0].text;
  assert.equal(text('<@U1|kim> <@U1|@kim> <!subteam^S1|@team> <!date^1^{date}|Mar 2>'), '@kim @kim @team Mar 2');
  assert.equal(text('<http://a.io/x> <https://b.io> <mailto:a@b.io> <ftp://c.io>'), 'http://a.io/x https://b.io mailto:a@b.io <ftp://c.io>');
  assert.equal(text('<!channel> <!everyone> <!nope>'), '@channel @everyone <!nope>');
  assert.equal(text('a &lt;b&gt; &amp;'), 'a <b> &');
});

// --- import: Discord ---

test('import: Discord entries that are not chat are skipped, whatever shape they have', () => {
  const out = parseDiscord({ messages: [null, { id: '1', timestamp: '2026-03-02T09:00:00Z', content: 5 },
    { id: '2', timestamp: '2026-03-02T09:00:00Z', content: '' }, { id: '3', timestamp: '2026-03-02T09:00:00Z', content: 'ok' }] });
  assert.deepEqual(out.map((m) => [m.id, m.author]), [['3', 'unknown']]);
});

test('import: Discord authors fall back from nickname to name to "unknown"', () => {
  assert.equal(discord({ author: { nickname: 'Nick', name: 'n' } })[0].author, 'Nick');
  assert.equal(discord({ author: { nickname: '', name: 'n' } })[0].author, 'n');
  assert.equal(discord({ author: null })[0].author, 'unknown');
});

test('import: Discord IDs must be strings or safe integers', () => {
  for (const id of [null, undefined, {}, ['1'], true, 1.5]) assert.throws(() => discord({ id }), /ID/, String(id));
  assert.equal(discord({ id: 'abc_DEF-1.2:3' })[0].id, 'abc_DEF-1.2:3');
});

test('import: duplicates that differ in any field are refused', () => {
  const base = { id: '1', timestamp: '2026-03-02T09:00:00Z', author: { name: 'a' }, content: 'hi' };
  for (const change of [{ timestamp: '2026-03-02T09:00:01Z' }, { author: { name: 'b' } }, { content: 'bye' }]) {
    assert.throws(() => parseDiscord({ messages: [base, { ...base, ...change }] }), /duplicate message ID 1/, JSON.stringify(change));
  }
});

// --- verify: exact issues and corrections ---

test('verify: whitespace-only titles and point text count as missing', () => {
  const r = verifyEpisodes({ episodes: [{ title: '   ', status: 'open', message_ids: ['1'], points: [{ text: ' \n ', cites: ['1'] }, { text: 'ok', cites: ['1'] }] }] }, [msg('1', 0)]);
  assert.equal(r.episodes[0].title, '(untitled)');
  assert.deepEqual(r.episodes[0].points, [{ text: 'ok', cites: ['1'], uncited: false }]);
});

test('verify: issues say exactly what was wrong and where', () => {
  const burst = [msg('1', 0), msg('2', 1)];
  const r = verifyEpisodes({ episodes: [
    'junk',
    { title: 'Two', status: 'open', message_ids: '1', points: [] },
    { title: 'Three', status: 'open', message_ids: ['1'], points: 'p' },
    { title: 'Four', status: 'open', message_ids: ['2'], points: [{ text: 'p', cites: 'c' }, { text: 'q', cites: [2, '9', '1'] }] },
  ] }, burst);
  assert.deepEqual(r.issues, [
    { kind: 'malformed-episode', where: 'episode 1' },
    { kind: 'malformed-episode', where: 'episode 2 ("Two")', field: 'message_ids' },
    { kind: 'empty-episode', where: 'episode 2 ("Two")' },
    { kind: 'malformed-episode', where: 'episode 3 ("Three")', field: 'points' },
    { kind: 'malformed-cites', where: 'episode 4 ("Four")' },
    { kind: 'unknown-cite', where: 'episode 4 ("Four")', id: 2 },
    { kind: 'unknown-cite', where: 'episode 4 ("Four")', id: '9' },
    { kind: 'cite-outside-episode', where: 'episode 4 ("Four")', id: '1' },
  ]);
  assert.deepEqual(r.episodes.map((e) => [e.title, e.messageIds, e.points]), [
    ['Three', ['1'], []],
    ['Four', ['2'], [{ text: 'p', cites: [], uncited: true }, { text: 'q', cites: [], uncited: true }]],
  ]);
  assert.deepEqual(r.stats, { cites: 3, validCites: 0, points: 2, uncitedPoints: 2 });
  assert.deepEqual(verifyEpisodes('nope', burst).issues, [{ kind: 'malformed-answer', where: 'answer' }]);
});

test('verify: a cited point is not flagged', () => {
  const r = verifyEpisodes({ episodes: [{ title: 't', status: 'info', message_ids: ['1'], points: [{ text: 'p', cites: ['1'] }] }] }, [msg('1', 0)]);
  assert.deepEqual(r.episodes[0].points, [{ text: 'p', cites: ['1'], uncited: false }]);
  assert.deepEqual(r.issues, []);
});

// --- report ---

test('report: times, counts and headings read correctly', () => {
  const one = { title: 'Solo', status: 'info', messageIds: ['1'], points: [{ text: 'cited', cites: ['1'], uncited: false }] };
  const two = { title: 'Pair', status: 'open', messageIds: ['2', '3'], points: [] };
  const html = renderReport({ title: 'support', bursts: [
    { messages: [msg('1', 0), msg('2', 1), msg('3', 75)], episodes: [one, two], issues: [], stats: {} },
  ] });
  assert.match(html, /<h2>2026-03-02 09:00 to 2026-03-02 10:15 UTC<\/h2>/);
  assert.match(html, /<p class="meta">1 message<\/p>/);
  assert.match(html, /<p class="meta">2 messages<\/p>/);
  assert.match(html, /<bdi>cited<\/bdi> <a class="cite"/);
  assert.doesNotMatch(html, /class="flag"/, 'nothing is flagged when everything is cited');
  assert.match(html, /<bdi>a<\/bdi> · 2026-03-02 09:01 UTC · <bdi>Pair<\/bdi><\/p>/);
  assert.match(html, /<\/article>\n  <article class="episode">/, 'episodes are separated');
  assert.match(html, /Transcript \(3 messages\)<\/summary>\n    <ol class="messages"><li id="m-1">/);
  assert.match(html, /<\/section>\n<\/main>/);
});

test('report: two bursts make two sections, numbered continuously', () => {
  const html = renderReport({ title: 't', bursts: [
    { messages: [msg('a', 0)], episodes: [], issues: [], stats: {} },
    { messages: [msg('b', 500)], episodes: [{ title: 'B', status: 'open', messageIds: ['b'], points: [{ text: 'p', cites: ['b'], uncited: false }] }], issues: [], stats: {} },
  ] });
  assert.equal(html.match(/<section>/g).length, 2);
  assert.match(html, /<\/section>\n<section>/);
  assert.match(html, /<a class="cite" href="#m-b">2<\/a>/, 'message b is number 2 overall');
});

// --- metrics ---

test('metrics: status is judged by the majority label, not the first one seen', () => {
  const msgs = [{ id: '1', label: 'x' }, { id: '2', label: 'y' }, { id: '3', label: 'y' }, { id: '4', label: null }];
  assert.equal(statusAccuracy([{ messageIds: ['1', '2', '3', '4'], status: 'open' }], msgs, { x: 'resolved', y: 'open' }), 1);
  assert.equal(statusAccuracy([{ messageIds: ['1', '2', '3'], status: 'resolved' }], msgs, { x: 'resolved', y: 'open' }), 0);
  assert.equal(statusAccuracy([{ messageIds: ['4'], status: 'open' }], msgs, { x: 'resolved', y: 'open' }), null, 'unlabelled-only episodes are not judged');
});

test('metrics: singletons and duplicates form no pairs', () => {
  assert.deepEqual(pairScores([['a'], ['b']], [['a', 'b']]), { precision: 0, recall: 0, f1: 0 });
  assert.deepEqual(pairScores([['a', 'b']], []), { precision: 0, recall: 0, f1: 0 });
});

// --- second Stryker pass ---

test('bursts: messages before 1970 (negative epoch times) work', () => {
  const old = [{ id: 'a', at: '1969-07-20T20:17:00.000Z' }, { id: 'b', at: '1969-07-20T20:18:00.000Z' }];
  assert.deepEqual(splitBursts(old).map((b) => b.length), [2]);
  assert.equal(parseSlack([slack('0.000001', 'epoch')])[0].at, '1970-01-01T00:00:00.000Z');
});

test('readResponse: content with no text block is "no text", not a crash', () => {
  assert.throws(() => readResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] }), /model returned no text/);
});

test('import: channel events in a Slack folder are skipped too', () => withDir((dir) => {
  writeFileSync(join(dir, '2026-03-02.json'), JSON.stringify([slack('1772442000.000100', 'joined', { subtype: 'channel_join' }), slack('1772442001.000100', 'real')]));
  assert.deepEqual(loadExport(dir).map((m) => m.text), ['real']);
}));

test('import: users.json names must be non-empty strings', () => withDir((root) => {
  const dir = join(root, 'support');
  mkdirSync(dir);
  writeFileSync(join(dir, '2026-03-02.json'), JSON.stringify([slack('1772442000.000100', '<@U7> <@U8> <@U9>')]));
  writeFileSync(join(root, 'users.json'), JSON.stringify([{ id: 'U7', name: 5 }, { id: 'U8', name: '' }, { id: 'U9', name: true }]));
  assert.equal(loadExport(dir)[0].text, '@U7 @U8 @U9');
}));

test('import: only a leading @ is dropped from a mention label', () => {
  assert.equal(parseSlack([slack('1.000001', '<@U1|kim@home>')])[0].text, '@kim@home');
});

test('import: an unreadable timestamp and an out-of-range one are told apart', () => {
  assert.throws(() => discord({ timestamp: 'soon' }), /message 1 has an unreadable timestamp/);
  assert.throws(() => discord({ timestamp: undefined }), /unreadable timestamp/);
});

test('model: a corrupt recording says it is not valid JSON', async () => {
  await withDirAsync(async (dir) => {
    const req = buildRequest([msg('1', 0)]);
    writeFileSync(join(dir, `${requestKey(req).slice(0, 16)}.json`), '{"request": ');
    await assert.rejects(createModel({ mode: 'replay', dir }).complete(req), /recording is not valid JSON/);
  });
});

test('model: without an injected client, live mode loads the SDK (and never reaches the network in tests)', async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
  // No key, and a base URL nothing listens on: whatever happens, no request leaves this machine.
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  try {
    await assert.rejects(createModel().complete(buildRequest([msg('1', 0)])),
      (e) => !/Cannot read properties of undefined/.test(e.message), 'fails on the SDK or the key, not on a missing client');
  } finally {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = saved.url;
  }
});

test('report: lists are joined with nothing in between', () => {
  const ep = { title: 'E', status: 'open', messageIds: ['1', '2'], points: [
    { text: 'p1', cites: ['1', '2'], uncited: false }, { text: 'p2', cites: ['1'], uncited: false }] };
  const html = renderReport({ title: 't', bursts: [{ messages: [msg('1', 0), msg('2', 1), msg('3', 2)], episodes: [ep], issues: [], stats: {} }] });
  assert.match(html, /<a class="cite" href="#m-1">1<\/a><a class="cite" href="#m-2">2<\/a><\/li><li><bdi>p2<\/bdi>/);
  assert.match(html, /<\/li><li id="m-2">/);
  assert.match(html, /<bdi>a<\/bdi> · 2026-03-02 09:02 UTC<\/p>/, 'a loose message has no episode name');
  assert.match(html, /<style>[\s\S]*--accent[\s\S]*<\/style>/);
});

test('report: an episode whose status was rejected shows no status chip, not "null"', () => {
  const ep = { title: 'E', status: null, messageIds: ['1'], points: [] };
  const html = renderReport({ title: 't', bursts: [{ messages: [msg('1', 0)], episodes: [ep], issues: [], stats: {} }] });
  assert.doesNotMatch(html, /null/);
  assert.match(html, /<h3><bdi>E<\/bdi><\/h3>/);
});

test('report: a valid status shows as a chip after the title', () => {
  for (const status of ['resolved', 'open', 'info']) {
    const html = renderReport({ title: 't', bursts: [{ messages: [msg('1', 0)], episodes: [{ title: 'E', status, messageIds: ['1'], points: [] }], issues: [], stats: {} }] });
    assert.match(html, new RegExp(`<h3><bdi>E</bdi> <span class="status ${status}">${status}</span></h3>`));
  }
});
