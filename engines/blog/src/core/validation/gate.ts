import type { BlogEngineConfig } from "../../config/config.js";
import type { SimilarityIndex } from "../analyzer/similarity.js";
import { sameSearchIntent } from "../analyzer/similarity.js";
import { renderMarkdown } from "../content/markdown.js";
import { checkQuality } from "../generator/quality.js";
import { checkLinks, type LinkCheckContext } from "../linking/graph.js";
import { buildBlogSeoIndex } from "../seo/index-builder.js";
import { validateIndexDocument } from "../seo/index-schema.js";
import { articleCrumbs, articleSchema, breadcrumbSchema, validateSchema } from "../seo/schema-org.js";
import { sitemapEntries, urlsetXml, validateSitemapXml } from "../seo/sitemap.js";
import type { BlogArticle, SitePage, ValidationIssue, ValidationResult } from "../types.js";
import { isValidSlug } from "../util/slug.js";
import { isUnderPath, urlKey } from "../util/url.js";

export interface GateContext {
  config: BlogEngineConfig;
  siteName: string;
  blogTitle: string;
  articles: BlogArticle[];
  pages: SitePage[];
  sim: SimilarityIndex;
  markdown: string;
  /** Full rendered page when the engine renders HTML; otherwise only the body is checked. */
  pageHtml?: string;
  linkCheck: LinkCheckContext;
  now: string;
}

/**
 * The publication gate. An article becomes "published" only if every error-level check passes.
 * Returns all findings so the reviewer sees warnings too.
 */
