import { FileSystemHostAdapter } from "../../adapters/host-site/filesystem.js";
import { buildProfile } from "../analyzer/profile.js";
import { SimilarityIndex, type Doc } from "../analyzer/similarity.js";
import { buildClusters } from "../clusters/clusters.js";
import { IDEAS_SYSTEM_PROMPT } from "../generator/prompt.js";
import { neutralizeUntrusted } from "../generator/injection.js";
import { buildInventory } from "../inventory/inventory.js";
import { COMMERCIAL_TYPES } from "../inventory/classify.js";
import { applyGraphToArticles, buildLinkGraph } from "../linking/graph.js";
import { findContentGaps } from "../recommendations/gaps.js";
import { recommend, type IdeaInput } from "../recommendations/recommend.js";
import type { BlogArticle, ContentGap, SiteArchitecture, SitePage, SiteProfile } from "../types.js";
import { isoNow } from "../util/time.js";
import { urlKey } from "../util/url.js";
import type { EngineContext } from "./context.js";

export interface AnalysisReport {
  analyzedAt: string;
  architecture: SiteArchitecture;
  profile: SiteProfile;
  pagesDiscovered: number;
  existingArticles: number;
  newArticlesDiscovered: number;
  articlesMissingFromSite: number;
  gaps: number;
  recommendations: number;
  discarded: { title: string; why: string }[];
  clusters: number;
  orphanArticles: string[];
  linkProblems: number;
  /** Only on re-analysis. */
  changes?: {
    newPages: { url: string; pageType: string }[];
    removedPages: string[];
    changedOfferings: string[];
    obsoleteRecommendations: string[];
    newRecommendations: string[];
  };
  stopped: true;
  nextStep: string;
}

export function buildSimilarity(pages: SitePage[], articles: BlogArticle[], text: Map<string, string> = new Map()): SimilarityIndex {
  const docs: Doc[] = [
    ...pages.map((p) => ({ key: `page:${urlKey(p.url)}`, title: `${p.title} ${p.h1}`, body: `${p.headings.map((h) => h.text).join(" ")} ${p.description} ${p.excerpt}` })),
    ...articles.map((a) => {
      const page = pages.find((p) => urlKey(p.url) === urlKey(a.url));
      return { key: `art:${urlKey(a.url)}`, title: a.title, body: text.get(a.id) ?? (page ? `${page.excerpt}` : `${a.description} ${a.headings.map((h) => h.text).join(" ")} ${a.primaryTopic}`) };
    }),
  ];
  return new SimilarityIndex(docs);
}

/**
 * First phase: detect, inventory, index, map topics, find gaps, check cannibalization, recommend, then STOP.
 * Nothing is generated here; generation only follows an explicit selection.
 */
