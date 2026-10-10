import type { SimilarityIndex } from "../analyzer/similarity.js";
import { offeringName } from "../analyzer/profile.js";
import type { BlogArticle, ContentGap, SitePage, SiteProfile } from "../types.js";
import { stableId } from "../util/hash.js";
import { isQuestion, jaccard, subjectTokens } from "../util/text.js";
import { urlKey } from "../util/url.js";

const SUPPORT_THRESHOLD = 0.22;
const COVERED_THRESHOLD = 0.42;

/**
 * Content gaps, found by comparing what the site offers and is asked about with what its articles cover.
 * Every gap carries the evidence (page, question, or cluster) that produced it.
 */
export function findContentGaps(pages: SitePage[], articles: BlogArticle[], profile: SiteProfile, sim: SimilarityIndex): ContentGap[] {
  const gaps: ContentGap[] = [];
  const live = articles.filter((a) => a.status !== "rejected" && a.status !== "archived");
  const articleKeys = live.map((a) => `art:${urlKey(a.url)}`);
  const pageKey = (p: SitePage) => `page:${urlKey(p.url)}`;

  // 1. Offerings (products, services, tools) with no supporting article.
  for (const p of pages.filter((x) => ["product", "service", "tool", "calculator", "category"].includes(x.pageType) && x.indexable)) {
    const support = articleKeys.filter((k) => sim.similarity(pageKey(p), k) >= SUPPORT_THRESHOLD);
    const linkingIn = live.filter((a) => a.internalLinksOut.some((h) => urlKey(h) === urlKey(p.url)));
    const name = offeringName(p, profile.name);
    if (!name) continue;
    if (support.length + linkingIn.length < 2) {
      gaps.push({
        id: stableId("gap", "offering", p.url),
        topic: name,
        kind: "unsupported-offering",
        supportsPages: [p.url],
        evidence: `${p.pageType} page "${name}" has ${support.length} topically related article(s) and ${linkingIn.length} article link(s) pointing to it.`,
        weight: 0.6 + p.importance * 0.4 - (support.length + linkingIn.length) * 0.15,
      });
    }
    if (p.pageType === "tool" || p.pageType === "calculator") {
      const explained = articleKeys.some((k) => sim.similarity(pageKey(p), k) >= COVERED_THRESHOLD);
      if (!explained)
        gaps.push({
          id: stableId("gap", "howto", p.url),
          topic: name,
          kind: "missing-how-to",
          supportsPages: [p.url],
          evidence: `Tool page "${name}" has no article explaining how to use it or interpret its results.`,
          weight: 0.7 + p.importance * 0.3,
        });
    }
  }

  // 2. Questions the site itself raises (FAQ blocks, question headings) with no article answering them in depth.
  const seenQ = new Set<string>();
  for (const p of pages.filter((x) => x.indexable && !x.isBlogArticle)) {
    for (const q of p.faqQuestions) {
      const norm = q.toLowerCase().replace(/\s+/g, " ").trim();
      if (!isQuestion(q) || seenQ.has(norm) || q.split(/\s+/).length < 4) continue;
      seenQ.add(norm);
      const covered = live.some((a) => jaccard(subjectTokens(a.title), subjectTokens(q)) >= 0.5 || sim.similarityToText(`art:${urlKey(a.url)}`, q) >= 0.45);
      if (covered) continue;
      gaps.push({
        id: stableId("gap", "question", norm),
        topic: q.trim(),
        kind: "unanswered-question",
        supportsPages: [p.url],
        evidence: `The site asks "${q.trim()}" on ${p.path} but no article answers it in depth.`,
        weight: 0.55 + p.importance * 0.3,
      });
    }
  }

  // 3. Comparisons between related offerings (same family, no comparison content).
  const offers = profile.offerings.filter((o) => o.kind !== "tool");
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i]!;
      const b = offers[j]!;
      const sa = subjectTokens(a.name);
      const sb = subjectTokens(b.name);
      const shared = sa.filter((t) => sb.includes(t));
      if (!shared.length || jaccard(sa, sb) > 0.75) continue;
      const exists = pages.some((p) => p.pageType === "comparison" && [a.name, b.name].every((n) => `${p.title} ${p.h1}`.toLowerCase().includes(n.toLowerCase().split(" ")[0]!))) ||
        live.some((a2) => /\bvs\.?\b|versus|difference/i.test(a2.title) && subjectTokens(a2.title).filter((t) => sa.includes(t) || sb.includes(t)).length >= 2);
      if (exists) continue;
      gaps.push({
        id: stableId("gap", "compare", a.url, b.url),
        topic: `${a.name} vs ${b.name}`,
        kind: "missing-comparison",
        supportsPages: [a.url, b.url],
        evidence: `"${a.name}" and "${b.name}" are related offerings (shared: ${shared.join(", ")}) with no comparison content.`,
        weight: 0.6,
      });
    }
  }

  // 4. Topics the site talks about a lot with thin article coverage.
  for (const t of profile.topics.slice(0, 12)) {
    if (t.pages.length < 3) continue;
    const covering = live.filter((a) => `${a.title} ${a.primaryTopic}`.toLowerCase().includes(t.term)).length;
    if (covering >= 3) {
      const hasPillar = live.some((a) => `${a.title}`.toLowerCase().includes(t.term) && /\b(guide|explained|everything|complete)\b/i.test(a.title));
      if (!hasPillar)
        gaps.push({
          id: stableId("gap", "pillar", t.term),
          topic: t.term,
          kind: "missing-pillar",
          supportsPages: t.pages.filter((u) => !live.some((a) => urlKey(a.url) === urlKey(u))).slice(0, 5),
          evidence: `${covering} articles cover "${t.term}" but none brings the topic together as a guide.`,
          weight: 0.5,
        });
      continue;
    }
    if (covering <= 1) {
      gaps.push({
        id: stableId("gap", "thin", t.term),
        topic: t.term,
        kind: "thin-cluster",
        supportsPages: t.pages.filter((u) => !live.some((a) => urlKey(a.url) === urlKey(u))).slice(0, 5),
        evidence: `"${t.term}" appears on ${t.pages.length} site pages but only ${covering} article(s).`,
        weight: 0.35 + Math.min(0.25, t.pages.length * 0.03),
      });
    }
  }

  return gaps.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}
