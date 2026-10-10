import type { BlogEngineConfig } from "../../config/config.js";
import { attr, byTag, findAll, parseHtml } from "../../core/html/dom.js";
import type { Progress } from "../../core/progress.js";
import type { SiteArchitecture } from "../../core/types.js";
import { isUnderPath, sameSiteHost, urlKey } from "../../core/util/url.js";
import { buildTemplate, parseRobots } from "./filesystem.js";
import type { HostSiteAdapter, HostTemplate, RawPage, UrlCheck } from "./types.js";

export interface HttpAdapterOptions {
  /** Where to crawl. Defaults to siteUrl; set it to a dev/preview server to analyze before deploy. URLs are still recorded on siteUrl. */
  crawlOrigin?: string;
  concurrency?: number;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Crawls a running website (CMS-backed, ecommerce, WordPress, server-rendered apps, or any site whose source is
 * not a checkout). Same-origin only, honours robots.txt Disallow for "*", bounded by maxPages, HTML only.
 */
export class HttpHostAdapter implements HostSiteAdapter {
  readonly name = "http";
  private pages?: RawPage[];
  private robotsTxt?: string | null;
  private readonly origin: string;
  private readonly fetch: typeof fetch;
  private statusCache = new Map<string, UrlCheck>();
  private sitemapUrls: string[] = [];
  private sitemapKind: SiteArchitecture["sitemap"]["kind"] = "none";

  constructor(
    private readonly config: BlogEngineConfig,
    private readonly opts: HttpAdapterOptions = {},
  ) {
    this.origin = new URL(opts.crawlOrigin ?? config.siteUrl).origin;
    this.fetch = opts.fetchImpl ?? fetch;
  }

  invalidate(): void {
    this.pages = undefined;
    this.statusCache.clear();
  }

  private toCanonical(u: string): string {
    const url = new URL(u);
    return new URL(url.pathname + url.search, new URL(this.config.siteUrl).origin).href;
  }

  private toCrawl(u: string): string {
    const url = new URL(u);
    return new URL(url.pathname + url.search, this.origin).href;
  }

