#!/usr/bin/env node
// threadmark <export> [--out report.html] [--title text] [--gap minutes]
//                     [--max-burst n] [--record dir | --replay dir]
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { loadExport } from './import.js';
import { createModel } from './model.js';
import { digest, totals } from './digest.js';
import { renderReport } from './report.js';

const USAGE = `Usage: threadmark <export> [options]

  <export>           a Slack channel folder, or a DiscordChatExporter JSON file

  --out <file>       where to write the report (default: report.html)
  --title <text>     report title (default: the export's name)
  --gap <minutes>    quiet time that separates bursts (default: 90)
  --max-burst <n>    most messages per model request (default: 150)
  --record <dir>     call Claude and save each response to <dir>
  --replay <dir>     answer from saved responses, without calling Claude

Calling Claude needs ANTHROPIC_API_KEY.`;

function positive(name, value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!(n > 0)) throw new Error(`--${name} must be a positive number`);
  return n;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'report.html' },
      title: { type: 'string' },
      gap: { type: 'string' },
      'max-burst': { type: 'string' },
      record: { type: 'string' },
      replay: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  if (values.record && values.replay) throw new Error('use --record or --replay, not both');

  const [path] = positionals;
  const messages = loadExport(path);
  const model = createModel(
    values.replay ? { mode: 'replay', dir: values.replay }
      : values.record ? { mode: 'record', dir: values.record }
        : { mode: 'live' },
  );
  const bursts = await digest(messages, model, {
    gapMinutes: positive('gap', values.gap),
    maxBurst: positive('max-burst', values['max-burst']),
    onProgress: (i, n) => console.error(`burst ${i} of ${n}`),
  });

  writeFileSync(values.out, renderReport({ title: values.title ?? basename(path), bursts }));
  const t = totals(bursts);
  console.log(`${messages.length} messages, ${t.episodes} episodes, ${t.validCites}/${t.cites} citations valid, ${t.uncitedPoints} uncited points, ${t.issues} corrections`);
  console.log(`wrote ${values.out}`);
}

main().catch((err) => {
  console.error(`threadmark: ${err.message}`);
  process.exitCode = 1;
});
