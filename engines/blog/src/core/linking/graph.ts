import type { SimilarityIndex } from "../analyzer/similarity.js";
import type { BlogArticle, BrokenLink, SitePage } from "../types.js";
import { COMMERCIAL_TYPES } from "../inventory/classify.js";
import { normalizeLink, urlKey } from "../util/url.js";
import type { UrlCheck } from "../../adapters/host-site/types.js";

export interface LinkGraph {
  inbound: Map<string, Set<string>>;
  contextualInbound: Map<string, Set<string>>;
  outbound: Map<string, Set<string>>;
}

/**
 * The internal-link graph across the whole site. Nodes are canonical URL keys; edges come from every page's
 * links (body, nav, footer), every article's own links, and engine-rendered listing pages.
 */
export function buildLinkGraph(pages: SitePage[], articles: BlogArticle[], extraEdges: [string, string][] = []): LinkGraph {
  const inbound = new Map<string, Set<string>>();
  const contextualInbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  const add = (from: string, to: string, contextual: boolean) => {
    const f = urlKey(from);
    const t = urlKey(to);
    if (f === t) return;
    (outbound.get(f) ?? outbound.set(f, new Set()).get(f)!).add(t);
    (inbound.get(t) ?? inbound.set(t, new Set()).get(t)!).add(f);
    if (contextual) (contextualInbound.get(t) ?? contextualInbound.set(t, new Set()).get(t)!).add(f);
  };
  const pageKeys = new Set(pages.map((p) => urlKey(p.url)));
  for (const p of pages) for (const l of p.internalLinksOut) add(p.url, l.href, l.context === "body" && p.pageType !== "blog-index" && p.pageType !== "blog-category");
  // Articles the host does not serve yet (new Blog Engine articles) contribute their own links.
  for (const a of articles) if (!pageKeys.has(urlKey(a.url)) && a.status === "published") for (const h of a.internalLinksOut) add(a.url, h, true);
  for (const [f, t] of extraEdges) add(f, t, false);
  return { inbound, contextualInbound, outbound };
}

/** Update each article's links in/out, orphan flag and relationships from the graph. */
export function applyGraphToArticles(articles: BlogArticle[], graph: LinkGraph, pages: SitePage[], sim: SimilarityIndex, siteUrl: string): BlogArticle[] {
  const origin = new URL(siteUrl).origin;
  const toUrl = (k: string) => new URL(k, `${origin}/`).href;
  const published = articles.filter((a) => a.status === "published");
  const commercial = pages.filter((p) => p.indexable && COMMERCIAL_TYPES.includes(p.pageType));
  return articles.map((a) => {
    const k = urlKey(a.url);
    const ins = [...(graph.inbound.get(k) ?? [])].map(toUrl).sort();
    const outs = a.internalLinksOut.length ? a.internalLinksOut : [...(graph.outbound.get(k) ?? [])].map(toUrl).sort();
    const key = `art:${k}`;
    const related = published
      .filter((b) => b.id !== a.id)
      .map((b) => ({ url: b.url, s: sim.similarity(key, `art:${urlKey(b.url)}`) }))
      .filter((x) => x.s >= 0.15)
      .sort((x, y) => y.s - x.s)
      .slice(0, 5)
      .map((x) => x.url);
    const linkedCommercial = commercial.filter((p) => outs.some((o) => urlKey(o) === urlKey(p.url))).map((p) => p.url);
    const similarCommercial = commercial
      .map((p) => ({ url: p.url, s: sim.similarity(key, `page:${urlKey(p.url)}`) }))
      .filter((x) => x.s >= 0.2)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.url);
    const relatedSitePages = [...new Set([...a.relatedSitePages, ...linkedCommercial, ...similarCommercial])].slice(0, 6);
    return {
      ...a,
      internalLinksIn: ins,
      internalLinksOut: [...new Set(outs)],
      orphan: a.status === "published" ? ins.length === 0 : undefined,
      relatedArticles: related,
      relatedSitePages,
    } as BlogArticle;
  });
}

export interface LinkCheckContext {
  siteUrl: string;
  stagingHosts: string[];
  knownStatus: Map<string, number>;
  canonicalOf: Map<string, string>;
  articleStatus: Map<string, string>;
  checkUrl: (url: string) => Promise<UrlCheck>;
}

/** Validate links from one page. Never knowingly publish a broken internal link. */
export async function checkLinks(fromUrl: string, hrefs: string[], ctx: LinkCheckContext): Promise<BrokenLink[]> {
  const out: BrokenLink[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    if (seen.has(href)) continue;
    seen.add(href);
    const n = normalizeLink(href, fromUrl, ctx.siteUrl, ctx.stagingHosts);
    if (n.kind === "malformed") {
      out.push({ fromUrl, href, problem: "malformed", detail: n.problems.join("; ") });
      continue;
    }
    if (n.kind !== "page" || !n.internal) continue;
    for (const pr of n.problems) {
      if (pr.startsWith("localhost")) out.push({ fromUrl, href, problem: "localhost", detail: pr });
      else if (pr.startsWith("staging")) out.push({ fromUrl, href, problem: "staging-host", detail: pr });
      else if (pr.startsWith("wrong protocol")) out.push({ fromUrl, href, problem: "wrong-protocol", detail: pr });
      else if (pr.includes("slashes")) out.push({ fromUrl, href, problem: "malformed", detail: pr });
    }
    const k = urlKey(n.url);
    const st = ctx.articleStatus.get(k);
    if (st && st !== "published") {
      out.push({ fromUrl, href, problem: "unpublished-target", detail: `target article is ${st}` });
      continue;
    }
    let status = ctx.knownStatus.get(k);
    let location: string | undefined;
    if (status === undefined && st !== "published") {
      const r = await ctx.checkUrl(n.url);
      if (r.status !== "unknown") status = r.status;
      location = r.location;
    }
    if (status === 404 || status === 410) out.push({ fromUrl, href, problem: "not-found", detail: `${status}` });
    else if (status !== undefined && status >= 300 && status < 400) out.push({ fromUrl, href, problem: "redirect", detail: `redirects${location ? ` to ${location}` : ""}; link to the final URL` });
    const canon = ctx.canonicalOf.get(k);
    if (canon && new URL(n.url).pathname !== new URL(canon).pathname && urlKey(canon) === k) {
      out.push({ fromUrl, href, problem: "duplicate-canonical-path", detail: `links to ${new URL(n.url).pathname} but the canonical path is ${new URL(canon).pathname}` });
    }
  }
  return out;
}
