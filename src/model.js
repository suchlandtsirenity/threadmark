// Calls Claude, or replays a saved answer. Each response is stored under the
// SHA-256 of its request, so the same input always replays the same output and
// evals can be re-run without an API key or any cost.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const requestKey = (request) => createHash('sha256').update(JSON.stringify(request)).digest('hex');

// `client` replaces the Anthropic SDK client, so tests can check exactly what
// would be sent without a network or an API key.
export function createModel({ mode = 'live', dir, client } = {}) {
  if (!['live', 'record', 'replay'].includes(mode)) throw new Error(`unknown model mode "${mode}"`);
  if (mode !== 'live' && !dir) throw new Error(`${mode} mode needs a recordings directory`);

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
        let saved;
        try {
          saved = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err) {
          throw new Error(`${file}: recording is not valid JSON (${err.message})`);
        }
        // The file name is only a prefix of the hash, and files can be edited,
        // so the saved request must be this exact request.
        if (JSON.stringify(saved?.request) !== JSON.stringify(request)) {
          throw new Error(`${file}: recording does not match this request; re-record it`);
        }
        if (saved.response === undefined) throw new Error(`${file}: recording has no response`);
        return saved.response;
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
