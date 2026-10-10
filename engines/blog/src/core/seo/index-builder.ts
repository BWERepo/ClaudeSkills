import type { BlogEngineConfig } from "../../config/config.js";
import type { SimilarityIndex } from "../analyzer/similarity.js";
import type { BlogArticle, BrokenLink, Recommendation, SitePage, TopicCluster } from "../types.js";
import { COMMERCIAL_TYPES } from "../inventory/classify.js";
import { DISCOVERY_SCHEMA_VERSION, ENGINE_NAME, ENGINE_VERSION, INDEX_SCHEMA_VERSION } from "../../version.js";
import { urlKey } from "../util/url.js";

export interface IndexArticle {
  id: string;
  url: string;
  slug: string;
  title: string;
  description: string;
  source: "existing" | "blog-engine";
  status: string;
  category: string;
  tags: string[];
  primaryTopic: string;
  secondaryTopics: string[];
  searchIntent: string;
  author?: string;
  publishedAt?: string;
  modifiedAt?: string;
  canonicalUrl: string;
  indexable: boolean;
  internalLinksIn: string[];
  internalLinksOut: string[];
  relatedArticles: string[];
  relatedSitePages: string[];
  clusterId?: string;
  pillarArticle?: string;
  schemaTypes: string[];
  wordCount: number;
  orphan: boolean;
  linkCount: { in: number; out: number };
  brokenLinks: number;
  contentHash?: string;
  metadataHash?: string;
  lastAnalyzedAt?: string;
  lastIndexedAt: string;
  lastReviewedAt?: string;
  refreshRecommended: boolean;
  refreshReason?: string[];
  generatedBy?: string;
}

export interface BlogSeoIndex {
  schemaVersion: string;
  engine: string;
  engineVersion: string;
  generatedAt: string;
  site: string;
  blogRoot: string;
  visibility: "public" | "internal";
  articleCount: number;
  summary: {
    published: number;
    existing: number;
    blogEngine: number;
    orphans: number;
    weaklyLinked: number;
    brokenLinks: number;
    needsRefresh: number;
    clusters: number;
    incompleteClusters: number;
  };
  articles: IndexArticle[];
  clusters: { id: string; name: string; pillar?: string; supportingArticles: string[]; relatedSitePages: string[]; complete: boolean; gaps: string[] }[];
  sitePageCoverage: { url: string; pageType: string; title: string; supportingArticles: string[] }[];
  overlaps: { a: string; b: string; similarity: number }[];
  opportunities?: { id: string; title: string; priority: string; status: string; recommendedAction: string; supportsPages: string[]; opportunitySource: string; searchVolume: "Unknown" | number }[];
}

export interface BuildIndexInput {
  config: BlogEngineConfig;
  articles: BlogArticle[];
  clusters: TopicCluster[];
  pages: SitePage[];
  recommendations: Recommendation[];
  brokenLinks: BrokenLink[];
  sim: SimilarityIndex;
  now: string;
  visibility: "public" | "internal";
}

/**
 * The authoritative, machine-readable Blog SEO Index. The public variant lists only published articles; the
 * internal variant (kept in the data directory for BWE tools in the same project) lists every status and the open
 * opportunities. Field order and names are part of the documented, versioned contract.
 */
