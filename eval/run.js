// Scores the time-gap baseline and (with a model) Claude on the labelled dataset.
//
//   npm run eval                 baseline, plus Claude from recordings if they exist
//   npm run eval -- --record     call Claude and save the responses (needs a key)
//   npm run eval -- --replay     Claude from recordings only; fails if one is missing
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { labelledMessages, STATUS } from './dataset.js';
import { goldGroups, pairScores, statusAccuracy } from './metrics.js';
import { splitBursts } from '../src/bursts.js';
import { createModel } from '../src/model.js';
import { digest, totals } from '../src/digest.js';

const RECORDINGS = fileURLToPath(new URL('./recordings', import.meta.url));
const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

const messages = labelledMessages();
const gold = goldGroups(messages);
const rows = [];

// Baseline: every burst is one episode.
const baseline = splitBursts(messages).map((b) => ({ messageIds: b.map((m) => m.id), status: null }));
rows.push({ name: 'Time gaps only', ...pairScores(baseline.map((e) => e.messageIds), gold), episodes: baseline.length });

const flag = process.argv[2];
const hasRecordings = existsSync(RECORDINGS) && readdirSync(RECORDINGS).length > 0;
const mode = flag === '--record' ? 'record' : flag === '--replay' || hasRecordings ? 'replay' : null;

if (mode) {
  const model = createModel({ mode, dir: RECORDINGS });
  const bursts = await digest(messages, model);
  const episodes = bursts.flatMap((b) => b.episodes);
  const t = totals(bursts);
  rows.push({
    name: `Claude (${mode})`,
    ...pairScores(episodes.map((e) => e.messageIds), gold),
    episodes: episodes.length,
    status: statusAccuracy(episodes, messages, STATUS),
    citations: t.cites ? t.validCites / t.cites : null,
    uncited: t.points ? t.uncitedPoints / t.points : null,
  });
} else {
  console.log('No recordings yet: showing the baseline only. Run with --record (needs ANTHROPIC_API_KEY).\n');
}

console.log(`${gold.length} labelled episodes, ${messages.length} messages\n`);
console.log('| | Episodes | Pair precision | Pair recall | Pair F1 | Status right | Valid citations | Uncited points |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.episodes} | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.f1)} | ${pct(r.status)} | ${pct(r.citations)} | ${pct(r.uncited)} |`);
}
