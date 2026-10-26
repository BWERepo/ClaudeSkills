// BWESEO change-to-outcome history — pure functions, zero dependencies, no Node-only imports (Node 18+, Worker, browser).
//
// A customer records each page change (what, when, which content hash) in its own data (seo/data/outcomes.json). Later the saved
// daily Search Console / conversion rows are compared across two equal-length, complete periods around the publication date.
//
// What this does and does not establish (see docs/methodology/change-outcomes.md):
//   * It reports what happened before and after. It never says a change CAUSED a movement: every comparison carries
//     interpretation "association" and the limits that apply (missing days, low volume, seasonality, overlapping changes).
//   * A figure that is missing is "unavailable", never 0. A day with a recorded 0 is a real zero.
//   * Search Console position is an impression-weighted AVERAGE for the page, not a live ranking, and is labelled so.
//   * Indexing is not inferred from traffic. An indexing record is passed through if the caller has one; otherwise it is "not provided".

export const OUTCOMES_SCHEMA_VERSION = 1;
export const CHANGE_CATEGORIES = ["content", "title-meta", "internal-links", "schema", "technical", "new-page", "redirect", "removal", "other"];
export const DEFAULTS = Object.freeze({
  windowDays: 28, // length of the before and the after period
  lagDays: 2, // Search Console data is usually final about 2 days behind
  minImpressions: 100, // below this in either period the comparison is flagged low-sample
  minClicks: 30,
  reviewAfterDays: [14, 28, 56],
});
export const resolveCfg = (o = {}) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => k in DEFAULTS && (k === "reviewAfterDays" ? Array.isArray(v) && v.every((n) => Number.isInteger(n) && n > 0) : Number.isInteger(v) && v >= 0))) });
export const CAUSATION_NOTE = "This compares two periods. It does not show that the change caused the difference.";

const DAY = 86_400_000;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => iso(ms(d) + n * DAY);
const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const dates = (start, end) => { const out = []; for (let t = ms(start); t <= ms(end); t += DAY) out.push(iso(t)); return out; };

export const newOutcomes = (site = null) => ({ outcomesSchemaVersion: OUTCOMES_SCHEMA_VERSION, site, changes: [] });
export function migrateOutcomes(raw) {
  if (raw == null) return newOutcomes();
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("outcomes file must be a JSON object");
  const v = raw.outcomesSchemaVersion ?? 0;
  if (v > OUTCOMES_SCHEMA_VERSION) throw new Error(`outcomes file is schema ${v}; this engine understands up to ${OUTCOMES_SCHEMA_VERSION}. The file was not changed.`);
  if (v === OUTCOMES_SCHEMA_VERSION) return raw;
  // schema 0: an unversioned { changes:[{ id, page, publishedOn, ... }] } list. publishedOn (a date) becomes publishedAt at 00:00Z and is marked date-only.
  return { ...newOutcomes(raw.site ?? null), changes: (raw.changes ?? []).filter((c) => c?.id && c?.page).map((c) => ({ ...c, publishedAt: c.publishedAt ?? (c.publishedOn ? `${c.publishedOn}T00:00:00Z` : null), publishedPrecision: c.publishedAt ? "time" : "date", category: CHANGE_CATEGORIES.includes(c.category) ? c.category : "other" })) };
}

// ---------------------------------------------------------------- recording a change

export function recordChange(file, { id, page, category = "other", publishedAt, contentHash = null, releaseHash = null, baselineDays, reviewDates, by, note = "", now = Date.now() }, cfgIn = {}) {
  const cfg = resolveCfg(cfgIn);
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error("a change needs a kebab-case id");
  if (!String(page ?? "").startsWith("/") && page !== "*") throw new Error('page must be a site path starting with "/" (or "*" for a site-wide change)');
  if (!CHANGE_CATEGORIES.includes(category)) throw new Error(`category must be one of ${CHANGE_CATEGORIES.join(", ")}`);
  const when = String(publishedAt ?? "");
  if (!isDate(when) && Number.isNaN(Date.parse(when))) throw new Error("publishedAt must be a date or timestamp");
  if (!by || !String(by).trim()) throw new Error("recording a change needs the name of the person recording it (--by)");
  if (file.changes.some((c) => c.id === id)) throw new Error(`change "${id}" already exists; changes are append-only (record a new one)`);
  const publishedDay = isDate(when) ? when : new Date(when).toISOString().slice(0, 10);
  const days = Number.isInteger(baselineDays) && baselineDays > 0 ? baselineDays : cfg.windowDays;
  const change = {
    id, page, category, publishedAt: when, publishedPrecision: isDate(when) ? "date" : "time", contentHash, releaseHash,
    baseline: { start: addDays(publishedDay, -days), end: addDays(publishedDay, -1), days },
    reviewDates: reviewDates?.length ? reviewDates : cfg.reviewAfterDays.map((n) => addDays(publishedDay, n)),
    recordedBy: by.trim(), recordedAt: new Date(now).toISOString(), note, reviews: [],
  };
  return { ...file, changes: [...file.changes, change] };
}

