// BWESEO improvement queue — source adapters. Pure functions, zero dependencies, Worker-safe.
//
// Each adapter reads the records an existing module already keeps and returns a batch for improvement-queue.reconcile():
//   { module, check, status: "complete"|"partial"|"failed", observedAt, observations[], sourceOwnsWorkflow?, coveredRefs? }
// Nothing here reads a file, calls a service or edits the module's own records.
import { makeEvidence } from "./evidence.mjs";

const SEV = { critical: "critical", high: "high", medium: "medium", low: "low" };
const AREA_CATEGORY = { technical: "technical", schema: "technical", "internal-links": "technical", environment: "technical", local: "gbp", content: "content", legal: "other", measurement: "measurement" };
const ev = (source, observedAt, now, extra = {}) => makeEvidence({ source, observedAt, coverage: "complete", basis: "reported", now, ...extra });

// Inventory `issues` (the existing audit workflow). Their status is a person's decision in the inventory and is mirrored as-is.
// GBP entries ("gbp-…") are skipped: the richer GBP recommendation record is read directly by fromGbpRecommendations.
export function fromInventoryIssues(inventory, { observedAt, now = Date.now() } = {}) {
  const issues = (inventory?.issues ?? []).filter((i) => !String(i.id).startsWith("gbp-"));
  return {
    module: "inventory", check: "issues", status: "complete", observedAt, sourceOwnsWorkflow: true,
    observations: issues.map((i) => ({
      category: AREA_CATEGORY[i.area] ?? "other", ref: i.id, title: i.title, severity: SEV[i.severity], blocking: i.blocking === true,
      target: { kind: (i.pages ?? []).length === 1 ? "page" : "site", ref: (i.pages ?? []).length === 1 ? i.pages[0] : i.id },
      evidence: [ev(`inventory issue ${i.id}`, i.foundOn ?? observedAt, now, { detail: i.notes ?? null })],
      recommendation: { action: i.title, reason: i.notes ?? null }, needsApproval: i.needsApproval !== false,
      sourceStatus: i.status === "verified" ? "resolved" : i.status === "wont-fix" ? "wont-fix" : i.status,
      verification: i.status === "fixed" ? ["Confirm the fix on the production site, then record verifiedOn in the inventory."] : [],
      missingInformation: [], impact: "unknown",
    })),
  };
}

// Google Business Profile recommendations (seo/data/local-gbp/recommendations.json). Their workflow states map onto queue statuses.
const GBP_STATUS = { new: "open", review: "open", approved: "approved", implementing: "in-progress", verification: "fixed", completed: "resolved", rejected: "wont-fix", deferred: "deferred", failed: "open" };
const GBP_PRIORITY = { high: "high", medium: "medium", low: "low" };
export function fromGbpRecommendations(recs, { observedAt, now = Date.now() } = {}) {
  return {
    module: "gbp", check: "recommendations", status: "complete", observedAt, sourceOwnsWorkflow: true,
    observations: (recs ?? []).map((r) => ({
      category: "gbp", ref: r.id, title: `GBP: ${r.reason}`.slice(0, 200), severity: GBP_PRIORITY[r.priority] ?? "unknown", target: { kind: "entity", ref: r.target ?? "business profile" },
      evidence: [ev(`gbp recommendation ${r.id}`, r.foundOn ?? observedAt, now, { detail: (r.evidence ?? []).join("; ") || null })],
      recommendation: { action: r.proposed != null ? `Change ${r.type}` : r.type, reason: r.reason }, needsApproval: r.publicChange !== false, sourceStatus: GBP_STATUS[r.state] ?? "open",
      missingInformation: r.userInputNeeded ? [`input needed from the owner: ${r.userInputNeeded}`] : [], impact: "unknown",
      verification: ["Check the live Google Business Profile shows the change (the engine does not read the live profile)."],
    })),
  };
}

