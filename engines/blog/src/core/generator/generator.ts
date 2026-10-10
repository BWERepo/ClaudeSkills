import type { AIProvider } from "../../adapters/ai-provider/types.js";
import type { BlogEngineConfig } from "../../config/config.js";
import { renderMarkdown } from "../content/markdown.js";
import { extractPage } from "../html/extract.js";
import { cleanText } from "../html/sanitize.js";
import type { BlogArticle, Recommendation, SitePage, SiteProfile, ValidationIssue } from "../types.js";
import { contentHash, stableId } from "../util/hash.js";
import { isoNow, type Clock } from "../util/time.js";
import { truncate } from "../util/text.js";
import { normalizeLink, urlKey } from "../util/url.js";
import { ENGINE_VERSION } from "../../version.js";
import { plannedUrl } from "../recommendations/recommend.js";
import { isYmyl, type ArticleBrief } from "./brief.js";
import { neutralizeUntrusted } from "./injection.js";
import { ARTICLE_SYSTEM_PROMPT, buildArticlePrompt, parseArticleResponse } from "./prompt.js";
import { checkQuality } from "./quality.js";

export interface GenerationContext {
  config: BlogEngineConfig;
  profile: SiteProfile;
  pages: SitePage[];
  articles: BlogArticle[];
  provider: AIProvider;
  clock: Clock;
}

export interface GeneratedArticle {
  article: BlogArticle;
  markdown: string;
  html: string;
  issues: ValidationIssue[];
  injectionFlags: string[];
  sources: { name: string; url: string }[];
}

export function buildBrief(rec: Recommendation, ctx: GenerationContext): { brief: ArticleBrief; injectionFlags: string[] } {
  const { config, profile, pages, articles } = ctx;
  const pageByKey = new Map(pages.map((p) => [urlKey(p.url), p]));
  const flags: string[] = [];
  const supportingPages = rec.primaryPagesSupported
    .map((u) => pageByKey.get(urlKey(u)))
    .filter((p): p is SitePage => !!p)
    .slice(0, 4)
    .map((p) => {
      const s = neutralizeUntrusted(`${p.description} ${p.excerpt}`, 900);
      flags.push(...s.flagged.map((f) => `${p.path}: ${f}`));
      return { url: p.url, title: cleanText(p.h1 || p.title, 120), type: p.pageType, summary: s.text };
    });
  const live = new Map(articles.filter((a) => a.status === "published" && a.indexable).map((a) => [urlKey(a.url), a]));
  const targets = new Map<string, ArticleBrief["linkTargets"][number]>();
  for (const u of [...rec.primaryPagesSupported, ...rec.internalLinkOpportunities, ...rec.relatedExistingArticles]) {
    const k = urlKey(u);
    if (targets.has(k)) continue;
    const a = live.get(k);
    const p = pageByKey.get(k);
    if (a) targets.set(k, { url: a.url, title: a.title, kind: "article" });
    else if (p && p.indexable) targets.set(k, { url: p.url, title: cleanText(p.h1 || p.title, 120), kind: p.isBlogArticle ? "article" : "page" });
  }
  const ymyl = isYmyl(`${rec.title} ${rec.primaryTopic} ${profile.primarySubject}`);
  return {
    brief: {
      title: rec.title,
      slug: rec.proposedSlug,
      url: plannedUrl(config, rec.proposedSlug),
      primaryTopic: rec.primaryTopic,
      intent: rec.primarySearchIntent,
      contentType: rec.contentType,
      audience: rec.targetAudience,
      angle: rec.reason,
      category: rec.suggestedCategory,
      tags: rec.suggestedTags,
      language: config.generation.language,
      site: { name: profile.name, url: config.siteUrl, subject: profile.primarySubject, market: profile.geographicMarket },
      supportingPages,
      linkTargets: [...targets.values()].slice(0, 10),
      avoidOverlapWith: rec.potentialCannibalization.filter((f) => f.kind !== "recommendation").map((f) => `${f.title} (${f.url})`),
      ymyl,
      ...(ymyl ? { disclaimer: config.generation.ymylDisclaimer } : {}),
      ...(rec.notes ? { editorNotes: cleanText(rec.notes, 1000) } : {}),
    },
    injectionFlags: flags,
  };
}

