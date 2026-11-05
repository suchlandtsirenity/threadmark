// Builds the Claude request that groups one burst into episodes, and reads the
// answer back. The request is plain data so the model wrapper can hash it.
export const MODEL = 'claude-opus-5-5';

// Kept byte-for-byte stable: it is the cacheable prefix of every request.
export const SYSTEM = `You read a slice of a team chat channel and split it into episodes.

An episode is one conversation about one topic: a question and its answers, an
incident and its fix, a decision being made. Conversations in a busy channel
interleave, so an episode's messages need not be consecutive. Leave out messages
that belong to no real conversation (greetings, "thanks!", off-topic chatter).

For each episode give:
- title: under 8 words, specific ("CSV export times out for large orgs", not "Export issue")
- status: "resolved" if the conversation reached an answer or fix, "open" if it
  ended without one, "info" if it was an announcement or FYI
- message_ids: every message that belongs to it, using the IDs in square brackets
- points: 1 to 4 short sentences summarising what happened. Each point lists in
  "cites" the IDs of the messages that support it. Only cite messages in the same
  episode. A point you cannot support with a message should not be written.

Use only what the messages say. Do not guess at causes or outcomes that nobody stated.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['episodes'],
  properties: {
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'status', 'message_ids', 'points'],
        properties: {
          title: { type: 'string' },
          status: { type: 'string', enum: ['resolved', 'open', 'info'] },
          message_ids: { type: 'array', items: { type: 'string' } },
          points: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'cites'],
              properties: {
                text: { type: 'string' },
                cites: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
};

// Every way text can start a new line, not just \n. Each becomes a plain \n so
// the continuation indent below applies to it: otherwise a message containing
// "\r[<real id>] 09:30 boss: approved" would show the model a fake line that
// carries a real ID, and a citation to it would pass verification.
const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/g;
// Other control characters and bidirectional overrides, which can hide or
// reorder text. Tab is kept.
const CONTROL = /[\u0000-\u0008\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

const textLines = (s) => s.replace(LINE_BREAK, '\n').replace(CONTROL, ' ');
const oneLine = (s) => s.replace(LINE_BREAK, ' ').replace(CONTROL, ' ');

// `[1772441900.0001] 09:58 mo: text`, with a date line whenever the day changes.
// Continuation lines are indented, so only a real message can start a line with "[".
export function transcript(burst) {
  const lines = [];
  let day = null;
  for (const m of burst) {
    const [d, t] = [m.at.slice(0, 10), m.at.slice(11, 16)];
    if (d !== day) { lines.push(`--- ${d} (UTC) ---`); day = d; }
    lines.push(`[${m.id}] ${t} ${oneLine(m.author)}: ${textLines(m.text).replace(/\n/g, '\n    ')}`);
  }
  return lines.join('\n');
}

export function buildRequest(burst) {
  return {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: transcript(burst) }],
  };
}

export function readResponse(message) {
  if (message?.stop_reason === 'refusal') throw new Error(`model declined: ${message.stop_details?.category ?? 'no category'}`);
  if (message?.stop_reason === 'max_tokens') throw new Error('model ran out of output tokens; try a smaller --max-burst');
  if (message?.stop_reason !== 'end_turn') throw new Error(`unexpected stop reason: ${message?.stop_reason}`);
  const text = Array.isArray(message.content) ? message.content.find((b) => b?.type === 'text')?.text : undefined;
  if (typeof text !== 'string' || !text) throw new Error('model returned no text');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`model output is not valid JSON: ${err.message}`);
  }
}
