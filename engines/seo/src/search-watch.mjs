// BWESEO search watch — pure rules for the Google search monitoring workflow. Zero dependencies, no file or network access.
//
// One customer-local workflow, built from pieces the engine already has (it adds no crawler and no new Google integration):
//   1. page events (published / changed / removed) keep a ledger of the site's pages, and the ledger produces the sitemap;
//   2. a daily run checks the pages never checked before plus a rotating, bounded sample of the rest;
//   3. Search Console URL Inspection evidence (and only that) says a page is not indexed; a crawl says a page fails or
//      declares an unexpected canonical; both feed the unified improvement queue;
//   4. a weekly report compares complete weeks of Search Console rows and picks the three most useful fixes.
// The IO wrapper is seo-watch.mjs. See docs/methodology/search-watch.md.
import { normalizeUrl, normalizeInspection, classifyIndexState, describeState } from "./index-monitor.mjs";
import { CAUSATION_NOTE, resolveCfg, addDays, summarize, positionOf, rel } from "./outcome-history.mjs";

export const WATCH_SCHEMA_VERSION = 1;
export const EVENT_KINDS = ["published", "changed", "removed"];
export const DEFAULTS = Object.freeze({
  sampleSize: 10, // existing pages re-checked per day (the rotating sample)
  newPerRun: 25, // never-checked pages taken per day; the rest wait for tomorrow
  dailyInspectionCap: 40, // URL Inspection calls this workflow allows itself per UTC day (Google's own limit is higher)
  graceDays: 3, // a new page is "waiting" rather than "not indexed" until it is this old
  confirmAfter: 2, // consecutive failed crawls before a 5xx / network failure is flagged (4xx is flagged at once)
  maxShrinkPercent: 20, // a regenerated sitemap may drop at most this share of the current file's URLs
  maxUrlsPerSitemap: 50000,
  crawlDelayMs: 500, // pause between the daily run's page requests
});
const num = (v, d, min = 0) => (Number.isInteger(v) && v >= min ? v : d);
export const resolveWatchConfig = (o = {}) => Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, num(o?.[k], d, ["confirmAfter", "sampleSize"].includes(k) ? 1 : 0)]));

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString();
const day = (t) => iso(t).slice(0, 10);
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// ---------------------------------------------------------------- the page ledger

export const newLedger = (site = null) => ({ watchSchemaVersion: WATCH_SCHEMA_VERSION, site, updatedAt: null, pages: {} });
export function migrateLedger(raw) {
  if (raw == null) return newLedger();
  if (typeof raw.watchSchemaVersion !== "number") throw new Error("the search-watch ledger has no watchSchemaVersion; it was not changed");
  if (raw.watchSchemaVersion > WATCH_SCHEMA_VERSION) throw new Error(`the ledger is schema ${raw.watchSchemaVersion}; this engine understands up to ${WATCH_SCHEMA_VERSION}. Update the engine; the file was not changed`);
  return { ...newLedger(raw.site), ...raw, pages: raw.pages ?? {} };
}

const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(v) && !Number.isNaN(Date.parse(v));

// One page event from the site's publish hook. Returns { ok, entry } or { ok:false, reason }. Query strings are kept only if the
// site really serves distinct pages on them; the fragment is always dropped.
export function normalizeEvent(raw, origin) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const event = raw.event ?? raw.type;
  if (!EVENT_KINDS.includes(event)) return { ok: false, reason: `event must be one of ${EVENT_KINDS.join(", ")}` };
  const input = raw.url ?? raw.path;
  if (!isStr(input)) return { ok: false, reason: "needs a url or path" };
  const n = normalizeUrl(String(input).split("#")[0], origin);
  if (!n) return { ok: false, reason: `${input} is not on the production origin ${origin}` };
  if (raw.lastmod != null && !validDate(raw.lastmod)) return { ok: false, reason: `lastmod "${raw.lastmod}" is not an ISO date` };
  let canonical = null;
  if (raw.canonical != null) {
    const c = normalizeUrl(String(raw.canonical), origin);
    if (!c) return { ok: false, reason: `canonical ${raw.canonical} is not on the production origin` };
    canonical = c.url;
  }
  return { ok: true, entry: { event, url: n.url, path: n.path, lastmod: raw.lastmod ?? null, canonical, noindex: raw.noindex === true } };
}

