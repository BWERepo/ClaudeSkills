// BWESEO Google Index Monitoring — the pure core. Zero dependencies and NO Node-only imports, so it runs in Node 18+
// (the /BWESEO CLI) and in a Cloudflare Worker (scheduled monitoring + an admin screen). Engine 1.9.0.
//
// The question it answers: which production URLs does Google know about, which are indexed, which have problems,
// and which need attention?  It never changes anything by itself: inspection, storage and scheduling live in
// index-monitor-run.mjs; this file only normalizes, classifies, explains, schedules and summarizes.
//
// Ground rules (see docs/methodology/google-index-monitoring.md):
//   • Being in the sitemap, being crawled, being indexed and receiving impressions are DIFFERENT facts. Each is kept
//     separately; "indexed" is only ever set from the URL Inspection API's own verdict.
//   • Zero impressions never means "not indexed". Search Analytics never overrides URL Inspection.
//   • A Google API failure is "GOOGLE STATUS TEMPORARILY UNAVAILABLE" — it never turns into NOT INDEXED.
//   • Only production URLs are monitored. Staging is only ever checked for being hidden from search engines.
//   • Nothing here names any business: origins, properties and thresholds come from the site's own configuration.
//   • Fields Google does not return stay null. Nothing is invented.

export const MONITOR_VERSION = "1.9.0";

// ---------------------------------------------------------------- vocabulary

// Where a URL is on its way to Google (each stage is separate evidence, never inferred from another).
export const STAGES = ["DISCOVERED", "PUBLISHED", "IN_SITEMAP", "SUBMITTED", "CRAWLED", "INDEXED", "RECEIVING_IMPRESSIONS"];

// What Google's URL Inspection says about the URL right now. INDEXED is the only healthy one.
export const INDEX_STATES = [
  "INDEXED",
  "NOT_DISCOVERED_BY_GOOGLE",
  "DISCOVERED_NOT_INDEXED",
  "CRAWLED_NOT_INDEXED",
  "BLOCKED_BY_ROBOTS",
  "NOINDEX",
  "CANONICAL_CONFLICT",
  "FETCH_ERROR",
  "REDIRECTED",
  "DUPLICATE",
  "UNKNOWN",
  "NOT_CHECKED", // never inspected yet — not a Google answer
];

// Documented URL Inspection enums (Search Console API reference). Unknown values are kept, never guessed.
const FETCH_PROBLEMS = new Set([
  "SOFT_404", "NOT_FOUND", "ACCESS_DENIED", "SERVER_ERROR", "ACCESS_FORBIDDEN", "BLOCKED_4XX", "INTERNAL_CRAWL_ERROR", "INVALID_URL",
]);

export const DEFAULTS = Object.freeze({
  windowDays: 28, // Search Analytics reporting window
  newPageGraceDays: 3, // no "not discovered" noise right after publishing
  notDiscoveredAlertDays: 7, // published + in sitemap this long and Google still doesn't know it
  notIndexedAlertDays: 14, // crawled/discovered but not indexed this long
  indexedNoImpressionsNoteDays: 28,
  batchSize: 20, // URL Inspection calls per scheduled run (stays inside a Worker's subrequest budget)
  dailyInspectionCap: 400, // our own ceiling — Google's limit is 2,000 per property per day, 600 per minute
  manualUrlCooldownMinutes: 30, // "Check URL now" on the same URL
  manualRefreshCooldownMinutes: 15, // "Refresh Google status"
  sitemapCheckHours: 24,
  analyticsRefreshHours: 24,
  stagingCheckHours: 24,
  newPageDays: 14, // a URL this young is checked daily
  recentChangeDays: 14,
  stableDays: 90,
  intervalHours: { newPage: 24, problem: 48, recentChange: 48, indexed: 14 * 24, stable: 30 * 24, retryAfterFailure: 6 },
  historyLimit: 40, // state changes kept per URL (in its record)
  alertLimit: 200,
  failureAlertAfter: 3, // consecutive failed Google calls before a site-level alert
});

export const resolveConfig = (overrides = {}) => ({
  ...DEFAULTS,
  ...overrides,
  intervalHours: { ...DEFAULTS.intervalHours, ...(overrides.intervalHours ?? {}) },
});

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ms = (iso) => (isStr(iso) && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : null);
const iso = (t) => new Date(t).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

// ---------------------------------------------------------------- URL normalization and the production guard

// Normalize a URL or path against the site's production origin. Returns null for anything that is not a page on
// exactly that origin (another host, http instead of https, a non-web scheme). Fragments are dropped; the root
// is "/" and every other path has no trailing slash, so sitemap, canonical and Search Analytics URLs compare equal.
export function normalizeUrl(input, origin) {
  if (!isStr(input) || !isStr(origin)) return null;
  const base = new URL(origin);
  let u;
  try {
    u = new URL(String(input).trim(), `${base.origin}/`);
  } catch {
    return null;
  }
  if (u.origin !== base.origin) return null;
  const pathname = u.pathname.replace(/\/{2,}/g, "/");
  const path = (pathname !== "/" ? pathname.replace(/\/+$/, "") : "/") + u.search;
  return { url: `${base.origin}${path}`, path };
}

export const sameUrl = (a, b, origin) => {
  const x = normalizeUrl(a, origin);
  const y = normalizeUrl(b, origin);
  return !!x && !!y && x.url === y.url;
};

const hostOf = (u) => {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return null;
  }
};

// True only for the configured production origin. Staging, preview, local and unknown hosts are never monitored.
export function isProductionUrl(url, { productionUrl }) {
  const h = hostOf(url);
  return !!h && h === hostOf(productionUrl) && String(url).toLowerCase().startsWith("https://");
}

