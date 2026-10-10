import path from "node:path";
import type { BlogEngineConfig } from "../../config/config.js";
import { parseFrontmatter, renderMarkdown, frontString } from "../../core/content/markdown.js";
import { attr, byTag, findAll, findOne, parseHtml, serialize, type Element } from "../../core/html/dom.js";
import { escapeHtml } from "../../core/html/dom.js";
import type { Progress } from "../../core/progress.js";
import type { SiteArchitecture } from "../../core/types.js";
import type { SafeFs } from "../../core/util/safe-fs.js";
import { slugify } from "../../core/util/slug.js";
import { absoluteUrl, isUnderPath, joinRoute, urlKey } from "../../core/util/url.js";
import { detectStack, readRedirects, type StackDetection } from "./detect.js";
import type { HostSiteAdapter, HostTemplate, RawPage, UrlCheck } from "./types.js";

const HTML_RE = /\.html?$/i;
const MD_RE = /\.(md|mdx|markdown)$/i;

/**
 * Reads a website from its checkout: built/served HTML files (any framework emits HTML) plus Markdown/MDX
 * content sources. Works for plain HTML, static generators, and framework sites after `build`.
 */
export class FileSystemHostAdapter implements HostSiteAdapter {
  readonly name = "filesystem";
  private stack?: StackDetection;
  private pages?: RawPage[];
  private outputDir?: string | null;
  private contentDir?: string | null;
  private redirects?: Record<string, string>;

  constructor(
    private readonly fs: SafeFs,
    private readonly config: BlogEngineConfig,
  ) {}

  invalidate(): void {
    this.pages = undefined;
    this.redirects = undefined;
  }

  async getStack(): Promise<StackDetection> {
    return (this.stack ??= await detectStack(this.fs));
  }

  /** Directory holding served HTML, relative to the site root ("." for a plain HTML site), or null. */
  async getOutputDir(): Promise<string | null> {
    if (this.outputDir !== undefined) return this.outputDir;
    if (this.config.host.outputDir) return (this.outputDir = this.config.host.outputDir);
    const stack = await this.getStack();
    for (const d of stack.outputDirCandidates) {
      if (this.fs.exists(path.posix.join(d, "index.html"))) return (this.outputDir = d);
    }
    for (const d of stack.outputDirCandidates.filter((x) => x !== ".")) {
      const html = await this.fs.listFiles(d, (r) => HTML_RE.test(r), 3);
      if (html.length) return (this.outputDir = d);
    }
    return (this.outputDir = null);
  }

  async getContentDir(): Promise<string | null> {
    if (this.contentDir !== undefined) return this.contentDir;
    if (this.config.host.contentDir) return (this.contentDir = this.config.host.contentDir);
    const stack = await this.getStack();
    for (const d of stack.contentDirCandidates) {
      if (!this.fs.exists(d)) continue;
      const md = await this.fs.listFiles(d, (r) => MD_RE.test(r), 4);
      if (md.length) return (this.contentDir = d);
    }
    return (this.contentDir = null);
  }

