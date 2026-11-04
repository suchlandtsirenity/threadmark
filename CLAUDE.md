# threadmark

Chat export in, digest of verified, cited episodes out. See README.md and docs/spec.md.

## Commands

- `npm test` runs `node --test`. It must never need an API key or network
- `npm run eval` scores the baseline, plus Claude if `eval/recordings/` has responses
- `npm run eval -- --record` calls Claude and costs money, so ask first
- `npm run build-example` regenerates `examples/support/` from `eval/dataset.js`

## Rules

- `src/bursts.js`, `src/verify.js` and `src/report.js` stay pure: no I/O, no model calls.
- Anything the model returns goes through `verifyEpisodes` before it is used or shown.
- All chat and model text in the report goes through `esc()`.
- Requests are keyed by their SHA-256. Changing the prompt, schema or model changes
  every key, so recordings must be re-recorded and the README's scores updated.
- Never hand-write or edit a recording, and never put a score in the README that
  `npm run eval` can't reproduce.
- `eval/dataset.js` is the source of truth for labels. Don't change labels to
  improve a score. Tuning the prompt against the eval makes the score optimistic,
  so say so if it happens.
- Keep real chat exports out of the repo. Examples and evals use synthetic data only.
- Model: `claude-opus-5-5`. Thinking can't be disabled and sampling parameters are
  rejected, so control depth with `output_config.effort`.
