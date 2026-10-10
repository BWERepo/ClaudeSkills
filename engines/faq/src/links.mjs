// Internal-link engine: proposes natural links from an answer to pages the answer already names, and checks that every link resolves.
import { mdLinks, squash, normalize } from './text.mjs';

const cleanTitle = (t) => squash(String(t).split(/\s[|–—-]\s|:\s/)[0]);

export function buildLinkTargets(inventory, cfg) {
  const out = [];
  for (const p of inventory.pages) {
    if (!p.indexable || p.url === '/' || cfg.linkTargets.exclude.some((x) => p.url === x || p.url.startsWith(x + '/'))) continue;
    const names = new Set([cleanTitle(p.title), p.headings.find((h) => h.level === 1)?.text, ...(cfg.linkTargets.aliases[p.url] ?? []), ...(p.aliases ?? [])].filter(Boolean).map(squash));
    const usable = [...names].filter((n) => n.length >= 6 && (/\s/.test(n) || (cfg.linkTargets.aliases[p.url] ?? []).includes(n)));
    if (usable.length) out.push({ url: p.url, names: usable });
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mentions of known page names in the answer that are not yet links. Longest names win; one link per target. */
export function proposeLinks(item, targets, cfg) {
  const text = String(item.answer ?? '');
  const masked = text.replace(/\[[^\]]+\]\([^)]+\)/g, (m) => ' '.repeat(m.length));
  const own = new Set([...(item.contexts ?? []), item.page].filter(Boolean));
  const already = new Set(mdLinks(text).map((l) => l.href));
  const found = [];
  for (const t of targets) {
    if (own.has(t.url) || already.has(t.url)) continue;
    for (const name of [...t.names].sort((a, b) => b.length - a.length)) {
      const m = new RegExp(`(?<![\\w/\\-])${esc(name)}(?![\\w\\-])`, 'i').exec(masked);
      if (m) {
        found.push({ text: text.slice(m.index, m.index + m[0].length), href: t.url, index: m.index });
        break;
      }
    }
  }
  const picked = [];
  for (const f of found.sort((a, b) => b.text.length - a.text.length)) {
    if (picked.length >= cfg.linkPolicy.maxPerAnswer) break;
    if (picked.some((p) => f.index < p.index + p.text.length && p.index < f.index + f.text.length)) continue;
    picked.push(f);
  }
  return picked.sort((a, b) => a.index - b.index).map(({ text, href }) => ({ text, href }));
}

export function applyLinks(answer, proposals) {
  let out = String(answer);
  for (const p of proposals) {
    const masked = out.replace(/\[[^\]]+\]\([^)]+\)/g, (m) => ' '.repeat(m.length));
    const i = masked.indexOf(p.text);
    if (i >= 0) out = out.slice(0, i) + `[${p.text}](${p.href})` + out.slice(i + p.text.length);
  }
  return out;
}

/** Problems with the links in one answer. `urls` is the set of known internal paths. */
export function checkLinks(answer, urls, cfg) {
  const problems = [];
  for (const l of mdLinks(answer)) {
    const href = l.href.trim();
    if (/^https?:\/\//i.test(href)) {
      const host = new URL(href).host;
      if (!cfg.externalHosts.includes(host)) problems.push(`external link not allowed: ${href}`);
      continue;
    }
    if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    const path = href.split('#')[0].split('?')[0] || '/';
    const norm = path.length > 1 ? path.replace(/\/$/, '') : path;
    if (cfg.knownPaths.includes(href) || cfg.knownPaths.includes(norm) || urls.has(norm)) continue;
    problems.push(`broken internal link: ${href}`);
  }
  return problems;
}

export { normalize };