  async listPages(progress?: Progress): Promise<RawPage[]> {
    if (this.pages) return this.pages;
    const byKey = new Map<string, RawPage>();
    const out = await this.getOutputDir();
    if (out !== null) {
      const files = await this.fs.listFiles(out, (r) => HTML_RE.test(r) && !isExcludedFile(r, this.config.dataDir));
      let n = 0;
      for (const f of files) {
        const route = fileToRoute(f, out);
        if (!route || this.isExcluded(route)) continue;
        const html = (await this.fs.readText(f)) ?? "";
        const url = absoluteUrl(this.config.siteUrl, route);
        byKey.set(urlKey(url), { url, html, kind: "html", sourceFile: f, lastModified: await this.fs.mtime(f) });
        if (++n % 25 === 0) progress?.tick("discover", `${n} pages discovered`, n);
      }
    }
    const contentDir = await this.getContentDir();
    if (contentDir !== null) {
      const files = await this.fs.listFiles(contentDir, (r) => MD_RE.test(r));
      const htmlBySlug = new Map<string, string>();
      for (const [k] of byKey) htmlBySlug.set(k.split("/").pop() ?? "", k);
      for (const f of files) {
        const raw = (await this.fs.readText(f)) ?? "";
        const parsed = parseFrontmatter(raw);
        const slug = frontString(parsed.data, "slug") ?? fileSlug(f);
        const permalink = frontString(parsed.data, "permalink", "url", "path");
        let route: string;
        if (permalink && permalink.startsWith("/")) route = permalink;
        else if (htmlBySlug.has(slugify(slug))) route = htmlBySlug.get(slugify(slug))!;
        else route = joinRoute(this.inferArticleRoot(contentDir, byKey), slugify(slug));
        if (this.isExcluded(route)) continue;
        const url = absoluteUrl(this.config.siteUrl, route);
        const key = urlKey(url);
        const existing = byKey.get(key);
        const lastModified = await this.fs.mtime(f);
        if (existing) {
          // Built HTML is what visitors see; the Markdown file is the source of truth for storage.
          existing.sourceFile = f;
          existing.frontmatter = parsed.data;
          existing.frontmatterFormat = parsed.format;
          existing.frontmatterErrors = parsed.errors;
          existing.markdownBody = parsed.body;
          existing.lastModified = lastModified;
        } else {
          const title = frontString(parsed.data, "title") ?? slug;
          const desc = frontString(parsed.data, "description", "excerpt", "summary") ?? "";
          const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(desc)}"></head><body><main><article><h1>${escapeHtml(title)}</h1>${renderMarkdown(parsed.body)}</article></main></body></html>`;
          byKey.set(key, {
            url,
            html,
            kind: "markdown",
            sourceFile: f,
            frontmatter: parsed.data,
            frontmatterFormat: parsed.format,
            frontmatterErrors: parsed.errors,
            markdownBody: parsed.body,
            lastModified,
          });
        }
      }
    }
    this.pages = [...byKey.values()].sort((a, b) => a.url.localeCompare(b.url));
    progress?.tick("discover", `${this.pages.length} pages discovered`, this.pages.length);
    return this.pages;
  }

  /** Route prefix Markdown articles are served under, learned from built pages when possible. */
  private inferArticleRoot(contentDir: string, built: Map<string, RawPage>): string {
    const last = contentDir.split("/").filter(Boolean).pop() ?? "";
    for (const k of built.keys()) {
      if (k.startsWith(`/${last}/`)) return `/${last}`;
    }
    if (["blog", "posts", "articles", "news", "_posts"].includes(last)) return last === "_posts" ? this.config.blogPath : last === "blog" ? this.config.blogPath : `/${last}`;
    return this.config.blogPath;
  }

  private isExcluded(route: string): boolean {
    return this.config.host.excludePaths.some((p) => isUnderPath(route, p.replace(/\/$/, "")) || route.startsWith(p));
  }

  async detectArchitecture(): Promise<SiteArchitecture> {
    const stack = await this.getStack();
    const out = await this.getOutputDir();
    const contentDir = await this.getContentDir();
    const redirects = await this.getRedirects();
    const sitemapPaths: string[] = [];
    const base = out ?? "public";
    for (const f of await this.fs.listFiles(base, (r) => /(^|\/)[^/]*sitemap[^/]*\.xml$/i.test(r), 2)) sitemapPaths.push(`/${path.posix.relative(base === "." ? "" : base, f)}`);
    let sitemapKind: SiteArchitecture["sitemap"]["kind"] = "none";
    for (const s of sitemapPaths) {
      const x = (await this.fs.readText(path.posix.join(base, s))) ?? "";
      if (/<sitemapindex/i.test(x)) sitemapKind = "index";
      else if (/<urlset/i.test(x) && sitemapKind === "none") sitemapKind = "single";
    }
    const robotsTxt = await this.readRobots();
    const robots = parseRobots(robotsTxt);
    return {
      framework: stack.framework,
      ...(stack.frameworkVersion ? { frameworkVersion: stack.frameworkVersion } : {}),
      buildSystem: stack.buildSystem,
      routing: stack.routing,
      hosting: stack.hosting,
      cms: stack.cms,
      database: stack.database,
      contentStorage: contentDir ? (/(mdx)/.test(contentDir) ? "mdx" : "markdown") : out !== null ? "html-files" : "unknown",
      blog: { exists: false, frontmatterKeys: [], articleCount: 0, ...(contentDir ? { contentDir } : {}) },
      templates: [],
      metadata: stack.metadata,
      sitemap: { paths: sitemapPaths, kind: sitemapKind, generatedBy: stack.sitemapGenerator },
      robots: { ...(robotsTxt !== undefined ? { path: "/robots.txt" } : {}), disallow: robots.disallow, sitemaps: robots.sitemaps },
      canonical: stack.canonical,
      structuredData: [],
      navigation: [],
      categories: [],
      tags: [],
      authors: [],
      redirects,
      internalLinkPatterns: "",
      seoInfrastructure: [],
      ...(out !== null ? { outputDir: out } : {}),
      notes: [...stack.notes, ...(out === null ? ["No built HTML found. Run the site's build first, or use the http adapter, for complete link analysis."] : [])],
    };
  }

  async readRobots(): Promise<string | undefined> {
    const out = await this.getOutputDir();
    return (await this.fs.readText(path.posix.join(out ?? "public", "robots.txt"))) ?? (await this.fs.readText("robots.txt"));
  }

  private async getRedirects(): Promise<Record<string, string>> {
    return (this.redirects ??= await readRedirects(this.fs, (await this.getOutputDir()) ?? undefined));
  }

  async checkUrl(url: string): Promise<UrlCheck> {
    let p: string;
    try {
      p = new URL(url).pathname;
    } catch {
      return { url, status: 404 };
    }
    const redirects = await this.getRedirects();
    const r = redirects[p] ?? redirects[p.replace(/\/$/, "")] ?? redirects[`${p.replace(/\/$/, "")}/`];
    if (r) return { url, status: 301, location: r };
    const pages = await this.listPages();
    const key = urlKey(url);
    if (pages.some((pg) => urlKey(pg.url) === key)) return { url, status: 200 };
    const out = await this.getOutputDir();
    if (out !== null) {
      const rel = decodeURI(p).replace(/^\/+/, "");
      const candidates = [rel, path.posix.join(rel, "index.html"), `${rel.replace(/\/$/, "")}.html`].map((c) => path.posix.join(out, c));
      if (candidates.some((c) => this.fs.exists(c) && !c.endsWith("/"))) return { url, status: 200 };
      return { url, status: 404 };
    }
    return { url, status: "unknown" };
  }

  async getTemplate(preferPath?: string): Promise<HostTemplate | undefined> {
    const pages = (await this.listPages()).filter((p) => p.kind === "html" && p.sourceFile);
    if (!pages.length) return undefined;
    const pick =
      (preferPath && pages.find((p) => urlKey(p.url) === urlKey(absoluteUrl(this.config.siteUrl, preferPath)))) ||
      pages.find((p) => isUnderPath(new URL(p.url).pathname, this.config.blogPath) && urlKey(p.url) !== urlKey(absoluteUrl(this.config.siteUrl, this.config.blogPath))) ||
      pages.find((p) => !["/", ""].includes(new URL(p.url).pathname) && findOne(parseHtml(p.html), byTag("main"))) ||
      pages[0]!;
    const html = buildTemplate(pick.html);
    return html ? { sourceFile: pick.sourceFile!, html } : undefined;
  }
}

