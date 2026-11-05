// Property-based tests: instead of hand-picked examples, fast-check generates
// thousands of inputs (including raw UTF-16 with lone surrogates, control
// characters and every kind of line break) and checks that the invariants the
// code promises hold for all of them. A failure prints the smallest input that
// breaks the property, and a seed to replay it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseSlack, parseDiscord } from '../src/import.js';
import { splitBursts } from '../src/bursts.js';
import { verifyEpisodes } from '../src/verify.js';
import { transcript, buildRequest } from '../src/episodes.js';
import { requestKey } from '../src/model.js';
import { renderReport, esc } from '../src/report.js';
import { pairScores } from '../eval/metrics.js';

const RUNS = Number(process.env.FC_RUNS ?? 1000);
const check = (prop) => fc.assert(prop, { numRuns: RUNS });

// Any UTF-16 code unit, so lone surrogates and every control character turn up.
const anyChar = fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c));
// Characters that matter most here, weighted up so they appear often.
const nasty = fc.constantFrom('\n', '\r', '\r\n', '\u2028', '\u2029', '\u0085', '\v', '\f', '\0', '\t', '\u202E', '\u2066',
  '[', ']', '<', '>', '&', '"', "'", '`', '\\', '\uFEFF', '\uD800', '\uDFFF', ': ', '---', '<script>', '&amp;', '&lt;');
const text = fc.array(fc.oneof({ weight: 3, arbitrary: anyChar }, { weight: 2, arbitrary: nasty }), { maxLength: 40 }).map((a) => a.join(''));
const idChars = fc.constantFrom(...'abcXYZ0123456789._:-');
const safeId = fc.array(idChars, { minLength: 1, maxLength: 12 }).map((a) => a.join(''));

// A sorted burst of messages with unique IDs.
const burstArb = fc.uniqueArray(safeId, { minLength: 1, maxLength: 25 }).chain((ids) =>
  fc.tuple(
    fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: ids.length, maxLength: ids.length }),
    fc.array(text, { minLength: ids.length, maxLength: ids.length }),
    fc.array(text, { minLength: ids.length, maxLength: ids.length }),
  ).map(([mins, texts, authors]) => {
    const sorted = [...mins].sort((a, b) => a - b);
    return ids.map((id, i) => ({ id, at: new Date(Date.UTC(2026, 2, 2) + sorted[i] * 60_000).toISOString(), author: authors[i], text: texts[i] }));
  }));

// Model answers that are sometimes well-formed, sometimes nonsense, and often
// in between: real IDs mixed with fake ones, wrong types, duplicates.
const answerFor = (burst) => {
  const ids = burst.map((m) => m.id);
  const anyId = fc.oneof(fc.constantFrom(...ids), safeId, fc.integer(), fc.constant(null));
  const point = fc.oneof({ weight: 5, arbitrary: fc.record({ text: fc.oneof(text, fc.constant('ok')), cites: fc.oneof({ weight: 5, arbitrary: fc.array(anyId, { maxLength: 6 }) }, { weight: 1, arbitrary: fc.jsonValue() }) }) },
    { weight: 1, arbitrary: fc.jsonValue() });
  const episode = fc.oneof({ weight: 6, arbitrary: fc.record({
    title: fc.oneof(text, fc.jsonValue()),
    status: fc.oneof(fc.constantFrom('resolved', 'open', 'info'), fc.jsonValue()),
    message_ids: fc.oneof({ weight: 5, arbitrary: fc.array(anyId, { maxLength: 10 }) }, { weight: 1, arbitrary: fc.jsonValue() }),
    points: fc.oneof({ weight: 5, arbitrary: fc.array(point, { maxLength: 5 }) }, { weight: 1, arbitrary: fc.jsonValue() }),
  }, { requiredKeys: [] }) }, { weight: 1, arbitrary: fc.jsonValue() });
  return fc.oneof({ weight: 8, arbitrary: fc.record({ episodes: fc.array(episode, { maxLength: 6 }) }) }, { weight: 1, arbitrary: fc.jsonValue() });
};

