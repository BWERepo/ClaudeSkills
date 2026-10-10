import type { BlogEngineConfig } from "../../config/config.js";
import type { SimilarityIndex } from "../analyzer/similarity.js";
import { inferIntent } from "../inventory/classify.js";
import type { BlogArticle, ContentGap, Priority, Recommendation, RecommendedAction, SitePage, SiteProfile } from "../types.js";
import { stableId } from "../util/hash.js";
import { slugify, uniqueSlug } from "../util/slug.js";
import { intentFacets, subjectTokens, titleCase } from "../util/text.js";
import { isoNow, type Clock } from "../util/time.js";
import { joinRoute, urlKey } from "../util/url.js";
import { candidatesForGap, type Candidate } from "./candidates.js";
import { detectCannibalization } from "./cannibalization.js";

export interface IdeaInput {
  title: string;
  primaryTopic: string;
  reason: string;
  supportsPages: string[];
  source: string;
}

export interface RecommendInput {
  pages: SitePage[];
  articles: BlogArticle[];
  profile: SiteProfile;
  gaps: ContentGap[];
  sim: SimilarityIndex;
  config: BlogEngineConfig;
  clock: Clock;
  previous: Recommendation[];
  /** Extra ideas (e.g. from an AI provider). Each must tie to a real site page or it is discarded. */
  ideas?: IdeaInput[];
}

export interface RecommendOutput {
  recommendations: Recommendation[];
  obsolete: Recommendation[];
  discarded: { title: string; why: string }[];
}

const MIN_SCORE = 0.3;
const MAX_PER_PAGE = 3;
const MAX_CONSOLIDATE = 5;

/**
 * Up to `maxRecommendations` (<= 50) article recommendations. 50 is a ceiling, not a target: ideas below the
 * quality floor, duplicates of other ideas, and slight keyword variations are dropped, not padded.
 */