export function buildBlogSeoIndex(i: BuildIndexInput): BlogSeoIndex {
  const { config, now } = i;
  const include = (a: BlogArticle) => (i.visibility === "public" ? a.status === "published" : true);
  const arts = i.articles.filter(include).sort((a, b) => a.url.localeCompare(b.url));
  const brokenBy = new Map<string, number>();
  for (const b of i.brokenLinks) brokenBy.set(urlKey(b.fromUrl), (brokenBy.get(urlKey(b.fromUrl)) ?? 0) + 1);

  const articles: IndexArticle[] = arts.map((a) => ({
    id: a.id,
    url: a.url,
    slug: a.slug,
    title: a.title,
    description: a.description,
    source: a.source,
    status: a.status,
    category: a.category,
    tags: a.tags,
    primaryTopic: a.primaryTopic,
    secondaryTopics: a.secondaryTopics,
    searchIntent: a.searchIntent,
    ...(a.author ? { author: a.author } : {}),
    ...(a.publishedAt ? { publishedAt: a.publishedAt } : {}),
    ...(a.modifiedAt ?? a.lastModifiedAt ? { modifiedAt: a.modifiedAt ?? a.lastModifiedAt } : {}),
    canonicalUrl: a.canonicalUrl,
    indexable: a.status === "published" && a.indexable,
    internalLinksIn: a.internalLinksIn,
    internalLinksOut: a.internalLinksOut,
    relatedArticles: a.relatedArticles,
    relatedSitePages: a.relatedSitePages,
    ...(a.clusterId ? { clusterId: a.clusterId } : {}),
    ...(a.pillarArticle ? { pillarArticle: a.pillarArticle } : {}),
    schemaTypes: a.schemaTypes,
    wordCount: a.wordCount,
    orphan: a.status === "published" && a.internalLinksIn.length === 0,
    linkCount: { in: a.internalLinksIn.length, out: a.internalLinksOut.length },
    brokenLinks: brokenBy.get(urlKey(a.url)) ?? 0,
    ...(a.contentHash ? { contentHash: a.contentHash } : {}),
    ...(a.metadataHash ? { metadataHash: a.metadataHash } : {}),
    ...(a.lastAnalyzedAt ? { lastAnalyzedAt: a.lastAnalyzedAt } : {}),
    lastIndexedAt: now,
    ...(a.lastReviewedAt ? { lastReviewedAt: a.lastReviewedAt } : {}),
    refreshRecommended: !!a.refreshRecommended,
    ...(a.refreshReason?.length ? { refreshReason: a.refreshReason } : {}),
    ...(a.generatedBy ? { generatedBy: a.generatedBy } : {}),
  }));

  const included = new Set(arts.map((a) => urlKey(a.url)));
  const keepUrl = (u: string) => included.has(urlKey(u));
  const clusters = i.clusters
    .map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.pillar && keepUrl(c.pillar) ? { pillar: c.pillar } : {}),
      supportingArticles: c.supportingArticles.filter(keepUrl),
      relatedSitePages: c.relatedSitePages,
      complete: c.complete,
      gaps: c.gaps,
    }))
    .filter((c) => c.pillar || c.supportingArticles.length);

  const coverage = i.pages
    .filter((p) => p.indexable && COMMERCIAL_TYPES.includes(p.pageType))
    .map((p) => ({
      url: p.url,
      pageType: p.pageType,
      title: p.h1 || p.title,
      supportingArticles: arts.filter((a) => a.status === "published" && (a.relatedSitePages.some((u) => urlKey(u) === urlKey(p.url)) || a.internalLinksOut.some((u) => urlKey(u) === urlKey(p.url)))).map((a) => a.url),
    }));

  const overlaps: BlogSeoIndex["overlaps"] = [];
  const pub = arts.filter((a) => a.status === "published");
  for (let x = 0; x < pub.length; x++)
    for (let y = x + 1; y < pub.length; y++) {
      const s = i.sim.similarity(`art:${urlKey(pub[x]!.url)}`, `art:${urlKey(pub[y]!.url)}`);
      if (s >= 0.5) overlaps.push({ a: pub[x]!.url, b: pub[y]!.url, similarity: Math.round(s * 100) / 100 });
    }

  const index: BlogSeoIndex = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    engine: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    generatedAt: now,
    site: config.siteUrl,
    blogRoot: `${config.blogPath.replace(/\/$/, "")}/`,
    visibility: i.visibility,
    articleCount: articles.length,
    summary: {
      published: articles.filter((a) => a.status === "published").length,
      existing: articles.filter((a) => a.source === "existing").length,
      blogEngine: articles.filter((a) => a.source === "blog-engine").length,
      orphans: articles.filter((a) => a.orphan).length,
      weaklyLinked: articles.filter((a) => a.status === "published" && a.linkCount.in <= 1).length,
      brokenLinks: articles.reduce((s, a) => s + a.brokenLinks, 0),
      needsRefresh: articles.filter((a) => a.refreshRecommended).length,
      clusters: clusters.length,
      incompleteClusters: clusters.filter((c) => !c.complete).length,
    },
    articles,
    clusters,
    sitePageCoverage: coverage,
    overlaps,
  };
  if (i.visibility === "internal") {
    index.opportunities = i.recommendations
      .filter((r) => r.status === "recommended" || r.status === "selected")
      .map((r) => ({ id: r.id, title: r.title, priority: r.priority, status: r.status, recommendedAction: r.recommendedAction, supportsPages: r.primaryPagesSupported, opportunitySource: r.opportunitySource, searchVolume: r.searchVolume === "Unknown" ? "Unknown" : r.searchVolume.value }));
  }
  return index;
}

export interface DiscoveryFile {
  schemaVersion: string;
  type: "bwe-blog-engine";
  engine: string;
  engineVersion: string;
  blogIndex: string;
  indexSchemaVersion: string;
  sitemap: string;
  blogSitemap?: string;
  blogRoot: string;
  articleCount: number;
  lastUpdated: string;
}

/** /.well-known/bwe-blog.json: a predictable entry point for BWE tools. Not a substitute for normal SEO signals. */
export function buildDiscoveryFile(config: BlogEngineConfig, idx: BlogSeoIndex, sitemapPath: string, blogSitemapPath: string | undefined): DiscoveryFile {
  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    type: "bwe-blog-engine",
    engine: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    blogIndex: config.blogIndexPath,
    indexSchemaVersion: idx.schemaVersion,
    sitemap: sitemapPath,
    ...(blogSitemapPath ? { blogSitemap: blogSitemapPath } : {}),
    blogRoot: idx.blogRoot,
    articleCount: idx.articleCount,
    lastUpdated: idx.generatedAt,
  };
}