test('property: verifyEpisodes never throws, and everything it returns holds up', () => {
  check(fc.property(burstArb.chain((burst) => fc.tuple(fc.constant(burst), answerFor(burst))), ([burst, raw]) => {
    const { episodes, issues, stats } = verifyEpisodes(raw, burst);
    const order = burst.map((m) => m.id);
    const seen = new Set();
    let points = 0, cites = 0, uncited = 0;
    for (const ep of episodes) {
      assert.ok(typeof ep.title === 'string' && ep.title.trim() !== '');
      assert.ok(ep.status === null || ['resolved', 'open', 'info'].includes(ep.status));
      assert.ok(ep.messageIds.length > 0, 'no empty episodes');
      for (const id of ep.messageIds) {
        assert.ok(order.includes(id), 'only real messages');
        assert.ok(!seen.has(id), 'no message in two episodes');
        seen.add(id);
      }
      assert.deepEqual(ep.messageIds, order.filter((id) => ep.messageIds.includes(id)), 'transcript order');
      for (const p of ep.points) {
        points++;
        assert.ok(typeof p.text === 'string' && p.text.trim() !== '');
        assert.equal(new Set(p.cites).size, p.cites.length, 'no repeated citations');
        for (const c of p.cites) assert.ok(ep.messageIds.includes(c), 'every citation is inside its own episode');
        assert.equal(p.uncited, p.cites.length === 0);
        cites += p.cites.length;
        if (p.uncited) uncited++;
      }
    }
    assert.equal(stats.points, points);
    assert.equal(stats.validCites, cites);
    assert.equal(stats.uncitedPoints, uncited);
    assert.ok(stats.cites >= stats.validCites);
    assert.ok(Array.isArray(issues) && issues.every((i) => typeof i.kind === 'string' && typeof i.where === 'string'));
  }));
});

test('property: verifyEpisodes survives any JSON value at all', () => {
  check(fc.property(burstArb, fc.jsonValue(), (burst, raw) => {
    const r = verifyEpisodes(raw, burst);
    assert.ok(Array.isArray(r.episodes) && Array.isArray(r.issues));
  }));
});

const HEADER = /^\[([^\]]+)\] \d\d:\d\d /;

