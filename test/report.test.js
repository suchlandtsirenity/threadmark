import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { renderReport } from '../src/report.js';
import { buildRequest } from '../src/episodes.js';
import { requestKey } from '../src/model.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = promisify(execFile);

const messages = [
  { id: '1', at: '2026-03-02T09:00:00.000Z', author: 'kim', text: 'export fails <img src=x onerror=alert(1)>' },
  { id: '2', at: '2026-03-02T09:01:00.000Z', author: 'raj', text: 'fixed' },
  { id: '3', at: '2026-03-02T09:02:00.000Z', author: 'mo', text: 'lunch?' },
];
const burst = {
  messages,
  issues: [],
  stats: {},
  episodes: [{
    title: 'Export <b>fails</b>',
    status: 'resolved',
    messageIds: ['1', '2'],
    points: [
      { text: 'It was fixed', cites: ['2'], uncited: false },
      { text: 'Nobody knows why', cites: [], uncited: true },
    ],
  }],
};

test('citations link to numbered messages in the transcript', () => {
  const html = renderReport({ title: 'support', bursts: [burst] });
  assert.match(html, /<a class="cite" href="#m-2">2<\/a>/);
  assert.match(html, /<li id="m-2">/);
});

test('uncited points are flagged and loose messages are marked', () => {
  const html = renderReport({ title: 'support', bursts: [burst] });
  assert.match(html, /Nobody knows why<\/bdi> <span class="flag">uncited<\/span>/);
  assert.match(html, /<li id="m-3" class="loose">/);
});

test('chat text and model text cannot inject markup', () => {
  const html = renderReport({ title: '<script>x</script>', bursts: [burst] });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>fails/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;img src=x/);
});

test('a burst with no episodes still renders its transcript', () => {
  const html = renderReport({ title: 't', bursts: [{ ...burst, episodes: [] }] });
  assert.match(html, /No episodes found/);
  assert.match(html, /Transcript \(3 messages\)/);
});

test('the CLI digests an export from recordings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadmark-'));
  try {
    const exportFile = join(dir, 'chat.json');
    writeFileSync(exportFile, JSON.stringify({ messages: [
      { id: '1', timestamp: '2026-03-02T09:00:00Z', author: { name: 'kim' }, content: 'hello' },
    ] }));
    const request = buildRequest([{ id: '1', at: '2026-03-02T09:00:00.000Z', author: 'kim', text: 'hello' }]);
    const answer = { episodes: [{ title: 'Greeting', status: 'info', message_ids: ['1'], points: [{ text: 'Kim said hello', cites: ['1'] }] }] };
    writeFileSync(join(dir, `${requestKey(request).slice(0, 16)}.json`), JSON.stringify({
      request,
      response: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] },
    }));

    const out = join(dir, 'report.html');
    const { stdout } = await run(process.execPath, [CLI, exportFile, '--replay', dir, '--out', out]);
    assert.match(stdout, /1 messages, 1 episodes, 1\/1 citations valid/);
    assert.match(readFileSync(out, 'utf8'), /Kim said hello/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the CLI explains bad input instead of crashing', async () => {
  await assert.rejects(run(process.execPath, [CLI]), (e) => e.code === 1 && /Usage:/.test(e.stdout));
  await assert.rejects(run(process.execPath, [CLI, '/nonexistent']), (e) => e.code === 1 && /threadmark:/.test(e.stderr) && !/\n\s+at /.test(e.stderr));
});
