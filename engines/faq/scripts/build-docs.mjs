// Builds docs/*.md into a small static HTML site (default: _site/). Uses `marked`, installed by the workflow; the engine itself stays dependency-free.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';

const out = process.argv[2] ?? '_site';
const pages = [
  ['USER_MANUAL', 'User Manual'],
  ['COORDINATOR', 'FAQ Coordinator Playbook'],
  ['ARCHITECTURE', 'Architecture'],
  ['UPDATE_MODE', 'Update Mode'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const nav = (cur) => pages.map(([f, t]) => `<a href="${f}.html"${f === cur ? ' aria-current="page"' : ''}>${esc(t)}</a>`).join('');
const css = `:root{--bg:#fff;--fg:#1c2330;--mut:#5b6678;--line:#dde2ea;--acc:#1f5fbf;--code:#f3f5f9}
@media(prefers-color-scheme:dark){:root{--bg:#14181f;--fg:#e6e9ef;--mut:#9aa5b8;--line:#2a3140;--acc:#7fb0ff;--code:#1d232d}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
header{border-bottom:1px solid var(--line);padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
header strong{margin-right:8px}header a{color:var(--acc);text-decoration:none}header a[aria-current]{font-weight:700;text-decoration:underline}
main{max-width:860px;margin:0 auto;padding:16px}a{color:var(--acc)}
pre,code{background:var(--code);border-radius:4px;font-size:.9em}code{padding:.1em .3em}pre{padding:12px;overflow-x:auto}pre code{padding:0;background:none}
table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 10px;vertical-align:top}
blockquote{border-left:4px solid var(--line);margin:1em 0;padding:0 1em;color:var(--mut)}`;

mkdirSync(out, { recursive: true });
for (const [file, title] of pages) {
  const md = readFileSync(`docs/${file}.md`, 'utf8');
  const body = marked.parse(md).replace(/href="(?:\.\/)?([A-Z_]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
  writeFileSync(`${out}/${file}.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | FAQ Engine</title><style>${css}</style></head><body><header><strong>FAQ Engine</strong>${nav(file)}</header><main>${body}</main></body></html>`);
}
writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=USER_MANUAL.html"><title>FAQ Engine</title><a href="USER_MANUAL.html">FAQ Engine User Manual</a>`);
console.log(`Built ${pages.length} pages into ${out}/`);
