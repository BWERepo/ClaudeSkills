import type { BlogEngineConfig } from "../../config/config.js";
import { offeringName } from "../analyzer/profile.js";
import type { BlogArticle, Recommendation, SitePage, TopicCluster } from "../types.js";
import { stableId } from "../util/hash.js";
import { jaccard, subjectTokens, titleCase } from "../util/text.js";
import { urlKey } from "../util/url.js";
import { plannedUrl } from "../recommendations/recommend.js";

interface Member {
  url: string;
  title: string;
  kind: "article" | "recommendation";
  role: "pillar" | "supporting" | "faq" | "comparison";
  anchorPage?: string;
}

/**
 * Group articles and recommendations into topical clusters anchored on the site page (or topic) they support.
 * Clusters exist to build topical authority: a pillar, supporting articles, and the commercial pages they serve.
 */
export function buildClusters(
  pages: SitePage[],
  articles: BlogArticle[],
  recs: Recommendation[],
  config: BlogEngineConfig,
  siteName: string,
): { clusters: TopicCluster[]; articleCluster: Map<string, string>; recCluster: Map<string, string> } {
  const pageByKey = new Map(pages.map((p) => [urlKey(p.url), p]));
  const groups = new Map<string, { name: string; tokens: string[]; members: Member[]; sitePages: Set<string> }>();

  const groupFor = (anchor: string | undefined, topic: string): string => {
    const page = anchor ? pageByKey.get(urlKey(anchor)) : undefined;
    const name = page && !page.isBlogArticle && page.pageType !== "home" ? offeringName(page, siteName) || topic : topic;
    const tokens = subjectTokens(name);
    for (const [k, g] of groups) {
      if (jaccard(g.tokens, tokens) >= 0.5) {
        if (page && !page.isBlogArticle) g.sitePages.add(page.url);
        return k;
      }
    }
    const key = stableId("cluster", tokens.join("-") || name.toLowerCase());
    groups.set(key, { name: titleCase(name), tokens, members: [], sitePages: new Set(page && !page.isBlogArticle && page.pageType !== "home" ? [page.url] : []) });
    return key;
  };

  const recCluster = new Map<string, string>();
  for (const r of recs.filter((x) => x.status !== "rejected" && x.status !== "obsolete")) {
    const k = groupFor(r.primaryPagesSupported[0], r.primaryTopic);
    recCluster.set(r.id, k);
    if (r.status === "created") continue; // represented by its article
    groups.get(k)!.members.push({
      url: plannedUrl(config, r.proposedSlug),
      title: r.title,
      kind: "recommendation",
      role: r.clusterRole === "pillar" ? "pillar" : r.contentType === "comparison" ? "comparison" : /\?$/.test(r.title) ? "faq" : "supporting",
      ...(r.primaryPagesSupported[0] ? { anchorPage: r.primaryPagesSupported[0] } : {}),
    });
  }

  const articleCluster = new Map<string, string>();
  for (const a of articles.filter((x) => !["rejected", "archived", "error"].includes(x.status))) {
    // An article anchors on the commercial page it links to most strongly, else its own topic.
    const target = a.relatedSitePages[0] ?? a.internalLinksOut.find((h) => {
      const p = pageByKey.get(urlKey(h));
      return p && !p.isBlogArticle && p.pageType !== "home" && !["legal", "utility", "contact", "about", "blog-index", "blog-category"].includes(p.pageType);
    });
    const recId = a.recommendationId && recCluster.get(a.recommendationId);
    const k = recId || groupFor(target, a.primaryTopic || a.title);
    articleCluster.set(a.id, k);
    groups.get(k)!.members.push({
      url: a.url,
      title: a.title,
      kind: "article",
      role: /\b(complete guide|ultimate guide|everything you need|guide to)\b/i.test(a.title) ? "pillar" : /\b(vs\.?|versus)\b/i.test(a.title) ? "comparison" : /\?$/.test(a.title) ? "faq" : "supporting",
    });
  }

  const clusters: TopicCluster[] = [];
  for (const [id, g] of groups) {
    if (!g.members.length) continue;
    const pillars = g.members.filter((m) => m.role === "pillar");
    const pillar = pillars.find((m) => m.kind === "article") ?? pillars[0];
    const supporting = g.members.filter((m) => m !== pillar).map((m) => m.url);
    const gaps: string[] = [];
    if (!pillar && g.members.length >= 3) gaps.push("no pillar article");
    if (!g.sitePages.size) gaps.push("no commercial or tool page anchors this cluster");
    if (g.members.length < 2) gaps.push("only one article");
    clusters.push({
      id,
      name: g.name,
      ...(pillar ? { pillar: pillar.url } : {}),
      supportingArticles: supporting,
      relatedSitePages: [...g.sitePages],
      faqContent: g.members.filter((m) => m.role === "faq").map((m) => m.url),
      comparisonContent: g.members.filter((m) => m.role === "comparison").map((m) => m.url),
      complete: !!pillar && supporting.length >= 2 && g.sitePages.size > 0,
      gaps,
    });
  }
  clusters.sort((a, b) => b.supportingArticles.length - a.supportingArticles.length || a.name.localeCompare(b.name));
  return { clusters, articleCluster, recCluster };
}
