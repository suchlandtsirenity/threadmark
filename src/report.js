// Renders a digest as one self-contained HTML file: episodes with cited points,
// then the transcript they link into. Chat text is untrusted, so every value
// that reaches the page goes through esc(). As a second line of defence, the
// page's Content Security Policy only runs the one script and stylesheet below,
// matched by hash, so even a missed escape couldn't run code or load anything.
import { createHash } from 'node:crypto';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const anchor = (id) => `m-${esc(id)}`;
// <bdi> stops right-to-left override characters in chat text from reordering
// the text around them (a name, a citation, an "uncited" flag).
const iso = (s) => `<bdi>${esc(s)}</bdi>`;
const time = (at) => `${at.slice(0, 10)} ${at.slice(11, 16)}`;

function renderPoint(point, numberOf) {
  const cites = point.cites
    .map((id) => `<a class="cite" href="#${anchor(id)}">${numberOf.get(id)}</a>`)
    .join('');
  const flag = point.uncited ? ' <span class="flag">uncited</span>' : '';
  return `<li>${iso(point.text)}${flag} ${cites}</li>`;
}

function renderEpisode(ep, numberOf) {
  return `<article class="episode">
  <h3>${iso(ep.title)}${ep.status ? ` <span class="status ${esc(ep.status)}">${esc(ep.status)}</span>` : ''}</h3>
  <ul>${ep.points.map((p) => renderPoint(p, numberOf)).join('')}</ul>
  <p class="meta">${ep.messageIds.length} message${ep.messageIds.length === 1 ? '' : 's'}</p>
</article>`;
}

function renderMessage(m, n, episodeOf) {
  const title = episodeOf.get(m.id);
  return `<li id="${anchor(m.id)}"${title ? '' : ' class="loose"'}>
  <span class="n">${n}</span>
  <div><p class="meta">${iso(m.author)} · ${esc(time(m.at))} UTC${title ? ` · ${iso(title)}` : ''}</p>
  <p class="text">${iso(m.text)}</p></div>
</li>`;
}

export function renderReport({ title, bursts }) {
  // Citations show as message numbers, which read better than raw chat IDs.
  const numberOf = new Map();
  for (const m of bursts.flatMap((b) => b.messages)) numberOf.set(m.id, numberOf.size + 1);

  const sections = bursts.map((b) => {
    const episodeOf = new Map(b.episodes.flatMap((ep) => ep.messageIds.map((id) => [id, ep.title])));
    const first = b.messages[0], last = b.messages.at(-1);
    return `<section>
  <h2>${esc(time(first.at))} to ${esc(time(last.at))} UTC</h2>
  ${b.episodes.map((ep) => renderEpisode(ep, numberOf)).join('\n  ') || '<p class="meta">No episodes found.</p>'}
  <details><summary>Transcript (${b.messages.length} messages)</summary>
    <ol class="messages">${b.messages.map((m) => renderMessage(m, numberOf.get(m.id), episodeOf)).join('')}</ol>
  </details>
</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${sections}
</main>
<script>${OPEN_TARGET}</script>
</body>
</html>
`;
}

// A citation can point into a closed transcript, so open it before jumping.
const OPEN_TARGET = `function show(){var t=location.hash&&document.getElementById(location.hash.slice(1));
if(!t)return;var d=t.closest('details');if(d)d.open=true;t.scrollIntoView({block:'center'})}
addEventListener('hashchange',show);show();`;

const CSS = `
:root{color-scheme:light dark;--bg:#fbfaf8;--card:#fff;--fg:#1f2328;--muted:#5d6570;--line:#dfe1e4;--accent:#0b6e75;--tint:#fff3b8;--warn:#8a4b00}
@media (prefers-color-scheme:dark){:root{--bg:#14171a;--card:#1c2024;--fg:#e8eaed;--muted:#a3abb5;--line:#343a40;--accent:#63c8cf;--tint:#4a4110;--warn:#f0b35c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.7rem;margin:0 0 24px}
h2{font-size:.9rem;font-weight:600;color:var(--muted);margin:32px 0 12px}
h3{font-size:1.05rem;margin:0 0 8px}
.episode{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:12px}
.episode ul{margin:0;padding-left:20px}
.meta{color:var(--muted);font-size:.8rem;margin:8px 0 0}
.status{font-size:.72rem;font-weight:600;border:1px solid currentColor;border-radius:99px;padding:1px 8px;margin-left:6px;vertical-align:2px;color:var(--muted)}
.status.open{color:var(--warn)}.status.resolved{color:var(--accent)}
.cite{display:inline-block;min-width:22px;text-align:center;font-size:.72rem;color:var(--accent);border:1px solid var(--line);border-radius:4px;margin-left:3px;text-decoration:none}
.flag{font-size:.72rem;font-weight:600;color:var(--warn)}
summary{cursor:pointer;color:var(--muted);font-size:.85rem;margin-top:12px}
.messages{list-style:none;margin:12px 0 0;padding:0}
.messages li{display:flex;gap:12px;padding:8px;border-bottom:1px solid var(--line)}
.messages li:target{background:var(--tint)}
.messages li.loose{opacity:.65}
.messages .meta{margin:0}.text{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.n{color:var(--muted);font-size:.8rem;min-width:24px;text-align:right}
`;

const sha256 = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const CSP = `default-src 'none'; script-src ${sha256(OPEN_TARGET)}; style-src ${sha256(CSS)}; base-uri 'none'; form-action 'none'`;
