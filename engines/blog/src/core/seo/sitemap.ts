import { escapeHtml } from "../html/dom.js";
import type { BlogArticle } from "../types.js";
import { urlKey } from "../util/url.js";

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

/**
 * Only public, indexable, canonical articles go in a sitemap: never drafts, rejected/archived articles,
 * admin or preview URLs, or non-canonical duplicates.
 */
export function sitemapEntries(articles: BlogArticle[], extra: SitemapEntry[] = []): SitemapEntry[] {
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const a of articles) {
    if (a.status !== "published" || !a.indexable) continue;
    if (urlKey(a.canonicalUrl) !== urlKey(a.url)) continue;
    const k = urlKey(a.canonicalUrl);
    if (seen.has(k)) continue;
    seen.add(k);
    const lm = a.modifiedAt ?? a.publishedAt;
    out.push({ loc: a.canonicalUrl, ...(lm ? { lastmod: lm.slice(0, 10) } : {}) });
  }
  for (const e of extra) {
    const k = urlKey(e.loc);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => a.loc.localeCompare(b.loc));
}

export function urlsetXml(entries: SitemapEntry[]): string {
  const body = entries.map((e) => `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ""}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function parseUrlset(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(m[1]!)?.[1];
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(m[1]!)?.[1];
    if (loc) out.push({ loc: loc.replace(/&amp;/g, "&"), ...(lastmod ? { lastmod } : {}) });
  }
  return out;
}

/**
 * Merge blog entries into an existing <urlset> without disturbing anything else: existing entries stay as they
 * are (an existing article's lastmod is only updated when the engine knows a newer date), new articles are
 * appended, and engine-owned URLs that are no longer public are removed.
 */
export function mergeIntoUrlset(existingXml: string, blog: SitemapEntry[], engineOwnedNoLongerPublic: Set<string>): { xml: string; added: number; updated: number; removed: number } {
  const blogByKey = new Map(blog.map((e) => [urlKey(e.loc), e]));
  let added = 0;
  let updated = 0;
  let removed = 0;
  const seen = new Set<string>();
  let xml = existingXml.replace(/[ \t]*<url>([\s\S]*?)<\/url>\s*/gi, (block, inner: string) => {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(inner)?.[1]?.replace(/&amp;/g, "&");
    if (!loc) return block;
    const k = urlKey(loc);
    if (seen.has(k)) {
      removed++;
      return "";
    }
    seen.add(k);
    if (engineOwnedNoLongerPublic.has(k)) {
      removed++;
      return "";
    }
    const b = blogByKey.get(k);
    if (b?.lastmod) {
      const cur = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(inner)?.[1];
      if (!cur || cur.slice(0, 10) < b.lastmod) {
        updated++;
        const replaced = cur ? block.replace(/<lastmod>\s*[^<\s]+\s*<\/lastmod>/i, `<lastmod>${b.lastmod}</lastmod>`) : block.replace(/<\/loc>/i, `</loc>\n    <lastmod>${b.lastmod}</lastmod>`);
        return replaced;
      }
    }
    return block;
  });
  const missing = blog.filter((e) => !seen.has(urlKey(e.loc)));
  if (missing.length) {
    added = missing.length;
    const add = missing.map((e) => `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ""}\n  </url>\n`).join("");
    xml = xml.replace(/<\/urlset>/i, `${add}</urlset>`);
  }
  return { xml, added, updated, removed };
}

export function sitemapIndexHasChild(indexXml: string, childUrl: string): boolean {
  return [...indexXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].some((m) => urlKey(m[1]!) === urlKey(childUrl));
}

export function addChildToSitemapIndex(indexXml: string, childUrl: string, lastmod?: string): string {
  if (sitemapIndexHasChild(indexXml, childUrl)) return indexXml;
  const entry = `  <sitemap>\n    <loc>${escapeHtml(childUrl)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </sitemap>\n`;
  return indexXml.replace(/<\/sitemapindex>/i, `${entry}</sitemapindex>`);
}

export function sitemapIndexXml(children: SitemapEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${children
    .map((c) => `  <sitemap>\n    <loc>${escapeHtml(c.loc)}</loc>${c.lastmod ? `\n    <lastmod>${c.lastmod}</lastmod>` : ""}\n  </sitemap>`)
    .join("\n")}\n</sitemapindex>\n`;
}

/** Well-formedness check for sitemap XML (tag balance, one root, <loc> absolute URLs, valid lastmod). */
export function validateSitemapXml(xml: string): string[] {
  const errs: string[] = [];
  if (!/^<\?xml[^>]*\?>/.test(xml.trim())) errs.push("missing XML declaration");
  const isIndex = /<sitemapindex/i.test(xml);
  const root = isIndex ? "sitemapindex" : "urlset";
  if (!new RegExp(`<${root}[^>]*xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`).test(xml)) errs.push(`<${root}> must declare the sitemap namespace`);
  const opens = (xml.match(/<(url|sitemap)>/g) ?? []).length;
  const closes = (xml.match(/<\/(url|sitemap)>/g) ?? []).length;
  if (opens !== closes) errs.push("unbalanced <url>/<sitemap> elements");
  for (const m of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) if (!/^https?:\/\/\S+$/.test(m[1]!.trim())) errs.push(`<loc> is not an absolute URL: ${m[1]}`);
  for (const m of xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(m[1]!.trim())) errs.push(`invalid <lastmod>: ${m[1]}`);
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => urlKey(m[1]!.trim()));
  if (new Set(locs).size !== locs.length) errs.push("duplicate <loc> entries");
  if (opens > 50000) errs.push("more than 50,000 entries in one sitemap");
  return errs;
}
