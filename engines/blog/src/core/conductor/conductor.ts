import type { EngineContext } from "../engine/context.js";
import { findGuideSection, type GuideSection } from "../../docs/guide.js";

/**
 * Coarse point in the install-to-publish workflow, derived from existing engine state. There is no stored
 * "phase" field anywhere: every value here is read back out of analysis.json, recommendations.json, the
 * article registry, links.json and state.json, so the conductor can never drift from what the engine
 * actually did.
 */
export const CONDUCTOR_PHASES = [
  "not-initialized",
  "configured",
  "analyzed",
  "recommendations-awaiting-selection",
  "selected-awaiting-generation",
  "drafts-awaiting-review",
  "ready-to-publish",
  "published",
  "index-stale",
  "up-to-date",
] as const;
export type ConductorPhase = (typeof CONDUCTOR_PHASES)[number];

export interface NextAction {
  description: string;
  command: string;
  /** The guide section this step is explained in, when the bundled guide (docs/INSTALL-AND-USE.md) is available. */
  guideSection?: GuideSection;
}

/** Looks up a guide section by keyword; never throws (a missing/broken guide just means no link is attached). */
function guideLink(...keywords: string[]): GuideSection | undefined {
  try {
    return findGuideSection(...keywords);
  } catch {
    return undefined;
  }
}

export interface ConductorActivityEntry {
  at: string;
  summary: string;
}

export interface ConductorStatus {
  phase: ConductorPhase;
  summary: string;
  /** What the engine has already done, oldest first; a plain checklist, not a log. */
  doneSoFar: string[];
  nextAction: NextAction;
  /** Secondary follow-ups worth knowing about but not blocking (orphans, broken links, stale index, etc). */
  alsoConsider: NextAction[];
  /** Most recent persisted activity, newest first. Read from the engine's own event log; nothing new is stored. */
  recentActivity: ConductorActivityEntry[];
}

const EVENT_SUMMARY: Record<string, (d: Record<string, unknown>) => string> = {
  "analysis.completed": () => "Website analyzed",
  "recommendations.updated": () => "Recommendations updated",
  "article.created": (d) => `Article created: ${d.url ?? ""}`,
  "article.updated": (d) => `Article updated: ${d.url ?? ""}`,
  "article.published": (d) => `Article published: ${d.url ?? ""}`,
  "article.unpublished": (d) => `Article unpublished: ${d.url ?? ""}`,
  "article.archived": (d) => `Article archived: ${d.url ?? ""}`,
  "article.deleted": (d) => `Article removed: ${d.url ?? ""}`,
  "article.discovered": (d) => `Existing article discovered: ${d.url ?? ""}`,
  "links.updated": () => "Internal links updated",
  "index.rebuilt": () => "Blog SEO Index rebuilt",
};

function summarizeEvent(e: { name: string; data?: unknown }): string {
  const f = EVENT_SUMMARY[e.name];
  return f ? f((e.data as Record<string, unknown>) ?? {}) : e.name;
}

/**
 * Reports what has been done so far and the single next recommended action, by inspecting the engine's
 * existing persisted state. Pure read: it never generates, publishes, analyzes or otherwise changes anything.
 */
export async function conductorStatus(ctx: EngineContext): Promise<ConductorStatus> {
  const [analysis, recommendations, state, links] = await Promise.all([ctx.readAnalysis(), ctx.readRecommendations(), ctx.readState(), ctx.readLinks()]);
  const articles = ctx.registry.list();
  const engineArticles = articles.filter((a) => a.source === "blog-engine");

  const doneSoFar: string[] = [];
  if (analysis) doneSoFar.push(`Website analyzed (${state.lastAnalysisAt ?? analysis.analyzedAt}).`);
  if (recommendations.length) doneSoFar.push(`${recommendations.length} content recommendation(s) identified.`);
  const selected = recommendations.filter((r) => r.status === "selected" || r.status === "created");
  if (selected.length) doneSoFar.push(`${selected.length} recommendation(s) selected.`);
  const generated = engineArticles.filter((a) => a.status !== "recommended" && a.status !== "selected");
  if (generated.length) doneSoFar.push(`${generated.length} article(s) generated.`);
  const published = engineArticles.filter((a) => a.status === "published");
  if (published.length) doneSoFar.push(`${published.length} article(s) published.`);
  if (state.lastRebuildAt) doneSoFar.push(`Blog SEO Index last rebuilt ${state.lastRebuildAt}.`);

  const alsoConsider: NextAction[] = [];
  if (links.orphans.length) alsoConsider.push({ description: `${links.orphans.length} published article(s) have no inbound link.`, command: "bwe-blog links" });
  if (links.broken.length) alsoConsider.push({ description: `${links.broken.length} broken internal link(s) were found.`, command: "bwe-blog links" });
  const needingReview = engineArticles.filter((a) => a.refreshRecommended);
  if (needingReview.length) alsoConsider.push({ description: `${needingReview.length} published article(s) are flagged for review.`, command: "bwe-blog reanalyze" });

  const { phase, summary, nextAction } = derivePhase({ analysis, recommendations, selected, generated, published, engineArticles, state });

  const events = await readRecentEvents(ctx);
  const recentActivity = events
    .slice(-20)
    .reverse()
    .map((e) => ({ at: e.at, summary: summarizeEvent(e) }));

  return { phase, summary, doneSoFar, nextAction, alsoConsider, recentActivity };
}