// Apply events in order. A page is "removed" only by an explicit removed event. Never throws for one bad event.
export function applyEvents(ledger, events, { origin, now }) {
  const pages = { ...ledger.pages };
  const report = { added: [], changed: [], removed: [], unchanged: [], rejected: [] };
  for (const [i, raw] of events.entries()) {
    const r = normalizeEvent(raw, origin);
    if (!r.ok) { report.rejected.push({ index: i, reason: r.reason, input: raw?.url ?? raw?.path ?? null }); continue; }
    const e = r.entry, cur = pages[e.path];
    if (e.event === "removed") {
      if (cur && cur.status !== "removed") { pages[e.path] = { ...cur, status: "removed", removedAt: iso(now) }; report.removed.push(e.path); } else report.unchanged.push(e.path);
      continue;
    }
    if (!cur || cur.status === "removed") {
      pages[e.path] = { url: e.url, path: e.path, status: "live", firstSeen: iso(now), changedAt: iso(now), lastmod: e.lastmod, canonical: e.canonical, noindex: e.noindex };
      report.added.push(e.path);
    } else {
      const next = { ...cur, lastmod: e.lastmod ?? cur.lastmod, canonical: e.canonical ?? cur.canonical, noindex: e.noindex || (e.event === "published" ? false : cur.noindex) };
      if (JSON.stringify(next) === JSON.stringify(cur)) report.unchanged.push(e.path);
      else { pages[e.path] = { ...next, changedAt: iso(now) }; report.changed.push(e.path); }
    }
  }
  return { ledger: { ...ledger, pages, updatedAt: iso(now) }, report };
}

// Seed the ledger from an existing sitemap's <loc>/<lastmod> pairs so the first sync never replaces a real sitemap with a short one.
export function seedFromSitemap(ledger, xml, { origin, now }) {
  const entries = [...String(xml).matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => ({ loc: /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(m[1])?.[1], lastmod: /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(m[1])?.[1] ?? null }));
  const events = entries.filter((e) => e.loc).map((e) => ({ event: "published", url: e.loc.replace(/&amp;/g, "&"), lastmod: validDate(e.lastmod) ? e.lastmod : null }));
  return applyEvents(ledger, events.filter((e) => !ledger.pages[normalizeUrl(e.url, origin)?.path]), { origin, now });
}

// ---------------------------------------------------------------- the sitemap

// Why a ledger page is NOT in the sitemap. Confirmed-gone pages (a 404/410 on the latest crawl) are left out; a transient failure is not
// a reason to drop a page.
export function sitemapExclusion(page, check, origin) {
  if (page.status === "removed") return "removed";
  if (page.noindex) return "noindex";
  if (page.canonical && page.canonical !== page.url) return "not-canonical";
  if (!normalizeUrl(page.url, origin)) return "off-origin";
  const c = check?.crawl;
  if (c && (c.status === 404 || c.status === 410)) return "gone";
  if (c?.canonical && c.canonical !== page.url) return "not-canonical";
  if (c?.noindex) return "noindex";
  return null;
}

export function buildSitemaps(ledger, { origin, checks = {}, maxUrls = DEFAULTS.maxUrlsPerSitemap, sitemapName = "sitemap.xml" }) {
  const included = [], excluded = [];
  for (const p of Object.values(ledger.pages).sort((a, b) => (a.url < b.url ? -1 : 1))) {
    const why = sitemapExclusion(p, checks[p.path], origin);
    if (why) excluded.push({ url: p.url, reason: why }); else included.push(p);
  }
  const urlset = (list) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list.map((p) => `  <url>\n    <loc>${xmlEsc(p.url)}</loc>${validDate(p.lastmod) ? `\n    <lastmod>${xmlEsc(p.lastmod)}</lastmod>` : ""}\n  </url>`).join("\n")}\n</urlset>\n`;
  if (included.length <= maxUrls) return { files: [{ name: sitemapName, xml: urlset(included) }], included: included.length, excluded };
  const parts = [];
  for (let i = 0; i < included.length; i += maxUrls) parts.push(included.slice(i, i + maxUrls));
  const stem = sitemapName.replace(/\.xml$/, "");
  const files = parts.map((list, i) => ({ name: `${stem}-${i + 1}.xml`, xml: urlset(list) }));
  const index = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map((f) => `  <sitemap>\n    <loc>${xmlEsc(`${origin}/${f.name}`)}</loc>\n  </sitemap>`).join("\n")}\n</sitemapindex>\n`;
  return { files: [{ name: sitemapName, xml: index }, ...files], included: included.length, excluded };
}

