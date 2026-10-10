// BWESEO Keyword Performance — the pure rules. Zero dependencies, no Node-only imports (Node 18+, Cloudflare Worker, browser).
// Engine 1.10.0. Answers: "If someone searches Google for a keyword we target, which page is meant to rank, has Google indexed it,
// is Google showing it for that query, and how is it doing?" — from the site's OWN Search Console data, never from Google's results pages.
//
// THIS IS NOT A SERP TRACKER. Nothing here searches Google, scrapes a results page or simulates a search. "Average position" is
// Search Console's average over the period for the times the site was shown; it is not a live ranking and is never called one.
// (A future authorized third-party SERP provider could be added behind the same shapes; none is used.)
//
// Inputs are plain data (Search Analytics rows, registry records, page facts, index-monitor records). See keyword-performance-run.mjs
// for the part that fetches and caches them, and docs/methodology/keyword-performance.md for the whole picture.
import { normalizeUrl } from "./index-monitor.mjs";
import { normalizeKeyword, similarKeywords, decisionsOf } from "./keyword-registry.mjs";

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const DAY = 86_400_000;

export const PRIORITIES = ["FIX NOW", "HIGH OPPORTUNITY", "IMPROVE", "MONITOR", "HEALTHY", "INSUFFICIENT DATA"];
export const KEYWORD_ENGINE_VERSION = "1.10.0";

export const DEFAULTS = Object.freeze({
  defaultRangeDays: 28,
  lagDays: 2, // Search Console data is usually final about 2 days behind
  minImpressions: 10, // below this a query has too little data to judge
  highImpressions: 100, // "frequently shown"
  strikingMin: 8, // average position band that is close to page one
  strikingMax: 20,
  farPosition: 20,
  lowCtrTop10: 0.02, // shown in the top 10 on average yet fewer than 2% click
  newPageDays: 30, // a page younger than this is not judged on impressions
  newIndexGraceDays: 14, // a page younger than this is not judged on indexing
  discoverMinImpressions: 3,
  cannibalMinImpressions: 10,
  cannibalMinShare: 0.2,
  topQueries: 10,
  maxRows: 5000, // rows kept in a stored snapshot
});
export const resolveThresholds = (o = {}) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => k in DEFAULTS && Number.isFinite(v) && v >= 0)) });

// ---------------------------------------------------------------- date ranges

const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const RANGE_PRESETS = { "7d": { days: 7, label: "Last 7 days" }, "28d": { days: 28, label: "Last 28 days" }, "3m": { days: 90, label: "Last 3 months" } };
export const RANGE_NAMES = Object.keys(RANGE_PRESETS);

// A reporting range: a preset ("7d" | "28d" | "3m") or a custom { startDate, endDate }. The end is held back by the data lag so a
// range never silently includes days Search Console has not finished. Always carries a label so the screen can show it.
export function rangeFor(spec = "28d", now = Date.now(), cfg = DEFAULTS) {
  if (spec && typeof spec === "object" && /^\d{4}-\d{2}-\d{2}$/.test(spec.startDate ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(spec.endDate ?? "")) {
    if (spec.startDate > spec.endDate) return { ok: false, error: "the start date is after the end date" };
    const days = Math.round((Date.parse(spec.endDate) - Date.parse(spec.startDate)) / DAY) + 1;
    if (days > 486) return { ok: false, error: "Search Console keeps about 16 months of data; choose a shorter range" };
    return { ok: true, key: "custom", startDate: spec.startDate, endDate: spec.endDate, days, label: `${spec.startDate} to ${spec.endDate}` };
  }
  const p = RANGE_PRESETS[spec];
  if (!p) return { ok: false, error: `range must be one of ${RANGE_NAMES.join(", ")} or { startDate, endDate }` };
  const end = now - cfg.lagDays * DAY;
  return { ok: true, key: spec, startDate: dayStr(end - (p.days - 1) * DAY), endDate: dayStr(end), days: p.days, label: `${p.label} (${dayStr(end - (p.days - 1) * DAY)} to ${dayStr(end)})` };
}
// The period of equal length immediately before — for "was 120, now 680".
export function previousRange(range) {
  const end = Date.parse(range.startDate) - DAY;
  const start = end - (range.days - 1) * DAY;
  return { ok: true, key: "previous", startDate: dayStr(start), endDate: dayStr(end), days: range.days, label: `previous ${range.days} days (${dayStr(start)} to ${dayStr(end)})` };
}

// ---------------------------------------------------------------- Search Analytics rows → an index

// rows are Search Analytics rows with dimensions ["query","page"]. Rows for any other origin are dropped (and counted).
export function parseRows(response, { origin } = {}) {
  const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response) ? response : [];
  const out = [];
  let dropped = 0;
  for (const r of rows) {
    const q = r?.keys?.[0];
    const p = normalizeUrl(r?.keys?.[1], origin);
    if (!isStr(q) || !p) { dropped += 1; continue; }
    out.push({ query: normalizeKeyword(q), rawQuery: q, path: p.path.split("?")[0], clicks: num(r.clicks), impressions: num(r.impressions), position: num(r.position) });
  }
  return { rows: out, dropped };
}