function derivePhase(i: {
  analysis: unknown;
  recommendations: { status: string }[];
  selected: unknown[];
  generated: { status: string }[];
  published: unknown[];
  engineArticles: { status: string }[];
  state: { lastAnalysisAt?: string; lastRebuildAt?: string };
}): { phase: ConductorPhase; summary: string; nextAction: NextAction } {
  if (!i.analysis) {
    return {
      phase: "not-initialized",
      summary: "The engine has not analyzed this website yet.",
      nextAction: { description: "Run the first analysis to inventory the site and find content gaps.", command: "bwe-blog analyze", guideSection: guideLink("installing", "basic workflow") },
    };
  }

  const openRecommendations = i.recommendations.filter((r) => r.status === "recommended");
  const awaitingReview = i.engineArticles.filter((a) => a.status === "draft" || a.status === "review");
  const awaitingPublish = i.engineArticles.filter((a) => a.status === "approved");

  if (!i.recommendations.length) {
    return {
      phase: "analyzed",
      summary: "The site has been analyzed but no content recommendations exist yet.",
      nextAction: { description: "Re-run analysis to generate content recommendations.", command: "bwe-blog reanalyze", guideSection: guideLink("re-running analysis") },
    };
  }

  if (!i.selected.length && openRecommendations.length) {
    return {
      phase: "recommendations-awaiting-selection",
      summary: `${openRecommendations.length} recommendation(s) are waiting to be reviewed and selected.`,
      nextAction: { description: "Review recommendations and select the ones to write.", command: "bwe-blog recommendations", guideSection: guideLink("basic workflow") },
    };
  }

  if (i.selected.length && !i.generated.length) {
    return {
      phase: "selected-awaiting-generation",
      summary: `${i.selected.length} recommendation(s) are selected but not yet generated.`,
      nextAction: { description: "Generate the selected recommendations.", command: "bwe-blog generate", guideSection: guideLink("basic workflow") },
    };
  }

  if (awaitingReview.length) {
    return {
      phase: "drafts-awaiting-review",
      summary: `${awaitingReview.length} draft article(s) are awaiting human review.`,
      nextAction: { description: "Review and approve the drafts in the admin dashboard, then publish them.", command: "bwe-blog admin", guideSection: guideLink("admin dashboard") },
    };
  }

  if (awaitingPublish.length) {
    return {
      phase: "ready-to-publish",
      summary: `${awaitingPublish.length} article(s) are approved and ready to publish.`,
      nextAction: { description: "Publish the approved article(s).", command: "bwe-blog publish <articleId>", guideSection: guideLink("basic workflow") },
    };
  }

  if (openRecommendations.length) {
    return {
      phase: "recommendations-awaiting-selection",
      summary: `${openRecommendations.length} more recommendation(s) are waiting to be reviewed and selected.`,
      nextAction: { description: "Review the remaining recommendations and select the ones to write.", command: "bwe-blog recommendations", guideSection: guideLink("basic workflow") },
    };
  }

  const indexStale = !i.state.lastRebuildAt || (i.state.lastAnalysisAt !== undefined && i.state.lastRebuildAt < i.state.lastAnalysisAt);
  if (i.published.length && indexStale) {
    return {
      phase: "index-stale",
      summary: "Articles are published but the Blog SEO Index has not been rebuilt since the last change.",
      nextAction: { description: "Rebuild the Blog SEO Index.", command: "bwe-blog rebuild-index", guideSection: guideLink("basic workflow") },
    };
  }

  return {
    phase: "up-to-date",
    summary: "Everything the engine knows about has been generated, reviewed and published.",
    nextAction: { description: "Nothing is pending. Re-analyze periodically to find new content gaps.", command: "bwe-blog reanalyze", guideSection: guideLink("re-running analysis") },
  };
}

async function readRecentEvents(ctx: EngineContext): Promise<{ at: string; name: string; data?: unknown }[]> {
  return ctx.store.readLines<{ at: string; name: string; data?: unknown }>("events.jsonl");
}