// Refuse a regeneration that would silently drop a large part of the existing sitemap (a damaged ledger, a missing seed).
export function shrinkCheck(currentXml, nextCount, maxShrinkPercent) {
  if (!currentXml) return { ok: true, current: 0 };
  const current = [...String(currentXml).matchAll(/<loc>/gi)].length;
  if (current === 0) return { ok: true, current };
  const dropped = Math.max(0, current - nextCount);
  const percent = Math.round((dropped / current) * 1000) / 10;
  return { ok: percent <= maxShrinkPercent, current, next: nextCount, percent, limit: maxShrinkPercent };
}

// ---------------------------------------------------------------- the daily selection

export const newState = (site = null) => ({ watchSchemaVersion: WATCH_SCHEMA_VERSION, site, cursor: null, quota: { date: null, used: 0 }, pages: {}, runs: [] });
export function migrateState(raw) {
  if (raw == null) return newState();
  if (typeof raw.watchSchemaVersion !== "number") throw new Error("the search-watch state has no watchSchemaVersion; it was not changed");
  if (raw.watchSchemaVersion > WATCH_SCHEMA_VERSION) throw new Error(`the state is schema ${raw.watchSchemaVersion}; this engine understands up to ${WATCH_SCHEMA_VERSION}. Update the engine; the file was not changed`);
  return { ...newState(raw.site), ...raw };
}
export const quotaLeft = (state, now, cap) => Math.max(0, cap - (state.quota?.date === day(now) ? state.quota.used : 0));

// The rotation walks live paths in sorted order and remembers the LAST PATH it checked (not a position), so pages added or removed
// between runs never make it skip or repeat a page by accident. It wraps at the end.
export function rotatingSample(paths, cursor, n, exclude = new Set()) {
  const sorted = [...paths].filter((p) => !exclude.has(p)).sort();
  if (!sorted.length || n <= 0) return [];
  const start = cursor == null ? 0 : sorted.findIndex((p) => p > cursor);
  const from = start < 0 ? 0 : start;
  return [...sorted.slice(from), ...sorted.slice(0, from)].slice(0, Math.min(n, sorted.length));
}

export function selectTargets(ledger, state, cfg, { now, inspector = false }) {
  const live = Object.values(ledger.pages).filter((p) => p.status === "live");
  const fresh = live.filter((p) => !state.pages[p.path]?.lastCheckedAt).sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : a.path < b.path ? -1 : 1));
  const wantNew = fresh.slice(0, cfg.newPerRun).map((p) => p.path);
  const wantSample = rotatingSample(live.filter((p) => state.pages[p.path]?.lastCheckedAt).map((p) => p.path), state.cursor, cfg.sampleSize);
  const room = inspector ? quotaLeft(state, now, cfg.dailyInspectionCap) : Infinity;
  const take = (list, n) => list.slice(0, Math.max(0, n));
  const newPaths = take(wantNew, room);
  const samplePaths = take(wantSample, room - newPaths.length);
  return { newPaths, samplePaths, backlog: fresh.length - newPaths.length, quotaLeft: inspector ? room : null, quotaBlocked: inspector && room < wantNew.length + wantSample.length };
}

// ---------------------------------------------------------------- one page's evidence