/** Generate one selected recommendation into a draft BlogArticle. Never publishes; the workflow decides that. */
export async function generateArticle(rec: Recommendation, ctx: GenerationContext): Promise<GeneratedArticle> {
  const { config, clock, provider } = ctx;
  const { brief, injectionFlags } = buildBrief(rec, ctx);
  const res = await provider.generate({ purpose: "article", system: ARTICLE_SYSTEM_PROMPT, prompt: buildArticlePrompt(brief), brief });
  const parsed = parseArticleResponse(res.text);
  const issues: ValidationIssue[] = parsed.parseWarnings.map((m) => ({ code: "provider-format", severity: "warning", message: m }));

  const allowed = new Set(brief.linkTargets.map((t) => urlKey(t.url)));
  const { markdown: linkedMd, removed } = restrictInternalLinks(parsed.markdown, brief.url, config, allowed);
  for (const r of removed) issues.push({ code: "link-removed", severity: "warning", message: `removed a link to ${r} (not a known page on the site)` });
  let markdown = linkedMd.replace(/^#\s+(.*)$/gm, "## $1");
  if (brief.ymyl && brief.disclaimer && !markdown.includes(brief.disclaimer.slice(0, 40))) markdown = `${markdown.trim()}\n\n*${brief.disclaimer}*\n`;

  const title = cleanText(parsed.title, 120) || rec.title;
  const quality = checkQuality(markdown, { title, primaryTopic: rec.primaryTopic, contentType: rec.contentType });
  issues.push(...quality.issues);
  if (provider.id === "deterministic" && !config.generation.publishDeterministicDrafts) {
    issues.push({ code: "offline-draft", severity: "error", message: "written by the offline deterministic provider: rewrite it (or regenerate with a real provider) before publishing" });
  }
  for (const f of injectionFlags) issues.push({ code: "prompt-injection", severity: "warning", message: `instruction-like text in site content was excluded from the prompt: ${f}` });

  const html = renderMarkdown(markdown);
  const url = plannedUrl(config, rec.proposedSlug);
  const ex = extractPage(`<html><body><main>${html}</main></body></html>`, url, config.siteUrl, config.host.stagingHosts);
  const firstPara = markdown.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#"))?.replace(/[*_`#>[\]()]/g, "") ?? "";
  const description = cleanText(parsed.description, 300) || truncate(cleanText(firstPara, 400), 158);
  const now = isoNow(clock);
  const article: BlogArticle = {
    id: stableId("art", urlKey(url)),
    title,
    slug: rec.proposedSlug,
    url,
    source: "blog-engine",
    status: "generating",
    description: truncate(description, 160),
    primaryTopic: rec.primaryTopic,
    secondaryTopics: rec.suggestedTags.filter((t) => t !== rec.primaryTopic).slice(0, 4),
    category: rec.suggestedCategory,
    tags: rec.suggestedTags,
    searchIntent: rec.primarySearchIntent,
    ...(config.authors.default ? { author: config.authors.default } : {}),
    canonicalUrl: url,
    ...(rec.clusterId ? { clusterId: rec.clusterId } : {}),
    internalLinksIn: [],
    internalLinksOut: [...new Set(ex.links.map((l) => l.href))],
    outboundLinks: [...new Set(ex.externalLinks.map((l) => l.href))],
    relatedArticles: rec.relatedExistingArticles,
    relatedSitePages: rec.primaryPagesSupported,
    schemaTypes: config.enableSchema ? [config.schema.articleType, ...(config.schema.breadcrumbs ? ["BreadcrumbList"] : [])] : [],
    indexable: false,
    generatedBy: `${provider.id}:${res.model}`,
    engineVersion: ENGINE_VERSION,
    lastAnalyzedAt: now,
    headings: ex.headings,
    wordCount: quality.wordCount,
    contentHash: contentHash(markdown),
    lastModifiedAt: now,
    recommendationId: rec.id,
    history: [],
  };
  return { article, markdown, html, issues, injectionFlags, sources: parsed.sources };
}

/** Keep internal links only to allowed targets (anchor text stays); drop javascript:/data: links entirely. */
export function restrictInternalLinks(md: string, pageUrl: string, config: BlogEngineConfig, allowed: Set<string>): { markdown: string; removed: string[] } {
  const removed: string[] = [];
  const markdown = md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (all, bang: string, text: string, href: string) => {
    if (bang) return all;
    const n = normalizeLink(href, pageUrl, config.siteUrl, config.host.stagingHosts);
    if (n.kind === "javascript" || n.kind === "data" || n.kind === "malformed") {
      removed.push(href);
      return text;
    }
    if (n.internal && n.kind === "page") {
      if (!allowed.has(urlKey(n.url)) || n.problems.length) {
        removed.push(href);
        return text;
      }
      return `[${text}](${new URL(n.url).pathname})`;
    }
    return all;
  });
  return { markdown, removed };
}