/** Turn a host page into a template: page-specific head tags removed, main content replaced by a placeholder. */
export function buildTemplate(html: string): string | undefined {
  const doc = parseHtml(html);
  const head = findOne(doc, byTag("head"));
  const body = findOne(doc, byTag("body"));
  if (!head || !body) return undefined;
  const pageSpecific = (el: Element): boolean => {
    if (el.name === "title") return true;
    if (el.name === "link" && /\b(canonical|alternate|prev|next|amphtml)\b/i.test(attr(el, "rel") ?? "")) return true;
    if (el.name === "script" && (attr(el, "type") ?? "").toLowerCase() === "application/ld+json") return true;
    if (el.name === "meta") {
      const n = (attr(el, "name") ?? attr(el, "property") ?? "").toLowerCase();
      return /^(description|robots|googlebot|keywords|author|og:|twitter:|article:)/.test(n);
    }
    return false;
  };
  for (const el of findAll(head, pageSpecific)) removeNode(el);
  const main =
    findOne(body, byTag("main")) ?? findOne(body, (el) => attr(el, "role") === "main") ?? findOne(body, byTag("article"));
  if (!main) return undefined;
  main.children = [];
  const marker = "BWE_MAIN_PLACEHOLDER";
  (main.attribs ??= {})["data-bwe"] = marker;
  let out = serialize(doc);
  out = out.replace(/<head([^>]*)>/i, "<head$1>\n<!--BWE:HEAD-->");
  out = out.replace(new RegExp(`(<[a-z]+[^>]*data-bwe="${marker}"[^>]*>)`, "i"), "$1<!--BWE:MAIN-->").replace(` data-bwe="${marker}"`, "");
  if (!out.includes("<!--BWE:HEAD-->") || !out.includes("<!--BWE:MAIN-->")) return undefined;
  if (!/^<!doctype/i.test(out.trim())) out = `<!doctype html>\n${out}`;
  return out;
}

function removeNode(el: Element): void {
  const parent = el.parent;
  if (!parent) return;
  parent.children = parent.children.filter((c) => c !== el);
}

export function fileToRoute(file: string, outputDir: string): string | null {
  const rel = outputDir === "." ? file : path.posix.relative(outputDir, file);
  if (rel.startsWith("..")) return null;
  const base = path.posix.basename(rel).toLowerCase();
  if (/^(404|500|50x|error)\.html?$/.test(base)) return null;
  if (/^google[0-9a-f]+\.html$/.test(base) || /^yandex_/.test(base)) return null;
  if (/(^|\/)index\.html?$/i.test(rel)) return `/${rel.replace(/(^|\/)index\.html?$/i, "$1")}`;
  return `/${rel}`;
}

function isExcludedFile(rel: string, dataDir: string): boolean {
  return rel.startsWith(`${dataDir}/`) || /(^|\/)(node_modules|\.git|\.next\/cache|vendor)\//.test(rel);
}

function fileSlug(f: string): string {
  let base = path.posix.basename(f).replace(MD_RE, "");
  if (base === "index") base = path.posix.basename(path.posix.dirname(f));
  return base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

export function parseRobots(txt: string | undefined): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  if (!txt) return { disallow, sitemaps };
  let applies = false;
  for (const raw of txt.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2]!.trim();
    if (k === "user-agent") applies = v === "*";
    else if (k === "disallow" && applies && v) disallow.push(v);
    else if (k === "sitemap") sitemaps.push(v);
  }
  return { disallow, sitemaps };
}
