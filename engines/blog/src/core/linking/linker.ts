import type { BlogEngineConfig } from "../../config/config.js";
import type { SimilarityIndex } from "../analyzer/similarity.js";
import type { BlogArticle, LinkSuggestion, SitePage } from "../types.js";
import { PROTECTED_PAGE_TYPES } from "../types.js";
import { stableId } from "../util/hash.js";
import { urlKey } from "../util/url.js";
import { findAnchor, insertLink, isGenericAnchor } from "./anchors.js";
import { bandOf, scoreLink, termsOf, type LinkNode } from "./scoring.js";

export interface LinkPlanInput {
  config: BlogEngineConfig;
  sim: SimilarityIndex;
  pages: SitePage[];
  /** Articles that can be linked to or from (published, plus the batch about to be published). */
  articles: BlogArticle[];
  /** Article ids whose content the engine owns and may edit (blog-engine drafts/articles). */
  editable: Set<string>;
  /** Markdown/text of each article, keyed by id. */
  content: Map<string, string>;
  /** Anchors already used site-wide per target (keeps anchor text varied). */
  usedAnchors?: Map<string, Set<string>>;
}

const LISTING_TYPES = new Set(["blog-index", "blog-category", "utility", "legal", "contact", "about", "home", "other"]);

/**
 * Plan internal links Blog->Blog, Blog->Site and Site->Blog. Links are suggestions with scores, bands and reasons.
 * Only suggestions that are strong, have a natural anchor already in the text, and whose source the engine owns
 * are marked for automatic application; everything else waits for review.
 */
