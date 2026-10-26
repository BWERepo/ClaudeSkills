// BWESEO evidence and freshness contract — pure functions, zero dependencies, no Node-only imports (Node 18+, Worker, browser).
//
// One shared way to say "where did this fact come from, when was it seen, how much of the thing did the check cover, is it still
// fresh, and how far can it be trusted". Used first by the improvement queue, the change-to-outcome history and the regression
// comparison; other modules adopt it by calling makeEvidence() where they record an observation.
//
//   { v, source, observedAt, coverage, freshness, ageDays, confidence, basis, unavailable, detail }
//
// Rules (nothing here invents a number):
//   coverage    "complete" | "partial" | "none" | "unknown"   how much of the subject the observation covered. A failed check is "none".
//   freshness   "fresh" | "stale" | "unknown"                 observedAt compared with maxAgeDays (default below); no date = "unknown".
//   confidence  "high" | "medium" | "low" | "unknown"         a label from the rules in confidenceOf(), never a score.
//   unavailable null, or a short reason ("check failed", "no Search Console data", ...). Unavailable data is NOT zero.

export const EVIDENCE_VERSION = 1;
export const COVERAGE = ["complete", "partial", "none", "unknown"];
export const FRESHNESS = ["fresh", "stale", "unknown"];
export const CONFIDENCE = ["high", "medium", "low", "unknown"];
export const BASES = ["observed", "reported", "derived"];
export const DEFAULT_MAX_AGE_DAYS = 14;

const DAY = 86_400_000;
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const toMs = (v) => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (!isStr(v)) return null;
  // A bare date means that day in UTC; anything else must parse as a full timestamp.
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(t) ? null : t;
};

// Whole days between an observation and "now"; null when either is unknown. Negative (future-dated) is treated as unknown.
export function ageInDays(observedAt, now = Date.now()) {
  const o = toMs(observedAt), n = toMs(now);
  if (o == null || n == null || o > n + DAY) return null;
  return Math.max(0, Math.floor((n - o) / DAY));
}

export function freshnessOf(observedAt, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const age = ageInDays(observedAt, now);
  if (age == null) return "unknown";
  return age <= maxAgeDays ? "fresh" : "stale";
}

// high    complete coverage, fresh, and directly observed by a check
// medium  complete coverage and fresh but reported by a person or derived from other records, or partial coverage that is fresh and direct
// low     anything stale, or partial coverage that is not directly observed
// unknown no usable observation (unavailable, no coverage, no date)
export function confidenceOf({ coverage, freshness, basis, unavailable }) {
  if (unavailable || coverage === "none" || coverage === "unknown" || freshness === "unknown") return "unknown";
  if (freshness === "stale") return "low";
  if (coverage === "complete") return basis === "observed" ? "high" : "medium";
  return basis === "observed" ? "medium" : "low";
}

export function makeEvidence({ source, observedAt = null, coverage = "unknown", basis = "observed", unavailable = null, detail = null, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  if (!isStr(source)) throw new Error("evidence needs a source");
  if (!COVERAGE.includes(coverage)) throw new Error(`evidence coverage must be one of ${COVERAGE.join(", ")}`);
  if (!BASES.includes(basis)) throw new Error(`evidence basis must be one of ${BASES.join(", ")}`);
  const reason = isStr(unavailable) ? unavailable : null;
  const cov = reason && coverage !== "none" ? "none" : coverage;
  const freshness = freshnessOf(observedAt, now, maxAgeDays);
  return {
    v: EVIDENCE_VERSION, source, observedAt: toMs(observedAt) == null ? null : String(observedAt), coverage: cov, freshness, ageDays: ageInDays(observedAt, now),
    confidence: confidenceOf({ coverage: cov, freshness, basis, unavailable: reason }), basis, unavailable: reason, detail: detail ?? null,
  };
}

// Evidence for something that could not be obtained: keeps the reason instead of a zero or an empty value.
export const unavailableEvidence = (source, reason, now) => makeEvidence({ source, coverage: "none", unavailable: reason || "unavailable", now });

// Re-grade stored evidence against a later "now" (a stored record does not stay fresh by itself).
export const regrade = (ev, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) => makeEvidence({ ...ev, now, maxAgeDays });

// ---------------------------------------------------------------- metrics: a number, or the reason there is none

// { available: true, value } or { available: false, reason }. A real zero is { available: true, value: 0 }; a missing figure is never 0.
export const metric = (value) => (typeof value === "number" && Number.isFinite(value) ? { available: true, value } : { available: false, reason: "no value recorded" });
export const unavailableMetric = (reason = "unavailable") => ({ available: false, reason: isStr(reason) ? reason : "unavailable" });
export const isAvailable = (m) => m?.available === true && typeof m.value === "number" && Number.isFinite(m.value);
export const valueOrNull = (m) => (isAvailable(m) ? m.value : null);

// Weakest of several confidence labels (for a conclusion that rests on several observations).
export function weakestConfidence(list) {
  const order = ["unknown", "low", "medium", "high"];
  const labels = (list ?? []).map((c) => (order.includes(c) ? c : "unknown"));
  return labels.length ? labels.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : "unknown";
}