const merge = (a, r) => { // impression-weighted average position
  const imp = a.impressions + r.impressions;
  a.position = imp ? (a.position * a.impressions + r.position * r.impressions) / imp : 0;
  a.impressions = imp;
  a.clicks += r.clicks;
  return a;
};
const finish = (a) => ({ ...a, ctr: a.impressions ? a.clicks / a.impressions : 0, position: a.impressions ? r1(a.position) : null });

// query → { impressions, clicks, ctr, position, pages[] } and page → { …, queries[] }
export function indexRows(rows) {
  const byQuery = new Map();
  const byPage = new Map();
  for (const r of rows) {
    const q = byQuery.get(r.query) ?? { query: r.query, raw: r.rawQuery, impressions: 0, clicks: 0, position: 0, pages: new Map() };
    merge(q, r);
    q.pages.set(r.path, merge(q.pages.get(r.path) ?? { path: r.path, impressions: 0, clicks: 0, position: 0 }, r));
    byQuery.set(r.query, q);
    const p = byPage.get(r.path) ?? { path: r.path, impressions: 0, clicks: 0, position: 0, queries: new Map() };
    merge(p, r);
    p.queries.set(r.query, merge(p.queries.get(r.query) ?? { query: r.query, raw: r.rawQuery, impressions: 0, clicks: 0, position: 0 }, r));
    byPage.set(r.path, p);
  }
  const outQ = new Map();
  for (const [k, q] of byQuery) {
    const f = finish(q);
    f.pages = [...q.pages.values()].map(finish).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).map((p) => ({ ...p, share: f.impressions ? p.impressions / f.impressions : 0 }));
    outQ.set(k, f);
  }
  const outP = new Map();
  for (const [k, p] of byPage) {
    const f = finish(p);
    f.queries = [...p.queries.values()].map(finish).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
    outP.set(k, f);
  }
  return { byQuery: outQ, byPage: outP, totalRows: rows.length };
}

// ---------------------------------------------------------------- indexing status (confirmed / inferred / unknown — never blurred)

const NOT_INDEXED_PROBLEMS = new Set(["BLOCKED_BY_ROBOTS", "NOINDEX", "FETCH_ERROR", "CANONICAL_CONFLICT", "REDIRECTED", "DUPLICATE"]);
const NOT_INDEXED_WAITING = new Set(["NOT_DISCOVERED_BY_GOOGLE", "DISCOVERED_NOT_INDEXED", "CRAWLED_NOT_INDEXED"]);

// record: the site's Google index-monitor record for the URL (indexState from URL Inspection) or null.
//   CONFIRMED  — Google's URL Inspection API said so (source and date shown)
//   INFERRED   — Google has shown the page in search (impressions) but URL Inspection has not confirmed it; shown as inferred ONLY
//   UNKNOWN    — nothing definitive; the reason and the manual step are given
export function indexingStatus({ record = null, impressions = 0, now = Date.now() } = {}) {
  const at = record?.inspect?.status === "OK" ? record.inspect.at ?? null : null;
  const s = record?.indexState;
  if (at && s === "INDEXED") return { confidence: "CONFIRMED", indexed: true, state: s, label: "Indexed — confirmed", source: "Google Search Console (URL Inspection API)", checkedAt: at, reason: null, action: null };
  if (at && s && s !== "NOT_CHECKED" && s !== "UNKNOWN")
    return { confidence: "CONFIRMED", indexed: false, state: s, problem: NOT_INDEXED_PROBLEMS.has(s), waiting: NOT_INDEXED_WAITING.has(s), label: "Not indexed — confirmed", source: "Google Search Console (URL Inspection API)", checkedAt: at, reason: `Google reports: ${record.google?.coverageState ?? s}`, action: "Open the URL in Search Console's URL Inspection tool and follow Google's explanation." };
  if (impressions > 0)
    return { confidence: "INFERRED", indexed: true, state: "INFERRED_INDEXED", label: "Probably indexed — inferred", source: "Search Console performance data (the page has appeared in Google results)", checkedAt: null, reason: "A page can only be shown in results if Google has it, but URL Inspection has not confirmed it.", action: "Run a URL Inspection check to confirm." };
  const unavailable = record?.inspect?.status === "UNAVAILABLE";
  return { confidence: "UNKNOWN", indexed: null, state: "UNKNOWN", label: "Unknown", source: null, checkedAt: null, reason: unavailable ? `Google's URL Inspection did not answer (${record.inspect.errorKind ?? "error"}). That is not the same as "not indexed".` : "Definitive indexing status is not available through the configured API.", action: "Inspect this URL in Google Search Console." };
}

