// BWESEO unified improvement queue — pure functions, zero dependencies, no Node-only imports (Node 18+, Worker, browser).
//
// One queue contract for work found by different modules (technical audits, regression comparisons, keyword performance, Google
// Business Profile recommendations, landing pages). It is stored in the customer's OWN data folder (seo/data/improvement-queue.json),
// is built from the modules' existing records (see improvement-sources.mjs) and never replaces them: the inventory `issues` list, the
// GBP recommendation queue and the landing state stay the workflow stores of their modules.
//
// Item: { id, scope:{ customer:"local", site }, target:{ kind, ref }, category, source:{ module, check, ref }, title,
//         evidence[] (evidence.mjs), firstObservedOn, lastObservedOn, missingInformation[],
//         recommendation:{ action, reason }, severity, blocking, impact, effort:{ level, basis }, dependencies[], owner,
//         status, history[], verification:{ criteria[], result }, check:{ status, on } }
// Dashboards read readModel(), which adds priority:{ position, level, factors[] } and eligibility to each item.
//
// Rules this file enforces (documented in docs/methodology/improvement-queue.md):
//   * identity   id = category + sha256(module|check|normalized ref): the same finding found again is the same item.
//   * decisions  a status a person set (approved, in-progress, deferred, wont-fix, fixed) is never overwritten by a later observation.
//   * resolution an item is "resolved" only when a COMPLETE run of the check that produced it, covering the item's target, no longer
//                reports it. A partial or failed run changes nothing but records that the check did not complete.
//   * priority   a fixed ordering of documented factors; no score is invented. Effort and impact stay "unknown" unless a source says.
import { sha256hex } from "./landing-hash.mjs";
import { freshnessOf, regrade, DEFAULT_MAX_AGE_DAYS } from "./evidence.mjs";

export const QUEUE_SCHEMA_VERSION = 1;
export const STATUSES = ["open", "approved", "in-progress", "fixed", "resolved", "deferred", "wont-fix"];
export const HUMAN_STATUSES = ["approved", "in-progress", "fixed", "deferred", "wont-fix"];
export const SEVERITIES = ["critical", "high", "medium", "low", "unknown"];
export const CATEGORIES = ["technical", "regression", "keyword", "gbp", "landing-page", "content", "measurement", "other"];
export const LEVELS = ["small", "medium", "large", "unknown"];
export const CHECK_STATUSES = ["complete", "partial", "failed"];
// Page-level work that should wait for a site-wide blocker (for example "the whole site is noindex") to be fixed first.
export const BLOCKED_BY_SITE_BLOCKERS = ["keyword", "landing-page", "content"];

const TRANSITIONS = {
  open: ["approved", "in-progress", "fixed", "deferred", "wont-fix"],
  approved: ["open", "in-progress", "fixed", "deferred", "wont-fix"],
  "in-progress": ["approved", "fixed", "deferred", "wont-fix"],
  fixed: ["open", "resolved"],
  resolved: ["open"],
  deferred: ["open", "approved", "wont-fix"],
  "wont-fix": ["open"],
};
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
const IMPACT_RANK = { high: 3, medium: 2, low: 1, unknown: 0 };
const EFFORT_RANK = { small: 0, medium: 1, large: 2, unknown: 3 };
const FRESH_RANK = { fresh: 0, unknown: 1, stale: 2 };
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const day = (now) => new Date(now).toISOString().slice(0, 10);
const uniq = (a) => [...new Set(a)];

export const newQueue = (site = null) => ({ queueSchemaVersion: QUEUE_SCHEMA_VERSION, scope: { customer: "local", site }, updatedAt: null, items: [] });

// ---------------------------------------------------------------- stored file: version handling

