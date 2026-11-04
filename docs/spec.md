# threadmark: spec

Turn a team chat export into a digest of *episodes* (one conversation about one
topic) where every summary sentence links back to the messages it came from,
and the links are checked by code rather than trusted.

## Input

A channel export, normalised to messages `{ id, at, author, text }`:

- **Slack**: a channel folder from a workspace export (`YYYY-MM-DD.json` files).
- **Discord**: a DiscordChatExporter JSON file.

## Pipeline

1. **Bursts** (`src/bursts.js`, pure). Split the timeline wherever nobody spoke
   for `gapMinutes` (default 90). Bursts longer than `maxBurst` messages are
   cut into windows so one request stays a sensible size.
2. **Episodes** (`src/episodes.js`). One Claude request per burst, structured
   output. Within a burst, topics can interleave ("anyone else seeing 502s?"
   in the middle of a billing question), so the model decides which messages
   belong together. Messages that are just chatter can be left out.
3. **Verification** (`src/verify.js`, pure). The model's answer is a claim, not
   a fact. For each episode:
   - message IDs must exist in the burst, and each message belongs to at most
     one episode (first claim wins);
   - each summary point's citations must be messages *in that episode*;
   - a point left with no valid citation is kept but marked **uncited**.
   Every correction is recorded as an issue, so the eval can count them.
4. **Report** (`src/report.js`). A single static HTML file: episodes with
   status and cited points, and the full transcript with anchors to jump to.

## Model access

`src/model.js` wraps the API with three modes:

- `live`: call Claude.
- `record`: call Claude and save each response under the SHA-256 of its request.
- `replay`: answer from saved responses only; a missing one is an error.

Tests use a fake model. Replay makes evals reproducible and free to re-run.

## Evaluation

`eval/` holds a synthetic support channel with hand-labelled episodes.
`npm run eval` scores:

- **Grouping**: pairwise precision, recall and F1. Two messages are a pair
  when they share an episode, compared against the labels.
- **Citations**: the share of cited IDs that survived verification, and the
  share of points left uncited.

The baseline is "one burst = one episode" with no model, so the eval shows
what the model adds over a time-gap heuristic.

## Not in scope

Live Slack/Discord APIs (exports only), a server or login, attachments.