// ---------------------------------------------------------------- the 11 separate states (never inferred from one another)

const yn = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");
export function pageLadder({ validation = null, indexing, inSitemap = null, internalLinks = null, stats = null, keywordStats = null, topPagePath = null, targetPath }) {
  const L = [];
  const add = (id, label, state, basis) => L.push({ id, label, state, basis });
  add("exists", "Page exists", validation ? yn(validation.exists) : "unknown", validation ? `HTTP ${validation.httpStatus ?? "?"}` : "page not checked");
  add("discoverable", "Page is discoverable", inSitemap === true || (internalLinks ?? 0) > 0 ? "yes" : inSitemap === false && internalLinks === 0 ? "no" : "unknown", "in the sitemap or linked from another page (a way for Google to find it)");
  add("sitemap", "Page is in the sitemap", yn(inSitemap), "the sitemap lists this address — this does not mean Google indexed it");
  add("crawlable", "Page is crawlable", validation ? yn(validation.crawlable) : "unknown", validation?.crawlBasis ?? "robots.txt not checked");
  add("indexable", "Page is indexable", validation ? yn(validation.indexable) : "unknown", validation?.indexableBasis ?? "page not checked");
  add("indexed", "Page is indexed by Google", indexing.indexed === true ? (indexing.confidence === "CONFIRMED" ? "yes" : "inferred") : indexing.indexed === false ? "no" : "unknown", `${indexing.confidence}${indexing.source ? " — " + indexing.source : ""}`);
  add("impressions", "Page receives impressions", stats ? yn(stats.impressions > 0) : "unknown", stats ? `${stats.impressions} in the period` : "no Search Console data");
  add("clicks", "Page receives clicks", stats ? yn(stats.clicks > 0) : "unknown", stats ? `${stats.clicks} in the period` : "no Search Console data");
  add("ranks", "Page appears for the intended query", keywordStats ? yn(keywordStats.some((p) => p.path === targetPath && p.impressions > 0)) : "unknown", "the target page has impressions for this exact query (average position, not a live rank)");
  add("shows", "Google shows the intended page", keywordStats?.length ? yn(topPagePath === targetPath) : keywordStats ? "no-data" : "unknown", "the target page is the one Google shows most for this query");
  add("traffic", "Page generates organic traffic", stats ? yn(stats.clicks > 0) : "unknown", "clicks from Google search recorded in Search Console");
  return L;
}

// ---------------------------------------------------------------- analysing one keyword

const pct = (v) => `${r1(v * 100)}%`;
const ageDays = (date, now) => { const t = Date.parse(String(date ?? "").slice(0, 10)); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null; };