// A crawl result (from fetchChain) as plain facts. `declared` is read from the page's own HTML; nothing is guessed.
export function crawlFacts(res, page, { parseHead, now }) {
  const at = iso(now);
  const hops = res.chain.filter((h) => h.status >= 300 && h.status < 400).length;
  if (!res.final) return { at, ok: false, kind: res.error === "too many redirects" ? "redirect-loop" : "network", status: null, error: res.error ?? "no response", redirects: hops };
  const status = res.final.status;
  const finalUrl = res.final.url;
  const head = status < 400 && parseHead ? parseHead(res.final.text) : null;
  const robots = [...(head?.robots ?? []), res.final.headers?.get?.("x-robots-tag") ?? ""].join(",");
  const canonicals = head?.canonicals ?? [];
  return {
    at, ok: status >= 200 && status < 300 && finalUrl === page.url, status, finalUrl, redirects: hops, error: null,
    kind: status >= 400 ? (status >= 500 ? "server-error" : "client-error") : finalUrl !== page.url ? "redirected" : status >= 300 ? "bad-redirect" : "ok",
    canonical: canonicals[0] ? (normalizeUrl(canonicals[0], page.url)?.url ?? canonicals[0]) : null,
    canonicalDeclared: head ? canonicals.length > 0 : null, canonicalCount: canonicals.length, noindex: /\bnoindex\b/i.test(robots) || undefined,
  };
}

// URL Inspection response → the facts kept per page. Evidence from Google only; `null` when Google was not asked or did not answer.
export function inspectionFacts(apiData, origin, now) {
  const norm = normalizeInspection(apiData, { origin });
  if (!norm.ok) return { at: iso(now), ok: false, message: norm.message };
  return { at: iso(now), ok: true, indexState: classifyIndexState(norm), coverageState: norm.google.coverageState, verdict: norm.google.verdict, lastCrawlTime: norm.google.lastCrawlTime, googleCanonical: norm.google.googleCanonical, userCanonical: norm.google.userCanonical, canonicalStatus: norm.canonical.status };
}

// ---------------------------------------------------------------- findings (derived from the stored evidence, so they clear by themselves)

const NOT_INDEXED = new Set(["NOT_DISCOVERED_BY_GOOGLE", "DISCOVERED_NOT_INDEXED", "CRAWLED_NOT_INDEXED", "BLOCKED_BY_ROBOTS", "NOINDEX", "DUPLICATE", "REDIRECTED", "FETCH_ERROR"]);
const SEVERITY_OF = { BLOCKED_BY_ROBOTS: "high", NOINDEX: "high", FETCH_ERROR: "high", CRAWLED_NOT_INDEXED: "medium", DISCOVERED_NOT_INDEXED: "medium", NOT_DISCOVERED_BY_GOOGLE: "medium", DUPLICATE: "medium", REDIRECTED: "medium" };

