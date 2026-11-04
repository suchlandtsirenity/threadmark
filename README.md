# threadmark

Turns a team chat export into a digest of what actually happened: separate
conversations pulled apart from the noise, each with a short summary where
every sentence links back to the messages it came from.

The model's answer is treated as a claim, not a fact. Code checks every message
ID and citation against the export, corrects what doesn't hold up, and flags
any sentence left without support. A labelled eval set measures how well it works.

- **Reads exports:** a Slack channel folder or a DiscordChatExporter JSON file
- **Untangles conversations:** topics that interleave in a busy channel become separate episodes
- **Verified citations:** a citation has to point at a real message in the same episode
- **Single-file report:** static HTML, where each citation jumps to its message in the transcript
- **Reproducible:** responses can be recorded and replayed, so evals re-run with no API key or cost

## How it works

```
export -> messages -> bursts -> Claude, one request per burst -> verification -> report
```

| | |
|---|---|
| `src/import.js` | Slack and Discord exports into one message shape |
| `src/bursts.js` | Splits the timeline on quiet gaps. No model involved |
| `src/episodes.js` | The prompt, the JSON schema for structured output, and response checks |
| `src/verify.js` | Checks the model's answer against the source messages and records every correction |
| `src/model.js` | Calls Claude, or records and replays responses keyed by the request's SHA-256 |
| `src/report.js` | The HTML report. Chat text is untrusted, so all of it is escaped |
| `eval/` | Synthetic labelled channel, scoring, and the runner |
| `test/` | 19 tests with `node:test`, using a fake model, so they need no API key |

The [spec](docs/spec.md) has the details, and the [build log](docs/build-log.md)
covers the decisions and what's still unproven.

## Evaluation

`eval/dataset.js` is a made-up support channel with 34 messages and 6 hand-labelled
conversations, written so that topics interleave. Grouping is scored on
pairs of messages that share an episode.

| | Episodes | Pair precision | Pair recall | Pair F1 |
|---|---|---|---|---|
| Time gaps only (baseline) | 3 | 33% | 100% | 50% |
| Claude | not recorded yet | | | |

Time gaps alone lump everything in a burst together, so they find every real pair
and many false ones. That's the gap the model has to close. **Claude's scores
aren't here yet because the responses haven't been recorded**, and this README
won't quote numbers it can't reproduce. The live API path has not been run yet.

```sh
npm run eval                 # baseline, plus Claude if recordings exist
npm run eval -- --record     # call Claude and save the responses
```

## Running it

Needs Node 22+, and `ANTHROPIC_API_KEY` for anything that calls Claude.

```sh
npm install
npm test
node src/cli.js examples/support --out report.html
```

`examples/support` is the eval channel as a Slack export. Options:
`--gap <minutes>`, `--max-burst <n>`, `--title <text>`,
`--record <dir>`, `--replay <dir>`.

Exports are sent to the Anthropic API when you run a digest, so only use chats
you're allowed to share that way.

## Limits

- Episodes can't span bursts: a conversation picked up after a long gap becomes two.
- Verification proves a citation points at a real message in the right episode.
  It doesn't prove that message supports the sentence. That would need a separate
  check, such as a model grading each claim against its source.
- The eval set is small and synthetic, so it's a regression check, not a benchmark.

## License

[MIT](LICENSE)
