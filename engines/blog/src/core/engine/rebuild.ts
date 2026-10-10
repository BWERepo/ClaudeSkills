import { buildClusters } from "../clusters/clusters.js";
import { applyGraphToArticles, buildLinkGraph, checkLinks } from "../linking/graph.js";
import { buildBlogSeoIndex, buildDiscoveryFile } from "../seo/index-builder.js";
import { validateDiscoveryDocument, validateIndexDocument } from "../seo/index-schema.js";
import { addChildToSitemapIndex, mergeIntoUrlset, sitemapEntries, sitemapIndexHasChild, urlsetXml, validateSitemapXml } from "../seo/sitemap.js";
import { evaluateRefresh } from "../refresh/refresh.js";
import type { BlogArticle, BrokenLink } from "../types.js";
import { articleMetadataHash } from "../inventory/inventory.js";
import { contentHash } from "../util/hash.js";
import { isoNow } from "../util/time.js";
import { urlKey } from "../util/url.js";
import type { EngineContext } from "./context.js";
import { buildSimilarity } from "./analyze.js";
import { linkCheckContext, loadWorld, resolveStorage } from "./site.js";

export interface RebuildOptions {
  /** Always false in this engine: Rebuild Index never regenerates article content. */
  regenerateContent: false;
}

export interface RebuildReport {
  rebuiltAt: string;
  articlesScanned: number;
  orphans: string[];
  brokenLinks: number;
  hashesUpdated: number;
  indexArticles: number;
  indexValid: boolean;
  indexErrors: string[];
  sitemap: { action: "created" | "merged" | "deferred-to-build-plugin" | "unchanged"; added: number; updated: number; removed: number; path?: string };
  discoveryWritten: boolean;
  bweseo?: { status: string; written: boolean; warnings: string[] };
  refreshFlagged: number;
}

/**
 * `Rebuild Blog SEO Index`: re-validate, recompute relationships, inbound/outbound links and orphans, update
 * hashes, regenerate the index, update the sitemap if required, run validation. Never regenerates content.
 */
