import type { RawPage } from "../../adapters/host-site/types.js";
import type { BlogEngineConfig } from "../../config/config.js";
import { frontList, frontString } from "../content/markdown.js";
import { extractPage, type ExtractedPage } from "../html/extract.js";
import { cleanText } from "../html/sanitize.js";
import type { BlogArticle, SitePage } from "../types.js";
import { contentHash, metadataHash, stableId } from "../util/hash.js";
import { parseLooseDate } from "../util/time.js";
import { Corpus, featureTokens, keyPhrases, wordCount } from "../util/text.js";
import { absoluteUrl, isUnderPath, normalizeLink, pathOf, urlKey } from "../util/url.js";
import { BLOG_ROOT_CANDIDATES, PAGE_IMPORTANCE, classifyPage, inferIntent, looksLikeArticle } from "./classify.js";

export interface InventoryResult {
  pages: SitePage[];
  existingArticles: BlogArticle[];
  blogRoot: string;
  blogRootDetected: boolean;
  urlPattern?: string;
  linkProblems: { fromUrl: string; href: string; problems: string[] }[];
  extracted: Map<string, ExtractedPage>;
  frontmatterKeys: string[];
}

/**
 * Normalize every page the host serves into SitePage records, and every existing blog post into a
 * BlogArticle with source = "existing". Read-only: nothing on the host is modified.
 */
export function buildInventory(raw: RawPage[], config: BlogEngineConfig, contentDir: string | null): InventoryResult {
  const extracted = new Map<string, ExtractedPage>();
  for (const r of raw) extracted.set(r.url, extractPage(r.html, r.url, config.siteUrl, config.host.stagingHosts));

  const { root: blogRoot, detected } = detectBlogRoot(raw, extracted, config.blogPath);

  const pages: SitePage[] = [];
  const linkProblems: InventoryResult["linkProblems"] = [];
  const frontmatterKeys = new Set<string>();
  const inbound = new Map<string, number>();
  const navTargets = new Set<string>();

  for (const r of raw) {
    const x = extracted.get(r.url)!;
    for (const l of x.links) {
      if (l.context === "body") inbound.set(urlKey(l.href), (inbound.get(urlKey(l.href)) ?? 0) + 1);
      else navTargets.add(urlKey(l.href));
    }
    for (const lp of x.linkProblems) linkProblems.push({ fromUrl: r.url, ...lp });
    if (r.frontmatter) for (const k of Object.keys(r.frontmatter)) frontmatterKeys.add(k);
  }

  const corpus = new Corpus();
  const tokensByUrl = new Map<string, string[]>();
  for (const r of raw) {
    const x = extracted.get(r.url)!;
    const toks = featureTokens(`${x.title} ${x.h1} ${x.headings.map((h) => h.text).join(" ")} ${x.mainText.slice(0, 20_000)}`);
    tokensByUrl.set(r.url, toks);
    corpus.add(toks);
  }

  for (const r of raw) {
    const x = extracted.get(r.url)!;
    const p = pathOf(r.url);
    const wc = wordCount(x.mainText);
    const fromContentDir = !!(contentDir && r.sourceFile?.startsWith(`${contentDir}/`));
    const pageType = classifyPage({ path: p, extracted: x, ...(r.frontmatter ? { frontmatter: r.frontmatter } : {}), blogRoot, wordCount: wc, fromContentDir });
    const key = urlKey(r.url);
    const vec = corpus.vector(tokensByUrl.get(r.url) ?? []);
    const keyTerms = [...vec.entries()]
      .filter(([t]) => !t.includes("_") || (vec.get(t) ?? 0) > 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([t]) => t.replace("_", " "));
    const canonical = resolveCanonical(x.canonical, r.url, config.siteUrl);
    const draft = r.frontmatter?.draft === true || r.frontmatter?.published === false;
    const noindex = /noindex/i.test(x.robots) || draft;
    const importance = Math.min(1, PAGE_IMPORTANCE[pageType] + Math.min(0.15, (inbound.get(key) ?? 0) * 0.02) + (navTargets.has(key) ? 0.05 : 0));
    pages.push({
      id: stableId("page", key),
      url: r.url,
      path: p,
      title: cleanText(x.title, 300) || cleanText(frontString(r.frontmatter ?? {}, "title"), 300),
      description: cleanText(x.description, 500),
      h1: cleanText(x.h1, 300),
      headings: x.headings.slice(0, 80).map((h) => ({ level: h.level, text: cleanText(h.text, 200) })),
      pageType,
      canonicalUrl: canonical,
      indexable: !noindex && urlKey(canonical) === key,
      robots: x.robots,
      schemaTypes: x.schemaTypes,
      internalLinksOut: dedupeLinks(x.links),
      externalLinks: dedupeLinks(x.externalLinks).slice(0, 100),
      wordCount: wc,
      keyTerms,
      faqQuestions: x.faqQuestions.slice(0, 40).map((q) => cleanText(q, 200)),
      importance: round2(importance),
      isBlogArticle: pageType === "blog-article",
      ...(r.sourceFile ? { sourceFile: r.sourceFile } : {}),
      ...(r.lastModified ? { lastModified: r.lastModified } : {}),
      contentHash: contentHash(r.markdownBody ?? x.mainText),
      excerpt: x.mainText.slice(0, 4000),
    });
  }

  const existingArticles = pages.filter((p) => p.isBlogArticle).map((p) => toExistingArticle(p, raw.find((r) => r.url === p.url)!, extracted.get(p.url)!, config));
  const urlPattern = inferUrlPattern(existingArticles.map((a) => pathOf(a.url)), blogRoot);

  return {
    pages,
    existingArticles,
    blogRoot,
    blogRootDetected: detected,
    ...(urlPattern ? { urlPattern } : {}),
    linkProblems,
    extracted,
    frontmatterKeys: [...frontmatterKeys].sort(),
  };
}