// ctx: { keyword, entry (registry record|null), index (from indexRows), prevIndex?, related[] (all registry records), validation?,
//        indexRecord?, range, siteHasData, firstDetected?, now, cfg }
export function analyzeKeyword(ctx) {
  const cfg = resolveThresholds(ctx.cfg);
  const now = ctx.now ?? Date.now();
  const nKey = normalizeKeyword(ctx.keyword);
  const entry = ctx.entry ?? null;
  const targetPath = entry ? normalizeUrl(entry.targetUrl, "https://x.invalid")?.path ?? entry.targetUrl : null;
  const q = ctx.index?.byQuery?.get(nKey) ?? null;
  const stats = q ? { impressions: q.impressions, clicks: q.clicks, ctr: q.ctr, position: q.position } : { impressions: 0, clicks: 0, ctr: 0, position: null };
  const pages = q?.pages ?? [];
  const targetStats = pages.find((p) => p.path === targetPath) ?? null;
  const top = pages[0] ?? null;
  const targetPage = targetPath ? ctx.index?.byPage?.get(targetPath) ?? null : null;
  const indexing = indexingStatus({ record: ctx.indexRecord ?? null, impressions: targetPage?.impressions ?? 0, now });
  const age = ageDays(ctx.firstDetected, now);
  const isNew = age != null && age < cfg.newPageDays;
  const validation = ctx.validation ?? null;
  const signals = [];
  const sig = (id) => signals.push(id);

  // who does Google show?
  const meaningful = pages.filter((p) => p.impressions >= cfg.cannibalMinImpressions && p.share >= cfg.cannibalMinShare);
  const mismatch = !!(entry && top && top.path !== targetPath && top.impressions >= cfg.minImpressions && (!targetStats || top.impressions > targetStats.impressions));
  const cannibal = meaningful.length >= 2
    ? { pages: meaningful.map((p) => ({ path: p.path, impressions: p.impressions, clicks: p.clicks, position: p.position, share: r1(p.share * 100), otherQueryShare: (() => { const pp = ctx.index?.byPage?.get(p.path); return pp?.impressions ? r1((1 - p.impressions / pp.impressions) * 100) : null; })() })),
        note: "More than one page receives meaningful impressions for this query. That is not automatically a problem: check whether the pages serve genuinely different needs. A page whose impressions mostly come from OTHER queries is probably overlapping only incidentally." }
    : null;
  const showing = !q || !stats.impressions ? (ctx.siteHasData === false ? "insufficient-data" : "not-yet") : !entry ? "unregistered" : top.path === targetPath ? "yes" : targetStats ? "partly" : "no";

  if (mismatch) sig("target-mismatch");
  if (cannibal) sig("cannibalization");
  const pos = stats.position;
  // When Google shows a DIFFERENT page, the query's combined numbers describe that page, not the target: the mismatch is the
  // finding, and position/CTR opportunities are not judged on the blend.
  const judged = !mismatch;
  const striking = judged && stats.impressions >= cfg.minImpressions && pos != null && pos >= cfg.strikingMin && pos <= cfg.strikingMax;
  const lowCtr = judged && stats.impressions >= cfg.highImpressions && pos != null && pos <= 10 && stats.ctr < cfg.lowCtrTop10;
  const far = judged && stats.impressions >= cfg.minImpressions && pos != null && pos > cfg.farPosition;
  if (striking) sig("striking-distance");
  if (lowCtr) sig("high-impressions-low-ctr");
  if (far) sig("position-over-20");
  if (stats.impressions === 0) sig("zero-impressions");
  if (indexing.indexed === false) sig("not-indexed");
  if (indexing.confidence === "UNKNOWN") sig("indexing-unknown");
  if (isNew) sig("new-page");

  // ---- priority, from evidence
  let priority; let headline;
  const fixes = (validation?.issues ?? []).filter((i) => i.severity === "fix");
  const idxProblem = indexing.confidence === "CONFIRMED" && indexing.indexed === false && indexing.problem;
  const idxWaiting = indexing.confidence === "CONFIRMED" && indexing.indexed === false && !indexing.problem;
  const hasSiteData = ctx.siteHasData !== false;
  if (fixes.length || idxProblem) { priority = "FIX NOW"; headline = fixes[0]?.message ?? `Google reports a problem with this page: ${indexing.reason}`; }
  else if (mismatch) { priority = "IMPROVE"; headline = "Google appears to associate a different page with this search."; }
  else if (stats.impressions >= cfg.minImpressions) {
    if (striking) { priority = stats.impressions >= cfg.highImpressions ? "HIGH OPPORTUNITY" : "IMPROVE"; headline = "Google already shows this page and its average position is close to page one."; }
    else if (lowCtr) { priority = "HIGH OPPORTUNITY"; headline = "Google shows this page often and near the top, but few people click."; }
    else if (far) { priority = "IMPROVE"; headline = "Google shows this page, but on average well beyond page two."; }
    else { priority = "HEALTHY"; headline = "Google is showing this page for this search and people are clicking."; }
  } else if (stats.impressions > 0) { priority = "INSUFFICIENT DATA"; headline = "Only a handful of impressions so far — too few to judge."; }
  else if (!hasSiteData || isNew) { priority = "INSUFFICIENT DATA"; headline = isNew ? "This page is new. Google has not generated enough Search Console data yet. Continue monitoring." : "Search Console has produced no data for this site yet. Continue monitoring."; }
  else if (indexing.confidence === "CONFIRMED" && indexing.indexed === true) { priority = "MONITOR"; headline = "Indexed, but not shown for this search in the period. That is not a failure by itself: demand, competition and page age all matter."; }
  else if (idxWaiting && (age == null || age < cfg.newIndexGraceDays)) { priority = "INSUFFICIENT DATA"; headline = "Google knows about the page but has not indexed it yet. Give it time before acting."; }
  else if (idxWaiting) { priority = "IMPROVE"; headline = "Google has known about this page for a while but has not indexed it."; }
  else { priority = age != null && age < cfg.newIndexGraceDays ? "INSUFFICIENT DATA" : "MONITOR"; headline = "No impressions yet and indexing has not been confirmed. Check indexing before judging the keyword."; }
  if (priority !== "FIX NOW" && (mismatch || cannibal) && ["HEALTHY", "MONITOR", "INSUFFICIENT DATA"].includes(priority) && stats.impressions >= cfg.minImpressions) {
    priority = "IMPROVE"; headline = mismatch ? "Google appears to associate a different page with this search." : "Several pages compete for this search.";
  }

  // ---- actions, with reasons
  const why = [];
  const actions = [];
  const act = (text, because) => actions.push({ text, because });
  if (stats.impressions) why.push(`Shown ${stats.impressions.toLocaleString("en-US")} times, ${stats.clicks.toLocaleString("en-US")} clicks (${pct(stats.ctr)}), average position ${stats.position} — ${ctx.range?.label ?? "selected period"}.`);
  for (const f of fixes) act(`Fix: ${f.message}`, "This stops the page from being found or indexed regardless of its content.");
  if (idxProblem) act("Resolve the indexing problem Google reports, then re-check the URL in Search Console.", indexing.reason);
  if (striking || lowCtr) {
    act("Compare the page title with the queries people actually used (Search Console → Performance → Queries).", "The title is the main thing a searcher reads before clicking.");
    act("Improve the search-result description (meta description) so it answers the search directly.", "Clearer snippets win clicks without needing a higher position.");
    act("Add contextual internal links from related pages.", "Links from related pages tell Google the page matters for this topic.");
    if (striking) act("Compare the page's coverage with what searchers want for this query before making large changes.", "Moving from position ~12 to page one usually comes from relevance, not volume of text.");
  }
  if (far) act("Review whether the page really satisfies this search, strengthen internal links, and widen topical coverage.", "A position past 20 means Google considers other pages more relevant for this search.");
  if (mismatch) {
    act(`Review why Google shows ${top.path} instead of ${targetPath}: search intent, titles/H1s, overlapping content, canonical tags, internal links.`, "Google appears to associate another page with this query. Do not change URLs, canonicals or delete pages until the cause is understood.");
  }
  if (cannibal) act("Review the competing pages and decide whether each serves a distinct need, or whether one should be strengthened and the others differentiated or consolidated.", "Competing pages can split impressions and links, but overlapping pages are sometimes legitimate.");
  if (priority === "INSUFFICIENT DATA" || priority === "MONITOR") act("Keep monitoring; re-check after Search Console has collected more data.", "New pages commonly show nothing for several weeks.");
  if (indexing.confidence !== "CONFIRMED" && !(priority === "FIX NOW")) act(indexing.action ?? "Confirm indexing with URL Inspection.", "Impressions suggest Google has the page, but only URL Inspection confirms it.");
  if (priority === "HEALTHY") act("Protect this page (avoid unnecessary rewrites) and look at related keywords for new opportunities.", "It is working; changes risk losing it.");
  if (!why.length) why.push(headline);

  // ---- trend (same-length period before)
  const prev = ctx.prevIndex?.byQuery?.get(nKey) ?? null;
  const trend = ctx.prevIndex
    ? { previousLabel: ctx.prevRange?.label ?? "previous period", impressions: { previous: prev?.impressions ?? 0, current: stats.impressions }, clicks: { previous: prev?.clicks ?? 0, current: stats.clicks }, position: { previous: prev?.position ?? null, current: pos },
        direction: !prev?.impressions && stats.impressions ? "new" : stats.impressions > (prev?.impressions ?? 0) * 1.1 ? "up" : stats.impressions < (prev?.impressions ?? 0) * 0.9 ? "down" : "flat" }
    : null;

  return {
    keyword: ctx.keyword, normalized: nKey, registered: !!entry, role: entry?.role ?? null,
    target: entry ? { path: targetPath, url: entry.targetUrl, title: entry.pageTitle, pageId: entry.pageId, primaryKeyword: entry.primaryKeyword, secondaryKeywords: entry.secondaryKeywords, searchIntent: entry.searchIntent } : null,
    range: ctx.range ?? null,
    metrics: { ...stats, ctr: stats.ctr, position: stats.position },
    targetMetrics: targetStats ? { impressions: targetStats.impressions, clicks: targetStats.clicks, ctr: targetStats.ctr, position: targetStats.position } : null,
    pagesReceivingImpressions: pages.map((p) => ({ path: p.path, impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, position: p.position, share: r1(p.share * 100), isTarget: p.path === targetPath })),
    googleShowing: { state: showing, topPage: top?.path ?? null },
    mismatch: mismatch ? { intended: targetPath, googleShows: top.path, message: `TARGET PAGE MISMATCH — Google appears to associate ${top.path} with this query rather than ${targetPath}.` } : null,
    cannibalization: cannibal,
    indexing, validation, ladder: pageLadder({ validation, indexing, inSitemap: validation?.inSitemap ?? null, internalLinks: validation?.internalLinks ?? null, stats: targetPage, keywordStats: q ? pages : ctx.siteHasData === false ? null : [], topPagePath: top?.path ?? null, targetPath }),
    similarKeywords: (ctx.related ?? []).filter((r) => normalizeKeyword(r.keyword) !== nKey && r.pageId === entry?.pageId && similarKeywords(r.keyword, ctx.keyword).similar).map((r) => r.keyword),
    signals, status: { priority, headline, why, actions }, trend,
    newSite: ctx.siteHasData === false,
    caveat: "Average position is Search Console's average for the period, not a live Google ranking.",
  };
}

