import type { BlogEngineConfig } from "../../config/config.js";
import type { SimilarityIndex } from "../analyzer/similarity.js";
import type { LinkSuggestion, PageType, SearchIntent } from "../types.js";
import { contentTokens, jaccard } from "../util/text.js";

export interface LinkNode {
  key: string;
  url: string;
  title: string;
  kind: "article" | "page";
  pageType: PageType;
  intent?: SearchIntent;
  clusterId?: string;
  category?: string;
  importance: number;
  terms: string[];
}

export interface ScoreInput {
  from: LinkNode;
  to: LinkNode;
  sim: SimilarityIndex;
  alreadyLinked: boolean;
  anchorFound: boolean;
}

/**
 * Relevance of a possible internal link, 0-100. Weighted factors, each reported as a reason:
 *  topic similarity 45, shared entities/terms 10, intent fit 10, same cluster 15, same category 5,
 *  target importance 10, natural anchor in the text 5. An existing link scores 0 (never duplicate links).
 */
export function scoreLink(i: ScoreInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (i.alreadyLinked) return { score: 0, reasons: ["already linked"] };
  if (i.from.key === i.to.key) return { score: 0, reasons: ["same page"] };
  const topic = i.sim.similarity(i.from.key, i.to.key);
  const topicPts = Math.min(45, (topic / 0.5) * 45);
  reasons.push(`topic similarity ${(topic * 100).toFixed(0)}%`);
  const termOverlap = jaccard(i.from.terms, i.to.terms);
  const termPts = Math.min(10, (termOverlap / 0.3) * 10);
  if (termOverlap > 0) reasons.push(`shared terms ${(termOverlap * 100).toFixed(0)}%`);
  const intentPts = intentFit(i.from, i.to);
  if (intentPts >= 7) reasons.push("intent fit");
  const clusterPts = i.from.clusterId && i.from.clusterId === i.to.clusterId ? 15 : 0;
  if (clusterPts) reasons.push("same topical cluster");
  const catPts = i.from.category && i.from.category === i.to.category ? 5 : 0;
  if (catPts) reasons.push("same category");
  const impPts = Math.round(i.to.importance * 10);
  if (i.to.importance >= 0.7) reasons.push(`important target (${i.to.pageType})`);
  const anchorPts = i.anchorFound ? 5 : 0;
  if (anchorPts) reasons.push("natural anchor phrase in the text");
  const score = Math.round(Math.min(100, topicPts + termPts + intentPts + clusterPts + catPts + impPts + anchorPts));
  return { score, reasons };
}

function intentFit(from: LinkNode, to: LinkNode): number {
  // Informational articles naturally lead readers to commercial/tool pages and to deeper guides.
  const commercial = ["product", "service", "tool", "calculator", "category", "landing", "location"].includes(to.pageType);
  if (from.kind === "article" && commercial) return 10;
  if (from.kind === "article" && to.kind === "article") return from.intent === to.intent || to.intent === "informational" ? 8 : 5;
  if (from.kind === "page" && to.kind === "article") return 7;
  return 4;
}

export function bandOf(score: number, t: BlogEngineConfig["linking"]["thresholds"]): LinkSuggestion["band"] {
  if (score >= t.excellent) return "excellent";
  if (score >= t.strong) return "strong";
  if (score >= t.optional) return "optional";
  return "below-threshold";
}

export const termsOf = (text: string): string[] => [...new Set(contentTokens(text))].slice(0, 60);
