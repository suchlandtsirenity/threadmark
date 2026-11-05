// Reads chat exports into one shape: { id, at, author, text }, sorted by time.
// `at` is an ISO 8601 string in UTC. Exports are untrusted input, so anything
// that can't be read exactly is an error naming the file or message, never a
// guess.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// IDs end up inside transcript lines ("[id] 09:00 kim: ...") and HTML attributes,
// so they are limited to characters that can't break either. Slack timestamps
// and Discord snowflakes both fit.
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

export function loadExport(path) {
  const messages = statSync(path).isDirectory() ? loadSlackDir(path) : loadDiscordFile(path);
  if (!messages.length) throw new Error(`${path}: no messages found`);
  return messages;
}

function readJson(file) {
  // Some exporters write a UTF-8 byte order mark, which JSON.parse rejects.
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${err.message})`);
  }
}

function inFile(file, fn) {
  try {
    return fn();
  } catch (err) {
    throw new Error(`${file}: ${err.message}`);
  }
}

function loadDiscordFile(file) {
  const data = readJson(file);
  if (!Array.isArray(data?.messages)) throw new Error(`${file}: not a Slack channel folder or a DiscordChatExporter JSON file`);
  return inFile(file, () => parseDiscord(data));
}

// A Slack workspace export has one folder per channel and one file per day,
// with users.json one level up.
function loadSlackDir(dir) {
  const users = slackUsers(join(dirname(dir), 'users.json'));
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const messages = files.flatMap((f) => {
    const file = join(dir, f);
    const rows = readJson(file);
    if (!Array.isArray(rows)) throw new Error(`${file}: expected an array of messages`);
    return inFile(file, () => rows.filter(isSlackChat).map((r) => slackMessage(r, users)));
  });
  return finish(messages);
}

function slackUsers(file) {
  const users = new Map();
  if (!existsSync(file)) return users;
  const list = readJson(file);
  if (!Array.isArray(list)) return users;
  for (const u of list) {
    const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name;
    if (typeof u?.id === 'string' && typeof name === 'string' && name) users.set(u.id, name);
  }
  return users;
}

// Plain messages plus the subtypes that are still someone talking. Joins,
// leaves, topic and name changes, pins and the like are channel events.
const SLACK_CHAT = new Set([undefined, 'bot_message', 'thread_broadcast', 'me_message', 'file_share']);
const isSlackChat = (r) => r?.type === 'message' && SLACK_CHAT.has(r.subtype) && typeof r.text === 'string' && r.text !== '';

export function parseSlack(rows, users = new Map()) {
  return finish(rows.filter(isSlackChat).map((r) => slackMessage(r, users)));
}

function slackMessage(r, users) {
  if (typeof r.ts !== 'string' || !/^\d+(\.\d+)?$/.test(r.ts)) {
    throw new Error(`Slack message has a missing or invalid ts: ${JSON.stringify(r.ts)}`);
  }
  return {
    id: checkId(r.ts),
    at: isoTime(Number(r.ts) * 1000, r.ts),
    author: r.user_profile?.display_name || r.user_profile?.real_name || r.username || r.user || 'unknown',
    text: slackText(r.text, users),
  };
}

// Slack wraps links, mentions and channel references in <...> and escapes
// &, < and >. Entities are decoded last, and &amp; last of all, so text the
// user typed as "&lt;" stays "&lt;".
function slackText(s, users) {
  return s
    .replace(/<([^<>|]+)\|([^<>]*)>/g, (_, target, label) => {
      if (target.startsWith('#')) return `#${label}`;
      if (target.startsWith('@')) return `@${label.replace(/^@/, '')}`;
      return label;
    })
    .replace(/<@([A-Z0-9]+)>/g, (_, id) => `@${users.get(id) ?? id}`)
    .replace(/<#([A-Z0-9]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<((?:https?|mailto):[^<>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// DiscordChatExporter marks system events (joins, pins, boosts) with a type.
const DISCORD_CHAT = new Set([undefined, 'Default', 'Reply']);

export function parseDiscord(data) {
  return finish(data.messages
    .filter((m) => m && DISCORD_CHAT.has(m.type) && typeof m.content === 'string' && m.content !== '')
    .map((m) => {
      const id = discordId(m.id);
      return {
        id,
        at: isoTime(Date.parse(m.timestamp), id),
        author: m.author?.nickname || m.author?.name || 'unknown',
        text: m.content,
      };
    }));
}

function discordId(id) {
  // Snowflakes are 64-bit. A number that big was already rounded by JSON.parse,
  // and a rounded ID would point at the wrong message.
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id)) throw new Error(`Discord message ID ${id} lost precision; the export must store IDs as strings`);
    return checkId(String(id));
  }
  return checkId(id);
}

function checkId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error(`unusable message ID ${JSON.stringify(id)}`);
  return id;
}

function isoTime(ms, id) {
  if (!Number.isFinite(ms)) throw new Error(`message ${id} has an unreadable timestamp`);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error(`message ${id} has an out-of-range timestamp`);
  return d.toISOString();
}

// Exact duplicates (the same message exported twice) are merged; two different
// messages sharing an ID can't both be cited, so that's an error.
function finish(messages) {
  const byId = new Map();
  for (const m of messages) {
    const seen = byId.get(m.id);
    if (!seen) byId.set(m.id, m);
    else if (seen.at !== m.at || seen.author !== m.author || seen.text !== m.text) {
      throw new Error(`duplicate message ID ${m.id} with different content`);
    }
  }
  // Plain code-unit comparison, so the order never depends on the locale.
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...byId.values()].sort((a, b) => cmp(a.at, b.at) || cmp(a.id, b.id));
}