// Keyword analyses (getKeywordPerformance().analyses). Search Console average position is data about impressions, not a live ranking.
const KW_SEVERITY = { "FIX NOW": "high", "HIGH OPPORTUNITY": "medium", IMPROVE: "medium" };
export function fromKeywordAnalyses(analyses, { observedAt, snapshot = null, now = Date.now(), siteHasData = true } = {}) {
  const complete = !!snapshot && siteHasData;
  return {
    module: "keywords", check: "performance", status: complete ? "complete" : "failed", observedAt: snapshot?.fetchedAt ?? observedAt,
    observations: complete ? (analyses ?? []).filter((a) => KW_SEVERITY[a.status?.priority]).map((a) => ({
      category: "keyword", ref: `${a.keyword}|${a.target?.path ?? "no-target"}`, title: `${a.status.priority}: "${a.keyword}" - ${a.status.headline}`, severity: KW_SEVERITY[a.status.priority],
      target: { kind: "keyword", ref: a.target?.path ?? a.keyword }, impact: a.metrics?.impressions >= 100 ? "high" : a.metrics?.impressions >= 10 ? "medium" : a.metrics?.impressions >= 0 ? "low" : "unknown",
      evidence: [makeEvidence({ source: "Search Console export (stored)", observedAt: snapshot.fetchedAt, coverage: snapshot.truncated ? "partial" : "complete", basis: "observed", now, detail: `range ${JSON.stringify(snapshot.range ?? null)}; average position is not a live ranking` })],
      recommendation: { action: (a.status.actions ?? [])[0] ?? a.status.headline, reason: a.status.why ?? null }, needsApproval: true,
      verification: ["Re-pull Search Console data after the change has had time to be crawled and compare like-for-like periods; do not treat a movement as proof the change caused it."],
      missingInformation: a.indexing?.confidence === "CONFIRMED" ? [] : ["Google indexing status is not confirmed for the target page"],
    })) : [],
    coveredRefs: undefined,
  };
}

// Landing-page work: opportunities that still need a person (proposed/draft/approved), from seo/data/landing/state.json.
const LP_STATUS = { proposed: "open", draft: "in-progress", approved: "approved", published: "resolved" };
export function fromLandingState(state, { observedAt, now = Date.now() } = {}) {
  return {
    module: "landing", check: "opportunities", status: "complete", observedAt, sourceOwnsWorkflow: true,
    observations: (state?.opportunities ?? []).map((o) => ({
      category: "landing-page", ref: o.id, title: `${o.action === "new-page" ? "New page" : "Improve page"}: "${o.primary}" (${o.target})`, severity: o.score?.priority === "P1" ? "high" : o.score?.priority === "P2" ? "medium" : o.score?.priority === "P3" ? "low" : "unknown",
      target: { kind: "page", ref: o.target }, impact: "unknown",
      evidence: [ev(`landing plan ${o.id}`, observedAt, now, { detail: o.reason ?? null })],
      recommendation: { action: o.action === "new-page" ? "Create the page after the quality gate and your approval" : "Extend the existing page after the quality gate and your approval", reason: o.reason ?? null },
      needsApproval: true, sourceStatus: LP_STATUS[o.status] ?? "open",
      missingInformation: o.performance === "unavailable" ? ["no sourced performance data for this opportunity"] : [],
      verification: ["Run the landing quality gate on the draft", "After publication, confirm the live page matches the approved content."],
    })),
  };
}