// Pull every <loc> out of a sitemap (or sitemap index) document. Returns raw URL strings; callers normalize.
export function parseSitemapLocs(xml) {
  const out = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  for (const m of String(xml ?? "").matchAll(re)) out.push(m[1].replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  return out;
}
export const isSitemapIndex = (xml) => /<sitemapindex[\s>]/i.test(String(xml ?? ""));

// ---------------------------------------------------------------- Google response → normalized facts

const pick = (o, k) => (o && o[k] !== undefined && o[k] !== null && o[k] !== "" ? o[k] : null);
const strList = (v) => (Array.isArray(v) ? v.filter(isStr).map(String) : []);

// Compare the canonical the site declares with the one Google chose. "unknown" when either side is missing:
// a page Google has not indexed has no Google-selected canonical, and that is not a mismatch.
export function compareCanonical(userCanonical, googleCanonical, origin) {
  if (!isStr(userCanonical) || !isStr(googleCanonical)) return { status: "unknown", declared: userCanonical ?? null, google: googleCanonical ?? null };
  const a = normalizeUrl(userCanonical, origin)?.url ?? userCanonical;
  const b = normalizeUrl(googleCanonical, origin)?.url ?? googleCanonical;
  return { status: a === b ? "match" : "mismatch", declared: userCanonical, google: googleCanonical };
}

// Interpret robots.txt / indexing-state fields exactly as documented (RobotsTxtState, IndexingState).
export function robotsInterpretation(r) {
  const robots = pick(r, "robotsTxtState");
  const indexing = pick(r, "indexingState");
  return {
    robotsBlocked: robots === "DISALLOWED",
    noindex: indexing === "BLOCKED_BY_META_TAG" || indexing === "BLOCKED_BY_HTTP_HEADER",
    noindexSource: indexing === "BLOCKED_BY_META_TAG" ? "meta robots tag" : indexing === "BLOCKED_BY_HTTP_HEADER" ? "X-Robots-Tag header" : null,
    indexingAllowed: indexing === "INDEXING_ALLOWED" ? true : indexing ? false : null,
  };
}

// Map one Search Console URL Inspection response to normalized fields. Returns { ok:false, kind:"malformed" } when the
// response has no inspectionResult. Every field Google omitted stays null.
export function normalizeInspection(api, { origin } = {}) {
  const ir = api?.inspectionResult;
  if (!ir || typeof ir !== "object") return { ok: false, kind: "malformed", message: "Google's response had no inspectionResult" };
  const r = ir.indexStatusResult;
  if (!r || typeof r !== "object") return { ok: false, kind: "malformed", message: "Google's response had no indexStatusResult" };
  const google = {
    verdict: pick(r, "verdict"),
    coverageState: pick(r, "coverageState"),
    lastCrawlTime: pick(r, "lastCrawlTime"),
    pageFetchState: pick(r, "pageFetchState"),
    robotsTxtState: pick(r, "robotsTxtState"),
    indexingState: pick(r, "indexingState"),
    googleCanonical: pick(r, "googleCanonical"),
    userCanonical: pick(r, "userCanonical"),
    crawledAs: pick(r, "crawledAs"),
    sitemaps: strList(r.sitemap),
    referringUrls: strList(r.referringUrls),
    mobileUsability: pick(ir.mobileUsabilityResult, "verdict"),
    richResults: pick(ir.richResultsResult, "verdict"),
    richResultTypes: Array.isArray(ir.richResultsResult?.detectedItems) ? ir.richResultsResult.detectedItems.map((d) => d?.richResultType).filter(isStr) : [],
    inspectionLink: pick(ir, "inspectionResultLink"),
  };
  return { ok: true, google, canonical: compareCanonical(google.userCanonical, google.googleCanonical, origin), robots: robotsInterpretation(r) };
}

// The lifecycle state, from Google's own fields. Precedence: indexed (Google's PASS verdict) → blocks Google reports
// → coverage text. The coverage text is free-form in the API, so it is matched by pattern and anything unrecognised
// is UNKNOWN (with the original text kept) instead of being squeezed into a misleading state.
export function classifyIndexState(norm) {
  if (!norm?.ok) return "UNKNOWN";
  const g = norm.google;
  const cov = String(g.coverageState ?? "");
  const robots = norm.robots;
  const notIndexedText = /not indexed|currently not indexed|excluded|unknown to google/i.test(cov);
  if (g.verdict === "PASS" && /indexed/i.test(cov) && !notIndexedText) return "INDEXED";
  if (/unknown to google/i.test(cov)) return "NOT_DISCOVERED_BY_GOOGLE";
  if (robots.robotsBlocked || /blocked by robots/i.test(cov)) return "BLOCKED_BY_ROBOTS";
  if (robots.noindex || /noindex/i.test(cov)) return "NOINDEX";
  if (/different canonical|google chose different|chose different canonical/i.test(cov) || (norm.canonical.status === "mismatch" && /duplicate|alternate/i.test(cov))) return "CANONICAL_CONFLICT";
  if (/duplicate|alternate page/i.test(cov)) return "DUPLICATE";
  if (/redirect/i.test(cov) || g.pageFetchState === "REDIRECT_ERROR") return "REDIRECTED";
  if (g.pageFetchState && FETCH_PROBLEMS.has(g.pageFetchState)) return "FETCH_ERROR";
  if (/server error|not found|404|soft 404|access denied|forbidden|crawl anomaly/i.test(cov)) return "FETCH_ERROR";
  if (/discovered\s*[-–—]\s*currently not indexed/i.test(cov)) return "DISCOVERED_NOT_INDEXED";
  if (/crawled\s*[-–—]\s*currently not indexed/i.test(cov)) return "CRAWLED_NOT_INDEXED";
  return "UNKNOWN";
}

// ---------------------------------------------------------------- plain-language explanations

// Honest wording: possible things to check, never a claim about the cause unless Google's data proves it.
export const EXPLANATIONS = Object.freeze({
  INDEXED: { label: "Indexed", googleTerm: "Submitted and indexed / Indexed, not submitted in sitemap", plain: "Google has this page in its search index. That means it can appear in results; it does not mean it is receiving traffic.", checks: [] },
  NOT_DISCOVERED_BY_GOOGLE: { label: "Not discovered by Google", googleTerm: "URL is unknown to Google", plain: "Google has no record of this address yet. New pages often take days to be found.", checks: ["The page is in the sitemap and the sitemap is registered with Search Console", "Other pages on the site link to it (internal links)", "The page is not blocked by robots.txt or a noindex rule", "Give it a few days after publishing before treating this as a problem"] },
  DISCOVERED_NOT_INDEXED: { label: "Discovered — not indexed", googleTerm: "Discovered - currently not indexed", plain: "Google knows the address but has not visited the page yet, or has not chosen to index it.", checks: ["Internal links pointing to the page", "Sitemap inclusion", "Whether the site as a whole has many similar new pages", "Server speed and availability when Google visits"] },
  CRAWLED_NOT_INDEXED: { label: "Crawled — not indexed", googleTerm: "Crawled - currently not indexed", plain: "Google successfully visited this page but has not chosen to include it in the search index yet.", checks: ["Page quality and how useful it is on its own", "Duplicate or substantially similar content on other pages or tools", "Canonical configuration", "Internal links", "Sitemap inclusion", "Thin content"] },
  BLOCKED_BY_ROBOTS: { label: "Blocked by robots.txt", googleTerm: "Blocked by robots.txt", plain: "robots.txt tells Google not to crawl this page.", checks: ["Whether the block is intended — on a page meant to rank it is not", "The robots.txt rules that match this path"] },
  NOINDEX: { label: "Blocked by noindex", googleTerm: "Excluded by 'noindex' tag", plain: "The page tells Google not to index it (a meta robots tag or an X-Robots-Tag header).", checks: ["Whether the noindex is intended — on a page meant to rank it is not", "Both the page's meta tags and its HTTP response headers"] },
  CANONICAL_CONFLICT: { label: "Canonical conflict", googleTerm: "Duplicate, Google chose different canonical than user", plain: "The page says one address is the main version, but Google picked a different one.", checks: ["Compare the declared canonical with Google's choice below", "Whether another page is very similar", "Do not change canonical tags until you understand why Google disagrees"] },
  FETCH_ERROR: { label: "Page could not be fetched", googleTerm: "Server error (5xx) / Not found (404) / Soft 404 / Access denied", plain: "Google tried to load the page and was not given a normal page.", checks: ["Whether the address returns a normal page right now", "Server errors or timeouts in the hosting logs", "The fetch state Google reported below"] },
  REDIRECTED: { label: "Redirects elsewhere", googleTerm: "Page with redirect", plain: "This address redirects to another one, so Google indexes the destination instead.", checks: ["Whether the redirect is intended", "Whether the sitemap should list the destination address instead"] },
  DUPLICATE: { label: "Duplicate of another page", googleTerm: "Duplicate without user-selected canonical / Alternate page with proper canonical", plain: "Google treats this page as a copy of another one and indexes the other one.", checks: ["Which page Google chose as the main version", "Whether the two pages should really be separate", "Canonical tags on both pages"] },
  UNKNOWN: { label: "Status not recognised", googleTerm: null, plain: "Google returned a status this system does not map to a known state. The original Google text is shown so nothing is lost.", checks: ["Read Google's own wording shown below"] },
  NOT_CHECKED: { label: "Not checked yet", googleTerm: null, plain: "Google has not been asked about this page yet. This is not a Google answer.", checks: [] },
});

export const describeState = (state) => EXPLANATIONS[state] ?? EXPLANATIONS.UNKNOWN;

// ---------------------------------------------------------------- record lifecycle, health and attention

const PROBLEM_STATES = new Set(["NOT_DISCOVERED_BY_GOOGLE", "DISCOVERED_NOT_INDEXED", "CRAWLED_NOT_INDEXED", "BLOCKED_BY_ROBOTS", "NOINDEX", "CANONICAL_CONFLICT", "FETCH_ERROR", "REDIRECTED", "DUPLICATE", "UNKNOWN"]);
const HARD_PROBLEMS = new Set(["BLOCKED_BY_ROBOTS", "NOINDEX", "CANONICAL_CONFLICT", "FETCH_ERROR", "REDIRECTED", "DUPLICATE"]);

const ageDays = (record, now) => {
  const from = ms(record.publishedAt) ?? ms(record.discoveredAt);
  return from == null ? null : (now - from) / DAY;
};

// The furthest stage with evidence (each flag is separate evidence; a URL can be indexed without our sitemap).
export function stageFlags(record) {
  const g = record.google ?? {};
  const inspected = !!record.inspect?.at && record.inspect?.status !== "NEVER";
  return {
    DISCOVERED: !!record.discoveredAt,
    PUBLISHED: record.active !== false, // the URL is a live production page (publishedAt, when the site knows it, is a separate date)
    IN_SITEMAP: record.inSitemap === true,
    SUBMITTED: strList(g.sitemaps).length > 0,
    CRAWLED: isStr(g.lastCrawlTime),
    INDEXED: record.indexState === "INDEXED",
    RECEIVING_IMPRESSIONS: record.indexState === "INDEXED" && num(record.metrics?.impressions) > 0,
    _inspected: inspected,
  };
}
export function currentStage(record) {
  const f = stageFlags(record);
  let stage = null;
  for (const s of STAGES) if (f[s]) stage = s;
  return stage;
}

// Health is about GOOGLE INDEXING only. It is a separate fact from website health and never implies the site is down.
//   PENDING      young URL or not inspected yet — nothing to do
//   OK           indexed
//   ATTENTION    a problem that warrants a look (see attentionReason)
//   UNAVAILABLE  the last Google call failed; the earlier state is kept, not replaced by "not indexed"
//   REMOVED      no longer a production page
export function evaluateHealth(record, now, cfg = DEFAULTS) {
  if (record.active === false) return { seoHealth: "REMOVED", attention: false, attentionReason: null };
  if (record.indexable === false) return { seoHealth: "OK", attention: false, attentionReason: "Not intended for search (marked not indexable on the site)" };
  // The site's own HTML says noindex on a page that is meant to be indexed: Google will honour it, so this is an immediate problem.
  if (record.pageCheck?.noindex === true) return { seoHealth: "ATTENTION", attention: true, attentionReason: "The page itself tells search engines not to index it (noindex), so Google will not index it" };
  const state = record.indexState ?? "NOT_CHECKED";
  const age = ageDays(record, now);
  const young = age != null && age < cfg.newPageGraceDays;
  const unavailable = record.inspect?.status === "UNAVAILABLE";
  if (state === "NOT_CHECKED") return { seoHealth: unavailable ? "UNAVAILABLE" : "PENDING", attention: false, attentionReason: null };
  if (state === "INDEXED") {
    const noImp = record.metrics && record.metrics.at && num(record.metrics.impressions) === 0;
    const sinceIndexed = ms(record.milestones?.firstIndexedSeen);
    const longIndexed = sinceIndexed != null && (now - sinceIndexed) / DAY >= cfg.indexedNoImpressionsNoteDays;
    if (noImp && longIndexed) return { seoHealth: "OK", attention: false, attentionReason: null, note: `Indexed for ${cfg.indexedNoImpressionsNoteDays}+ days with no impressions in the last ${cfg.windowDays} days — review query targeting, titles and descriptions (this is not an indexing problem)` };
    return { seoHealth: unavailable ? "UNAVAILABLE" : "OK", attention: false, attentionReason: null };
  }
  if (young && !HARD_PROBLEMS.has(state)) return { seoHealth: "PENDING", attention: false, attentionReason: null };
  if (state === "NOT_DISCOVERED_BY_GOOGLE") {
    const late = age != null && age >= cfg.notDiscoveredAlertDays;
    return { seoHealth: late ? "ATTENTION" : "PENDING", attention: late, attentionReason: late ? `Google has no record of this page ${Math.floor(age)} days after it was published` : null };
  }
  if (state === "DISCOVERED_NOT_INDEXED" || state === "CRAWLED_NOT_INDEXED") {
    const since = ms(record.changedAt) ?? ms(record.discoveredAt);
    const days = since == null ? 0 : (now - since) / DAY;
    const late = days >= cfg.notIndexedAlertDays;
    return { seoHealth: late ? "ATTENTION" : "PENDING", attention: late, attentionReason: late ? `${describeState(state).label} for ${Math.floor(days)} days` : null };
  }
  if (state === "UNKNOWN") return { seoHealth: "ATTENTION", attention: true, attentionReason: `Google reported a status this system does not recognise: "${record.google?.coverageState ?? "no coverage text"}"` };
  return { seoHealth: "ATTENTION", attention: true, attentionReason: describeState(state).label };
}

// Recommended checks from the CONDITIONS ACTUALLY OBSERVED for this URL — never generic advice.
export function recommendChecks(record, origin) {
  const out = [];
  const g = record.google ?? {};
  const state = record.indexState ?? "NOT_CHECKED";
  const canon = compareCanonical(g.userCanonical, g.googleCanonical, origin);
  if (canon.status === "mismatch")
    out.push({ id: "canonical-differs", text: `Google chose a different canonical from the one this page declares. The page declares ${canon.declared}; Google chose ${canon.google}. Find out why before changing any canonical tag — a similar page, a redirect or a sitemap entry may explain it.` });
  if (record.inSitemap === false && record.indexable !== false)
    out.push({ id: "not-in-sitemap", text: "This indexable page is not in the sitemap. Check the sitemap generation." });
  if (g.robotsTxtState === "DISALLOWED") out.push({ id: "robots", text: "robots.txt blocks Google from crawling this page. Check the robots.txt rule that matches this path." });
  if (g.indexingState === "BLOCKED_BY_META_TAG") out.push({ id: "noindex-meta", text: "A robots meta tag on this page says noindex. Remove it if the page is meant to appear in search." });
  if (g.indexingState === "BLOCKED_BY_HTTP_HEADER") out.push({ id: "noindex-header", text: "An X-Robots-Tag header on this page says noindex. Remove it if the page is meant to appear in search." });
  if (g.pageFetchState && g.pageFetchState !== "SUCCESSFUL") out.push({ id: "fetch", text: `Google's last attempt to fetch the page reported "${g.pageFetchState}". Check that the address returns a normal page.` });
  if (state === "CRAWLED_NOT_INDEXED") out.push({ id: "crawled-not-indexed", text: "Google visited the page and chose not to index it yet. Review page quality, duplication with similar pages, canonical configuration, internal links and sitemap inclusion. These are things to check, not proven causes." });
  if (state === "DISCOVERED_NOT_INDEXED") out.push({ id: "discovered-not-indexed", text: "Google knows the address but has not crawled it. Review internal links to the page and the sitemap; this often resolves with time." });
  if (state === "NOT_DISCOVERED_BY_GOOGLE") {
    if (record.inSitemap) out.push({ id: "not-discovered", text: "The page is in the sitemap but Google has no record of it yet. Confirm the sitemap is registered and that other pages link to this one." });
    else out.push({ id: "not-discovered", text: "Google has no record of this page and it is not in the sitemap. Add it to the sitemap and link to it from other pages." });
  }
  if (state === "UNKNOWN" && g.coverageState) out.push({ id: "unknown", text: `Google's status was "${g.coverageState}". This system does not map it to a known state; read Google's explanation in Search Console.` });
  if (state === "INDEXED" && record.metrics?.at && num(record.metrics.impressions) === 0)
    out.push({ id: "no-impressions", text: `Indexed, with no impressions in the last ${record.metrics.windowDays ?? 28} days. That does not mean the page is not indexed. Review query targeting, competition for the searches it answers, the title and description, and how useful the content is.` });
  return out;
}

// ---------------------------------------------------------------- scheduling (priority, due times, quotas, throttling)

// Which URLs to inspect next. Priority 1 (newest / never checked) → 5 (stable, long indexed). Scales to thousands of
// URLs because each URL carries its own next-due time and a run only takes a bounded batch.
export function scheduleInfo(record, now, cfg = DEFAULTS) {
  const h = cfg.intervalHours;
  if (record.active === false) return { priority: 9, dueAt: Infinity };
  const last = ms(record.inspect?.at);
  const failedAt = record.inspect?.status === "UNAVAILABLE" ? ms(record.inspect?.errorAt) : null;
  if (last == null && failedAt == null) return { priority: 1, dueAt: 0 };
  if (failedAt != null && (last == null || failedAt >= last)) return { priority: 2, dueAt: failedAt + h.retryAfterFailure * HOUR };
  const age = ageDays(record, now);
  const state = record.indexState ?? "NOT_CHECKED";
  let priority;
  let interval;
  if (age != null && age < cfg.newPageDays) { priority = 1; interval = h.newPage; }
  else if (PROBLEM_STATES.has(state)) { priority = 2; interval = h.problem; }
  else if (ms(record.changedAt) != null && (now - ms(record.changedAt)) / DAY < cfg.recentChangeDays) { priority = 3; interval = h.recentChange; }
  else if (ms(record.changedAt) != null && (now - ms(record.changedAt)) / DAY >= cfg.stableDays) { priority = 5; interval = h.stable; }
  else { priority = 4; interval = h.indexed; }
  return { priority, dueAt: last + interval * HOUR };
}

export function dueRecords(records, now, cfg = DEFAULTS) {
  return records
    .map((r) => ({ r, ...scheduleInfo(r, now, cfg) }))
    .filter((x) => x.dueAt <= now)
    .sort((a, b) => a.priority - b.priority || a.dueAt - b.dueAt)
    .map((x) => x.r);
}

const utcDay = (now) => iso(now).slice(0, 10);
export const emptyQuota = (now) => ({ date: utcDay(now), used: 0 });
export function quotaFor(quota, now) {
  return quota && quota.date === utcDay(now) ? { date: quota.date, used: num(quota.used) } : emptyQuota(now);
}
export const quotaRemaining = (quota, now, cfg = DEFAULTS) => Math.max(0, cfg.dailyInspectionCap - quotaFor(quota, now).used);

// Throttle for administrator actions. Returns { ok:true } or { ok:false, retryAfterSeconds, reason }.
export function checkCooldown(lastAtIso, now, minutes, what) {
  const last = ms(lastAtIso);
  if (last == null || now - last >= minutes * 60_000) return { ok: true };
  const retryAfterSeconds = Math.ceil((last + minutes * 60_000 - now) / 1000);
  return { ok: false, retryAfterSeconds, reason: `${what} was checked ${Math.round((now - last) / 60_000)} minute(s) ago. Google's limits are shared, so please wait ${Math.ceil(retryAfterSeconds / 60)} minute(s).` };
}

// ---------------------------------------------------------------- record update from an inspection

const newRecord = (path, url, now) => ({
  path, url, title: null, pageType: null, environment: "production", indexable: true, canonicalUrl: null,
  inSitemap: false, sitemapUrl: null, active: true, publishedAt: null, discoveredAt: iso(now), removedAt: null,
  inspect: { at: null, status: "NEVER", errorKind: null, errorAt: null }, google: null,
  indexState: "NOT_CHECKED", stage: "DISCOVERED", seoHealth: "PENDING", attention: false, attentionReason: null,
  metrics: null, milestones: {}, changedAt: null, checks: 0, updatedAt: iso(now),
});
export { newRecord };

// Apply a successful normalized inspection to a record. Returns { record, event } where event describes a change of
// state (for history and alerts), or null when the state did not change.
export function applyInspection(record, norm, now, cfg = DEFAULTS) {
  const at = iso(now);
  const prevState = record.indexState ?? "NOT_CHECKED";
  const state = classifyIndexState(norm);
  const g = norm.google;
  const m = { ...(record.milestones ?? {}) };
  const coverage = String(g.coverageState ?? "");
  // Google "knows" the URL unless it says so explicitly. First time seen = when WE first observed it (Google gives no discovery date).
  if (state !== "NOT_DISCOVERED_BY_GOOGLE" && !m.googleDiscovered) m.googleDiscovered = at;
  // Google's own last-crawl timestamp. The earliest one we have seen is the "first crawl seen" — it can be later than the true first crawl.
  if (isStr(g.lastCrawlTime) && (!m.firstCrawlSeen || ms(g.lastCrawlTime) < ms(m.firstCrawlSeen))) m.firstCrawlSeen = g.lastCrawlTime;
  if (state === "INDEXED" && !m.firstIndexedSeen) m.firstIndexedSeen = at;
  if (state === "INDEXED") m.lastIndexedSeen = at;
  if (strList(g.sitemaps).length && !m.sitemapSeenByGoogle) m.sitemapSeenByGoogle = at;
  const next = {
    ...record,
    google: { ...g, coverageState: coverage || null },
    canonicalCheck: norm.canonical,
    indexState: state,
    inspect: { at, status: "OK", errorKind: null, errorAt: null },
    milestones: m,
    changedAt: state !== prevState ? at : record.changedAt ?? at,
    checks: num(record.checks) + 1,
    updatedAt: at,
  };
  Object.assign(next, evaluateHealth(next, now, cfg));
  next.stage = currentStage(next);
  const event = state !== prevState ? { at, from: prevState, to: state, coverageState: g.coverageState, lastCrawlTime: g.lastCrawlTime, googleCanonical: g.googleCanonical, userCanonical: g.userCanonical } : null;
  return { record: next, event };
}

// A failed Google call. The URL's earlier state is KEPT — an API problem is "temporarily unavailable", never "not indexed".
export function applyInspectionFailure(record, failure, now, cfg = DEFAULTS) {
  const at = iso(now);
  const next = { ...record, inspect: { ...(record.inspect ?? {}), status: "UNAVAILABLE", errorKind: failure.kind ?? "api-error", errorAt: at, errorMessage: String(failure.message ?? "").slice(0, 300) }, updatedAt: at };
  Object.assign(next, evaluateHealth(next, now, cfg));
  return next;
}

// Merge Search Analytics rows (dimensions ["page","date"]) into the records. Zero rows is valid: it sets impressions to 0
// for monitored pages (a known "no impressions yet"), and never touches indexState.
export function applyAnalytics(records, rows, { origin, now, windowDays = DEFAULTS.windowDays, lookbackDays = 90, truncated = false } = {}) {
  const dayStr = (t) => iso(t).slice(0, 10);
  const metricsStart = dayStr(now - windowDays * DAY);
  const lookbackStart = dayStr(now - lookbackDays * DAY);
  const by = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeUrl(row?.keys?.[0], origin)?.path;
    if (!key) continue;
    const a = by.get(key) ?? { clicks: 0, impressions: 0, posWeighted: 0, firstDate: null };
    const imp = num(row.impressions);
    const d = isStr(row.keys?.[1]) ? row.keys[1] : null;
    if (!d || d >= metricsStart) { // the reporting window (rows carry a date; older rows only feed the first-impression date)
      a.clicks += num(row.clicks);
      a.impressions += imp;
      a.posWeighted += num(row.position) * imp;
    }
    if (d && imp > 0 && (!a.firstDate || d < a.firstDate)) a.firstDate = d;
    by.set(key, a);
  }
  const at = iso(now);
  const out = {};
  for (const [path, r] of Object.entries(records)) {
    const a = by.get(path);
    const metrics = { windowDays, at, truncated: truncated || undefined, impressions: a?.impressions ?? 0, clicks: a?.clicks ?? 0, ctr: a?.impressions ? a.clicks / a.impressions : 0, position: a?.impressions ? Math.round((a.posWeighted / a.impressions) * 10) / 10 : null };
    const milestones = { ...(r.milestones ?? {}) };
    // A "first impression" date is only trustworthy when the search window reaches back to when this URL began (otherwise earlier
    // impressions may exist outside the window). Never record a date that could be the start of the window rather than the first.
    const began = dayStr(ms(r.publishedAt) ?? ms(r.discoveredAt) ?? now);
    if (a?.firstDate && began >= lookbackStart && (!milestones.firstImpression || a.firstDate < milestones.firstImpression)) milestones.firstImpression = a.firstDate;
    const next = { ...r, metrics, milestones };
    Object.assign(next, evaluateHealth(next, now));
    next.stage = currentStage(next);
    out[path] = next;
  }
  return out;
}

