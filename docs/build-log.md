# Build log

How threadmark was built, and what's still unproven. Built with Claude Code.

## Where the idea came from

An earlier private tool of mine archived chat history and let you browse it by
day. It had an empty function for proposing groups of related messages, with a
note to decide what counts as a group. threadmark starts from that gap, as a
new codebase aimed at team chat, with synthetic data only.

## Decisions

**Time gaps first, model second.** Bursts are cheap, deterministic and testable,
and they keep each request small. The model handles only what a gap can't:
separating topics that interleave inside a burst.

**Verification is code, not a second prompt.** Whether a message ID exists and
belongs to an episode is a set lookup. Bad citations get corrected and counted
rather than rejected outright, because one bad citation shouldn't throw away a
useful summary, and the counts are what the eval reports.

**A point with no valid citation stays visible, flagged "uncited".** Dropping it
would hide a model failure from the reader.

**Structured output with a JSON schema.** Episodes arrive as parseable data, and
truncation or a refusal is an error rather than an empty digest.

**Record and replay by request hash.** Tests use a fake model and never touch the
network. Recordings make eval runs reproducible and free, and because the key
covers the prompt, changing the prompt can't silently reuse old answers.

**Labels live beside the messages.** `eval/dataset.js` holds each message with its
label, and the Slack export is generated from it, so the two can't drift apart.

**Pairwise scoring.** Predicted episodes don't map one-to-one onto labelled ones,
and pairs avoid needing that mapping. The baseline shows why precision matters:
one big group per burst gets 100% recall and only 33% precision.

**Exports only.** No live Slack or Discord access. It keeps the tool simple and
means it only reads files you chose to export.

## Not proven yet

- **The live API path hasn't run.** The request shape was checked against the
  installed SDK's types, but no real response has gone through it, because no API
  key was available during the build. Everything past `model.complete()` is
  tested with a fake model.
- **There are no Claude scores yet**, only the baseline. Expect to adjust the prompt
  after the first real run, and record what changed here.
- **Citation checks are structural.** See Limits in the README.