export async function runAnalysis(ctx: EngineContext, opts: { reanalyze?: boolean } = {}): Promise<AnalysisReport> {
  const { config, host } = ctx;
  const pr = ctx.progress(opts.reanalyze ? "reanalyze" : "analyze");
  const now = isoNow(ctx.clock);
  const previousPages = opts.reanalyze ? await ctx.readSiteIndex() : [];
  const previousRecs = await ctx.readRecommendations();

  pr.start("architecture", "Detecting website architecture");
  const architecture = await host.detectArchitecture();
  pr.done("architecture", `${architecture.framework} detected`);

  pr.start("discover", "Analyzing website");
  const raw = await host.listPages(pr);
  pr.done("discover", `${raw.length} pages discovered`, raw.length);

  pr.start("blog", "Analyzing existing blog");
  const contentDir = host instanceof FileSystemHostAdapter ? await host.getContentDir() : null;
  const inv = buildInventory(raw, config, contentDir);
  completeArchitecture(architecture, inv.pages, inv.existingArticles, inv.blogRoot, inv.urlPattern, inv.frontmatterKeys, inv.extracted);
  const sync = ctx.registry.syncDiscovered(inv.existingArticles);
  pr.done("blog", `${inv.existingArticles.length} articles found${sync.discovered.length ? ` (${sync.discovered.length} new to the registry)` : ""}`, inv.existingArticles.length);

  pr.start("index", "Building normalized site content index");
  await ctx.writeSiteIndex(inv.pages);
  pr.done("index");

  pr.start("topics", "Building topic map");
  const articles = ctx.registry.list();
  const sim = buildSimilarity(inv.pages, articles);
  const profile = buildProfile(inv.pages, inv.extracted, config);
  pr.done("topics", `Primary subject: ${profile.primarySubject}`);

  pr.start("gaps", "Finding content gaps");
  const gaps: ContentGap[] = findContentGaps(inv.pages, articles, profile, sim);
  pr.done("gaps", `${gaps.length} content gaps found`);

  let ideas: IdeaInput[] = [];
  if (config.generation.useProviderForIdeas) {
    pr.start("ideas", "Asking the AI provider for additional ideas");
    try {
      ideas = await providerIdeas(ctx, profile, inv.pages);
      pr.done("ideas", `${ideas.length} ideas received (each is checked against the site)`);
    } catch (e) {
      pr.warn("ideas", `skipped: ${(e as Error).message}`);
    }
  }

  pr.start("cannibalization", "Evaluating duplicate topics");
  const rec = recommend({ pages: inv.pages, articles, profile, gaps, sim, config, clock: ctx.clock, previous: previousRecs, ideas });
  pr.done("cannibalization", `Complete (${rec.discarded.length} overlapping or weak ideas dropped)`);
  const openRecs = rec.recommendations.filter((r) => r.status === "recommended");
  pr.done("recommend", `${openRecs.length} article opportunities identified`, openRecs.length);

  pr.start("graph", "Building internal-link graph");
  const { clusters, articleCluster, recCluster } = buildClusters(inv.pages, articles, rec.recommendations, config, profile.name);
  for (const r of rec.recommendations) {
    const c = recCluster.get(r.id);
    if (c) r.clusterId = c;
  }
  const graph = buildLinkGraph(inv.pages, articles);
  const linked = applyGraphToArticles(articles, graph, inv.pages, sim, config.siteUrl);
  for (const a of linked) {
    const cl = articleCluster.get(a.id);
    const pillar = cl ? clusters.find((c) => c.id === cl)?.pillar : undefined;
    ctx.registry.update(a.id, { internalLinksIn: a.internalLinksIn, internalLinksOut: a.internalLinksOut, ...(a.orphan !== undefined ? { orphan: a.orphan } : {}), relatedArticles: a.relatedArticles, relatedSitePages: a.relatedSitePages, ...(cl ? { clusterId: cl } : {}), ...(pillar && pillar !== a.url ? { pillarArticle: pillar } : {}) });
  }
  const orphanArticles = linked.filter((a) => a.orphan).map((a) => a.url);
  pr.done("graph");

  await ctx.writeRecommendations([...rec.recommendations, ...rec.obsolete]);
  await ctx.writeClusters(clusters);
  await ctx.writeAnalysis({ analyzedAt: now, architecture, profile, gaps, linkProblems: inv.linkProblems });
  const links = await ctx.readLinks();
  await ctx.writeLinks({ ...links, orphans: orphanArticles, weaklyLinked: linked.filter((a) => a.status === "published" && a.internalLinksIn.length === 1).map((a) => a.url), updatedAt: now });
  await ctx.patchState({ lastAnalysisAt: now });
  ctx.events.emit("analysis.completed", { pages: inv.pages.length, articles: inv.existingArticles.length });
  ctx.events.emit("recommendations.updated", { open: openRecs.length });
  await ctx.flush();

  const report: AnalysisReport = {
    analyzedAt: now,
    architecture,
    profile,
    pagesDiscovered: inv.pages.length,
    existingArticles: inv.existingArticles.length,
    newArticlesDiscovered: sync.discovered.length,
    articlesMissingFromSite: sync.missing.length,
    gaps: gaps.length,
    recommendations: openRecs.length,
    discarded: rec.discarded,
    clusters: clusters.length,
    orphanArticles,
    linkProblems: inv.linkProblems.length,
    stopped: true,
    nextStep: openRecs.length ? "Review the recommendations and select the articles to create. Nothing is generated until you do." : "No strong opportunities found. Re-run after the site adds pages or content.",
  };
  if (opts.reanalyze) {
    const prevKeys = new Map(previousPages.map((p) => [urlKey(p.url), p]));
    const curKeys = new Set(inv.pages.map((p) => urlKey(p.url)));
    const prevRecIds = new Set(previousRecs.map((r) => r.id));
    report.changes = {
      newPages: previousPages.length ? inv.pages.filter((p) => !prevKeys.has(urlKey(p.url))).map((p) => ({ url: p.url, pageType: p.pageType })) : [],
      removedPages: previousPages.filter((p) => !curKeys.has(urlKey(p.url))).map((p) => p.url),
      changedOfferings: inv.pages.filter((p) => COMMERCIAL_TYPES.includes(p.pageType) && prevKeys.has(urlKey(p.url)) && prevKeys.get(urlKey(p.url))!.contentHash !== p.contentHash).map((p) => p.url),
      obsoleteRecommendations: rec.obsolete.map((r) => r.title),
      newRecommendations: openRecs.filter((r) => !prevRecIds.has(r.id)).map((r) => r.title),
    };
  }
  return report;
}

