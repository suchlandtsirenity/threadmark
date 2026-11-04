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

// `[1772441900.0001] 09:58 mo: text`, with a date line whenever the day changes.
export function transcript(burst) {
  const lines = [];
  let day = null;
  for (const m of burst) {
    const [d, t] = [m.at.slice(0, 10), m.at.slice(11, 16)];
    if (d !== day) { lines.push(`--- ${d} (UTC) ---`); day = d; }
    lines.push(`[${m.id}] ${t} ${m.author}: ${m.text.replace(/\n/g, '\n    ')}`);
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
  if (message.stop_reason === 'refusal') throw new Error(`model declined: ${message.stop_details?.category ?? 'no category'}`);
  if (message.stop_reason === 'max_tokens') throw new Error('model ran out of output tokens; try a smaller --max-burst');
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('model returned no text');
  return JSON.parse(text);
}