// ---------------------------------------------------------------- timeline and timings

// The visible chain Published → Discovered → Crawled → Indexed → First impression, from recorded milestones only.
// Each event says what it is based on, so nothing is presented as more precise than it is:
//   site       the site's own record      google   a timestamp Google reported
//   observed   the first check that showed it (Google gives no date for this)
export function buildTimeline(record, history = []) {
  const m = record.milestones ?? {};
  const ev = [];
  const add = (key, label, at, basis, detail) => at && ev.push({ key, label, at, basis, ...(detail ? { detail } : {}) });
  add("published", "Published", record.publishedAt, "site");
  add("discovered-by-registry", "Found by the site monitor", record.discoveredAt, "site");
  add("in-sitemap", "Added to sitemap", m.inSitemapSeen ?? (record.inSitemap ? record.discoveredAt : null), "site");
  add("sitemap-seen", "Google lists the URL in a sitemap", m.sitemapSeenByGoogle, "observed");
  add("google-discovered", "Google knows the URL", m.googleDiscovered, "observed", "First check that did not say 'unknown to Google'. Google does not report the discovery date.");
  add("first-crawl", "Google crawled the URL", m.firstCrawlSeen, "google", "Google's own crawl timestamp. The earliest one seen — the first crawl may have been earlier.");
  add("first-indexed", "Reported indexed", m.firstIndexedSeen, "observed", "First check that reported it indexed. Google does not report the indexing date.");
  add("first-impression", "First Google impression", m.firstImpression ? `${m.firstImpression}T00:00:00.000Z` : null, "google", "First day with impressions in Search Analytics (date only).");
  for (const h of history) add(`state-${h.at}`, `Status changed: ${describeState(h.from).label} → ${describeState(h.to).label}`, h.at, "observed");
  return ev.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const gap = (from, to) => {
  const a = ms(from);
  const b = ms(to);
  return a != null && b != null && b >= a ? (b - a) / DAY : null;
};

// How long new pages typically take, from observed milestones across all URLs ("crawled in 2 days, indexed in 5").
// Only URLs that have BOTH ends of a span count. Resolution is the check interval, so it is approximate by nature.
export function computeTimings(records) {
  const spans = {
    toGoogleKnown: [(r) => r.publishedAt, (r) => r.milestones?.googleDiscovered],
    toCrawl: [(r) => r.publishedAt, (r) => r.milestones?.firstCrawlSeen],
    toIndexed: [(r) => r.publishedAt, (r) => r.milestones?.firstIndexedSeen],
    toFirstImpression: [(r) => r.publishedAt, (r) => (r.milestones?.firstImpression ? `${r.milestones.firstImpression}T00:00:00.000Z` : null)],
  };
  const out = {};
  for (const [k, [from, to]] of Object.entries(spans)) {
    const xs = records.map((r) => gap(from(r), to(r))).filter((x) => x != null);
    out[k] = { samples: xs.length, medianDays: median(xs) == null ? null : Math.round(median(xs) * 10) / 10, averageDays: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null };
  }
  return out;
}

// ---------------------------------------------------------------- alerts

// Alerts are derived from changes, with thresholds from the config, so a page that was just published never
// raises noise. Each alert has a stable key: an open alert is not raised twice, and it resolves when the condition clears.
export function deriveAlerts(next, now, cfg = DEFAULTS) {
  const out = [];
  if (next.active === false || next.indexable === false) return out;
  const at = iso(now);
  const age = ageDays(next, now);
  // Stays open while the URL is no longer indexed after having been reported indexed; resolves itself when it is indexed again.
  if (next.milestones?.lastIndexedSeen && next.indexState && next.indexState !== "INDEXED" && next.indexState !== "NOT_CHECKED")
    out.push({ key: `new-indexing-problem:${next.path}`, type: "NEW_INDEXING_PROBLEM", path: next.path, at, previously: "INDEXED", previouslyIndexedAt: next.milestones.lastIndexedSeen, now: next.indexState, googleStatus: next.google?.coverageState ?? null, lastCrawl: next.google?.lastCrawlTime ?? null });
  if (next.indexState === "NOT_DISCOVERED_BY_GOOGLE" && next.inSitemap && age != null && age >= cfg.notDiscoveredAlertDays)
    out.push({ key: `new-page-not-discovered:${next.path}`, type: "NEW_PAGE_NOT_DISCOVERED", path: next.path, at, publishedDaysAgo: Math.floor(age), inSitemap: true, internalLinks: next.internalLinks ?? null, googleDiscovery: "not detected" });
  if ((next.indexState === "CRAWLED_NOT_INDEXED" || next.indexState === "DISCOVERED_NOT_INDEXED") && next.attention)
    out.push({ key: `not-indexed-persists:${next.path}`, type: "NOT_INDEXED_PERSISTS", path: next.path, at, state: next.indexState, googleStatus: next.google?.coverageState ?? null, lastCrawl: next.google?.lastCrawlTime ?? null });
  if (next.indexState === "CANONICAL_CONFLICT")
    out.push({ key: `canonical-conflict:${next.path}`, type: "CANONICAL_CONFLICT", path: next.path, at, declared: next.google?.userCanonical ?? null, google: next.google?.googleCanonical ?? null });
  if (next.indexState === "NOINDEX" || next.indexState === "BLOCKED_BY_ROBOTS")
    out.push({ key: `blocked:${next.path}`, type: "BLOCKED", path: next.path, at, state: next.indexState });
  return out;
}

// Merge freshly derived alerts into the stored list: new keys are opened, keys no longer derived are resolved.
export function mergeAlerts(stored, derivedByPath, siteAlerts, now, cfg = DEFAULTS) {
  const at = iso(now);
  const live = new Set([...Object.values(derivedByPath).flat().map((a) => a.key), ...siteAlerts.map((a) => a.key)]);
  const list = [...(stored ?? [])];
  for (const a of [...Object.values(derivedByPath).flat(), ...siteAlerts]) {
    const existing = list.find((x) => x.key === a.key && !x.resolvedAt);
    if (existing) Object.assign(existing, { ...a, openedAt: existing.openedAt, at: existing.at });
    else list.unshift({ ...a, openedAt: at });
  }
  for (const a of list) if (!a.resolvedAt && !live.has(a.key)) a.resolvedAt = at;
  return list.slice(0, cfg.alertLimit);
}

// ---------------------------------------------------------------- staging protection (read-only evidence)

// Is staging hidden from search engines? From what a read-only fetch of the staging site returned.
//   PROTECTED  noindex by header or meta tag     PARTIAL  robots.txt blocks crawling only (a blocked page can still be listed)
//   EXPOSED    nothing prevents indexing         UNKNOWN  could not be checked (never treated as protected)
export function evaluateStagingProtection({ reachable = true, xRobotsTag = null, html = null, robotsTxt = null } = {}) {
  if (!reachable) return { status: "UNKNOWN", reasons: ["staging could not be reached from here"], indexable: null };
  const header = /noindex/i.test(String(xRobotsTag ?? ""));
  const meta = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(String(html ?? "")) || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/i.test(String(html ?? ""));
  const disallowAll = /^\s*user-agent:\s*\*[\s\S]*?^\s*disallow:\s*\/\s*$/im.test(String(robotsTxt ?? ""));
  const reasons = [];
  if (header) reasons.push("X-Robots-Tag: noindex");
  if (meta) reasons.push("meta robots noindex");
  if (disallowAll) reasons.push("robots.txt Disallow: /");
  if (header || meta) return { status: "PROTECTED", reasons, indexable: false };
  if (disallowAll) return { status: "PARTIAL", reasons, indexable: false, warning: "robots.txt blocks crawling but nothing tells Google not to index the address" };
  return { status: "EXPOSED", reasons: ["no noindex header, no noindex meta tag and robots.txt does not disallow crawling"], indexable: true, warning: "Staging appears indexable" };
}

// ---------------------------------------------------------------- summary, filtering and sorting

export const FILTERS = ["all", "indexed", "impressions", "crawled_not_indexed", "discovered_not_indexed", "not_discovered", "blocked", "canonical", "errors", "attention"];

const matchesFilter = (r, f) => {
  switch (f) {
    case "indexed": return r.indexState === "INDEXED";
    case "impressions": return r.indexState === "INDEXED" && num(r.metrics?.impressions) > 0;
    case "crawled_not_indexed": return r.indexState === "CRAWLED_NOT_INDEXED";
    case "discovered_not_indexed": return r.indexState === "DISCOVERED_NOT_INDEXED";
    case "not_discovered": return r.indexState === "NOT_DISCOVERED_BY_GOOGLE";
    case "blocked": return r.indexState === "BLOCKED_BY_ROBOTS" || r.indexState === "NOINDEX";
    case "canonical": return r.indexState === "CANONICAL_CONFLICT" || r.indexState === "DUPLICATE";
    case "errors": return r.indexState === "FETCH_ERROR" || r.inspect?.status === "UNAVAILABLE";
    case "attention": return r.attention === true;
    default: return true;
  }
};

const SORTERS = {
  page: (r) => (r.title ?? r.path ?? "").toLowerCase(),
  url: (r) => r.path ?? "",
  type: (r) => r.pageType ?? "",
  published: (r) => ms(r.publishedAt) ?? 0,
  sitemap: (r) => (r.inSitemap ? 1 : 0),
  status: (r) => r.indexState ?? "",
  crawl: (r) => ms(r.google?.lastCrawlTime) ?? 0,
  canonical: (r) => compareCanonical(r.google?.userCanonical, r.google?.googleCanonical, "https://x.invalid").status,
  impressions: (r) => num(r.metrics?.impressions),
  clicks: (r) => num(r.metrics?.clicks),
  attention: (r) => (r.attention ? 1 : 0),
  checked: (r) => ms(r.inspect?.at) ?? 0,
};
export const SORT_KEYS = Object.keys(SORTERS);

// Filter, search (title / tool name / URL or path), sort and paginate. Pure; works on the compact registry records.
export function queryRecords(records, { filter = "all", q = "", sort = "attention", dir = "desc", page = 1, pageSize = 50 } = {}) {
  const needle = String(q ?? "").trim().toLowerCase();
  let list = records.filter((r) => r.active !== false && matchesFilter(r, FILTERS.includes(filter) ? filter : "all"));
  if (needle) list = list.filter((r) => [r.title, r.path, r.url, r.itemId, r.itemName].some((v) => String(v ?? "").toLowerCase().includes(needle)));
  const key = SORTERS[sort] ?? SORTERS.attention;
  const sign = dir === "asc" ? 1 : -1;
  list = [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign || String(a.path).localeCompare(String(b.path));
  });
  const size = Math.max(1, Math.min(200, Number(pageSize) || 50));
  const total = list.length;
  const p = Math.max(1, Math.min(Math.ceil(total / size) || 1, Number(page) || 1));
  return { total, page: p, pageSize: size, pages: Math.max(1, Math.ceil(total / size)), rows: list.slice((p - 1) * size, p * size) };
}