export async function runValidationGate(a: BlogArticle, ctx: GateContext): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) => issues.push({ code, severity: "error", message });
  const warn = (code: string, message: string) => issues.push({ code, severity: "warning", message });
  const { config } = ctx;
  const publishedAt = a.publishedAt ?? ctx.now;
  const asPublished: BlogArticle = {
    ...a,
    status: "published",
    indexable: true,
    publishedAt,
    // A page can never claim it was modified before it was published; pull a stale modification date up
    // to the publish date, the same adjustment the registry makes when the transition actually happens.
    ...(a.modifiedAt && a.modifiedAt < publishedAt ? { modifiedAt: publishedAt } : {}),
    ...(a.lastModifiedAt && a.lastModifiedAt < publishedAt ? { lastModifiedAt: publishedAt } : {}),
  };
  const others = ctx.articles.filter((o) => o.id !== a.id && !["rejected", "archived", "error", "recommended", "selected"].includes(o.status));

  // 1. Valid, unique URL
  let path = "";
  try {
    const u = new URL(a.url);
    path = u.pathname;
    if (u.origin !== new URL(config.siteUrl).origin) err("url-origin", `URL ${a.url} is not on ${config.siteUrl}`);
  } catch {
    err("url-invalid", `URL "${a.url}" is not valid`);
  }
  if (!isValidSlug(a.slug)) err("slug-invalid", `slug "${a.slug}" must be lowercase letters, numbers and hyphens`);
  if (path && !isUnderPath(path, config.blogPath)) warn("url-outside-blog", `${path} is outside ${config.blogPath}`);
  const clash = [...others.map((o) => ({ url: o.url, what: `article "${o.title}"` })), ...ctx.pages.filter((p) => !p.isBlogArticle).map((p) => ({ url: p.url, what: `site page "${p.title}"` }))].find((x) => urlKey(x.url) === urlKey(a.url));
  if (clash) err("url-duplicate", `${path} is already used by the ${clash.what}`);
  if (others.some((o) => o.slug === a.slug && isUnderPath(new URL(o.url).pathname, config.blogPath))) err("slug-duplicate", `another blog article already uses the slug "${a.slug}"`);

  // 2. Content generation failure / quality
  const q = checkQuality(ctx.markdown, { title: a.title, primaryTopic: a.primaryTopic, contentType: "guide" });
  for (const i of q.issues) issues.push(i);
  if (a.generatedBy?.startsWith("deterministic") && !config.generation.publishDeterministicDrafts) err("offline-draft", "written by the offline deterministic provider; rewrite or regenerate with a real provider before publishing");

  // 3. Title
  if (!a.title.trim()) err("title-missing", "title is empty");
  else {
    if (a.title.length > 70) warn("title-long", `title is ${a.title.length} characters; search results show about 60`);
    if (a.title.length < 15) warn("title-short", "title is very short");
    const dupTitle = others.find((o) => o.status === "published" && o.title.trim().toLowerCase() === a.title.trim().toLowerCase());
    if (dupTitle) err("title-duplicate", `title duplicates "${dupTitle.title}" (${dupTitle.url})`);
    const pageDup = ctx.pages.find((p) => p.indexable && !p.isBlogArticle && (p.title.trim().toLowerCase() === a.title.trim().toLowerCase() || p.h1.trim().toLowerCase() === a.title.trim().toLowerCase()));
    if (pageDup) err("title-duplicate", `title duplicates the site page ${pageDup.path}`);
  }

  // 4. Canonical
  if (urlKey(a.canonicalUrl) !== urlKey(a.url)) err("canonical-mismatch", `canonical ${a.canonicalUrl} does not point to the article itself`);
  if (!/^https:\/\//.test(a.canonicalUrl) && new URL(config.siteUrl).protocol === "https:") err("canonical-protocol", "canonical must use https");

  // 5. Metadata
  if (!a.description.trim()) err("description-missing", "meta description is empty");
  else if (a.description.length < 70 || a.description.length > 160) warn("description-length", `meta description is ${a.description.length} characters (aim for 120-160)`);
  if (!a.primaryTopic) err("topic-missing", "primary topic is missing");
  if (!a.category) warn("category-missing", "no category");

  // 6/7. Duplicate content and overlapping intent
  for (const o of others.filter((x) => x.status === "published")) {
    const s = ctx.sim.has(`art:${urlKey(o.url)}`) ? ctx.sim.similarityToText(`art:${urlKey(o.url)}`, `${a.title} ${ctx.markdown.slice(0, 12000)}`) : 0;
    if (s >= 0.8) err("near-duplicate", `content is nearly identical to "${o.title}" (${Math.round(s * 100)}% similar)`);
    else if (s >= 0.6) warn("overlap", `content overlaps "${o.title}" (${Math.round(s * 100)}% similar)`);
    if (sameSearchIntent(a.title, o.title).same) err("intent-duplicate", `targets the same search intent as "${o.title}"`);
  }

  // 8. Internal links resolve
  const html = renderMarkdown(ctx.markdown);
  const hrefs = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  const broken = await checkLinks(a.url, hrefs, ctx.linkCheck);
  for (const b of broken) {
    if (b.problem === "redirect" || b.problem === "duplicate-canonical-path") warn(`link-${b.problem}`, `${b.href}: ${b.detail}`);
    else err(`link-${b.problem}`, `${b.href}: ${b.detail}`);
  }

  // 9. Structured data
  if (config.enableSchema) {
    for (const e of validateSchema(articleSchema(asPublished, config, ctx.siteName))) err("schema-article", e);
    if (config.schema.breadcrumbs) for (const e of validateSchema(breadcrumbSchema(articleCrumbs(asPublished, config, ctx.blogTitle)))) err("schema-breadcrumb", e);
  }

  // 10. Sitemap inclusion
  const entries = sitemapEntries([asPublished]);
  if (!entries.some((e) => urlKey(e.loc) === urlKey(a.canonicalUrl))) err("sitemap", "the article would not be included in the sitemap");
  else for (const e of validateSitemapXml(urlsetXml(entries))) err("sitemap", e);

  // 11. Blog SEO Index inclusion
  const idx = buildBlogSeoIndex({ config, articles: [asPublished], clusters: [], pages: [], recommendations: [], brokenLinks: [], sim: ctx.sim, now: ctx.now, visibility: "public" });
  if (!idx.articles.some((x) => x.id === a.id)) err("index", "the article would not appear in the Blog SEO Index");
  for (const e of validateIndexDocument(idx)) err("index-schema", e);

  // 12. Responsive rendering basics
  const page = ctx.pageHtml ?? html;
  if (ctx.pageHtml && !/<meta[^>]+name=["']viewport["']/i.test(ctx.pageHtml)) err("responsive-viewport", "rendered page has no viewport meta tag");
  if (/style="[^"]*\bwidth:\s*\d{4,}px/i.test(page) || /<(img|table|iframe)[^>]+width="\d{4,}"/i.test(page)) err("responsive-width", "content has a fixed width wider than small screens");
  if (/<table/i.test(page) && ctx.pageHtml && !/bwe-table-wrap/.test(page)) warn("responsive-table", "tables are not wrapped for horizontal scrolling");
  if (/<img(?![^>]*\balt=)/i.test(page)) err("img-alt", "an image has no alt attribute");
  if (ctx.pageHtml && (ctx.pageHtml.match(/<h1[\s>]/gi) ?? []).length !== 1) warn("h1-count", "the page should have exactly one H1");

  return { passed: !issues.some((i) => i.severity === "error"), checkedAt: ctx.now, issues };
}