// Unversioned or older files are upgraded; a newer file than this engine understands is refused rather than rewritten.
export function migrateQueue(raw) {
  if (raw == null) return { queue: newQueue(), migrated: false, notes: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("improvement queue file must be a JSON object");
  const v = raw.queueSchemaVersion ?? 0;
  if (!Number.isInteger(v) || v < 0) throw new Error("improvement queue file has an invalid queueSchemaVersion");
  if (v > QUEUE_SCHEMA_VERSION) throw new Error(`improvement queue file is schema ${v}; this engine understands up to ${QUEUE_SCHEMA_VERSION}. Update the engine; the file was not changed.`);
  if (v === QUEUE_SCHEMA_VERSION) return { queue: raw, migrated: false, notes: [] };
  // v0: an unversioned list of items written by hand or by a prototype: { items:[{ id, title, status, ... }] }. Nothing is invented:
  // every field the old shape lacks becomes an explicit unknown, and history gets one line saying where the item came from.
  const notes = [];
  const items = (raw.items ?? []).map((o, i) => {
    if (!isStr(o?.id) || !isStr(o?.title)) { notes.push(`item ${i} had no id or title and was not carried over`); return null; }
    const status = STATUSES.includes(o.status) ? o.status : "open";
    if (o.status && status !== o.status) notes.push(`${o.id}: unknown status "${o.status}" became "open"`);
    return {
      id: o.id, scope: { customer: "local", site: raw.scope?.site ?? null }, target: o.target ?? { kind: "site", ref: "unknown" }, category: CATEGORIES.includes(o.category) ? o.category : "other",
      source: o.source ?? { module: "legacy", check: null, ref: o.id }, title: o.title, evidence: o.evidence ?? [], firstObservedOn: o.firstObservedOn ?? o.foundOn ?? null,
      lastObservedOn: o.lastObservedOn ?? o.foundOn ?? null, missingInformation: uniq([...(o.missingInformation ?? []), "migrated from an unversioned queue file"]),
      recommendation: o.recommendation ?? { action: o.title, reason: null }, severity: SEVERITIES.includes(o.severity) ? o.severity : "unknown", blocking: o.blocking === true, impact: "unknown",
      effort: { level: "unknown", basis: "not recorded" }, dependencies: o.dependencies ?? [], owner: o.owner ?? null, status, needsApproval: o.needsApproval !== false,
      history: [...(o.history ?? []), { at: raw.updatedAt ?? null, event: "migrated", note: "from an unversioned queue file (schema 0)" }],
      verification: o.verification ?? { criteria: [], result: null }, check: o.check ?? null,
    };
  }).filter(Boolean);
  return { queue: { ...newQueue(raw.scope?.site ?? null), updatedAt: raw.updatedAt ?? null, items }, migrated: true, notes };
}

// ---------------------------------------------------------------- identity and observations

const normRef = (s) => String(s ?? "").trim();
export function itemId({ category, module, check = "", ref }) {
  return `q-${category}-${sha256hex(`${module}|${check ?? ""}|${normRef(ref)}`).slice(0, 12)}`;
}

// An observation is what a source module reports. Required: module, category, ref (what the finding is about), title.
function normalizeObservation(o, batch) {
  if (!isStr(o?.module ?? batch.module) || !isStr(o?.ref) || !isStr(o?.title)) throw new Error("an observation needs module, ref and title");
  const category = CATEGORIES.includes(o.category) ? o.category : "other";
  const module = o.module ?? batch.module;
  const check = o.check ?? batch.check ?? null;
  return {
    id: o.id ?? itemId({ category, module, check, ref: o.ref }), category, module, check, ref: normRef(o.ref), title: o.title,
    target: o.target ?? { kind: "site", ref: o.ref }, severity: SEVERITIES.includes(o.severity) ? o.severity : "unknown", blocking: o.blocking === true,
    impact: IMPACT_RANK[o.impact] != null ? o.impact : "unknown", evidence: o.evidence ?? [], recommendation: o.recommendation ?? { action: o.title, reason: null },
    effort: LEVELS.includes(o.effort?.level) ? o.effort : { level: "unknown", basis: "no estimate recorded by the source" }, dependencies: o.dependencies ?? [],
    owner: o.owner ?? null, needsApproval: o.needsApproval !== false, verification: o.verification ?? [], missingInformation: o.missingInformation ?? [],
    // A source whose workflow lives elsewhere (inventory issues, GBP recommendations, landing opportunities) passes the status it
    // holds; that is the person's decision in THAT store and is mirrored here.
    sourceStatus: STATUSES.includes(o.sourceStatus) ? o.sourceStatus : null,
  };
}

function newItem(n, batch, site, now) {
  return {
    id: n.id, scope: { customer: "local", site }, target: n.target, category: n.category, source: { module: n.module, check: n.check, ref: n.ref }, title: n.title,
    evidence: n.evidence, firstObservedOn: batch.observedAt ? String(batch.observedAt).slice(0, 10) : day(now), lastObservedOn: batch.observedAt ? String(batch.observedAt).slice(0, 10) : day(now),
    missingInformation: n.missingInformation, recommendation: n.recommendation, severity: n.severity, blocking: n.blocking, impact: n.impact, effort: n.effort,
    dependencies: n.dependencies, owner: n.owner, needsApproval: n.needsApproval, status: n.sourceStatus ?? "open", mirror: n.sourceStatus ? { sourceStatus: n.sourceStatus } : null,
    history: [{ at: new Date(now).toISOString(), event: "found", from: null, to: n.sourceStatus ?? "open", by: null, note: `${n.module}${n.check ? `/${n.check}` : ""}` }],
    verification: { criteria: n.verification, result: null }, check: { status: batch.status, on: batch.observedAt ?? day(now) },
  };
}

const covered = (batch, n) => {
  if (batch.status !== "complete") return false;
  if (Array.isArray(batch.coveredRefs)) return batch.coveredRefs.map(normRef).includes(n.ref) || batch.coveredRefs.map(normRef).includes(normRef(n.target?.ref));
  return batch.coversAll !== false;
};

// Merge batches of observations into the queue. A batch is { module, check?, status: complete|partial|failed, observedAt, observations[],
// coveredRefs? (the targets a complete run looked at; omit if it looked at everything the check can see), coversAll? }.
// Returns { queue, changes[] }; the input queue is not modified.
export function reconcile(queue, batches, { now = Date.now(), site = null } = {}) {
  const q = JSON.parse(JSON.stringify(queue ?? newQueue(site)));
  if (site && !q.scope?.site) q.scope = { customer: "local", site };
  if (site && q.scope.site && q.scope.site !== site) throw new Error(`this queue belongs to ${q.scope.site}; refusing to merge observations for ${site}`);
  const changes = [];
  const at = new Date(now).toISOString();
  const log = (it, event, extra = {}) => { it.history.push({ at, event, ...extra }); changes.push({ id: it.id, event, ...extra }); };
  for (const b of batches) {
    if (!CHECK_STATUSES.includes(b.status)) throw new Error(`batch for ${b.module} needs a status of ${CHECK_STATUSES.join(", ")}`);
    const seen = new Set();
    const obs = (b.observations ?? []).map((o) => normalizeObservation(o, b));
    for (const n of obs) {
      // Duplicate within one batch: keep the first, merge extra evidence.
      const it = q.items.find((x) => x.id === n.id);
      if (seen.has(n.id)) { if (it) it.evidence = [...it.evidence, ...n.evidence]; continue; }
      seen.add(n.id);
      if (!it) { const created = newItem(n, b, q.scope.site, now); q.items.push(created); changes.push({ id: created.id, event: "found" }); continue; }
      const seenOn = b.observedAt ? String(b.observedAt).slice(0, 10) : day(now);
      it.lastObservedOn = seenOn > (it.lastObservedOn ?? "") ? seenOn : it.lastObservedOn;
      it.evidence = n.evidence; it.title = n.title; it.recommendation = n.recommendation; it.severity = n.severity; it.blocking = n.blocking; it.impact = n.impact;
      it.target = n.target; it.missingInformation = n.missingInformation; it.verification = { ...it.verification, criteria: n.verification.length ? n.verification : it.verification.criteria };
      it.check = { status: b.status, on: b.observedAt ?? day(now) };
      if (!it.effort || it.effort.level === "unknown") it.effort = n.effort;
      // Owner, dependencies added by a person are kept; a source can only fill them in when empty.
      if (!it.owner && n.owner) it.owner = n.owner;
      it.dependencies = uniq([...(it.dependencies ?? []), ...n.dependencies]);
      // A source that keeps its own workflow wins only when ITS status changed since we last mirrored it; otherwise a decision made
      // here in the queue stands (the source is not rewritten, so it would otherwise undo that decision on every build).
      if (n.sourceStatus && it.mirror?.sourceStatus !== n.sourceStatus) {
        const from = it.status; it.mirror = { sourceStatus: n.sourceStatus };
        if (n.sourceStatus !== it.status) { it.status = n.sourceStatus; log(it, "status-from-source", { from, to: n.sourceStatus, by: n.module }); }
      } else if (n.sourceStatus) { /* unchanged at the source: keep the queue's status */ }
      else if (it.status === "resolved" || (it.status === "fixed" && b.status === "complete" && !n.sourceStatus)) {
        const from = it.status; it.status = "open"; log(it, it.status === "open" && from === "resolved" ? "reappeared" : "failed-verification", { from, to: "open", note: "reported again by a complete check" });
      }
    }
    // Items of this source that the batch did not report.
    for (const it of q.items) {
      if (it.source.module !== b.module || (b.check && it.source.check !== b.check) || seen.has(it.id)) continue;
      if (b.sourceOwnsWorkflow) continue; // not reported by a source whose absence proves nothing (e.g. hand-kept lists)
      if (b.status !== "complete" || !covered(b, { ref: it.source.ref, target: it.target })) {
        it.check = { status: b.status === "complete" ? "partial" : b.status, on: b.observedAt ?? day(now) };
        if (!it.missingInformation.includes("latest check did not confirm this item either way")) it.missingInformation = [...it.missingInformation, "latest check did not confirm this item either way"];
        log(it, "unconfirmed", { note: b.status === "complete" ? "the run did not cover this target" : `check ${b.status}; item left unchanged` });
        continue;
      }
      it.check = { status: "complete", on: b.observedAt ?? day(now) };
      it.missingInformation = it.missingInformation.filter((m) => m !== "latest check did not confirm this item either way");
      if (["open", "approved", "in-progress", "fixed"].includes(it.status)) { const from = it.status; it.status = "resolved"; it.verification.result = { on: day(now), by: `${b.module} (complete run)`, outcome: "no longer reported by a complete check" }; log(it, "resolved", { from, to: "resolved", by: b.module }); }
    }
  }
  q.updatedAt = new Date(now).toISOString();
  return { queue: q, changes };
}

// ---------------------------------------------------------------- human decisions

export function decide(queue, id, { to, by, note = "", owner, now = Date.now() } = {}) {
  const q = JSON.parse(JSON.stringify(queue));
  const it = q.items.find((x) => x.id === id);
  if (!it) throw new Error(`no queue item "${id}"`);
  if (!isStr(by)) throw new Error("a decision needs the name of the person who made it (--by)");
  const at = new Date(now).toISOString();
  if (owner !== undefined && to === undefined) { const from = it.owner; it.owner = owner || null; it.history.push({ at, event: "owner", from, to: it.owner, by, human: true, note }); q.updatedAt = at; return q; }
  if (!STATUSES.includes(to)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  if (!TRANSITIONS[it.status]?.includes(to)) throw new Error(`${it.status} -> ${to} is not allowed (allowed: ${(TRANSITIONS[it.status] ?? []).join(", ") || "none"})`);
  if (to === "resolved" && it.status === "fixed") { /* a person confirming a fix */ }
  const from = it.status; it.status = to;
  if (owner) it.owner = owner;
  if (to === "resolved") it.verification.result = { on: day(now), by, outcome: note || "confirmed by a person" };
  it.history.push({ at, event: "decision", from, to, by, human: true, note });
  q.updatedAt = at;
  return q;
}

// ---------------------------------------------------------------- prioritization (deterministic and explainable)

// Order: 1 blocking site-wide issue, 2 severity, 3 source-reported impact, 4 fresher evidence, 5 smaller known effort,
// 6 older first observation, 7 id. Each step only breaks ties of the one before. Nothing is scored.
export function priorityKey(it, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const fresh = worstFreshness(it, now, maxAgeDays);
  return { blocking: it.blocking ? 1 : 0, severity: SEV_RANK[it.severity] ?? 0, impact: IMPACT_RANK[it.impact] ?? 0, freshness: FRESH_RANK[fresh], effort: EFFORT_RANK[it.effort?.level ?? "unknown"], first: it.firstObservedOn ?? "9999-12-31", fresh };
}
function worstFreshness(it, now, maxAgeDays) {
  const f = (it.evidence ?? []).map((e) => regrade(e, now, maxAgeDays).freshness);
  if (!f.length) return it.lastObservedOn ? freshnessOf(it.lastObservedOn, now, maxAgeDays) : "unknown";
  return f.includes("stale") ? "stale" : f.includes("unknown") ? "unknown" : "fresh";
}
export function compareItems(a, b, now, maxAgeDays) {
  const x = priorityKey(a, now, maxAgeDays), y = priorityKey(b, now, maxAgeDays);
  return (y.blocking - x.blocking) || (y.severity - x.severity) || (y.impact - x.impact) || (x.freshness - y.freshness) || (x.effort - y.effort) || x.first.localeCompare(y.first) || a.id.localeCompare(b.id);
}
export function explainPriority(it, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const k = priorityKey(it, now, maxAgeDays);
  return [
    `blocking: ${it.blocking ? "yes - a site-wide blocker" : "no"}`,
    `severity: ${it.severity}`,
    `impact: ${it.impact}${it.impact === "unknown" ? " (the source did not report one)" : ""}`,
    `evidence freshness: ${k.fresh}${k.fresh === "stale" ? ` (older than ${maxAgeDays} days)` : ""}`,
    `effort: ${it.effort?.level ?? "unknown"}${(it.effort?.level ?? "unknown") === "unknown" ? " (not estimated; ranked after known efforts)" : ""}`,
    `first observed: ${it.firstObservedOn ?? "unknown"}`,
  ];
}

// ---------------------------------------------------------------- eligibility and the next action

const RESOLVED = new Set(["resolved", "wont-fix"]);
export function eligibility(it, queue, { now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const byId = new Map(queue.items.map((x) => [x.id, x]));
  if (["resolved", "deferred", "wont-fix"].includes(it.status)) return { eligible: false, reason: `status is ${it.status}` };
  const waiting = [];
  for (const d of it.dependencies ?? []) {
    const dep = byId.get(d);
    if (!dep) waiting.push(`${d} (not in the queue; unknown)`); else if (!RESOLVED.has(dep.status)) waiting.push(`${d} (${dep.status})`);
  }
  if (!it.blocking && BLOCKED_BY_SITE_BLOCKERS.includes(it.category))
    for (const b of queue.items) if (b.blocking && !RESOLVED.has(b.status) && !["deferred"].includes(b.status) && b.id !== it.id) waiting.push(`${b.id} (site-wide blocker, ${b.status})`);
  if (waiting.length) return { eligible: false, reason: `waiting for ${uniq(waiting).join(", ")}` };
  if (it.status === "fixed") return { eligible: true, action: "verify", reason: "a fix is recorded; confirm it with the verification criteria" };
  const fresh = worstFreshness(it, now, maxAgeDays);
  if (it.check && it.check.status !== "complete") return { eligible: true, action: "recheck", reason: `the latest ${it.source.module} check was ${it.check.status}; re-run it before acting` };
  if (it.status === "open" && fresh === "stale") return { eligible: true, action: "recheck", reason: `the evidence is older than ${maxAgeDays} days; re-run ${it.source.module} before acting` };
  if (it.status === "open" && it.needsApproval) return { eligible: true, action: "approve", reason: "needs a person's decision before the change is made" };
  return { eligible: true, action: "work", reason: it.status === "open" ? "no approval needed" : `${it.status}` };
}

export function rank(queue, opts = {}) {
  const now = opts.now ?? Date.now();
  return [...queue.items].sort((a, b) => compareItems(a, b, now, opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS));
}

// The single next action across every module. Items that cannot be acted on yet are listed with the reason, never skipped silently.
export function nextAction(queue, opts = {}) {
  const ordered = rank(queue, opts);
  const skipped = [];
  for (const it of ordered) {
    const e = eligibility(it, queue, opts);
    if (e.eligible) return { item: it, action: e.action, reason: e.reason, why: explainPriority(it, opts.now, opts.maxAgeDays), skipped };
    if (!["resolved", "deferred", "wont-fix"].includes(it.status)) skipped.push({ id: it.id, title: it.title, reason: e.reason });
  }
  return { item: null, action: null, reason: skipped.length ? "every open item is waiting on something else" : "nothing outstanding", why: [], skipped };
}

// Read model for dashboards and the CLI: items with their ranking position, eligibility and the priority explanation.
export function readModel(queue, opts = {}) {
  const now = opts.now ?? Date.now();
  const items = rank(queue, opts).map((it, i) => ({ ...it, priority: { position: i + 1, level: it.severity, factors: explainPriority(it, now, opts.maxAgeDays) }, eligibility: eligibility(it, queue, opts) }));
  const count = (f) => items.filter(f).length;
  return {
    queueSchemaVersion: QUEUE_SCHEMA_VERSION, scope: queue.scope, updatedAt: queue.updatedAt,
    totals: { items: items.length, outstanding: count((i) => ["open", "approved", "in-progress", "fixed"].includes(i.status)), resolved: count((i) => i.status === "resolved"), deferred: count((i) => i.status === "deferred"), unconfirmed: count((i) => i.check && i.check.status !== "complete") },
    items,
  };
}
