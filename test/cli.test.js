// End-to-end CLI runs against a fake Anthropic API on localhost. The real SDK
// makes the requests, so this checks what actually goes over the wire (headers,
// body, the beta flag) without a network, an API key or any cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MODEL } from '../src/episodes.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../examples/support', import.meta.url));

// Answers every burst with one episode holding all its messages, citing the first.
async function fakeApi(fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = JSON.parse(body);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const ids = [...json.messages[0].content.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
      const answer = { episodes: [{ title: `Burst of ${ids.length}`, status: 'info', message_ids: ids, points: [{ text: 'Something happened', cites: [ids[0]] }] }] };
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_test' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  try {
    return await fn({ env, requests });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const cli = (args, opts) => run(process.execPath, [CLI, ...args], opts);

test('cli: --record with valid options calls the API through the SDK, records, and writes report.html by default', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'threadmark-'));
  try {
    await fakeApi(async ({ env, requests }) => {
      const rec = join(cwd, 'rec');
      const { stdout, stderr } = await cli([EXAMPLE, '--record', rec, '--gap', '600', '--max-burst', '10'], { cwd, env });
      const n = Number(stderr.match(/burst \d+ of (\d+)/)[1]);
      assert.ok(n >= 4, 'a 34-message channel in windows of 10 is at least 4 requests');
      assert.deepEqual(stderr.trim().split('\n'), Array.from({ length: n }, (_, i) => `burst ${i + 1} of ${n}`));
      assert.equal(requests.length, n);
      for (const r of requests) {
        assert.equal(r.method, 'POST');
        assert.match(r.url, /^\/v1\/messages(\?beta=true)?$/);
        assert.equal(r.headers.authorization, 'Bearer test-key');
        assert.match(r.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
        assert.equal(r.body.model, MODEL);
        assert.equal(r.body.fallbacks, 'default');
        assert.ok(!('betas' in r.body), 'betas travel as a header, not in the body');
        assert.equal(r.body.output_config.format.type, 'json_schema');
        assert.ok(r.body.messages[0].content.split('\n').filter((l) => l.startsWith('[')).length <= 10, '--max-burst was honoured');
      }
      assert.equal(readdirSync(rec).length, n, 'one recording per request');
      assert.match(stdout, /^34 messages, \d+ episodes, \d+\/\d+ citations valid, 0 uncited points, 0 corrections\nwrote report\.html\n$/);
      const html = readFileSync(join(cwd, 'report.html'), 'utf8');
      assert.match(html, /<title>support<\/title>/, 'the title defaults to the export folder name');
      assert.match(html, /Burst of /);

      // Replay the same run: same output, no API calls, and options still apply.
      const before = requests.length;
      const out = join(cwd, 'again.html');
      const replay = await cli([EXAMPLE, '--replay', rec, '--gap', '600', '--max-burst', '10', '--out', out, '--title', 'Mine'], { cwd, env });
      assert.equal(requests.length, before, 'replay never calls the API');
      assert.equal(replay.stdout.split('\n')[0], stdout.split('\n')[0]);
      assert.match(readFileSync(out, 'utf8'), /<title>Mine<\/title>/);

      // Different options mean different requests, so replay refuses rather than guessing.
      await assert.rejects(cli([EXAMPLE, '--replay', rec, '--max-burst', '9'], { cwd, env }), /no recording for this request/);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('cli: live mode calls the API and records nothing', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'threadmark-'));
  try {
    await fakeApi(async ({ env, requests }) => {
      await cli([EXAMPLE, '--out', 'r.html'], { cwd, env });
      assert.ok(requests.length >= 1);
      assert.deepEqual(readdirSync(cwd), ['r.html']);
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('cli: an API error is reported plainly, and no report is written', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'threadmark-'));
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"type":"error","error":{"type":"invalid_request_error","message":"bad thing"}}'); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const env = { ...process.env, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` };
    await assert.rejects(cli([EXAMPLE], { cwd, env }), (e) => e.code === 1 && /threadmark: .*bad thing/.test(e.stderr) && !/\n\s+at /.test(e.stderr));
    assert.ok(!existsSync(join(cwd, 'report.html')));
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(cwd, { recursive: true, force: true });
  }
});