// The counts for the top of the screen and for /BWESEO. The indexing rate is a plain ratio — NOT a score.
export function summarize(records, meta = {}, now = Date.now()) {
  const active = records.filter((r) => r.active !== false && r.indexable !== false);
  const c = (f) => active.filter((r) => matchesFilter(r, f)).length;
  const inspectedAt = records.map((r) => ms(r.inspect?.at)).filter((x) => x != null);
  const api = meta.googleApi ?? {};
  return {
    v: 1,
    generatedAt: iso(now),
    productionUrls: active.length,
    indexed: c("indexed"),
    receivingImpressions: c("impressions"),
    crawledNotIndexed: c("crawled_not_indexed"),
    discoveredNotIndexed: c("discovered_not_indexed"),
    notDiscovered: c("not_discovered"),
    blocked: c("blocked"),
    canonicalProblems: c("canonical"),
    errors: active.filter((r) => r.indexState === "FETCH_ERROR").length,
    notYetChecked: active.filter((r) => r.indexState === "NOT_CHECKED").length,
    unavailable: active.filter((r) => r.inspect?.status === "UNAVAILABLE").length,
    needAttention: c("attention"),
    notInSitemap: active.filter((r) => r.inSitemap === false).length,
    indexedNoImpressions: active.filter((r) => r.indexState === "INDEXED" && r.metrics?.at && num(r.metrics.impressions) === 0).length,
    problems: active.filter((r) => PROBLEM_STATES.has(r.indexState)).length,
    indexingRate: { indexed: c("indexed"), of: active.length },
    lastGoogleCheckAt: inspectedAt.length ? iso(Math.max(...inspectedAt)) : null,
    searchConsole: { connected: api.status === "OK" ? true : api.status === "ERROR" ? false : null, status: api.status ?? "NOT_CONFIGURED", lastOkAt: api.lastOkAt ?? null, lastErrorKind: api.lastErrorKind ?? null, lastErrorAt: api.lastErrorAt ?? null },
    sitemap: meta.sitemap ?? null,
    stagingProtection: meta.staging ?? null,
    timings: computeTimings(active),
    openAlerts: (meta.alerts ?? []).filter((a) => !a.resolvedAt).length,
    attention: active.filter((r) => r.attention).slice(0, 25).map((r) => ({ path: r.path, state: r.indexState, reason: r.attentionReason, googleStatus: r.google?.coverageState ?? null, lastCrawl: r.google?.lastCrawlTime ?? null, lastCheckedAt: r.inspect?.at ?? null })),
  };
}
