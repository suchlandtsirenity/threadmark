// A synthetic #support channel for a made-up invoicing product, "Ledgerly".
// Every message carries a hand label: the episode it belongs to, or null for
// chatter that belongs to none. `npm run build-example` writes this out as a
// Slack export in examples/; the eval reads the labels from here.
//
// Topics interleave on purpose. A time-gap heuristic can't separate them;
// telling them apart is the part the model has to earn.
export const CHANNEL = 'support';

// [day, "HH:MM", author, text, label]
export const MESSAGES = [
  // Day 1, morning: an export bug and an SSO problem, tangled together.
  [1, '09:02', 'kim', 'morning all', null],
  [1, '09:04', 'mo', 'Acme Freight says their CSV export of all invoices spins and then fails. They have about 40k invoices.', 'export'],
  [1, '09:05', 'raj', 'which export, the invoices list or the accounting one?', 'export'],
  [1, '09:07', 'mo', 'invoices list, "Export all" button', 'export'],
  [1, '09:09', 'dana', 'Different thing: Northwind can\'t log in with SSO on Safari. It bounces them back to the login page forever.', 'sso'],
  [1, '09:10', 'kim', 'only Safari?', 'sso'],
  [1, '09:12', 'raj', 'export runs as one request, 40k rows will hit the 30s gateway timeout. I\'ll look at streaming it.', 'export'],
  [1, '09:13', 'dana', 'yes, Chrome works for them', 'sso'],
  [1, '09:15', 'priya', 'Safari blocks the third-party cookie our IdP callback sets. Known issue since the auth domain move.', 'sso'],
  [1, '09:16', 'kim', 'coffee machine on 3 is fixed btw', null],
  [1, '09:18', 'priya', 'workaround for now: have them allow cross-site tracking for login.ledgerly.app, or use Chrome', 'sso'],
  [1, '09:20', 'dana', 'passing that on, thanks', 'sso'],
  [1, '09:41', 'raj', 'PR up to stream the CSV in chunks instead of building it in memory: #2291', 'export'],
  [1, '09:58', 'raj', 'deployed. Export of 40k invoices now finishes in about 12s on staging', 'export'],
  [1, '10:03', 'mo', 'Acme confirms it worked 🎉', 'export'],
  [1, '10:05', 'kim', 'nice', null],
  [1, '10:07', 'priya', 'real SSO fix needs the callback moved onto our first-party domain. Ticket AUTH-418, not scheduled yet.', 'sso'],

  // Day 1, afternoon: a release announcement and an API question.
  [1, '14:00', 'lee', 'v4.2 is out: recurring invoice templates, a faster dashboard, and multi-currency totals on reports. Notes are in #releases.', 'release'],
  [1, '14:02', 'kim', '🙌', null],
  [1, '14:06', 'mo', 'Customer asking what the API rate limit is. They\'re planning a nightly sync of ~5k invoices.', 'ratelimit'],
  [1, '14:09', 'raj', '100 requests per minute per API key, with a burst of 20', 'ratelimit'],
  [1, '14:10', 'lee', 'reminder that multi-currency totals are behind a flag for orgs created before March', 'release'],
  [1, '14:12', 'raj', 'for 5k invoices they should use the batch endpoint, 200 per call, so 25 calls', 'ratelimit'],
  [1, '14:14', 'mo', 'perfect, sending them the batch docs', 'ratelimit'],

  // Day 2, morning: duplicate invoices from webhooks, plus a feature request.
  [2, '09:30', 'kim', 'Brightside reports duplicate invoices created from their Stripe webhook, roughly 1 in 50', 'webhook'],
  [2, '09:33', 'priya', 'probably Stripe retrying after a slow response from us. Do the duplicates have the same Stripe event ID?', 'webhook'],
  [2, '09:36', 'dana', 'unrelated but three customers this week asked for a dark mode. Is that on the roadmap?', 'darkmode'],
  [2, '09:38', 'kim', 'yes, same event ID on each pair', 'webhook'],
  [2, '09:40', 'lee', 'dark mode isn\'t planned this quarter. Can you add those customers to the feature request so we can count them?', 'darkmode'],
  [2, '09:41', 'priya', 'then we\'re not deduplicating on event ID. I\'ll add an idempotency check keyed on it.', 'webhook'],
  [2, '09:43', 'dana', 'will do', 'darkmode'],
  [2, '09:45', 'mo', 'lunch order going in at 11 if anyone wants in', null],
  [2, '10:20', 'priya', 'idempotency check is live. Replayed yesterday\'s events on staging and got zero duplicates.', 'webhook'],
  [2, '10:24', 'kim', 'I\'ll tell Brightside, and they can delete the existing duplicates from the invoices list', 'webhook'],
];

// How each labelled conversation ended.
export const STATUS = {
  export: 'resolved', sso: 'open', release: 'info', ratelimit: 'resolved', webhook: 'resolved', darkmode: 'open',
};

const pad = (n) => String(n).padStart(2, '0');
export const dayDate = (day) => `2026-03-${pad(day + 1)}`;

// The messages as threadmark sees them, with Slack-style IDs, plus the labels.
export function labelledMessages() {
  return MESSAGES.map(([day, time, author, text, label], i) => {
    const at = new Date(`${dayDate(day)}T${time}:00Z`);
    // Slack IDs are the epoch seconds plus a 6-digit sequence.
    const id = `${at.getTime() / 1000}.${String(100 + i).padStart(6, '0')}`;
    return { id, at: at.toISOString(), author, text, label };
  });
}