export const dueReviews = (file, today) => file.changes.flatMap((c) => c.reviewDates.filter((d) => d <= today && !c.reviews.some((r) => r.reviewDate === d)).map((d) => ({ id: c.id, page: c.page, reviewDate: d })));

// ---------------------------------------------------------------- comparing periods

// rows: [{ date, clicks?, impressions?, conversions?, position? }] - one row per day, only for days the source really reported.
// A field that is absent in a row is unavailable for that day; 0 is a real zero.
export function summarize(rows, period, field) {
  const days = dates(period.start, period.end);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const present = days.filter((d) => typeof byDate.get(d)?.[field] === "number" && Number.isFinite(byDate.get(d)[field]));
  const complete = present.length === days.length;
  const total = present.reduce((s, d) => s + byDate.get(d)[field], 0);
  return { days: days.length, daysWithData: present.length, missingDays: days.length - present.length, complete, total: present.length ? total : null };
}

export function positionOf(rows, period) {
  const inRange = rows.filter((r) => r.date >= period.start && r.date <= period.end && typeof r.position === "number" && typeof r.impressions === "number" && r.impressions > 0);
  const imp = inRange.reduce((s, r) => s + r.impressions, 0);
  return imp > 0 ? Math.round((inRange.reduce((s, r) => s + r.position * r.impressions, 0) / imp) * 10) / 10 : null;
}

export const rel = (before, after) => (before == null || after == null ? null : before === 0 ? null : Math.round(((after - before) / before) * 1000) / 10);