export async function rebuildIndex(ctx: EngineContext, _opts: RebuildOptions = { regenerateContent: false }): Promise<RebuildReport> {
  const { config } = ctx;
  const pr = ctx.progress("rebuild-index");
  const now = isoNow(ctx.clock);

  pr.start("scan", "Scanning existing and Blog Engine articles");
  let world = await loadWorld(ctx);
  pr.done("scan", `${world.articles.length} article(s)`, world.articles.length);

  pr.start("relationships", "Recomputing relationships, links and orphans");
  const { clusters, articleCluster } = buildClusters(world.pages, world.articles, world.recommendations, config, world.siteName);
  const graph = buildLinkGraph(world.pages, world.articles);
  const linked = applyGraphToArticles(world.articles, graph, world.pages, world.sim, config.siteUrl);
  let hashesUpdated = 0;
  for (const a of linked) {
    const cl = articleCluster.get(a.id);
    const text = world.text.get(a.id);
    const freshContentHash = text !== undefined ? contentHash(text) : a.contentHash;
    const patch: Partial<BlogArticle> = {
      internalLinksIn: a.internalLinksIn,
      internalLinksOut: a.internalLinksOut,
      ...(a.orphan !== undefined ? { orphan: a.orphan } : {}),
      relatedArticles: a.relatedArticles,
      relatedSitePages: a.relatedSitePages,
      ...(cl ? { clusterId: cl } : {}),
      lastIndexedAt: now,
      ...(freshContentHash !== a.contentHash ? { contentHash: freshContentHash } : {}),
    };
    if (freshContentHash !== a.contentHash) hashesUpdated++;
    ctx.registry.update(a.id, patch);
  }
  world = { ...world, articles: ctx.registry.list() };
  await ctx.writeClusters(clusters);
  const orphans = world.articles.filter((a) => a.status === "published" && a.orphan).map((a) => a.url);
  pr.done("relationships");

  pr.start("broken-links", "Checking internal links");
  const linkCtx = linkCheckContext(ctx, world.pages, world.articles);
  const broken: BrokenLink[] = [];
  for (const a of world.articles.filter((x) => x.status === "published")) {
    broken.push(...(await checkLinks(a.url, a.internalLinksOut, linkCtx)));
  }
  pr.done("broken-links", `${broken.length} broken link(s)`, broken.length);

  pr.start("hashes", "Updating metadata hashes");
  for (const a of world.articles) {
    const fresh = articleMetadataHash(a);
    if (fresh !== a.metadataHash) ctx.registry.update(a.id, { metadataHash: fresh });
  }
  world = { ...world, articles: ctx.registry.list() };
  pr.done("hashes");

  pr.start("refresh", "Evaluating which articles need a refresh");
  const refreshed = evaluateRefresh({ articles: world.articles, pages: world.pages, previousPages: world.pages, broken, sim: world.sim, now, reviewIntervalDays: config.refresh.reviewIntervalDays, text: world.text });
  let refreshFlagged = 0;
  for (const a of refreshed) {
    if (a.refreshRecommended) refreshFlagged++;
    if (a.refreshRecommended !== world.articles.find((x) => x.id === a.id)?.refreshRecommended || JSON.stringify(a.refreshReason) !== JSON.stringify(world.articles.find((x) => x.id === a.id)?.refreshReason)) {
      ctx.registry.update(a.id, { refreshRecommended: a.refreshRecommended, ...(a.refreshReason ? { refreshReason: a.refreshReason } : {}) });
    }
  }
  world = { ...world, articles: ctx.registry.list() };
  pr.done("refresh", `${refreshFlagged} article(s) flagged`);

  pr.start("index", "Regenerating the Blog SEO Index");
  const sim2 = buildSimilarity(world.pages, world.articles, world.text);
  const publicIdx = buildBlogSeoIndex({ config, articles: world.articles, clusters, pages: world.pages, recommendations: world.recommendations, brokenLinks: broken, sim: sim2, now, visibility: "public" });
  const internalIdx = buildBlogSeoIndex({ config, articles: world.articles, clusters, pages: world.pages, recommendations: world.recommendations, brokenLinks: broken, sim: sim2, now, visibility: "internal" });
  const indexErrors = validateIndexDocument(publicIdx);
  await ctx.store.write("blog-seo-index.internal.json", internalIdx);
  pr.done("index", `${publicIdx.articles.length} article(s) indexed`);

  const storageInfo = await resolveStorage(ctx, world.analysis, world.articles, world.pages);
  const outFs = ctx.writableFs([storageInfo.publicDir]);

  let sitemap: RebuildReport["sitemap"] = { action: "unchanged", added: 0, updated: 0, removed: 0 };
  if (config.sitemap.enabled) {
    pr.start("sitemap", "Updating the sitemap");
    sitemap = await updateSitemap(ctx, outFs, storageInfo.publicDir, world.articles, world.analysis.architecture.sitemap);
    pr.done("sitemap", sitemap.action);
  }

  let discoveryWritten = false;
  if (config.blogIndexVisibility === "public") {
    pr.start("publish-index", "Writing the public Blog SEO Index");
    await outFs.writeText(config.blogIndexPath.replace(/^\/+/, ""), `${JSON.stringify(publicIdx, null, 2)}\n`, { mode: "replace-with-backup", reason: "rebuild blog seo index" });
    if (config.bweSeoIntegration.enabled) {
      const discovery = buildDiscoveryFile(config, publicIdx, sitemapPathFor(world.analysis.architecture.sitemap), sitemap.path ?? (config.sitemap.enabled ? config.sitemap.blogSitemapPath : undefined));
      const dErrs = validateDiscoveryDocument(discovery);
      if (!dErrs.length) {
        await outFs.writeText(config.bweSeoIntegration.discoveryPath.replace(/^\/+/, ""), `${JSON.stringify(discovery, null, 2)}\n`, { mode: "replace-with-backup", reason: "rebuild discovery file" });
        discoveryWritten = true;
      }
    }
    pr.done("publish-index");
  }

  await ctx.patchState({ lastRebuildAt: now, lastIndexValidation: { passed: indexErrors.length === 0, errors: indexErrors, at: now } });
  await ctx.events.emit("index.rebuilt", { articleCount: publicIdx.articleCount });
  await ctx.flush();

  return {
    rebuiltAt: now,
    articlesScanned: world.articles.length,
    orphans,
    brokenLinks: broken.length,
    hashesUpdated,
    indexArticles: publicIdx.articleCount,
    indexValid: indexErrors.length === 0,
    indexErrors,
    sitemap,
    discoveryWritten,
    refreshFlagged,
  };
}