function detectBlogRoot(raw: RawPage[], ex: Map<string, ExtractedPage>, configured: string): { root: string; detected: boolean } {
  const score = new Map<string, number>();
  for (const r of raw) {
    const p = pathOf(r.url);
    const x = ex.get(r.url)!;
    if (!looksLikeArticle(x, r.frontmatter)) continue;
    for (const root of new Set([configured, ...BLOG_ROOT_CANDIDATES])) {
      if (isUnderPath(p, root) && p.replace(/\/$/, "") !== root) score.set(root, (score.get(root) ?? 0) + 1);
    }
  }
  const configuredScore = score.get(configured) ?? 0;
  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  if (configuredScore > 0 || !best || best[1] < 2) return { root: configured, detected: configuredScore > 0 };
  return { root: best[0], detected: true };
}

function inferUrlPattern(paths: string[], root: string): string | undefined {
  if (!paths.length) return undefined;
  const dated = paths.filter((p) => new RegExp(`^${escapeRe(root)}/\\d{4}/\\d{2}/`).test(p)).length;
  const trailing = paths.filter((p) => p.endsWith("/")).length > paths.length / 2;
  const html = paths.filter((p) => p.endsWith(".html")).length > paths.length / 2;
  const base = dated > paths.length / 2 ? `${root}/{yyyy}/{mm}/{slug}` : `${root}/{slug}`;
  return `${base}${html ? ".html" : trailing ? "/" : ""}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function resolveCanonical(canonical: string | undefined, pageUrl: string, siteUrl: string): string {
  if (!canonical) return pageUrl;
  const n = normalizeLink(canonical, pageUrl, siteUrl);
  if (n.kind !== "page") return pageUrl;
  return n.url;
}

function dedupeLinks<T extends { href: string; anchor: string }>(links: T[]): T[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const k = `${l.href}|${l.anchor}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function stripSiteSuffix(title: string, siteName?: string): string {
  let t = title.trim();
  const parts = t.split(/\s+[|\-–—·:]\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    if (!siteName || last.toLowerCase().includes(siteName.toLowerCase()) || last.length < 40) t = parts.slice(0, -1).join(" - ");
  }
  return t;
}

function toExistingArticle(p: SitePage, raw: RawPage, x: ExtractedPage, config: BlogEngineConfig): BlogArticle {
  const fm = raw.frontmatter ?? {};
  const title = cleanText(frontString(fm, "title") ?? (p.h1 || stripSiteSuffix(p.title, config.siteName)), 300);
  const description = cleanText(frontString(fm, "description", "excerpt", "summary") ?? p.description, 500);
  const categories = frontList(fm, "category", "categories");
  const tags = [...new Set([...frontList(fm, "tags", "tag", "keywords"), ...x.tags])].slice(0, 20);
  const publishedAt = parseLooseDate(fm.date ?? fm.pubDate ?? fm.publishedAt ?? fm.published_at ?? fm.datePublished) ?? x.publishedAt;
  const modifiedAt = parseLooseDate(fm.updated ?? fm.lastmod ?? fm.modified ?? fm.updatedAt ?? fm.updatedDate ?? fm.dateModified) ?? x.modifiedAt;
  const author = frontString(fm, "author", "authors") ?? x.author;
  const slug = decodeURIComponent(pathOf(p.url).replace(/\/$/, "").replace(/\.html?$/, "").split("/").pop() ?? "");
  const phrases = keyPhrases(`${title}. ${title}. ${p.headings.map((h) => h.text).join(". ")}. ${x.mainText.slice(0, 6000)}`, 5);
  const primaryTopic = phrases.find((ph) => title.toLowerCase().includes(ph.phrase))?.phrase ?? phrases[0]?.phrase ?? title.toLowerCase();
  const isDraft = fm.draft === true || fm.published === false;
  const base: BlogArticle = {
    id: stableId("art", urlKey(p.url)),
    title,
    slug,
    url: p.url,
    source: "existing",
    status: isDraft ? "draft" : "published",
    description,
    primaryTopic,
    secondaryTopics: phrases.map((ph) => ph.phrase).filter((ph) => ph !== primaryTopic).slice(0, 4),
    category: cleanText(categories[0] ?? x.section ?? "", 100),
    tags: tags.map((t) => cleanText(t, 60)).filter(Boolean),
    searchIntent: inferIntent(title),
    ...(author ? { author: cleanText(author, 120) } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
    canonicalUrl: p.canonicalUrl,
    internalLinksIn: [],
    internalLinksOut: [...new Set(p.internalLinksOut.filter((l) => l.context === "body").map((l) => l.href))],
    outboundLinks: [...new Set(p.externalLinks.map((l) => l.href))],
    relatedArticles: [],
    relatedSitePages: [],
    schemaTypes: p.schemaTypes,
    indexable: p.indexable,
    headings: p.headings,
    wordCount: p.wordCount,
    ...(x.ogImage ? { image: absoluteUrl(config.siteUrl, x.ogImage) } : {}),
    ...(p.robots ? { indexingStatus: p.robots } : {}),
    contentHash: p.contentHash,
    ...(raw.sourceFile ? { storage: { adapter: raw.kind === "markdown" || raw.frontmatter ? "markdown" : "html", path: raw.sourceFile } } : raw.recordId ? { storage: { adapter: "remote", recordId: raw.recordId } } : { storage: { adapter: "remote", recordId: p.url } }),
    history: [],
  };
  base.metadataHash = articleMetadataHash(base);
  return base;
}

export function articleMetadataHash(a: BlogArticle): string {
  return metadataHash({
    title: a.title,
    description: a.description,
    canonicalUrl: a.canonicalUrl,
    category: a.category,
    tags: a.tags,
    publishedAt: a.publishedAt,
    modifiedAt: a.modifiedAt,
    author: a.author,
    indexable: a.indexable,
    status: a.status,
  });
}
