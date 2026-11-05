// Tests that pin behaviour the original suite executed but never checked.
// Each was written against a mutation that survived: the code was changed on
// purpose, every existing test still passed, and this test now fails instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { parseSlack, loadExport } from '../src/import.js';
import { splitBursts } from '../src/bursts.js';
import { renderReport } from '../src/report.js';
import { pairScores, statusAccuracy } from '../eval/metrics.js';
import { labelledMessages } from '../eval/dataset.js';

const run = promisify(execFile);
const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const at = (min) => new Date(Date.UTC(2026, 2, 2, 9, 0) + min * 60_000).toISOString();
const msg = (id, min) => ({ id, at: at(min), author: 'a', text: 'x' });
const sizes = (b) => b.map((x) => x.length);

test('bursts: a gap of exactly gapMinutes stays in one burst; one minute more splits', () => {
  assert.deepEqual(sizes(splitBursts([msg('a', 0), msg('b', 30)], { gapMinutes: 30 })), [2]);
  assert.deepEqual(sizes(splitBursts([msg('a', 0), msg('b', 31)], { gapMinutes: 30 })), [1, 1]);
});

test('bursts: the default gap is 90 minutes', () => {
  assert.deepEqual(sizes(splitBursts([msg('a', 0), msg('b', 90)])), [2]);
  assert.deepEqual(sizes(splitBursts([msg('a', 0), msg('b', 91)])), [1, 1]);
});

test('bursts: the default max burst is 150 messages', () => {
  const many = Array.from({ length: 151 }, (_, i) => msg(String(i).padStart(3, '0'), i * 0.001));
  assert.deepEqual(sizes(splitBursts(many)), [150, 1]);
});

test('import: Slack display name wins over real name, then username, then user ID', () => {
  const base = { type: 'message', ts: '1.000001', text: 'x' };
  assert.equal(parseSlack([{ ...base, user: 'U1', user_profile: { display_name: 'kim', real_name: 'Kim Ho' } }])[0].author, 'kim');
  assert.equal(parseSlack([{ ...base, user: 'U1', user_profile: { display_name: '', real_name: 'Kim Ho' } }])[0].author, 'Kim Ho');
  assert.equal(parseSlack([{ ...base, user: 'U1', username: 'kbot' }])[0].author, 'kbot');
  assert.equal(parseSlack([{ ...base, user: 'U1' }])[0].author, 'U1');
});

test('import: Slack text is unescaped exactly once', () => {
  // The user typed "&lt;" literally; Slack stored it as "&amp;lt;".
  assert.equal(parseSlack([{ type: 'message', ts: '1.000001', user: 'U1', text: '&amp;lt;b&amp;gt; &amp;amp;' }])[0].text, '&lt;b&gt; &amp;');
});

test('report: following a citation opens the collapsed transcript and scrolls to it', () => {
  const html = renderReport({ title: 't', bursts: [{ messages: [msg('1', 0)], episodes: [], issues: [], stats: {} }] });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const details = { open: false };
  let scrolled = null;
  const target = { closest: (sel) => (sel === 'details' ? details : null), scrollIntoView: (o) => { scrolled = o; } };
  const listeners = {};
  vm.runInNewContext(script, {
    location: { hash: '#m-1' },
    document: { getElementById: (id) => (id === 'm-1' ? target : null) },
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  });
  assert.equal(details.open, true);
  assert.equal(JSON.stringify(scrolled), '{"block":"center"}');
  assert.equal(typeof listeners.hashchange, 'function', 'later citation clicks are handled too');
});

test('metrics: a pair is the same pair in either order', () => {
  assert.deepEqual(pairScores([['b', 'a']], [['a', 'b']]), { precision: 1, recall: 1, f1: 1 });
  assert.deepEqual(pairScores([['c', 'a', 'b']], [['b', 'c', 'a']]), { precision: 1, recall: 1, f1: 1 });
});