export function recommend(input: RecommendInput): RecommendOutput {
  const { pages, articles, gaps, sim, config, clock, profile } = input;
  const now = isoNow(clock);
  const pageByKey = new Map(pages.map((p) => [urlKey(p.url), p]));
  const discarded: RecommendOutput["discarded"] = [];

  let candidates: Candidate[] = gaps.flatMap((g) => candidatesForGap(g, pageByKey));
  for (const idea of input.ideas ?? []) {
    const supports = idea.supportsPages.filter((u) => pageByKey.has(urlKey(u)));
    if (!supports.length) {
      discarded.push({ title: idea.title, why: "not tied to any page on the site" });
      continue;
    }
    candidates.push({
      key: `idea:${slugify(idea.title)}`,
      gap: { id: stableId("gap", "idea", idea.title), topic: idea.primaryTopic, kind: "thin-cluster", supportsPages: supports, evidence: idea.reason, weight: 0.5 },
      title: idea.title,
      primaryTopic: idea.primaryTopic.toLowerCase(),
      contentType: "guide",
      clusterHint: supports[0]!,
      angle: idea.reason,
      weight: 0.5,
      source: idea.source,
    });
  }

  // Score: gap weight scaled by the importance of the pages it supports.
  const scored = candidates
    .map((c) => {
      const imp = Math.max(0, ...c.gap.supportsPages.map((u) => pageByKey.get(urlKey(u))?.importance ?? 0.3));
      return { c, score: c.weight * (0.7 + 0.3 * imp) + (c.gap.kind === "unanswered-question" ? 0.05 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.c.key.localeCompare(b.c.key));

  const accepted: Recommendation[] = [];
  const perPage = new Map<string, number>();
  let consolidations = 0;
  const takenSlugs = new Set<string>(articles.map((a) => a.slug));
  const prevById = new Map(input.previous.map((r) => [r.id, r]));
  const engineArticlesByRec = new Map(articles.filter((a) => a.recommendationId).map((a) => [a.recommendationId!, a]));

  for (const { c, score: base } of scored) {
    if (accepted.length >= config.maxRecommendations) break;
    const id = stableId("rec", c.key);
    const prev = prevById.get(id);
    // Respect the administrator's edits on regeneration.
    const title = prev?.editedBy ? prev.title : c.title;
    const findings = detectCannibalization({ title, topicText: `${c.primaryTopic} ${c.angle}`, supports: c.gap.supportsPages }, pages, articles.filter((a) => a.recommendationId !== id), accepted, sim);
    const dup = findings.find((f) => f.decision === "do-not-create");
    if (dup) {
      discarded.push({ title, why: `same intent as "${dup.title}"` });
      continue;
    }
    const expand = findings.find((f) => f.decision === "expand-existing");
    const consolidate = findings.find((f) => f.decision === "consolidate");
    let action: RecommendedAction = "Create";
    let score = base;
    if (expand || consolidate) {
      if (consolidations >= MAX_CONSOLIDATE) {
        discarded.push({ title, why: `overlaps "${(expand ?? consolidate)!.title}"` });
        continue;
      }
      consolidations++;
      action = "Consolidate With Existing Content";
      score -= 0.25;
    } else if (findings.some((f) => f.decision === "differentiate" && f.similarity >= 0.45)) {
      action = "Consider";
      score -= 0.1;
    }
    if (score < MIN_SCORE && !prev?.editedBy) {
      discarded.push({ title, why: "below the quality threshold" });
      continue;
    }
    const pageKey = urlKey(c.gap.supportsPages[0] ?? c.primaryTopic);
    if ((perPage.get(pageKey) ?? 0) >= MAX_PER_PAGE) {
      discarded.push({ title, why: "enough ideas already support this page" });
      continue;
    }
    perPage.set(pageKey, (perPage.get(pageKey) ?? 0) + 1);

    const slug = prev?.proposedSlug ?? uniqueSlug(slugify(title, { dropStopWords: true, maxLength: 70 }), takenSlugs);
    takenSlugs.add(slug);
    const intent = inferIntent(title);
    const linkOps = linkOpportunities(`${title} ${c.angle}`, pages, articles, sim, c.gap.supportsPages);
    const related = articles
      .filter((a) => a.status === "published" && sim.similarityToText(`art:${urlKey(a.url)}`, `${title} ${c.primaryTopic}`) >= 0.18)
      .slice(0, 5)
      .map((a) => a.url);
    const priority = priorityOf(score);
    const created = engineArticlesByRec.has(id);
    const rec: Recommendation = {
      id,
      title,
      proposedSlug: slug,
      primaryTopic: c.primaryTopic,
      primarySearchIntent: intent,
      contentType: c.contentType,
      targetAudience: profile.targetAudience.startsWith("Not stated") ? `People researching ${c.primaryTopic}` : profile.targetAudience,
      suggestedCategory: prev?.editedBy ? prev.suggestedCategory : suggestCategory(c, articles, pageByKey, profile.name),
      suggestedTags: prev?.editedBy ? prev.suggestedTags : suggestTags(title, c.primaryTopic),
      primaryPagesSupported: c.gap.supportsPages,
      reason: `${c.gap.evidence} ${c.angle}`.trim(),
      contentGap: gapLabel(c.gap.kind),
      internalLinkOpportunities: linkOps,
      relatedExistingArticles: related,
      potentialCannibalization: findings,
      priority,
      opportunitySource: c.source,
      recommendedAction: action,
      searchVolume: "Unknown",
      keywordDifficulty: "Unknown",
      ...(c.clusterRole ? { clusterRole: c.clusterRole } : { clusterRole: "supporting" as const }),
      status: created ? "created" : prev && ["selected", "rejected", "created"].includes(prev.status) ? prev.status : "recommended",
      score: Math.round(score * 100) / 100,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      ...(prev?.notes ? { notes: prev.notes } : {}),
      ...(prev?.editedBy ? { editedBy: prev.editedBy } : {}),
    };
    accepted.push(rec);
  }

  // Previous open recommendations that no longer come out of the analysis are obsolete (kept for the record).
  const keep = new Set(accepted.map((r) => r.id));
  const obsolete = input.previous
    .filter((r) => !keep.has(r.id) && (r.status === "recommended" || r.status === "obsolete"))
    .map((r) => ({ ...r, status: "obsolete" as const, updatedAt: now }));
  // Selected/created/rejected decisions are the administrator's and are never dropped.
  for (const r of input.previous) {
    if (!keep.has(r.id) && ["selected", "created", "rejected"].includes(r.status)) accepted.push(r);
  }

  return { recommendations: accepted, obsolete, discarded };
}

export function plannedUrl(config: BlogEngineConfig, slug: string): string {
  return new URL(joinRoute(config.blogPath, slug), `${config.siteUrl}/`).href;
}

function priorityOf(score: number): Priority {
  if (score >= 0.8) return "Critical";
  if (score >= 0.65) return "High";
  if (score >= 0.45) return "Medium";
  return "Low";
}

function gapLabel(kind: ContentGap["kind"]): string {
  return {
    "unsupported-offering": "Offering has no supporting educational content",
    "unanswered-question": "Question raised on the site is not answered in depth",
    "thin-cluster": "Topic is covered thinly relative to how often the site mentions it",
    "missing-comparison": "Related offerings are never compared",
    "missing-how-to": "Tool has no usage or interpretation guide",
    "missing-explainer": "Core concept is never explained",
    "missing-pillar": "Cluster has supporting articles but no pillar",
  }[kind];
}

function linkOpportunities(text: string, pages: SitePage[], articles: BlogArticle[], sim: SimilarityIndex, supports: string[]): string[] {
  const scored: { url: string; s: number }[] = supports.map((u) => ({ url: u, s: 1 }));
  for (const p of pages) {
    if (!p.indexable || ["legal", "utility", "blog-category"].includes(p.pageType) || p.isBlogArticle) continue;
    scored.push({ url: p.url, s: sim.similarityToText(`page:${urlKey(p.url)}`, text) * (0.6 + p.importance * 0.4) });
  }
  for (const a of articles) {
    if (a.status !== "published") continue;
    scored.push({ url: a.url, s: sim.similarityToText(`art:${urlKey(a.url)}`, text) * 0.9 });
  }
  const seen = new Set<string>();
  return scored
    .filter((x) => x.s >= 0.12)
    .sort((a, b) => b.s - a.s)
    .filter((x) => !seen.has(urlKey(x.url)) && seen.add(urlKey(x.url)))
    .slice(0, 6)
    .map((x) => x.url);
}

function suggestCategory(c: Candidate, articles: BlogArticle[], pageByKey: Map<string, SitePage>, siteName: string): string {
  const existingCats = [...new Set(articles.map((a) => a.category).filter(Boolean))];
  const topicToks = subjectTokens(`${c.primaryTopic} ${c.title}`);
  let best: { cat: string; overlap: number } | undefined;
  for (const cat of existingCats) {
    const overlap = subjectTokens(cat).filter((t) => topicToks.includes(t)).length;
    if (overlap && (!best || overlap > best.overlap)) best = { cat, overlap };
  }
  if (best) return best.cat;
  const page = c.gap.supportsPages[0] ? pageByKey.get(urlKey(c.gap.supportsPages[0])) : undefined;
  const base = page && !page.isBlogArticle ? page.h1 || page.title : c.primaryTopic;
  const cleaned = base.replace(new RegExp(siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").replace(/[|:–—-].*$/, "").trim();
  return titleCase(cleaned.split(/\s+/).slice(0, 3).join(" ") || c.primaryTopic);
}

function suggestTags(title: string, topic: string): string[] {
  const facets = intentFacets(title).map((f) => ({ cost: "cost", howto: "how-to", compare: "comparison", best: "buying guide", what: "explainer", why: "benefits", signs: "warning signs", fix: "troubleshooting", checklist: "tips", time: "timeline" })[f] ?? f);
  return [...new Set([topic.toLowerCase(), ...facets])].filter(Boolean).slice(0, 5);
}