// ---------------------------------------------------------------- the whole site

// registry: registryOf(inventory) records. Returns { analyses[], discovered[], summary }.
export function analyzeSite({ registry, inventory = null, index, prevIndex = null, range, prevRange = null, validations = {}, indexRecords = {}, firstDetected = {}, now = Date.now(), cfg = {} }) {
  const t = resolveThresholds(cfg);
  const siteHasData = (index?.totalRows ?? 0) > 0;
  const analyses = registry.map((entry) => {
    const path = entry.targetUrl;
    return analyzeKeyword({ keyword: entry.keyword, entry, index, prevIndex, related: registry, validation: validations[path] ?? null, indexRecord: indexRecords[path] ?? null, range, prevRange, siteHasData, firstDetected: firstDetected[path] ?? entry.dateAdded, now, cfg: t });
  });
  const discovered = discoverQueries({ registry, index, inventory, cfg: t });
  return { analyses, discovered, summary: summarizeKeywords(analyses, discovered, { siteHasData, range }) };
}

// Queries Google shows the site for that nobody registered. Never creates a page.
export function discoverQueries({ registry, index, inventory = null, cfg = {} }) {
  const t = resolveThresholds(cfg);
  const known = new Set(registry.map((r) => normalizeKeyword(r.keyword)));
  const decisions = decisionsOf(inventory);
  const out = [];
  for (const q of index?.byQuery?.values() ?? []) {
    if (known.has(q.query) || q.impressions < t.discoverMinImpressions) continue;
    const d = decisions.get(q.query);
    if (d?.decision === "ignore") continue;
    const top = q.pages[0];
    const owner = registry.find((r) => r.targetUrl === top?.path);
    const near = registry.find((r) => similarKeywords(r.keyword, q.raw).similar);
    out.push({ query: q.raw, normalized: q.query, impressions: q.impressions, clicks: q.clicks, ctr: q.ctr, position: q.position, rankingPage: top?.path ?? null, pages: q.pages.length, decision: d?.decision ?? null,
      suggestion: near ? { action: "add-secondary", pageId: near.pageId, because: `it reads like "${near.keyword}", which ${near.targetUrl} already targets` } : owner ? { action: "add-secondary", pageId: owner.pageId, because: `Google already shows ${owner.targetUrl} for it` } : { action: "investigate", because: "no registered page matches; it may point to a content or tool opportunity (nothing is created automatically)" } });
  }
  return out.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
}