// Regression findings arrive through the shared contract, produced by whichever regression detector the project uses:
//   { run:{ status, observedAt, coveredUrls? }, findings:[{ id?, type, severity, url, firstObserved, lastObserved, previous, current,
//     impact, action, verification[], limitations[] }] }
// A finding is carried into the queue; a partial or failed run never resolves anything.
export function fromRegressionReport(report, { now = Date.now() } = {}) {
  const run = report?.run ?? {};
  const status = ["complete", "partial", "failed"].includes(run.status) ? run.status : "failed";
  return {
    module: "regression", check: "compare", status, observedAt: run.observedAt, coveredRefs: run.coveredUrls,
    observations: (report?.findings ?? []).map((f) => ({
      category: "regression", ref: `${f.type}|${f.url ?? f.id}`, id: undefined, title: `${f.type}: ${f.url}`, severity: SEV[f.severity], blocking: f.siteWide === true,
      target: { kind: f.url === "/" || f.siteWide ? "site" : "page", ref: f.url }, impact: f.siteWide ? "high" : "unknown",
      evidence: [makeEvidence({ source: `regression compare (${f.type})`, observedAt: f.lastObserved ?? run.observedAt, coverage: status === "complete" ? "complete" : status === "partial" ? "partial" : "none", basis: "observed", now, detail: JSON.stringify({ previous: f.previous ?? null, current: f.current ?? null }) })],
      recommendation: { action: f.action ?? "Investigate the change", reason: f.impact ?? null }, needsApproval: f.needsApproval !== false,
      verification: f.verification ?? [], missingInformation: f.limitations ?? [],
    })),
  };
}

// The regression module's own store (seo/data/regression/findings.json). That module owns the finding lifecycle (open, intentional,
// resolved, accepted) and the human decisions, so its statuses are mirrored and its absence proves nothing here.
const REG_STATUS = { resolved: "resolved", intentional: "wont-fix", accepted: "wont-fix" };
export function fromRegressionStore(store, { now = Date.now() } = {}) {
  const last = store?.lastObservation ?? null;
  return {
    module: "regression", check: "store", status: "complete", observedAt: last?.observedAt, sourceOwnsWorkflow: true,
    observations: (store?.findings ?? []).map((f) => ({
      category: "regression", ref: f.id, title: f.title, severity: SEV[f.severity], blocking: f.severity === "critical",
      target: { kind: f.subject?.url === "/" ? "site" : "page", ref: f.subject?.url ?? f.subject?.target ?? f.id }, impact: f.severity === "critical" ? "high" : "unknown",
      evidence: [makeEvidence({ source: `regression compare (${f.type})`, observedAt: f.lastObservedAt, coverage: f.confidence ? "complete" : "unknown", basis: "observed", now, detail: f.impact ?? null })],
      recommendation: { action: f.recommendedAction ?? "Investigate the change", reason: f.impact ?? null }, needsApproval: true,
      sourceStatus: f.status === "open" ? (f.decision?.state === "acknowledged" ? "approved" : f.decision?.state === "wont-fix" ? "wont-fix" : "open") : REG_STATUS[f.status] ?? "open",
      verification: f.verification ?? [], missingInformation: f.limitations ?? [],
    })),
  };
}

// The search-watch daily report (seo/data/search-watch/findings.json). Findings are derived from stored evidence, so a page that was
// re-checked and is now fine is simply not reported; only a complete run resolves items, and only for the pages it actually checked.
const WATCH_CATEGORY = "technical";
export function fromSearchWatch(report, { now = Date.now() } = {}) {
  const run = report?.run ?? {};
  const status = ["complete", "partial", "failed"].includes(run.status) ? run.status : "failed";
  return {
    module: "search-watch", check: "daily", status, observedAt: run.observedAt, coveredRefs: run.coveredRefs ?? [],
    observations: (report?.findings ?? []).map((f) => ({
      category: WATCH_CATEGORY, ref: `${f.type}|${f.path}`, title: `${f.type}: ${f.path} - ${f.detail}`, severity: SEV[f.severity], blocking: false,
      target: { kind: "page", ref: f.path }, impact: f.severity === "high" ? "high" : "unknown",
      evidence: [makeEvidence({ source: f.basis === "search-console" ? "Search Console URL Inspection" : "daily crawl", observedAt: f.observedAt, coverage: "complete", basis: "observed", now, detail: f.detail })],
      recommendation: { action: f.action, reason: f.detail }, needsApproval: true,
      verification: [`the next daily check of ${f.path} no longer reports ${f.type}`], missingInformation: [],
    })),
  };
}
