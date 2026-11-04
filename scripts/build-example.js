// Writes the synthetic eval channel out as a Slack export, so the example the
// README runs is the same data the eval scores.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHANNEL, labelledMessages } from '../eval/dataset.js';

const dir = fileURLToPath(new URL(`../examples/${CHANNEL}`, import.meta.url));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const byDay = new Map();
for (const m of labelledMessages()) {
  const row = {
    type: 'message',
    ts: m.id,
    user: `U${m.author.toUpperCase()}`,
    user_profile: { display_name: m.author, real_name: m.author },
    // Slack escapes these three characters in message text.
    text: m.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };
  const day = m.at.slice(0, 10);
  byDay.set(day, [...(byDay.get(day) ?? []), row]);
}
for (const [day, rows] of byDay) writeFileSync(`${dir}/${day}.json`, JSON.stringify(rows, null, 2) + '\n');
console.log(`wrote ${byDay.size} day files to examples/${CHANNEL}/`);
