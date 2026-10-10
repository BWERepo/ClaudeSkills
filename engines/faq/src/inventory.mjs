// Content inventory: every public page the FAQ Engine may learn from, in one adapter-neutral shape.
//
// Page shape: { url, title, type, category, description, headings:[{level,text,id}], sections:[{heading,level,text}],
//               text, links:[href], faqs:[{q,a}], updated, indexable, hash }
// Adapters: "json" (a site exports its own inventory: best for sites whose content lives in code/CMS)
//           "html-dir" (scan a built site folder; works for any framework that emits static HTML)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { sha, squash } from './text.mjs';
import { fromRoot } from './config.mjs';

const decode = (s) =>
  String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const stripTags = (h) => squash(decode(h.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')));

export function finalizePage(p) {
  const page = {
    url: p.url,
    title: squash(p.title ?? ''),
    type: p.type ?? 'page',
    category: p.category ?? null,
    description: squash(p.description ?? ''),
    headings: p.headings ?? [],
    sections: p.sections ?? [],
    text: squash(p.text ?? ''),
    links: [...new Set(p.links ?? [])],
    faqs: (p.faqs ?? []).map((f) => ({ q: squash(f.q), a: squash(f.a) })),
    updated: p.updated ?? null,
    schemaTypes: p.schemaTypes ?? [],
    indexable: p.indexable !== false,
    aliases: p.aliases ?? [],
  };
  page.hash = sha([page.title, page.description, page.text, JSON.stringify(page.faqs)].join('\n'));
  return page;
}

/** Parse one static HTML document into a page. Tolerant on purpose: this is a scanner, not a validator. */
export function parseHtml(html, url) {
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '');
  const description = decode((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ?? [])[1] ?? '');
  const robots = (html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i) ?? [])[1] ?? '';
  const main = (html.match(/<main\b[\s\S]*?<\/main>/i) ?? [html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html])[0];
  const body = stripEngineBlocks(main.replace(/<(script|style|noscript|svg|template|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' '));
  const headings = [];
  const re = /<h([1-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let m;
  const marks = [];
  while ((m = re.exec(body))) {
    const id = (m[2].match(/\bid=["']([^"']+)["']/i) ?? [])[1] ?? null;
    const text = stripTags(m[3]);
    if (!text) continue;
    headings.push({ level: +m[1], text, id });
    marks.push({ level: +m[1], text, start: m.index, end: m.index + m[0].length });
  }
  const sections = marks.map((h, i) => ({ heading: h.text, level: h.level, text: stripTags(body.slice(h.end, marks[i + 1]?.start ?? body.length)) }));
  const links = [...body.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*|#[^"']+)["']/gi)].map((x) => decode(x[1]));
  const faqs = detailsFaqs(body);
  const ld = jsonLdInfo(html);
  return finalizePage({ url, title, description, headings, sections, links, faqs, text: stripTags(body), indexable: !/noindex/i.test(robots), schemaTypes: ld.types, category: ld.category, type: pageTypeFrom(ld.types) });
}


/** Remove every block the FAQ Engine itself rendered (<div class="faq-engine" ...>): those questions come from the registry, so scanning them again would loop the engine's own output back in as "page content". */
export function stripEngineBlocks(html) {
  let out = html;
  for (let guard = 0; guard < 100; guard++) {
    const start = out.search(/<div\b[^>]*class="[^"]*\bfaq-engine\b/);
    if (start < 0) break;
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = start;
    let depth = 0;
    let end = -1;
    let m;
    while ((m = tag.exec(out))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    }
    if (end < 0) break;
    out = out.slice(0, start) + ' ' + out.slice(end);
  }
  return out;
}

/** Every <details> element, balanced (they nest), as { summary, body }. A question is a details whose summary text ends in "?". */
function detailsFaqs(html) {
  const faqs = [];
  const tag = /<(\/?)details\b[^>]*>/gi;
  const stack = [];
  let m;
  while ((m = tag.exec(html))) {
    if (!m[1]) stack.push({ open: m.index, start: m.index + m[0].length });
    else {
      const d = stack.pop();
      if (!d) continue;
      const inner = html.slice(d.start, m.index);
      const sm = inner.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
      if (!sm) continue;
      const q = stripTags(sm[1]);
      const rest = inner.slice(sm[0].length);
      const a = stripTags(rest.replace(/<details\b[\s\S]*$/i, ' '));
      if (q.endsWith('?') && a) faqs.push({ q, a, at: d.open });
    }
  }
  return faqs.sort((x, y) => x.at - y.at).map(({ q, a }) => ({ q, a }));
}

const TYPE_MAP = { WebApplication: 'tool', SoftwareApplication: 'tool', BlogPosting: 'article', Article: 'article', NewsArticle: 'article', Product: 'product', Service: 'service', FAQPage: 'faq', ContactPage: 'contact', AboutPage: 'about' };
export const pageTypeFrom = (types) => types.map((t) => TYPE_MAP[t]).find(Boolean) ?? 'page';

/** @type and (when present) the second breadcrumb item, which is the page's section/category. */
function jsonLdInfo(html) {
  const types = [];
  let category = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    for (const node of Array.isArray(data) ? data : [data]) {
      if (node['@type']) types.push(...[].concat(node['@type']));
      if (node['@type'] === 'BreadcrumbList' && node.itemListElement?.length >= 3) category = node.itemListElement[1].name ?? null;
    }
  }
  return { types: [...new Set(types)], category };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function fileToUrl(root, file) {
  let rel = relative(root, file).split(sep).join('/');
  rel = rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
  return '/' + rel.replace(/\/$/, '');
}

function loadHtmlDir(cfg, a) {
  const dir = fromRoot(cfg, a.dir);
  if (!existsSync(dir)) throw new Error(`html-dir adapter: folder not found: ${dir}`);
  return walk(dir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => parseHtml(readFileSync(f, 'utf8'), fileToUrl(dir, f)))
    .filter((p) => !(a.exclude ?? []).some((x) => p.url.startsWith(x)));
}

function loadJson(cfg, a) {
  const file = resolve(cfg.root, a.path);
  if (!existsSync(file)) throw new Error(`json adapter: file not found: ${file} (run the site's export step first)`);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return (data.pages ?? data).map(finalizePage);
}

export function buildInventory(cfg) {
  const pages = [];
  const seen = new Set();
  for (const a of cfg.adapters) {
    const list = a.type === 'html-dir' ? loadHtmlDir(cfg, a) : a.type === 'json' ? loadJson(cfg, a) : (() => { throw new Error(`Unknown adapter type: ${a.type}`); })();
    for (const p of list) if (!seen.has(p.url)) { seen.add(p.url); pages.push(p); }
  }
  pages.sort((x, y) => x.url.localeCompare(y.url));
  const excluded = cfg.exclusions.pages;
  const kept = pages.filter((p) => !excluded.some((x) => p.url === x || p.url.startsWith(x.endsWith('/') ? x : x + '/')));
  return {
    schema: 1,
    site: cfg.site,
    pages: kept,
    summary: {
      pages: kept.length,
      indexable: kept.filter((p) => p.indexable).length,
      withExistingFaqs: kept.filter((p) => p.faqs.length).length,
      existingFaqs: kept.reduce((n, p) => n + p.faqs.length, 0),
      byType: kept.reduce((o, p) => ((o[p.type] = (o[p.type] ?? 0) + 1), o), {}),
    },
  };
}

export const pageIndex = (inv) => new Map(inv.pages.map((p) => [p.url, p]));