export function planLinks(input: LinkPlanInput): LinkSuggestion[] {
  const { config, sim, pages, articles, editable, content } = input;
  const t = config.linking.thresholds;
  const used = input.usedAnchors ?? new Map<string, Set<string>>();

  const articleNodes: (LinkNode & { a: BlogArticle })[] = articles.map((a) => ({
    a,
    key: `art:${urlKey(a.url)}`,
    url: a.url,
    title: a.title,
    kind: "article",
    pageType: "blog-article",
    intent: a.searchIntent,
    ...(a.clusterId ? { clusterId: a.clusterId } : {}),
    ...(a.category ? { category: a.category } : {}),
    importance: a.status === "published" ? 0.45 : 0.4,
    terms: termsOf(`${a.title} ${a.primaryTopic} ${a.tags.join(" ")}`),
  }));
  const articleKeys = new Set(articleNodes.map((n) => urlKey(n.url)));
  const pageNodes: (LinkNode & { p: SitePage })[] = pages
    .filter((p) => p.indexable && !p.isBlogArticle && !LISTING_TYPES.has(p.pageType) && !articleKeys.has(urlKey(p.url)))
    .map((p) => ({ p, key: `page:${urlKey(p.url)}`, url: p.url, title: p.h1 || p.title, kind: "page", pageType: p.pageType, importance: p.importance, terms: termsOf(`${p.title} ${p.h1} ${p.keyTerms.join(" ")}`) }));

  const suggestions: LinkSuggestion[] = [];
  const existingOut = (a: BlogArticle) => new Set(a.internalLinksOut.map((h) => urlKey(h)));

  // Blog -> Blog and Blog -> Site
  for (const from of articleNodes) {
    const text = content.get(from.a.id);
    if (!text) continue;
    const linked = existingOut(from.a);
    const cands: LinkSuggestion[] = [];
    for (const to of [...articleNodes.filter((n) => n.a.id !== from.a.id && (n.a.status === "published" || n.a.status === "approved" || n.a.status === "review" || n.a.status === "draft")), ...pageNodes]) {
      const avoid = used.get(urlKey(to.url)) ?? new Set<string>();
      const match = findAnchor(text, { title: to.title, ...("p" in to ? { h1: (to as { p: SitePage }).p.h1 } : {}), ...("a" in to ? { primaryTopic: (to as { a: BlogArticle }).a.primaryTopic } : {}) }, avoid);
      const { score, reasons } = scoreLink({ from, to, sim, alreadyLinked: linked.has(urlKey(to.url)), anchorFound: !!match });
      if (score < t.optional) continue;
      const anchor = match?.anchor ?? describe(to.title);
      if (isGenericAnchor(anchor)) continue;
      cands.push({
        id: stableId("link", from.url, to.url),
        fromUrl: from.url,
        toUrl: to.url,
        anchor,
        score,
        band: bandOf(score, t),
        direction: to.kind === "article" ? "blog-to-blog" : "blog-to-site",
        reasons,
        ...(match ? { context: match.sentence } : {}),
        status: match && editable.has(from.a.id) && score >= config.linking.autoApplyMin ? "suggested" : "needs-review",
      });
    }
    const budget = Math.max(0, config.linking.maxLinksPerArticle - linked.size);
    for (const s of pickVaried(cands, budget, used)) suggestions.push(s);
  }

  // Site -> Blog: only informational pages; protected (commercial/transactional) copy is never auto-edited.
  for (const from of pageNodes) {
    const p = from.p;
    const linked = new Set(p.internalLinksOut.map((l) => urlKey(l.href)));
    const cands: LinkSuggestion[] = [];
    for (const to of articleNodes.filter((n) => n.a.status === "published" || n.a.status === "approved")) {
      const match = findAnchor(p.excerpt, { title: to.title, primaryTopic: to.a.primaryTopic }, used.get(urlKey(to.url)) ?? new Set());
      const { score, reasons } = scoreLink({ from, to, sim, alreadyLinked: linked.has(urlKey(to.url)), anchorFound: !!match });
      if (score < t.optional) continue;
      const protectedPage = PROTECTED_PAGE_TYPES.includes(p.pageType);
      cands.push({
        id: stableId("link", from.url, to.url),
        fromUrl: from.url,
        toUrl: to.url,
        anchor: match?.anchor ?? describe(to.title),
        score,
        band: bandOf(score, t),
        direction: "site-to-blog",
        reasons: protectedPage ? [...reasons, `${p.pageType} page: suggest only (commercial copy is not edited automatically)`] : reasons,
        ...(match ? { context: match.sentence } : {}),
        status: !protectedPage && match && config.linking.allowSiteToBlogEdits && score >= config.linking.autoApplyMin ? "suggested" : "needs-review",
      });
    }
    for (const s of pickVaried(cands, 3, used)) suggestions.push(s);
  }

  return dropWeakReciprocals(suggestions, t.strong).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Highest scores first, at most one link per target, anchors never reused for the same target. */
function pickVaried(cands: LinkSuggestion[], budget: number, used: Map<string, Set<string>>): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  const targets = new Set<string>();
  const anchorsHere = new Set<string>();
  for (const c of cands.sort((a, b) => b.score - a.score || a.toUrl.localeCompare(b.toUrl))) {
    if (out.length >= budget) break;
    const k = urlKey(c.toUrl);
    const a = c.anchor.toLowerCase();
    if (targets.has(k) || anchorsHere.has(a)) continue;
    targets.add(k);
    anchorsHere.add(a);
    const set = used.get(k) ?? new Set<string>();
    set.add(a);
    used.set(k, set);
    out.push(c);
  }
  return out;
}

/** A->B and B->A are both kept only when both are strong; otherwise the weaker one goes (no circular filler). */
function dropWeakReciprocals(s: LinkSuggestion[], strong: number): LinkSuggestion[] {
  const byPair = new Map(s.map((x) => [`${urlKey(x.fromUrl)}>${urlKey(x.toUrl)}`, x]));
  return s.filter((x) => {
    const back = byPair.get(`${urlKey(x.toUrl)}>${urlKey(x.fromUrl)}`);
    if (!back) return true;
    if (x.score >= strong && back.score >= strong) return true;
    return x.score > back.score || (x.score === back.score && x.id < back.id);
  });
}

function describe(title: string): string {
  const t = title.replace(/\s*[|–—]\s.*$/, "").replace(/[?!.]+$/, "").trim();
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Apply suggestions to Markdown. Only suggestions with a natural anchor in the text are applied. */
export function applyLinksToMarkdown(md: string, suggestions: LinkSuggestion[]): { markdown: string; applied: LinkSuggestion[] } {
  let out = md;
  const applied: LinkSuggestion[] = [];
  for (const s of suggestions) {
    if (!s.context) continue;
    const href = new URL(s.toUrl).pathname;
    const next = insertLink(out, s.anchor, href);
    if (next) {
      out = next;
      applied.push({ ...s, status: "applied" });
    }
  }
  return { markdown: out, applied };
}