test('metrics: an episode with no status is not judged', () => {
  const msgs = [{ id: '1', label: 'x' }, { id: '2', label: 'x' }];
  assert.equal(statusAccuracy([{ messageIds: ['1'], status: null }], msgs, { x: 'open' }), null);
  assert.equal(statusAccuracy([{ messageIds: ['1'], status: null }, { messageIds: ['2'], status: 'open' }], msgs, { x: 'open' }), 1);
});

test('cli: a zero, negative, fractional or non-numeric option is refused', async () => {
  const cli = root('src/cli.js');
  const example = root('examples/support');
  for (const args of [['--gap', '0'], ['--gap=-5'], ['--gap', 'abc'], ['--max-burst', '0'], ['--max-burst', '2.5']]) {
    await assert.rejects(run(process.execPath, [cli, example, ...args]),
      (e) => e.code === 1 && new RegExp(`--${args[0].replace(/^--|=.*$/g, '')} must be`).test(e.stderr), args.join(' '));
  }
  // "--gap -5" never reaches threadmark's check: Node's parser refuses it first.
  await assert.rejects(run(process.execPath, [cli, example, '--gap', '-5']), (e) => e.code === 1 && /ambiguous/.test(e.stderr));
  await assert.rejects(run(process.execPath, [cli, example, '--bogus', '1']), (e) => e.code === 1 && /Unknown option/.test(e.stderr));
  await assert.rejects(run(process.execPath, [cli, example, '--record', 'x', '--replay', 'y']), (e) => /not both/.test(e.stderr));
});

// --- drift: what the README and examples claim must match what the code does ---

test('examples/support is exactly the eval dataset', () => {
  const fromExport = loadExport(root('examples/support'));
  const fromDataset = labelledMessages().map(({ label, ...m }) => m);
  assert.deepEqual(fromExport, fromDataset, 'run `npm run build-example` after editing eval/dataset.js');
});

test('every score in the README is what `npm run eval` prints', async () => {
  const { stdout } = await run(process.execPath, [root('eval/run.js')]);
  const readme = readFileSync(root('README.md'), 'utf8');
  const printed = new Map(stdout.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| |'))
    .map((l) => l.split('|').map((c) => c.trim())).map(([, name, eps, p, r, f1]) => [name, [eps, p, r, f1]]));
  const tableRows = readme.split('\n').filter((l) => /^\| (Time gaps|Claude)/.test(l));
  assert.ok(tableRows.length > 0, 'README has an evaluation table');
  for (const row of tableRows) {
    const [, name, eps, p, r, f1] = row.split('|').map((c) => c.trim());
    if (/not recorded yet/.test(eps)) {
      assert.ok(![...printed.keys()].some((k) => k.startsWith('Claude')), 'README says no Claude scores, but eval printed some');
      continue;
    }
    const key = name.replace(/ \(baseline\)$/, '');
    const match = [...printed].find(([k]) => k.startsWith(key));
    assert.ok(match, `eval printed no row for "${name}"`);
    assert.deepEqual([eps, p, r, f1], match[1], `README row "${name}" doesn't match eval output`);
  }
});

test('cli: option errors say exactly what was wrong, and a fractional gap is allowed', async () => {
  const cli = root('src/cli.js');
  const example = root('examples/support');
  await assert.rejects(run(process.execPath, [cli, example, '--max-burst', '2.5']),
    (e) => e.stderr === 'threadmark: --max-burst must be a positive whole number, got "2.5"\n');
  await assert.rejects(run(process.execPath, [cli, example, '--gap', 'soon']),
    (e) => e.stderr === 'threadmark: --gap must be a positive number, got "soon"\n');
  // A gap of 1.5 minutes is valid; it gets as far as needing a recording.
  await assert.rejects(run(process.execPath, [cli, example, '--gap', '1.5', '--replay', root('test')]),
    (e) => /no recording for this request/.test(e.stderr) && !/must be/.test(e.stderr));
});