export function summarizeKeywords(analyses, discovered, { siteHasData = true, range = null } = {}) {
  const by = Object.fromEntries(PRIORITIES.map((p) => [p, 0]));
  for (const a of analyses) by[a.status.priority] += 1;
  const count = (id) => analyses.filter((a) => a.signals.includes(id)).length;
  const order = (p) => PRIORITIES.indexOf(p);
  const first = [...analyses].filter((a) => !["HEALTHY", "INSUFFICIENT DATA"].includes(a.status.priority)).sort((a, b) => order(a.status.priority) - order(b.status.priority) || b.metrics.impressions - a.metrics.impressions)[0] ?? null;
  return {
    keywords: analyses.length, byPriority: by, siteHasData, range,
    notIndexed: count("not-indexed"), indexingUnknown: count("indexing-unknown"), mismatches: count("target-mismatch"), cannibalization: count("cannibalization"),
    indexedNoImpressions: analyses.filter((a) => a.indexing.confidence === "CONFIRMED" && a.indexing.indexed === true && a.metrics.impressions === 0 && !a.signals.includes("new-page")).length,
    withImpressions: analyses.filter((a) => a.metrics.impressions > 0).length, zeroImpressions: count("zero-impressions"), nearPageOne: count("striking-distance"), lowCtr: count("high-impressions-low-ctr"),
    discovered: discovered.filter((d) => !d.decision).length, top: first ? { keyword: a0(first), target: first.target?.path ?? null, priority: first.status.priority, headline: first.status.headline } : null,
  };
}
const a0 = (a) => a.keyword;