function sitemapPathFor(sitemap: { paths: string[] }): string {
  return sitemap.paths[0] ?? "/sitemap.xml";
}

/**
 * Sitemap strategy: defer to a build plugin that already generates one; add a child to an existing sitemap
 * index; merge into a single existing urlset; or create sitemap.xml when there is none at all.
 */
async function updateSitemap(
  ctx: EngineContext,
  fs: ReturnType<EngineContext["writableFs"]>,
  publicDir: string,
  articles: BlogArticle[],
  arch: { paths: string[]; kind: "single" | "index" | "none"; generatedBy: string },
): Promise<RebuildReport["sitemap"]> {
  const entries = sitemapEntries(articles);
  const knownPluginGenerators = ["next-sitemap", "@astrojs/sitemap", "@nuxtjs/sitemap", "gatsby-plugin-sitemap"];
  if (knownPluginGenerators.includes(arch.generatedBy)) {
    return { action: "deferred-to-build-plugin", added: 0, updated: 0, removed: 0 };
  }
  if (arch.kind === "index") {
    const indexPath = arch.paths[0]!;
    const indexXml = (await fs.readText(indexPath.replace(/^\/+/, ""))) ?? "";
    const blogSitemapRel = ctx.config.sitemap.blogSitemapPath.replace(/^\/+/, "");
    const blogXml = urlsetXml(entries);
    await fs.writeText(blogSitemapRel, blogXml, { mode: "replace-with-backup", reason: "blog sitemap" });
    const childUrl = new URL(ctx.config.sitemap.blogSitemapPath, `${ctx.config.siteUrl}/`).href;
    if (!sitemapIndexHasChild(indexXml, childUrl)) {
      const next = addChildToSitemapIndex(indexXml, childUrl, new Date().toISOString().slice(0, 10));
      await fs.writeText(indexPath.replace(/^\/+/, ""), next, { mode: "replace-with-backup", reason: "add blog sitemap to index" });
    }
    return { action: "merged", added: entries.length, updated: 0, removed: 0, path: ctx.config.sitemap.blogSitemapPath };
  }
  if (arch.kind === "single") {
    const sitemapPath = arch.paths[0]!;
    const existingXml = (await fs.readText(sitemapPath.replace(/^\/+/, ""))) ?? "";
    const engineOwned = new Set<string>(); // articles previously public but no longer: handled by syncDiscovered already removing them from `entries`
    const { xml, added, updated, removed } = mergeIntoUrlset(existingXml, entries, engineOwned);
    const errs = validateSitemapXml(xml);
    if (errs.length) return { action: "unchanged", added: 0, updated: 0, removed: 0 };
    await fs.writeText(sitemapPath.replace(/^\/+/, ""), xml, { mode: "replace-with-backup", reason: "merge blog entries into sitemap" });
    return { action: "merged", added, updated, removed, path: sitemapPath };
  }
  // No sitemap at all: create one covering every indexable page plus the blog.
  const xml = urlsetXml(entries);
  await fs.writeText("sitemap.xml", xml, { mode: "create", reason: "create sitemap" });
  return { action: "created", added: entries.length, updated: 0, removed: 0, path: "/sitemap.xml" };
}