export function deriveFindings(ledger, state, cfg, { now }) {
  const findings = [], waiting = [], unconfirmed = [];
  for (const p of Object.values(ledger.pages)) {
    if (p.status !== "live") continue;
    const s = state.pages[p.path];
    if (!s) continue;
    const c = s.crawl, g = s.inspect;
    const ageDays = (now - Date.parse(p.firstSeen)) / DAY;
    if (c && !c.ok) {
      const hard = c.kind === "client-error" || c.kind === "redirected" || c.kind === "redirect-loop" || c.kind === "bad-redirect";
      if (hard || (s.crawlFailures ?? 0) >= cfg.confirmAfter) {
        findings.push({ type: "crawl-failure", path: p.path, severity: c.status === 404 || c.status === 410 || c.kind === "redirect-loop" ? "high" : "medium", basis: "crawl", observedAt: c.at,
          detail: c.kind === "redirected" ? `redirects to ${c.finalUrl}` : c.status ? `HTTP ${c.status}` : c.error,
          action: c.kind === "redirected" ? "Point internal links and the sitemap at the final URL, or remove the page from the sitemap" : "Restore the page or remove it deliberately (and send a removed event so it leaves the sitemap)" });
      } else unconfirmed.push({ path: p.path, detail: c.status ? `HTTP ${c.status}` : c.error, failures: s.crawlFailures ?? 1, confirmAfter: cfg.confirmAfter });
    }
    if (c?.ok || c?.kind === "redirected") {
      const expected = p.canonical ?? p.url;
      if (c.canonical && c.canonical !== expected) findings.push({ type: "unexpected-canonical", path: p.path, severity: "high", basis: "crawl", observedAt: c.at, detail: `the page declares ${c.canonical}; expected ${expected}`, action: "Make the page's canonical tag point to its own address (or record the intended canonical with a changed event)" });
      else if (c.ok && c.canonicalDeclared === false) findings.push({ type: "missing-canonical", path: p.path, severity: "low", basis: "crawl", observedAt: c.at, detail: "the page declares no canonical", action: "Add a self-referencing canonical tag" });
    }
    if (g?.ok) {
      if (g.canonicalStatus === "mismatch") findings.push({ type: "unexpected-canonical", path: p.path, severity: "high", basis: "search-console", observedAt: g.at, detail: `Google chose ${g.googleCanonical}; the page declares ${g.userCanonical}`, action: "Compare the two pages; make the intended page the one Google chooses (consistent canonical, internal links and sitemap)" });
      else if (NOT_INDEXED.has(g.indexState)) {
        if (ageDays < cfg.graceDays) waiting.push({ path: p.path, indexState: g.indexState, ageDays: Math.floor(ageDays), graceDays: cfg.graceDays });
        else findings.push({ type: "not-indexed", path: p.path, severity: SEVERITY_OF[g.indexState] ?? "medium", basis: "search-console", observedAt: g.at, indexState: g.indexState, detail: `${describeState(g.indexState).label}${g.coverageState ? ` (Google: ${g.coverageState})` : ""}`, action: `Google reports "${describeState(g.indexState).label}". First check: ${describeState(g.indexState).checks[0] ?? "the page against Google's stated reason"}` });
      }
    }
  }
  return { findings, waiting, unconfirmed };
}

// ---------------------------------------------------------------- the weekly report

// Periods: the last 7 complete days (ending `lagDays` before today, because Search Console is final about 2 days late) against the 7
// days before them. Same length, same weekdays. A metric with any day missing is "unavailable", never a partial sum; the low-sample
// thresholds are seo-outcomes' own. Page ranking uses clicks, then impressions; this is a comparison of periods, not a cause.
export function weeklyPeriods(today, lagDays) {
  const end = addDays(today, -lagDays);
  return { after: { start: addDays(end, -6), end }, before: { start: addDays(end, -13), end: addDays(end, -7) } };
}

export function compareWeeks(rows, today, { cfg = {}, origin = null } = {}) {
  const c = resolveCfg(cfg);
  const periods = weeklyPeriods(today, c.lagDays);
  // Search Console omits a page on a day it had no impressions, so a page with no row on a day the source DID report (some other page has
  // a row) had zero that day. A day with no row from any page is a missing day, and a metric with a missing day is unavailable.
  const reported = new Set(rows.map((r) => r.date));
  const forPage = (page) => {
    const own = rows.filter((r) => r.page === page);
    const have = new Set(own.map((r) => r.date));
    return [...own, ...[...reported].filter((d) => !have.has(d)).map((date) => ({ date, page, clicks: 0, impressions: 0 }))];
  };
  const one = (rs) => {
    const out = {};
    for (const f of ["clicks", "impressions"]) {
      const b = summarize(rs, periods.before, f), a = summarize(rs, periods.after, f);
      out[f] = b.complete && a.complete ? { available: true, before: b.total, after: a.total, change: a.total - b.total, changePercent: rel(b.total, a.total) }
        : { available: false, reason: b.daysWithData + a.daysWithData === 0 ? `no ${f} rows for either week` : `incomplete: ${b.daysWithData}/7 days before, ${a.daysWithData}/7 after; a comparison needs complete weeks` };
    }
    out.position = { before: positionOf(rs, periods.before), after: positionOf(rs, periods.after) };
    const lowSample = (out.impressions.available && (out.impressions.before < c.minImpressions || out.impressions.after < c.minImpressions)) || (out.clicks.available && (out.clicks.before < c.minClicks || out.clicks.after < c.minClicks));
    return { ...out, lowSample };
  };
  // site totals: sum of the per-day totals across pages
  const byDate = new Map();
  for (const r of rows) { const d = byDate.get(r.date) ?? { date: r.date }; for (const f of ["clicks", "impressions"]) if (typeof r[f] === "number") d[f] = (d[f] ?? 0) + r[f]; byDate.set(r.date, d); }
  const site = one([...byDate.values()]);
  const pages = [...new Set(rows.map((r) => r.page).filter(Boolean))].map((page) => ({ page, ...one(forPage(page)) }));
  return { periods, cfg: { minImpressions: c.minImpressions, minClicks: c.minClicks, lagDays: c.lagDays }, site, pages, interpretation: "association", note: CAUSATION_NOTE, origin };
}