// ---------------------------------------------------------------- the dashboard table

export const TABLE_FILTERS = ["all", "highest-impressions", "highest-clicks", "lowest-ctr", "best-position", "near-page-one", "indexing-issues", "target-mismatch", "cannibalization", "zero-impressions"];
const issueOf = (a) => (a.signals.includes("target-mismatch") ? "Google shows another page" : a.signals.includes("cannibalization") ? "Pages compete" : a.signals.includes("not-indexed") ? "Not indexed" : a.signals.includes("high-impressions-low-ctr") ? "Low click-through" : a.signals.includes("striking-distance") ? "Near page one" : a.signals.includes("position-over-20") ? "Weak position" : a.signals.includes("indexing-unknown") && a.metrics.impressions === 0 ? "Indexing unconfirmed" : null);
export function tableRows(analyses) {
  return analyses.map((a) => ({ keyword: a.keyword, role: a.role, targetPage: a.target?.path ?? null, indexStatus: a.indexing.label, indexConfidence: a.indexing.confidence, impressions: a.metrics.impressions, clicks: a.metrics.clicks, ctr: a.metrics.ctr, position: a.metrics.position, trend: a.trend?.direction ?? null, issue: issueOf(a), priority: a.status.priority, signals: a.signals, why: a.status.headline, details: a }));
}
export function queryTable(rows, { filter = "all", sort = null, dir = null, q = "" } = {}) {
  let out = rows.filter((r) => ({ all: () => true, "highest-impressions": (x) => x.impressions > 0, "highest-clicks": (x) => x.clicks > 0, "lowest-ctr": (x) => x.impressions > 0, "best-position": (x) => x.position != null, "near-page-one": (x) => x.signals.includes("striking-distance"), "indexing-issues": (x) => x.signals.includes("not-indexed") || x.signals.includes("indexing-unknown"), "target-mismatch": (x) => x.signals.includes("target-mismatch"), cannibalization: (x) => x.signals.includes("cannibalization"), "zero-impressions": (x) => x.impressions === 0 }[filter] ?? (() => true))(r));
  const needle = normalizeKeyword(q);
  if (needle) out = out.filter((r) => normalizeKeyword(r.keyword).includes(needle) || String(r.targetPage ?? "").includes(needle));
  const by = sort ?? { "highest-impressions": "impressions", "highest-clicks": "clicks", "lowest-ctr": "ctr", "best-position": "position", "near-page-one": "position" }[filter] ?? "priority";
  const asc = dir ? dir === "asc" : ["ctr", "position"].includes(by) || by === "priority";
  const key = { impressions: (r) => r.impressions, clicks: (r) => r.clicks, ctr: (r) => r.ctr, position: (r) => r.position ?? Infinity, priority: (r) => PRIORITIES.indexOf(r.priority) }[by] ?? ((r) => r.impressions);
  return [...out].sort((a, b) => (asc ? 1 : -1) * (key(a) - key(b)) || b.impressions - a.impressions);
}

// ---------------------------------------------------------------- page view

// One page, in plain language: its indexing facts, search performance, top queries, related pages, issues and opportunities.
export function pageView({ path, index, prevIndex = null, registry, validation = null, indexRecord = null, range = null, inventory = null, now = Date.now(), cfg = {} }) {
  const t = resolveThresholds(cfg);
  const p = index?.byPage?.get(path) ?? null;
  const mine = registry.filter((r) => r.targetUrl === path);
  const indexing = indexingStatus({ record: indexRecord, impressions: p?.impressions ?? 0, now });
  const issues = [...(validation?.issues ?? []).map((i) => ({ severity: i.severity, message: i.message }))];
  if (p && p.impressions >= t.highImpressions && p.ctr < t.lowCtrTop10 && p.position <= 12) issues.push({ severity: "improve", message: "Low click-through for how often the page is shown." });
  const opportunities = [];
  if (p?.position != null && p.position >= t.strikingMin && p.position <= t.strikingMax && p.impressions >= t.minImpressions) opportunities.push("Near page-one visibility");
  const links = new Set(validation?.outboundLinks ?? []);
  const related = (inventory?.pages ?? []).filter((x) => x.url !== path && links.has(x.url)).map((x) => ({ path: x.url, title: x.title ?? x.name ?? x.url }));
  const prev = prevIndex?.byPage?.get(path) ?? null;
  return {
    path, range, primaryKeyword: mine.find((r) => r.role === "primary")?.keyword ?? null, secondaryKeywords: mine.filter((r) => r.role === "secondary").map((r) => r.keyword),
    indexing, sitemap: validation?.inSitemap ?? null, canonical: validation?.canonical?.status ?? null,
    performance: p ? { impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, position: p.position, note: "Totals cover queries Google reports individually; rare queries are hidden by Google, so real totals can be higher." } : { impressions: 0, clicks: 0, ctr: 0, position: null },
    previous: prev ? { impressions: prev.impressions, clicks: prev.clicks, position: prev.position } : null,
    topQueries: (p?.queries ?? []).slice(0, t.topQueries).map((x) => ({ query: x.raw, impressions: x.impressions, clicks: x.clicks, position: x.position })),
    relatedPages: related, issues, opportunities,
  };
}