export function compareChange(change, rows, { today, cfg: cfgIn = {}, otherChanges = [], indexing = null, metrics = ["clicks", "impressions", "conversions"] } = {}) {
  const cfg = resolveCfg(cfgIn);
  if (!isDate(today)) throw new Error("compareChange needs today as YYYY-MM-DD");
  const publishedDay = isDate(change.publishedAt) ? change.publishedAt : change.publishedAt.slice(0, 10);
  const win = cfg.windowDays;
  const before = { start: addDays(publishedDay, -win), end: addDays(publishedDay, -1) };
  // The publication day itself is excluded from both periods (the page changed part-way through it).
  const after = { start: addDays(publishedDay, 1), end: addDays(publishedDay, win) };
  const lastFinal = addDays(today, -cfg.lagDays);
  const flags = [];
  const out = { changeId: change.id, page: change.page, category: change.category, publishedAt: change.publishedAt, contentHash: change.contentHash ?? null, releaseHash: change.releaseHash ?? null,
    periods: { before, after, windowDays: win }, interpretation: "association", note: CAUSATION_NOTE, indexing: indexing ?? { status: "not provided", note: "Indexing is not inferred from traffic." } };

  if (after.end > lastFinal) {
    const ready = addDays(after.end, cfg.lagDays);
    return { ...out, status: "pending", reason: `the after period runs to ${after.end}; its data is not final until ${ready}`, flags: [{ id: "period-incomplete", detail: `needs ${ready}` }], metrics: {} };
  }
  if (change.publishedPrecision === "date") flags.push({ id: "date-only", detail: "only the publication date is known; the publication day is excluded from both periods" });

  const result = {};
  for (const f of metrics) {
    const b = summarize(rows, before, f), a = summarize(rows, after, f);
    if (b.daysWithData === 0 && a.daysWithData === 0) { result[f] = { available: false, reason: `no ${f} data supplied for either period` }; continue; }
    if (!b.complete || !a.complete) {
      result[f] = { available: false, reason: `incomplete data: before has ${b.daysWithData}/${b.days} days, after has ${a.daysWithData}/${a.days} days; a comparison needs complete periods`, before: b, after: a };
      flags.push({ id: "missing-data", detail: `${f}: ${b.missingDays} day(s) missing before, ${a.missingDays} after` });
      continue;
    }
    result[f] = { available: true, before: b.total, after: a.total, change: a.total - b.total, changePercent: rel(b.total, a.total), changePercentNote: b.total === 0 ? "undefined: the before period had a real total of 0" : null };
  }
  const bp = positionOf(rows, before), ap = positionOf(rows, after);
  result.searchConsolePosition = bp == null || ap == null ? { available: false, reason: "no position and impression data for both periods" } : { available: true, before: bp, after: ap, note: "impression-weighted average position in Search Console; not a live ranking" };

  const imp = result.impressions, clk = result.clicks;
  if (imp?.available && (imp.before < cfg.minImpressions || imp.after < cfg.minImpressions)) flags.push({ id: "low-sample", detail: `impressions ${imp.before} before / ${imp.after} after; below ${cfg.minImpressions}` });
  if (clk?.available && (clk.before < cfg.minClicks || clk.after < cfg.minClicks)) flags.push({ id: "low-sample", detail: `clicks ${clk.before} before / ${clk.after} after; below ${cfg.minClicks}` });

  // Year-ago comparison for the same after window, only if those days were supplied; otherwise seasonality is not controlled.
  const yAfter = { start: addDays(after.start, -364), end: addDays(after.end, -364) }, yBefore = { start: addDays(before.start, -364), end: addDays(before.end, -364) };
  const ya = summarize(rows, yAfter, "clicks"), yb = summarize(rows, yBefore, "clicks");
  if (ya.complete && yb.complete && result.clicks?.available) result.yearAgo = { available: true, before: yb.total, after: ya.total, note: "the same two periods one year earlier (364 days); a rough seasonal reference only" };
  else flags.push({ id: "seasonality-not-controlled", detail: "no complete data for the same periods a year earlier; a seasonal change cannot be separated from the effect of the change" });

  // Overlapping changes: another change on this page (or site-wide) published inside either period or the publication day.
  const lo = before.start, hi = after.end;
  const overlaps = otherChanges.filter((o) => o.id !== change.id && (o.page === change.page || o.page === "*" || change.page === "*") && o.publishedAt && o.publishedAt.slice(0, 10) >= lo && o.publishedAt.slice(0, 10) <= hi);
  if (overlaps.length) flags.push({ id: "overlapping-changes", detail: overlaps.map((o) => `${o.id} (${o.publishedAt.slice(0, 10)})`).join(", ") });

  const hasAny = Object.values(result).some((m) => m.available);
  return { ...out, status: hasAny ? "compared" : "insufficient-data", metrics: result, flags, limits: limitsText(flags) };
}

const LIMIT_TEXT = {
  "missing-data": "Some days have no data, so that metric was not compared.",
  "low-sample": "Volumes are small; ordinary week-to-week variation can look like a change.",
  "seasonality-not-controlled": "Seasonal demand may explain part of the difference.",
  "overlapping-changes": "Other changes in or near the same periods may explain the difference; the effects cannot be separated.",
  "date-only": "The exact publication time is unknown.",
  "period-incomplete": "The after period is not complete yet.",
};
export const limitsText = (flags) => [...new Set(flags.map((f) => LIMIT_TEXT[f.id]).filter(Boolean))];

export function recordReview(file, id, { reviewDate, by, comparison, now = Date.now() }) {
  const c = file.changes.find((x) => x.id === id);
  if (!c) throw new Error(`no change "${id}"`);
  if (!by || !String(by).trim()) throw new Error("a review needs the reviewer's name (--by)");
  const entry = { reviewDate, at: new Date(now).toISOString(), by, status: comparison.status, flags: comparison.flags.map((f) => f.id), metrics: Object.fromEntries(Object.entries(comparison.metrics).map(([k, m]) => [k, m.available ? { before: m.before, after: m.after } : { unavailable: m.reason }])) };
  return { ...file, changes: file.changes.map((x) => (x.id === id ? { ...x, reviews: [...x.reviews, entry] } : x)) };
}