const SEV_WEIGHT = { critical: 40, high: 30, medium: 18, low: 6 };
// Exactly three fixes, never padded: if the evidence supports fewer, fewer are returned and `shortfall` says so.
export function topFixes(findings, comparison, { limit = 3 } = {}) {
  const pageStats = new Map((comparison?.pages ?? []).map((p) => [p.page, p]));
  const lost = (path) => { const s = pageStats.get(path); return s?.clicks?.available && !s.lowSample && s.clicks.change < 0 ? -s.clicks.change : 0; };
  const impressionsAt = (path) => { const s = pageStats.get(path); return s?.impressions?.available ? s.impressions.after : 0; };
  const groups = new Map();
  for (const f of findings) { const k = `${f.type}${f.type === "not-indexed" ? `|${f.indexState}` : ""}`; groups.set(k, [...(groups.get(k) ?? []), f]); }
  const cands = [];
  for (const [key, list] of groups) {
    const paths = list.map((f) => f.path);
    const clicksLost = paths.reduce((s, p) => s + lost(p), 0);
    const decliningPaths = paths.filter((p) => lost(p) > 0);
    const impressions = paths.reduce((s, p) => s + impressionsAt(p), 0);
    const sev = Math.max(...list.map((f) => SEV_WEIGHT[f.severity] ?? 0));
    const score = sev + Math.min(30, paths.length * 3) + Math.min(30, clicksLost) + Math.min(10, Math.round(impressions / 100));
    const first = list[0];
    const reasons = [`${paths.length} page${paths.length > 1 ? "s" : ""}: ${first.detail}${paths.length > 1 ? " (e.g.)" : ""}`, `evidence from ${first.basis === "search-console" ? "Search Console URL Inspection" : "the daily crawl"}, last seen ${String(first.observedAt).slice(0, 10)}`];
    if (decliningPaths.length) reasons.push(`${decliningPaths.length} of these page${decliningPaths.length > 1 ? "s" : ""} also had fewer clicks than the week before (${clicksLost} fewer in total) - this coincides with the problem; it does not prove the problem caused it`);
    cands.push({ key, kind: "finding", type: first.type, title: `${first.action}`, pages: paths.sort(), score, reasons, evidenceBasis: first.basis, confidence: first.basis === "search-console" || first.type === "crawl-failure" ? "high" : "medium" });
  }
  // A real, sizeable traffic drop on a page that has no finding: worth a look, but it is a lead, not a diagnosed problem.
  const flagged = new Set(findings.map((f) => f.path));
  for (const p of comparison?.pages ?? []) {
    if (flagged.has(p.page) || p.lowSample || !p.clicks?.available || p.clicks.change >= 0) continue;
    cands.push({ key: `drop|${p.page}`, kind: "traffic-drop", type: "traffic-drop", title: `Investigate the click drop on ${p.page}`, pages: [p.page], score: Math.min(30, -p.clicks.change) + 5, evidenceBasis: "search-console-performance", confidence: "low",
      reasons: [`clicks ${p.clicks.before} -> ${p.clicks.after} week on week (volumes above the low-sample limits)`, "no crawl or indexing problem was found for this page, so the cause is unknown: check seasonality, ranking changes, and recent edits"] });
  }
  cands.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const fixes = cands.slice(0, limit).map((c, i) => ({ rank: i + 1, ...c }));
  return { fixes, shortfall: fixes.length < limit ? `only ${fixes.length} fix${fixes.length === 1 ? " is" : "es are"} supported by the evidence; none were added to reach ${limit}` : null, considered: cands.length };
}
