// Calls Claude, or replays a saved answer. Each response is stored under the
// SHA-256 of its request, so the same input always replays the same output and
// evals can be re-run without an API key or any cost.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const requestKey = (request) => createHash('sha256').update(JSON.stringify(request)).digest('hex');

export function createModel({ mode = 'live', dir } = {}) {
  if (mode !== 'live' && !dir) throw new Error(`${mode} mode needs a recordings directory`);
  let client;

  async function live(request) {
    if (!client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      client = new Anthropic();
    }
    // If a safety classifier declines, the API retries on a fallback model it picks.
    return client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  }

  return {
    mode,
    async complete(request) {
      const file = dir && join(dir, `${requestKey(request).slice(0, 16)}.json`);
      if (mode === 'replay') {
        if (!existsSync(file)) throw new Error(`no recording for this request (${file}); run with --record first`);
        return JSON.parse(readFileSync(file, 'utf8')).response;
      }
      const response = await live(request);
      if (mode === 'record') {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify({ request, response }, null, 2) + '\n');
      }
      return response;
    },
  };
}