test('property: in a transcript, only real messages start a line, in order, and no other line breaks survive', () => {
  check(fc.property(burstArb, (burst) => {
    const out = transcript(burst);
    assert.ok(!/[\r\v\f\u0085\u2028\u2029]/.test(out));
    assert.ok(!/[\u0000-\u0008\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(out));
    const headers = out.split('\n').map((l) => l.match(HEADER)?.[1]).filter(Boolean);
    assert.deepEqual(headers, burst.map((m) => m.id));
    for (const line of out.split('\n')) {
      assert.ok(HEADER.test(line) || line.startsWith('    ') || /^--- \d{4}-\d\d-\d\d \(UTC\) ---$/.test(line), JSON.stringify(line));
    }
  }));
});

test('property: the recording key depends on content, not object identity', () => {
  check(fc.property(burstArb, (burst) => {
    assert.equal(requestKey(buildRequest(burst)), requestKey(buildRequest(structuredClone(burst))));
  }));
});

// Every tag the report is allowed to contain. Anything else got in from chat or model text.
const TAGS = new Set(['!doctype', 'html', 'head', 'meta', 'title', 'style', 'body', 'main', 'h1', 'h2', 'h3', 'section', 'article',
  'span', 'ul', 'ol', 'li', 'a', 'p', 'details', 'summary', 'div', 'bdi', 'script']);

test('property: no chat or model text can add a tag or break out of an attribute', () => {
  check(fc.property(burstArb.chain((burst) => fc.tuple(fc.constant(burst), answerFor(burst), text)), ([burst, raw, title]) => {
    const html = renderReport({ title, bursts: [{ messages: burst, ...verifyEpisodes(raw, burst) }] });
    const body = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/, '');
    for (const [, name] of body.matchAll(/<\/?([!a-zA-Z][^\s>/]*)/g)) assert.ok(TAGS.has(name.toLowerCase()), `unexpected tag <${name}>`);
    for (const [tag] of body.matchAll(/<[!a-zA-Z][^>]*>/g)) {
      assert.equal((tag.match(/"/g) ?? []).length % 2, 0, `unbalanced quotes in ${tag}`);
      assert.ok(!/'/.test(tag) || /content="[^"]*'/.test(tag), `stray quote in ${tag}`);
      for (const [, attr] of tag.matchAll(/\s([a-z-]+)=/g)) assert.ok(['lang', 'charset', 'name', 'content', 'http-equiv', 'class', 'id', 'href'].includes(attr), `unexpected attribute ${attr}`);
    }
    assert.equal((html.match(/<script>/g) ?? []).length, 1);
  }));
});

test('property: esc output never contains a character that ends text or an attribute', () => {
  check(fc.property(text, (s) => {
    assert.ok(!/[<>"']/.test(esc(s)));
    assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(esc(s)), 'every & starts an entity');
  }));
});

test('property: bursts partition the timeline and respect both limits', () => {
  check(fc.property(burstArb, fc.integer({ min: 1, max: 600 }), fc.integer({ min: 1, max: 30 }), (msgs, gapMinutes, maxBurst) => {
    const bursts = splitBursts(msgs, { gapMinutes, maxBurst });
    assert.deepEqual(bursts.flat(), msgs, 'nothing lost, duplicated or reordered');
    for (const b of bursts) {
      assert.ok(b.length >= 1 && b.length <= maxBurst);
      for (let i = 1; i < b.length; i++) assert.ok(Date.parse(b[i].at) - Date.parse(b[i - 1].at) <= gapMinutes * 60_000);
    }
    for (let i = 1; i < bursts.length; i++) {
      const prev = bursts[i - 1];
      const gap = Date.parse(bursts[i][0].at) - Date.parse(prev.at(-1).at);
      assert.ok(gap > gapMinutes * 60_000 || prev.length === maxBurst, 'a burst only ends on a gap or when full');
    }
  }));
});

// Slack escapes exactly these three characters; markup only ever appears in <...>.
const slackEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('property: Slack text round-trips exactly through escaping and import', () => {
  check(fc.property(fc.uniqueArray(fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }), { minLength: 1, maxLength: 20 }), fc.array(text, { minLength: 20, maxLength: 20 }),
    (secs, texts) => {
      const rows = secs.map((s, i) => ({ type: 'message', ts: `${s}.000100`, user: 'U1', text: slackEscape(texts[i] || 'x') }));
      const out = parseSlack(rows);
      const expected = secs.map((s, i) => [s, texts[i] || 'x']).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
      assert.deepEqual(out.map((m) => m.text), expected);
    }));
});

test('property: Discord import keeps every message, sorted, with nothing invented', () => {
  check(fc.property(fc.uniqueArray(safeId, { minLength: 1, maxLength: 20 }), fc.array(fc.integer({ min: 0, max: 1e6 }), { minLength: 20, maxLength: 20 }), fc.array(text, { minLength: 20, maxLength: 20 }),
    (ids, mins, texts) => {
      const messages = ids.map((id, i) => ({ id, timestamp: new Date(Date.UTC(2026, 0, 1) + mins[i] * 60_000).toISOString(), author: { name: 'n' }, content: texts[i] || 'x' }));
      const out = parseDiscord({ messages });
      assert.equal(out.length, ids.length);
      assert.deepEqual(new Set(out.map((m) => m.id)), new Set(ids));
      for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].at < out[i].at || (out[i - 1].at === out[i].at && out[i - 1].id < out[i].id));
      for (const m of out) assert.equal(m.text, messages.find((x) => x.id === m.id).content);
    }));
});

test('property: pair scores stay in [0, 1], a perfect guess scores 1, and precision/recall swap with the arguments', () => {
  const groups = fc.array(fc.uniqueArray(fc.constantFrom(...'abcdefghij'), { maxLength: 6 }), { maxLength: 4 })
    .map((gs) => { const used = new Set(); return gs.map((g) => g.filter((x) => !used.has(x) && used.add(x))); });
  check(fc.property(groups, groups, (pred, gold) => {
    const s = pairScores(pred, gold);
    for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1);
    const flipped = pairScores(gold, pred);
    assert.equal(s.precision, flipped.recall);
    assert.equal(s.recall, flipped.precision);
    if (gold.some((g) => g.length > 1)) assert.deepEqual(pairScores(gold, gold), { precision: 1, recall: 1, f1: 1 });
  }));
});
