import path from "node:path";
import { HtmlStorage } from "../../adapters/content-storage/html.js";
import { learnConventions, MarkdownStorage } from "../../adapters/content-storage/markdown.js";
import type { ContentStorage } from "../../adapters/content-storage/types.js";
import { FileSystemHostAdapter } from "../../adapters/host-site/filesystem.js";
import type { SimilarityIndex } from "../analyzer/similarity.js";
import { parseFrontmatter } from "../content/markdown.js";
import { EngineError } from "../errors.js";
import type { LinkCheckContext } from "../linking/graph.js";
import type { RenderContext } from "../render/render.js";
import type { BlogArticle, Recommendation, SitePage, SiteProfile, TopicCluster } from "../types.js";
import { isUnderPath, urlKey } from "../util/url.js";
import { buildSimilarity } from "./analyze.js";
import type { EngineContext, StoredAnalysis } from "./context.js";

/** Everything an operation needs to know about the site, loaded once per operation. */
export interface World {
  analysis: StoredAnalysis;
  profile: SiteProfile;
  pages: SitePage[];
  recommendations: Recommendation[];
  clusters: TopicCluster[];
  articles: BlogArticle[];
  /** Article body (Markdown or plain text) by article id. */
  text: Map<string, string>;
  sim: SimilarityIndex;
  siteName: string;
  blogTitle: string;
}

export async function loadWorld(ctx: EngineContext): Promise<World> {
  const analysis = await ctx.readAnalysis();
  if (!analysis) throw new EngineError("BAD_INPUT", "the website has not been analyzed yet; run Analyze first");
  const pages = await ctx.readSiteIndex();
  const articles = ctx.registry.list();
  const text = await articleTexts(ctx, articles, pages);
  const blogHome = pages.find((p) => p.pageType === "blog-index" && urlKey(p.url) === urlKey(new URL(ctx.config.blogPath, `${ctx.config.siteUrl}/`).href));
  return {
    analysis,
    profile: analysis.profile,
    pages,
    recommendations: await ctx.readRecommendations(),
    clusters: await ctx.readClusters(),
    articles,
    text,
    sim: buildSimilarity(pages, articles, text),
    siteName: ctx.config.siteName ?? analysis.profile.name,
    blogTitle: blogHome?.h1 || "Blog",
  };
}

/** Engine articles: the engine's own Markdown copy. Existing articles: their source body or crawled excerpt. */
async function articleTexts(ctx: EngineContext, articles: BlogArticle[], pages: SitePage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byKey = new Map(pages.map((p) => [urlKey(p.url), p]));
  for (const a of articles) {
    if (a.source === "blog-engine") {
      const d = await ctx.readDraft(a.id);
      if (d !== undefined) out.set(a.id, d);
      continue;
    }
    const p = byKey.get(urlKey(a.url));
    if (p?.sourceFile && /\.(md|mdx|markdown)$/i.test(p.sourceFile)) {
      const raw = await ctx.readFs.readText(p.sourceFile);
      if (raw !== undefined) {
        out.set(a.id, parseFrontmatter(raw).body);
        continue;
      }
    }
    if (p) out.set(a.id, p.excerpt);
  }
  return out;
}

export interface StorageInfo {
  storage: ContentStorage;
  /** Directory served at the site root (sitemaps, the index and the discovery file go here). */
  publicDir: string;
  /** Directory engine-rendered HTML pages live in, when the engine renders pages. */
  outputDir?: string;
  notes: string[];
}

const PUBLIC_DIR_BY_FRAMEWORK: Record<string, string> = {
  "Next.js": "public",
  Astro: "public",
  Nuxt: "public",
  Remix: "public",
  "Create React App": "public",
  React: "public",
  Vue: "public",
  Svelte: "public",
  VitePress: "public",
  Eleventy: "public",
  SvelteKit: "static",
  Gatsby: "static",
  Hugo: "static",
  Docusaurus: "static",
  Hexo: "source",
  Jekyll: ".",
};

