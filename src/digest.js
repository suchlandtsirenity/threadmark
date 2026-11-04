// The pipeline: messages -> bursts -> one model request per burst -> verified episodes.
import { splitBursts } from './bursts.js';
import { buildRequest, readResponse } from './episodes.js';
import { verifyEpisodes } from './verify.js';

export async function digest(messages, model, { gapMinutes, maxBurst, onProgress } = {}) {
  const bursts = splitBursts(messages, { gapMinutes, maxBurst });
  const out = [];
  for (const [i, burst] of bursts.entries()) {
    onProgress?.(i + 1, bursts.length);
    const raw = readResponse(await model.complete(buildRequest(burst)));
    out.push({ messages: burst, ...verifyEpisodes(raw, burst) });
  }
  return out;
}

// Totals across bursts, for the CLI summary and the eval.
export function totals(bursts) {
  const t = { episodes: 0, issues: 0, cites: 0, validCites: 0, points: 0, uncitedPoints: 0 };
  for (const b of bursts) {
    t.episodes += b.episodes.length;
    t.issues += b.issues.length;
    for (const k of ['cites', 'validCites', 'points', 'uncitedPoints']) t[k] += b.stats[k];
  }
  return t;
}