function completeArchitecture(
  arch: SiteArchitecture,
  pages: SitePage[],
  articles: BlogArticle[],
  blogRoot: string,
  urlPattern: string | undefined,
  frontmatterKeys: string[],
  extracted: Map<string, { navLabels: string[]; hasViewport: boolean }>,
): void {
  const blogIndex = pages.find((p) => p.pageType === "blog-index");
  arch.blog = {
    ...arch.blog,
    exists: articles.length > 0 || !!blogIndex,
    root: blogRoot,
    ...(urlPattern ? { urlPattern } : {}),
    frontmatterKeys,
    articleCount: articles.length,
  };
  arch.structuredData = [...new Set(pages.flatMap((p) => p.schemaTypes))].sort();
  arch.categories = [...new Set(articles.map((a) => a.category).filter(Boolean))].sort();
  arch.tags = [...new Set(articles.flatMap((a) => a.tags))].sort().slice(0, 100);
  arch.authors = [...new Set(articles.map((a) => a.author).filter((x): x is string => !!x))].sort();
  const home = pages.find((p) => p.pageType === "home");
  arch.navigation = home ? [...new Set(extracted.get(home.url)?.navLabels ?? [])].slice(0, 30) : [];
  const counts = new Map<string, number>();
  for (const p of pages) counts.set(p.pageType, (counts.get(p.pageType) ?? 0) + 1);
  arch.templates = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`);
  const body = pages.reduce((s, p) => s + p.internalLinksOut.filter((l) => l.context === "body").length, 0);
  const nav = pages.reduce((s, p) => s + p.internalLinksOut.filter((l) => l.context !== "body").length, 0);
  arch.internalLinkPatterns = pages.length ? `${(body / pages.length).toFixed(1)} contextual and ${(nav / pages.length).toFixed(1)} navigation/footer links per page on average` : "no pages";
  const withCanonical = pages.filter((p) => urlKey(p.canonicalUrl) === urlKey(p.url)).length;
  const withDesc = pages.filter((p) => p.description).length;
  const withViewport = pages.filter((p) => extracted.get(p.url)?.hasViewport).length;
  arch.seoInfrastructure = [
    `canonical tags: ${withCanonical}/${pages.length} pages self-canonical`,
    `meta descriptions: ${withDesc}/${pages.length} pages`,
    `viewport meta: ${withViewport}/${pages.length} pages`,
    `structured data types: ${arch.structuredData.join(", ") || "none"}`,
    `sitemap: ${arch.sitemap.kind === "none" ? "none found" : `${arch.sitemap.kind} (${arch.sitemap.paths.join(", ")})`}`,
    `robots.txt: ${arch.robots.path ? "present" : "not found"}`,
  ];
}

async function providerIdeas(ctx: EngineContext, profile: SiteProfile, pages: SitePage[]): Promise<IdeaInput[]> {
  const offerings = pages.filter((p) => p.indexable && COMMERCIAL_TYPES.includes(p.pageType)).slice(0, 40);
  const desc = offerings.map((p) => `- ${p.url} (${p.pageType}): ${neutralizeUntrusted(`${p.h1 || p.title}. ${p.description}`, 240).text}`).join("\n");
  const res = await ctx.provider.generate({
    purpose: "ideas",
    system: IDEAS_SYSTEM_PROMPT,
    prompt: `Site: ${profile.name} (${ctx.config.siteUrl}), about ${profile.primarySubject}. Suggest up to 15 article ideas.\n<untrusted_site_content>\n${desc}\n</untrusted_site_content>`,
    maxTokens: 4000,
  });
  const start = res.text.indexOf("{");
  const parsed = JSON.parse(res.text.slice(start, res.text.lastIndexOf("}") + 1)) as { ideas?: { title?: unknown; primaryTopic?: unknown; reason?: unknown; supportsPages?: unknown }[] };
  return (parsed.ideas ?? [])
    .filter((i) => typeof i.title === "string" && typeof i.primaryTopic === "string" && Array.isArray(i.supportsPages))
    .slice(0, 15)
    .map((i) => ({
      title: String(i.title).slice(0, 120),
      primaryTopic: String(i.primaryTopic).slice(0, 80),
      reason: typeof i.reason === "string" ? i.reason.slice(0, 400) : "Suggested by the AI provider",
      supportsPages: (i.supportsPages as unknown[]).filter((u): u is string => typeof u === "string"),
      source: `AI suggestion (${ctx.provider.id}), validated against site content`,
    }));
}
