# threadmark

Chat export in, digest of verified, cited episodes out. See README.md and docs/spec.md.

## Commands

- `npm test` runs `node --test`. It must never need an API key or network
- `npm run fuzz` runs the property tests at 100,000 cases each
- `npm run mutate` runs Stryker. It fails below a 95% mutation score
- `npm run eval` scores the baseline, plus Claude if `eval/recordings/` has responses
- `npm run eval -- --record` calls Claude and costs money, so ask first
- `npm run build-example` regenerates `examples/support/` from `eval/dataset.js`

## Rules

- `src/bursts.js`, `src/verify.js` and `src/report.js` stay pure: no I/O, no model calls.
- Anything the model returns goes through `verifyEpisodes` before it is used or shown.
  `verifyEpisodes` must accept any JSON value without throwing; the property tests check this.
- All chat and model text in the report goes through `esc()`, inside `<bdi>`. The CSP
  hashes in `report.js` are computed from `CSS` and `OPEN_TARGET`, so never add another
  inline script, style attribute or external resource: the browser would block it.
- The transcript turns every line break (`\r`, U+2028 and the rest, not just `\n`) into
  an indented continuation, so only a real message can start a line with `[id]`. Don't
  build model input from chat text anywhere else without the same treatment.
- Message IDs are limited to `[A-Za-z0-9._:-]` at import. Refuse bad input with an error
  that names the file and message; never guess or silently skip something malformed.
- Requests are keyed by their SHA-256. Changing the prompt, schema or model changes
  every key, so recordings must be re-recorded and the README's scores updated. The
  prompt's hash is pinned in `test/hardening.test.js` for this reason.
- Never hand-write or edit a recording (replay refuses one whose saved request doesn't
  match), and never put a score in the README that `npm run eval` can't reproduce. A
  test compares them.
- `eval/dataset.js` is the source of truth for labels. Don't change labels to
  improve a score. Tuning the prompt against the eval makes the score optimistic,
  so say so if it happens.
- Keep real chat exports out of the repo. Examples and evals use synthetic data only.
- Model: `claude-opus-5-5`. Thinking can't be disabled and sampling parameters are
  rejected, so control depth with `output_config.effort`.

## Tests

- A bug fix comes with a test that fails before the fix. Check it really does by
  running the test against the old code, not just the new.
- New code needs tests that kill its mutants: run `npm run mutate` and look at the
  survivors. The ones listed as equivalent in docs/build-log.md are known; anything
  new needs a test or a written reason it can't be killed.
- Tests never touch the network. Inject a fake client into `createModel` instead.