/** Decide where published articles and public engine files go on this host. */
export async function resolveStorage(ctx: EngineContext, analysis: StoredAnalysis, articles: BlogArticle[], pages: SitePage[]): Promise<StorageInfo> {
  const { config } = ctx;
  const arch = analysis.architecture;
  const notes: string[] = [];
  const isFs = ctx.host instanceof FileSystemHostAdapter;
  const outputDir = isFs ? ((await (ctx.host as FileSystemHostAdapter).getOutputDir()) ?? undefined) : undefined;
  const staticSite = arch.framework === "Static HTML";
  const publicDir = config.storage.publicDir ?? (staticSite ? (outputDir ?? ".") : (PUBLIC_DIR_BY_FRAMEWORK[arch.framework] ?? outputDir ?? "public"));

  if (!isFs && !config.storage.articlesDir) {
    throw new EngineError("CONFIG_INVALID", "this site is read over HTTP, so the engine cannot know where to write articles; set storage.articlesDir (and storage.publicDir) to directories in the site's source checkout");
  }

  const existingMd = articles.filter((a) => a.source === "existing" && a.storage?.path && /\.(md|mdx|markdown)$/i.test(a.storage.path));
  const format = config.storage.format === "auto" ? (existingMd.length || arch.blog.contentDir || !staticSite ? "markdown" : "html") : config.storage.format;

  if (format === "markdown") {
    const files = existingMd.map((a) => a.storage!.path!);
    const dir = config.storage.articlesDir ?? commonDir(files) ?? arch.blog.contentDir ?? (arch.framework === "Astro" ? "src/content/blog" : "content/blog");
    if (!staticSite && !arch.blog.contentDir && !existingMd.length) notes.push(`New articles are written as Markdown to ${dir}. The site must have a route that renders Markdown from this folder; see BLOG_ENGINE.md "Framework sites without a blog".`);
    const conv = learnConventions(dir, arch.blog.frontmatterKeys, files, arch.framework);
    return { storage: new MarkdownStorage(ctx.writableFs([dir]), ctx.owned, conv), publicDir, ...(outputDir ? { outputDir } : {}), notes };
  }

  const htmlDir = config.storage.articlesDir ?? outputDir ?? ".";
  const layout = config.storage.htmlLayout ?? learnHtmlLayout(pages, config.blogPath);
  if (!staticSite) notes.push(`Articles are written as HTML into ${htmlDir}; a rebuild of the site may replace that folder. Prefer storage.format "markdown" for framework sites.`);
  const blogDir = path.posix.join(htmlDir, config.blogPath.replace(/^\/+/, ""));
  return { storage: new HtmlStorage(ctx.writableFs([blogDir]), ctx.owned, htmlDir, layout), publicDir, outputDir: htmlDir, notes };
}

function learnHtmlLayout(pages: SitePage[], blogPath: string): "directory" | "file" {
  const files = pages.filter((p) => p.isBlogArticle && p.sourceFile?.endsWith(".html") && isUnderPath(p.path, blogPath)).map((p) => p.sourceFile!);
  if (!files.length) return "directory";
  const dirStyle = files.filter((f) => f.endsWith("/index.html")).length;
  return dirStyle >= files.length / 2 ? "directory" : "file";
}

function commonDir(files: string[]): string | undefined {
  if (!files.length) return undefined;
  const counts = new Map<string, number>();
  for (const f of files) counts.set(path.posix.dirname(f), (counts.get(path.posix.dirname(f)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

export async function renderContext(ctx: EngineContext, w: World): Promise<RenderContext> {
  const template = await ctx.host.getTemplate?.(ctx.config.storage.templatePage);
  return { config: ctx.config, siteName: w.siteName, blogTitle: w.blogTitle, ...(template ? { template } : {}) };
}

export function linkCheckContext(ctx: EngineContext, pages: SitePage[], articles: BlogArticle[]): LinkCheckContext {
  const knownStatus = new Map<string, number>();
  const canonicalOf = new Map<string, string>();
  for (const p of pages) {
    knownStatus.set(urlKey(p.url), 200);
    if (p.canonicalUrl) canonicalOf.set(urlKey(p.url), p.canonicalUrl);
  }
  const articleStatus = new Map<string, string>();
  for (const a of articles) if (a.source === "blog-engine" || a.status !== "published") articleStatus.set(urlKey(a.url), a.status);
  return { siteUrl: ctx.config.siteUrl, stagingHosts: ctx.config.host.stagingHosts, knownStatus, canonicalOf, articleStatus, checkUrl: (u) => ctx.host.checkUrl(u) };
}