// ---------------------------------------------------------------- plain-language text (CLI, skill and UI share it)

const mark = (s) => (s === "yes" ? "✓" : s === "inferred" ? "≈" : s === "no" ? "✗" : "?");
export function formatKeywordAnalysis(a) {
  const L = ["KEYWORD ANALYSIS", "", "Keyword", `  ${a.keyword}`, ""];
  if (!a.registered) L.push("Registered target page", "  none — this phrase is not registered. Google data for it is shown below.", "");
  else L.push("Target Page", `  ${a.target.path}`, "");
  if (a.validation) L.push("Page", `  ${mark(a.validation.exists === true ? "yes" : a.validation.exists === false ? "no" : "?")} ${a.validation.exists ? "Exists" : "Does not exist or could not be checked"}`, "", "Sitemap", `  ${mark(a.validation.inSitemap === true ? "yes" : a.validation.inSitemap === false ? "no" : "?")} ${a.validation.inSitemap ? "Included" : a.validation.inSitemap === false ? "Not included" : "Not checked"}`, "");
  L.push("Indexing", `  ${a.indexing.confidence === "CONFIRMED" ? (a.indexing.indexed ? "✓" : "✗") : a.indexing.confidence === "INFERRED" ? "≈" : "?"} ${a.indexing.label}`);
  if (a.indexing.source) L.push(`  Source: ${a.indexing.source}${a.indexing.checkedAt ? " · last checked " + a.indexing.checkedAt.slice(0, 10) : ""}`);
  if (a.indexing.reason) L.push(`  ${a.indexing.reason}`);
  if (a.indexing.action) L.push(`  Recommended action: ${a.indexing.action}`);
  L.push("", `GOOGLE SEARCH PERFORMANCE`, `  ${a.range?.label ?? "selected period"}`, "");
  if (a.metrics.impressions || !a.newSite) L.push(`  Impressions   ${a.metrics.impressions.toLocaleString("en-US")}`, `  Clicks        ${a.metrics.clicks.toLocaleString("en-US")}`, `  CTR           ${pct(a.metrics.ctr)}`, `  Average position  ${a.metrics.position ?? "—"}  (Search Console's average, not a live ranking)`);
  else L.push("  No Search Console data yet for this site.");
  L.push("", "Google showing intended page", `  ${a.googleShowing.state === "yes" ? "✓ Yes" : a.googleShowing.state === "no" ? `✗ No — Google shows ${a.googleShowing.topPage}` : a.googleShowing.state === "partly" ? `≈ Partly — Google shows ${a.googleShowing.topPage} more` : a.googleShowing.state === "unregistered" ? `Google shows ${a.googleShowing.topPage}` : "? Not enough data yet"}`);
  L.push("", "Other pages competing", a.cannibalization ? `  ${a.cannibalization.pages.map((p) => p.path).join(", ")} — ${a.cannibalization.note}` : "  None detected");
  if (a.mismatch) L.push("", a.mismatch.message);
  L.push("", "STATUS", `  ${a.status.priority}`, "", "WHY", ...a.status.why.map((w) => `  ${w}`), `  ${a.status.headline}`, "", "NEXT ACTION");
  a.status.actions.slice(0, 5).forEach((x, i) => L.push(`  ${i + 1}. ${x.text}`, `     Why: ${x.because}`));
  if (!a.status.actions.length) L.push("  Nothing to do right now.");
  if (a.trend) L.push("", "TREND", `  Impressions: ${a.trend.impressions.previous} → ${a.trend.impressions.current} (vs ${a.trend.previousLabel})`);
  return L.join("\n");
}
