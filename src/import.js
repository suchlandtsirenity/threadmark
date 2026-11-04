// Reads chat exports into one shape: { id, at, author, text }, sorted by time.
// `at` is an ISO 8601 string in UTC.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function loadExport(path) {
  if (statSync(path).isDirectory()) return parseSlack(readSlackDir(path));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(data?.messages)) return parseDiscord(data);
  throw new Error(`${path}: not a Slack channel folder or a DiscordChatExporter JSON file`);
}

// A Slack workspace export has one folder per channel and one file per day.
function readSlackDir(dir) {
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

export function parseSlack(rows) {
  return sortByTime(rows
    // Joins, leaves and topic changes carry a subtype; bot posts are kept.
    .filter((r) => r.type === 'message' && (!r.subtype || r.subtype === 'bot_message') && r.text)
    .map((r) => ({
      id: r.ts,
      at: new Date(Number(r.ts) * 1000).toISOString(),
      author: r.user_profile?.display_name || r.user_profile?.real_name || r.username || r.user || 'unknown',
      text: slackText(r.text),
    })));
}

// Slack escapes &, < and > and wraps links and mentions in <...>.
function slackText(s) {
  return s
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function parseDiscord(data) {
  return sortByTime(data.messages
    .filter((m) => m.content)
    .map((m) => ({
      id: String(m.id),
      at: new Date(m.timestamp).toISOString(),
      author: m.author?.nickname || m.author?.name || 'unknown',
      text: m.content,
    })));
}

const sortByTime = (msgs) => msgs.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