  private async get(u: string, accept = "text/html"): Promise<{ status: number; body: string; type: string; location?: string }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000);
    try {
      const res = await this.fetch(u, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": this.opts.userAgent ?? "BWE-Blog-Engine/1.0 (+site analysis)", accept },
      });
      const type = res.headers.get("content-type") ?? "";
      const location = res.headers.get("location") ?? undefined;
      let body = "";
      if (res.status === 200 && (type.includes("html") || type.includes("xml") || type.includes("text/plain"))) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength <= (this.opts.maxBytes ?? 5_000_000)) body = new TextDecoder().decode(buf);
      } else {
        await res.body?.cancel().catch(() => undefined);
      }
      return { status: res.status, body, type, ...(location ? { location } : {}) };
    } finally {
      clearTimeout(t);
    }
  }

  async readRobots(): Promise<string | undefined> {
    if (this.robotsTxt === undefined) {
      try {
        const r = await this.get(`${this.origin}/robots.txt`, "text/plain");
        this.robotsTxt = r.status === 200 ? r.body : null;
      } catch {
        this.robotsTxt = null;
      }
    }
    return this.robotsTxt ?? undefined;
  }

  private async sitemapSeeds(): Promise<string[]> {
    const robots = parseRobots(await this.readRobots());
    const queue = robots.sitemaps.length ? robots.sitemaps.map((s) => this.toCrawl(s)) : [`${this.origin}/sitemap.xml`, `${this.origin}/sitemap_index.xml`];
    const urls: string[] = [];
    const seen = new Set<string>();
    while (queue.length && seen.size < 50) {
      const s = queue.shift()!;
      if (seen.has(s)) continue;
      seen.add(s);
      try {
        const r = await this.get(s, "application/xml,text/xml");
        if (r.status !== 200) continue;
        this.sitemapUrls.push(new URL(s).pathname);
        const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replace(/&amp;/g, "&"));
        if (/<sitemapindex/i.test(r.body)) {
          this.sitemapKind = "index";
          queue.push(...locs.map((l) => this.toCrawl(l)));
        } else {
          if (this.sitemapKind === "none") this.sitemapKind = "single";
          urls.push(...locs);
        }
      } catch {
        // missing sitemap is fine; links are crawled anyway
      }
    }
    return urls;
  }

  async listPages(progress?: Progress): Promise<RawPage[]> {
    if (this.pages) return this.pages;
    const disallow = parseRobots(await this.readRobots()).disallow;
    const allowed = (p: string) => !disallow.some((d) => d !== "/" && p.startsWith(d)) && !this.config.host.excludePaths.some((e) => isUnderPath(p, e.replace(/\/$/, "")) || p.startsWith(e));
    const queue: string[] = [`${this.origin}/`];
    for (const s of await this.sitemapSeeds()) {
      try {
        queue.push(this.toCrawl(s));
      } catch {
        // skip malformed sitemap entries
      }
    }
    const seen = new Set<string>();
    const pages = new Map<string, RawPage>();
    const max = this.config.host.maxPages;
    const conc = Math.max(1, Math.min(this.opts.concurrency ?? 4, 16));
    const worker = async () => {
      while (queue.length && pages.size < max) {
        const u = queue.shift()!;
        const key = urlKey(u);
        if (seen.has(key)) continue;
        seen.add(key);
        const p = new URL(u).pathname;
        if (!allowed(p) || /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|css|js|json|xml|txt|ico|woff2?)$/i.test(p)) continue;
        let r;
        try {
          r = await this.get(u);
        } catch {
          this.statusCache.set(key, { url: u, status: "unknown" });
          continue;
        }
        this.statusCache.set(key, { url: u, status: r.status, ...(r.location ? { location: r.location } : {}) });
        if (r.status >= 300 && r.status < 400 && r.location) {
          const next = new URL(r.location, u);
          if (sameSiteHost(next.hostname, new URL(this.origin).hostname)) queue.push(this.toCrawl(next.href));
          continue;
        }
        if (r.status !== 200 || !r.type.includes("html")) continue;
        pages.set(key, { url: this.toCanonical(u), html: r.body, kind: "html", status: 200 });
        if (pages.size % 10 === 0) progress?.tick("discover", `${pages.size} pages discovered`, pages.size);
        for (const a of findAll(parseHtml(r.body), byTag("a"))) {
          const href = attr(a, "href");
          if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
          try {
            const next = new URL(href, u);
            next.hash = "";
            if (sameSiteHost(next.hostname, new URL(this.origin).hostname) || next.origin === new URL(this.config.siteUrl).origin) {
              const c = this.toCrawl(next.href);
              if (!seen.has(urlKey(c))) queue.push(c);
            }
          } catch {
            // malformed links are reported by extraction
          }
        }
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    this.pages = [...pages.values()].sort((a, b) => a.url.localeCompare(b.url));
    progress?.tick("discover", `${this.pages.length} pages discovered`, this.pages.length);
    return this.pages;
  }

  async detectArchitecture(): Promise<SiteArchitecture> {
    const pages = await this.listPages();
    const home = pages.find((p) => new URL(p.url).pathname === "/")?.html ?? "";
    const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(home)?.[1];
    let framework = gen ?? "unknown (crawled)";
    if (/wp-content|wp-includes/.test(home)) framework = gen ?? "WordPress";
    else if (/__NEXT_DATA__|\/_next\//.test(home)) framework = "Next.js";
    else if (/data-astro-cid|astro-island/.test(home)) framework = "Astro";
    else if (/__NUXT__|\/_nuxt\//.test(home)) framework = "Nuxt";
    else if (/__sveltekit|\/_app\/immutable\//.test(home)) framework = "SvelteKit";
    else if (/cdn\.shopify\.com|Shopify\.theme/.test(home)) framework = "Shopify";
    else if (/static\.squarespace\.com/.test(home)) framework = "Squarespace";
    else if (/wix\.com|wixstatic/.test(home)) framework = "Wix";
    else if (/webflow/.test(home)) framework = "Webflow";
    const robotsTxt = await this.readRobots();
    const robots = parseRobots(robotsTxt);
    return {
      framework,
      buildSystem: "unknown (remote site)",
      routing: "server routes (crawled)",
      hosting: "unknown (remote site)",
      cms: /WordPress/i.test(framework) ? "WordPress" : ["Shopify", "Squarespace", "Wix", "Webflow"].includes(framework) ? framework : "unknown",
      database: "unknown (remote site)",
      contentStorage: "remote",
      blog: { exists: false, frontmatterKeys: [], articleCount: 0 },
      templates: [],
      metadata: "server-rendered <head>",
      sitemap: { paths: this.sitemapUrls, kind: this.sitemapKind, generatedBy: "remote" },
      robots: { ...(robotsTxt !== undefined ? { path: "/robots.txt" } : {}), disallow: robots.disallow, sitemaps: robots.sitemaps },
      canonical: "per-page <link rel=canonical>",
      structuredData: [],
      navigation: [],
      categories: [],
      tags: [],
      authors: [],
      redirects: {},
      internalLinkPatterns: "",
      seoInfrastructure: [],
      notes: [
        `Crawled ${pages.length} pages from ${this.origin}.`,
        "Remote sites are read-only for the engine: publishing needs a storage adapter for the CMS (or export to Markdown/HTML files).",
      ],
    };
  }

  async checkUrl(url: string): Promise<UrlCheck> {
    const key = urlKey(url);
    const cached = this.statusCache.get(key);
    if (cached) return { ...cached, url };
    try {
      const r = await this.get(this.toCrawl(url));
      const res: UrlCheck = { url, status: r.status, ...(r.location ? { location: r.location } : {}) };
      this.statusCache.set(key, res);
      return res;
    } catch {
      return { url, status: "unknown" };
    }
  }

  async getTemplate(): Promise<HostTemplate | undefined> {
    const pages = await this.listPages();
    const pick = pages.find((p) => isUnderPath(new URL(p.url).pathname, this.config.blogPath)) ?? pages[0];
    if (!pick) return undefined;
    const html = buildTemplate(pick.html);
    return html ? { sourceFile: pick.url, html } : undefined;
  }
}
