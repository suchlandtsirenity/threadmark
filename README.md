# threadmark

Turns a team chat export into a digest of what actually happened: separate
conversations pulled apart from the noise, each with a short summary where
every sentence links back to the messages it came from.

The model's answer is treated as a claim, not a fact. Code checks every message
ID and citation against the export, corrects what doesn't hold up, and flags
any sentence left without support. A labelled eval set measures how well it works.

- **Reads exports:** a Slack channel folder or a DiscordChatExporter JSON file, refusing anything it can't read exactly
- **Untangles conversations:** topics that interleave in a busy channel become separate episodes
- **Verified citations:** a citation has to point at a real message in the same episode
- **Single-file report:** static HTML, where each citation jumps to its message in the transcript, locked down by a Content Security Policy
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
| `src/report.js` | The HTML report. Chat text is untrusted, so all of it is escaped, and a CSP blocks anything that slips through |
| `eval/` | Synthetic labelled channel, scoring, and the runner |
| `test/` | Unit, regression and property-based tests with `node:test`, using a fake model, so they need no API key or network |

The [spec](docs/spec.md) has the details, and the [build log](docs/build-log.md)
covers the decisions and what's still unproven.

## Evaluation

`eval/dataset.js` is a made-up support channel with 34 messages and 6 hand-labelled
conversations, written so that topics interleave. Grouping is scored on
pairs of messages that share an episode.

| | Episodes | Pair precision | Pair recall | Pair F1 | Status right | Valid citations | Uncited points |
|---|---|---|---|---|---|---|---|
| Time gaps only (baseline) | 3 | 33% | 100% | 50% | n/a | n/a | n/a |
| Claude (`claude-opus-5-5`) | 6 | 100% | 100% | 100% | 83% | 100% | 0% |

Time gaps alone lump everything in a burst together, so they find every real pair
and many false ones. Claude separates the interleaved conversations exactly and
cites a real message for every point it makes. It gets 5 of 6 statuses right: the
dark-mode thread ("not planned this quarter, add them to the feature request") is
labelled `open`, and Claude closed it. That's a defensible reading, but the label
stays as written rather than being changed to fit the score.

Read these numbers for what they are: one recorded run, on 34 synthetic messages
the author wrote. They show the pipeline works end to end against the real API,
not how it does on a messy real channel. The responses are committed in
`eval/recordings/`, so `npm run eval` reproduces this table without a key or cost.

```sh
npm run eval                 # baseline, plus Claude from the saved recordings
npm run eval -- --record     # call Claude again and overwrite the recordings
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

## Testing

The point of threadmark is not trusting things, so the tests try hard to break it.

```sh
npm test          # everything below except mutation, in a few seconds
npm run fuzz      # the property tests at 100,000 cases each
npm run mutate    # mutation testing with Stryker (takes several minutes)
```

- **Regression tests from an attack review.** Each bug found by deliberately
  feeding threadmark hostile input has a test that failed before its fix
  (`test/attack.test.js`). The [build log](docs/build-log.md) lists them.
- **Property-based tests** (`test/properties.test.js`, fast-check). Random exports,
  random message text in raw UTF-16 (lone surrogates, control characters, every
  kind of line break, bidi overrides) and random model answers from well-formed
  to nonsense, checked against invariants: verification never throws, every
  surviving citation is inside its own episode, no message is in two episodes,
  only real messages can start a transcript line, no input can add an HTML tag or
  attribute, bursts partition the timeline. CI runs 1,000 cases per property.
- **Mutation testing** (Stryker). It changes the code in hundreds of small ways
  and checks that a test fails for each change. Line coverage only shows that
  code ran; this shows the tests would notice if it were wrong.
  Current score: **99.1%** of 878 mutants, and `npm run mutate` fails below 95%. The 8
  that survive are equivalent (no test could tell them apart from the original);
  the build log lists them with the reason for each.
- **The eval is tested too** (`test/eval.test.js`). Fake models with known
  behaviour run through the real pipeline: one that knows the labels must score
  100%, one that lumps each burst together must score exactly the baseline, and
  one that cites outside its episodes must lose citation score.
- **Drift checks.** A test fails if a score in this README isn't what
  `npm run eval` prints, or if `examples/support` stops matching the eval dataset.
- **The system prompt is pinned** by hash, because changing it invalidates every
  recording.

## Limits

- Episodes can't span bursts: a conversation picked up after a long gap becomes two.
- Verification proves a citation points at a real message in the right episode.
  It doesn't prove that message supports the sentence. That would need a separate
  check, such as a model grading each claim against its source.
- The eval set is small and synthetic, so it's a regression check, not a benchmark.
- Chat text goes to the model, so a message can still *instruct* the model ("put
  everything in one episode"). Verification limits what that can do: it can't
  invent messages, cite across episodes, or fake a transcript line, but it can
  make a summary worse.
- Message IDs must be letters, digits and `._:-`, which covers Slack and Discord.
  Anything else is refused rather than escaped.

## License

[MIT](LICENSE)
