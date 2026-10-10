import { sameSearchIntent, type SimilarityIndex } from "../analyzer/similarity.js";
import type { BlogArticle, CannibalizationFinding, Recommendation, SitePage } from "../types.js";
import { urlKey } from "../util/url.js";

export interface CannibalizationInput {
  title: string;
  topicText: string;
  /** Pages this article is meant to support; similarity to them is expected and not a conflict unless intent matches. */
  supports: string[];
}

/**
 * Compares a proposed article with existing articles, site pages and already-accepted recommendations.
 * Returns findings sorted by severity. Similarity uses the site's own vocabulary; intent uses facet matching.
 */
export function detectCannibalization(
  c: CannibalizationInput,
  pages: SitePage[],
  articles: BlogArticle[],
  accepted: Recommendation[],
  sim: SimilarityIndex,
): CannibalizationFinding[] {
  const out: CannibalizationFinding[] = [];
  const text = `${c.title}. ${c.topicText}`;
  const supports = new Set(c.supports.map((u) => urlKey(u)));

  for (const a of articles) {
    if (a.status === "rejected" || a.status === "archived") continue;
    const intent = sameSearchIntent(c.title, a.title);
    const s = Math.max(sim.similarityToText(`art:${urlKey(a.url)}`, text), intent.subjectOverlap * 0.8);
    if (intent.same) {
      out.push({ url: a.url, title: a.title, kind: "existing-article", similarity: round(s), sameIntent: true, decision: "expand-existing", note: `"${a.title}" already targets this question; improve that article instead of creating a competing one.` });
    } else if (s >= 0.55) {
      out.push({ url: a.url, title: a.title, kind: "existing-article", similarity: round(s), sameIntent: false, decision: "consolidate", note: `Heavy overlap with "${a.title}". Consolidate, or create only with a clearly different angle.` });
    } else if (s >= 0.38) {
      out.push({ url: a.url, title: a.title, kind: "existing-article", similarity: round(s), sameIntent: false, decision: "differentiate", note: `Related to "${a.title}". Keep a distinct angle and link the two articles.` });
    }
  }

  for (const p of pages) {
    if (p.isBlogArticle || !p.indexable || ["legal", "utility", "contact", "home", "blog-index", "blog-category"].includes(p.pageType)) continue;
    const pageTitle = p.h1 || p.title;
    const intent = sameSearchIntent(c.title, pageTitle);
    const s = sim.similarityToText(`page:${urlKey(p.url)}`, text);
    const supported = supports.has(urlKey(p.url));
    if (intent.same) {
      out.push({
        url: p.url,
        title: pageTitle,
        kind: "site-page",
        similarity: round(Math.max(s, intent.subjectOverlap)),
        sameIntent: true,
        decision: ["guide", "informational", "faq", "comparison", "resource"].includes(p.pageType) ? "expand-existing" : "differentiate",
        note: `The ${p.pageType} page "${pageTitle}" already answers this intent. ${["guide", "informational", "faq", "comparison", "resource"].includes(p.pageType) ? "Improve that page instead." : "An article must add depth the page does not, and link to it."}`,
      });
    } else if (!supported && s >= 0.6) {
      out.push({ url: p.url, title: pageTitle, kind: "site-page", similarity: round(s), sameIntent: false, decision: "supporting-subtopic", note: `Close to the ${p.pageType} page "${pageTitle}". Write it as supporting content that links to that page.` });
    }
  }

  for (const r of accepted) {
    const intent = sameSearchIntent(c.title, r.title);
    if (intent.same) {
      out.push({ url: r.proposedSlug, title: r.title, kind: "recommendation", similarity: round(intent.subjectOverlap), sameIntent: true, decision: "do-not-create", note: `Same intent as the recommendation "${r.title}".` });
    }
  }

  const rank: Record<CannibalizationFinding["decision"], number> = { "do-not-create": 0, "expand-existing": 1, consolidate: 2, differentiate: 3, "supporting-subtopic": 4 };
  return out.sort((a, b) => rank[a.decision] - rank[b.decision] || b.similarity - a.similarity).slice(0, 6);
}

const round = (n: number) => Math.round(n * 100) / 100;
