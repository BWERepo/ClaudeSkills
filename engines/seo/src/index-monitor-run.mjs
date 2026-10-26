// BWESEO Google Index Monitoring — storage and orchestration. Zero dependencies, no Node-only imports (runs in a
// Cloudflare Worker's scheduled handler and in Node). Engine 1.9.0. The pure rules live in index-monitor.mjs.
//
// A site supplies a thin ADAPTER (see docs/methodology/google-index-monitoring.md):
//   store         { get(key), put(key, value), delete(key) }   JSON in/out — kvStore(kv) for Cloudflare KV, memoryStore() for tests
//   client        createSearchConsoleClient(...) from gsc-client.mjs (service account, read from the host's secrets)
//   site          { productionUrl, stagingUrl?, sitemapUrl }    from the site's own seo-config — never hard-coded here
//   discover()    → { items: [{ url|path, title, pageType, publishedAt, indexable, itemId, itemName }] } the site's production pages
//   fetchHtml(path)   optional   the page's HTML, for the on-page checks (indexable, canonical, internal links)
//   fetchStaging()    optional   → { reachable, xRobotsTag, html, robotsTxt } for the staging-hidden check
//
// Nothing here runs during a visitor request. It is called from a scheduled handler or an administrator action only.
//
// Storage layout (all keys prefixed "gi:"):
//   gi:registry   { v, records: { <path>: compact record } }   one blob: a list view never costs one read per URL
//   gi:detail:<p> { raw, rawAt }                               the last raw Google response for ONE URL (state history is kept in its registry record)
//   gi:meta       site-level state: Google API status, quota, sitemap, staging check, alerts, run log
//   gi:summary    the compact snapshot /BWESEO and the admin header read
//   gi:links      { <path>: [internal link paths] }            outbound links per page, for the internal-link check
//   gi:lock       { at, owner }                                run lock so a cron run and a manual refresh do not overlap — see "Concurrency contract"
//
// Concurrency contract. Single-flight is guaranteed ONLY when the store provides an atomic `acquire(key, record, { staleBefore })`
// (and `release(key, owner)`): memoryStore does (one process), and a host may supply one backed by a Durable Object, a database row
// with a unique key, or similar. kvStore (Cloudflare KV) has no compare-and-set and is eventually consistent, so it gets a
// best-effort write-then-verify lock that narrows, but does not close, the window; runs report `lock.atomic: false` then. On such a
// store two runs that start at nearly the same moment can both proceed, and a locally enforced budget can be exceeded by at most
// the other run's own spend (every run re-reads its budget after taking the lock and stays within its own subrequest budget).

import {
  DEFAULTS, resolveConfig, normalizeUrl, isProductionUrl, newRecord, applyInspection, applyInspectionFailure, applyAnalytics,
  normalizeInspection, dueRecords, scheduleInfo, quotaFor, quotaRemaining, checkCooldown, deriveAlerts, mergeAlerts,
  evaluateHealth, currentStage, evaluateStagingProtection, summarize, parseSitemapLocs, isSitemapIndex,
} from "./index-monitor.mjs";
import { reconcileSitemap } from "./gsc-client.mjs";

export const KEYS = { registry: "gi:registry", meta: "gi:meta", summary: "gi:summary", links: "gi:links", lock: "gi:lock", detail: (path) => `gi:detail:${encodeURIComponent(path)}` };
const LOCK_MINUTES = 5;

const iso = (t) => new Date(t).toISOString();
const isStr = (v) => typeof v === "string" && v.trim() !== "";

// ---------------------------------------------------------------- storage adapters

export function kvStore(kv) {
  return {
    get: async (key) => {
      try { return await kv.get(key, "json"); } catch { return null; } // unreadable data behaves as "nothing stored" and is rebuilt
    },
    put: (key, value) => kv.put(key, JSON.stringify(value)),
    delete: (key) => kv.delete(key),
    atomic: false, // KV has no compare-and-set; acquireLock falls back to write-then-verify
  };
}

export function memoryStore(initial = {}) {
  const m = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  return {
    get: async (key) => (m.has(key) ? JSON.parse(JSON.stringify(m.get(key))) : null),
    put: async (key, value) => void m.set(key, JSON.parse(JSON.stringify(value))),
    delete: async (key) => void m.delete(key),
    // Atomic within one process: no await between the check and the write, so two callers cannot both win.
    atomic: true,
    acquire: async (key, record, { staleBefore = -Infinity } = {}) => {
      const cur = m.get(key);
      if (cur && !(Date.parse(cur.at) <= staleBefore)) return false;
      m.set(key, JSON.parse(JSON.stringify(record)));
      return true;
    },
    release: async (key, owner) => { const cur = m.get(key); if (!cur || cur.owner === undefined || cur.owner === owner) m.delete(key); },
    _dump: () => Object.fromEntries(m),
  };
}

let lockSeq = 0;
// Take a named run lock. Returns { ok: true, owner, atomic } or { ok: false }. Never throws for a busy lock.
export async function acquireLock(store, key, { now, ttlMs, owner = `${now}-${++lockSeq}-${Math.random().toString(36).slice(2, 10)}` }) {
  const record = { at: iso(now), owner };
  if (typeof store.acquire === "function") {
    return (await store.acquire(key, record, { staleBefore: now - ttlMs })) ? { ok: true, owner, atomic: store.atomic === true } : { ok: false };
  }
  const cur = await store.get(key);
  if (cur && now - Date.parse(cur.at) < ttlMs) return { ok: false };
  await store.put(key, record);
  const back = await store.get(key); // write-then-verify: a best-effort check, not an atomic guarantee
  return back?.owner === owner ? { ok: true, owner, atomic: false } : { ok: false };
}
// Release only a lock that is still ours (a run that outlived its TTL must not delete the next run's lock).
export async function releaseLock(store, key, owner) {
  if (typeof store.release === "function") return store.release(key, owner);
  const cur = await store.get(key);
  if (!cur || cur.owner === undefined || cur.owner === owner) await store.delete(key);
}

export async function loadState(store) {
  const registry = (await store.get(KEYS.registry)) ?? { v: 1, records: {} };
  const meta = (await store.get(KEYS.meta)) ?? { v: 1 };
  return { registry: { v: 1, records: registry.records ?? {} }, meta };
}

// ---------------------------------------------------------------- on-page checks (pure)

const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const attr = (tag, name) => decode(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.[1] ?? new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.[2] ?? "");

// What the page itself says about indexing and its canonical, plus its internal links. Read from the page's own HTML.
export function parseOnPage(html, origin) {
  const h = String(html ?? "");
  const metas = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const robots = metas.filter((t) => /name\s*=\s*["']robots["']/i.test(t)).map((t) => attr(t, "content")).join(",").toLowerCase();
  const canonTag = [...h.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /rel\s*=\s*["']canonical["']/i.test(t));
  const links = new Set();
  for (const m of h.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    const n = normalizeUrl(href, origin);
    if (n) links.add(n.path.split("?")[0]);
  }
  return {
    noindex: /noindex/.test(robots),
    canonicalUrl: canonTag ? attr(canonTag, "href") || null : null,
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? "") || null,
    links: [...links],
  };
}

// ---------------------------------------------------------------- registry sync

// Reconcile the stored registry with what the site says is a production page right now. New pages are added with their
// timestamps; pages that are gone are marked inactive (history kept); URLs on any other origin are ignored and reported.
export function syncRegistry(registry, items, { origin, now }) {
  const records = { ...registry.records };
  const added = [];
  const ignored = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const n = normalizeUrl(it.url ?? it.path, origin);
    if (!n || !isProductionUrl(n.url, { productionUrl: origin })) { ignored.push(String(it.url ?? it.path)); continue; }
    seen.add(n.path);
    let r = records[n.path];
    if (!r) { r = newRecord(n.path, n.url, now); added.push(n.path); }
    else if (r.active === false) r = { ...r, active: true, removedAt: null, discoveredAt: iso(now) };
    records[n.path] = {
      ...r,
      url: n.url,
      title: it.title ?? r.title ?? null,
      pageType: it.pageType ?? r.pageType ?? null,
      itemId: it.itemId ?? r.itemId ?? undefined,
      itemName: it.itemName ?? r.itemName ?? undefined,
      publishedAt: it.publishedAt ?? r.publishedAt ?? null,
      indexable: it.indexable ?? r.indexable ?? true,
      inSitemap: it.inSitemap ?? true,
      sitemapUrl: it.sitemapUrl ?? r.sitemapUrl ?? null,
      milestones: { ...(r.milestones ?? {}), ...(it.inSitemap !== false && !r.milestones?.inSitemapSeen ? { inSitemapSeen: iso(now) } : {}) },
    };
  }
  const removed = [];
  for (const [path, r] of Object.entries(records)) {
    if (!seen.has(path) && r.active !== false) { records[path] = { ...r, active: false, removedAt: iso(now), seoHealth: "REMOVED", attention: false, attentionReason: null }; removed.push(path); }
  }
  return { registry: { v: 1, records }, added, removed, ignored };
}

// Discover production pages from a sitemap document (one level of sitemap index supported through fetchText).
export async function discoverFromSitemap({ sitemapXml, fetchText, origin, sitemapUrl }) {
  const items = [];
  const bad = [];
  const eat = (xml, from) => { for (const loc of parseSitemapLocs(xml)) { const n = normalizeUrl(loc, origin); if (n) items.push({ url: n.url, inSitemap: true, sitemapUrl: from }); else bad.push(loc); } };
  if (isSitemapIndex(sitemapXml) && fetchText) {
    for (const child of parseSitemapLocs(sitemapXml).slice(0, 20)) { const xml = await fetchText(child).catch(() => null); if (xml) eat(xml, child); }
  } else eat(sitemapXml, sitemapUrl);
  return { items, ignored: bad };
}

// ---------------------------------------------------------------- the run

// Cloudflare Workers count every KV call and fetch as a subrequest (50 per invocation on the free plan). The runner
// counts its own work and stops adding inspections before the budget is spent, so a run always finishes cleanly.
function makeBudget(total) {
  let used = 0;
  return { use: (n = 1) => void (used += n), left: () => Math.max(0, total - used), used: () => used };
}

const FATAL_KINDS = new Set(["permission-denied", "auth-failed", "not-configured", "disabled", "quota"]);

/**
 * Run one monitoring pass.
 *   mode "cron"      scheduled: the due URLs, highest priority first, within the batch, quota and budget
 *   mode "refresh"   administrator "Refresh Google status": the stalest URLs first, throttled
 *   mode "url"       administrator "Check URL now" (paths: [path]): throttled per URL
 */
export async function runMonitor(ctx, { mode = "cron", paths = [] } = {}) {
  const cfg = resolveConfig(ctx.config);
  const now = (ctx.now ?? Date.now)();
  const origin = ctx.site.productionUrl;
  const budget = makeBudget(ctx.subrequestBudget ?? 40);
  const store = ctx.store;
  const out = { ok: true, mode, at: iso(now), inspected: 0, added: [], removed: [], skipped: null, errors: [], quotaUsed: 0, subrequests: 0 };

  // lock
  const lock = await acquireLock(store, KEYS.lock, { now, ttlMs: LOCK_MINUTES * 60_000 }); budget.use(2);
  if (!lock.ok) return { ...out, ok: false, skipped: "busy", message: "Another monitoring run is in progress." };
  out.lock = { atomic: lock.atomic };
  try {
    let { registry, meta } = await loadState(store); budget.use(2);
    meta.googleApi = meta.googleApi ?? { status: "NOT_CONFIGURED", consecutiveFailures: 0 };

    // administrator throttles — before any Google call
    if (mode === "refresh") {
      const c = checkCooldown(meta.lastManualRefreshAt, now, cfg.manualRefreshCooldownMinutes, "Google status");
      if (!c.ok) return { ...out, ok: false, skipped: "throttled", message: c.reason, retryAfterSeconds: c.retryAfterSeconds };
    }
    if (mode === "url") {
      const rec = registry.records[paths[0]];
      if (!rec) return { ...out, ok: false, skipped: "unknown-url", message: "That URL is not in the registry." };
      const c = checkCooldown(rec.lastManualCheckAt, now, cfg.manualUrlCooldownMinutes, rec.path);
      if (!c.ok) return { ...out, ok: false, skipped: "throttled", message: c.reason, retryAfterSeconds: c.retryAfterSeconds };
    }

    // 1. discovery (a failed discovery must NOT mark every page as removed)
    try {
      const found = await ctx.discover(); budget.use();
      const sync = syncRegistry(registry, found.items, { origin, now });
      registry = sync.registry; out.added = sync.added; out.removed = sync.removed;
      if (sync.ignored.length) out.ignoredNonProduction = sync.ignored.length;
    } catch (e) { out.errors.push({ stage: "discovery", message: String(e?.message ?? e).slice(0, 200) }); }

    const client = ctx.client;
    const apiUsable = !!client?.available;
    const paused = meta.googleApi.pausedUntil && now < Date.parse(meta.googleApi.pausedUntil);
    if (!apiUsable) meta.googleApi = { ...meta.googleApi, status: "NOT_CONFIGURED", reason: client?.status?.reason ?? "the Search Console API is not configured" };

    // 2. on-page checks for new/stale pages (the site's own HTML; indexable, canonical, internal links)
    const links = (await store.get(KEYS.links)) ?? {}; budget.use();
    if (ctx.fetchHtml) {
      const todo = Object.values(registry.records).filter((r) => r.active !== false && (!r.pageCheck?.at || now - Date.parse(r.pageCheck.at) > 7 * 86_400_000)).slice(0, ctx.pageCheckBatch ?? 6);
      for (const r of todo) {
        try {
          const html = await ctx.fetchHtml(r.path);
          const p = parseOnPage(html, origin);
          links[r.path] = p.links;
          registry.records[r.path] = { ...r, title: r.title ?? p.title, canonicalUrl: p.canonicalUrl, pageCheck: { at: iso(now), noindex: p.noindex, canonicalMatches: p.canonicalUrl ? normalizeUrl(p.canonicalUrl, origin)?.url === r.url : false } };
        } catch { /* the page could not be read from here; leave it unchecked rather than guessing */ }
      }
    }
    const inbound = {};
    for (const [from, tos] of Object.entries(links)) for (const to of tos) if (to !== from) inbound[to] = (inbound[to] ?? 0) + 1;
    const haveLinks = Object.keys(links).length > 0;
    for (const [p, r] of Object.entries(registry.records)) registry.records[p] = { ...r, internalLinksIn: haveLinks && links[p] !== undefined ? inbound[p] ?? 0 : r.internalLinksIn ?? null };

    // 3. choose what to inspect (priority, quota, subrequest budget)
    let targets = [];
    const active = Object.values(registry.records).filter((r) => r.active !== false && r.indexable !== false);
    meta.quota = quotaFor(meta.quota, now);
    const reserve = 14; // KV writes, analytics, sitemap, staging
    const perUrl = 2; // one Google call + one write of the raw response
    const room = Math.min(cfg.batchSize, quotaRemaining(meta.quota, now, cfg), Math.max(0, Math.floor((budget.left() - reserve) / perUrl)));
    if (mode === "url") targets = active.filter((r) => r.path === paths[0]).slice(0, 1);
    else if (mode === "refresh") targets = [...active].sort((a, b) => (Date.parse(a.inspect?.at) || 0) - (Date.parse(b.inspect?.at) || 0)).slice(0, room);
    else targets = dueRecords(active, now, cfg).slice(0, room);
    if (mode === "url" && quotaRemaining(meta.quota, now, cfg) < 1) { out.skipped = "quota"; out.message = "The daily Google inspection allowance this system allows itself is used up. It resets at midnight UTC."; targets = []; }

    // 4. inspect
    let consecutive = 0;
    if (apiUsable && !paused) {
      let tokenBudgetCharged = false;
      for (const r of targets) {
        if (!isProductionUrl(r.url, { productionUrl: origin })) continue; // staging/other hosts are never sent to Google
        if (!tokenBudgetCharged) { budget.use(); tokenBudgetCharged = true; }
        budget.use(); meta.quota.used += 1; out.quotaUsed += 1;
        const res = await client.inspectUrl(r.url);
        const norm = res.ok ? normalizeInspection(res.data, { origin }) : null;
        if (res.ok && norm?.ok) {
          const prev = registry.records[r.path];
          const { record, event } = applyInspection(prev, norm, now, cfg);
          // State history lives in the record itself (changes are rare, so it stays small and needs no extra read);
          // the detail key holds the latest raw Google response for diagnosis.
          const history = event ? [...(record.history ?? []), event].slice(-cfg.historyLimit) : record.history ?? [];
          registry.records[r.path] = { ...record, history, ...(mode === "url" ? { lastManualCheckAt: iso(now) } : {}) };
          await store.put(KEYS.detail(r.path), { raw: res.data, rawAt: iso(now) }); budget.use();
          out.inspected += 1; consecutive = 0;
          meta.googleApi = { status: "OK", consecutiveFailures: 0, lastOkAt: iso(now) };
        } else {
          const failure = res.ok ? { kind: "malformed", message: norm?.message ?? "malformed Google response" } : res;
          registry.records[r.path] = applyInspectionFailure(registry.records[r.path], failure, now, cfg);
          out.errors.push({ stage: "inspect", path: r.path, kind: failure.kind, message: failure.message });
          consecutive += 1;
          meta.googleApi = { ...meta.googleApi, status: "ERROR", lastErrorKind: failure.kind, lastErrorAt: iso(now), lastErrorMessage: String(failure.message ?? "").slice(0, 200), consecutiveFailures: (meta.googleApi.consecutiveFailures ?? 0) + 1 };
          if (failure.kind === "quota") { meta.googleApi.pausedUntil = iso(Date.parse(`${iso(now).slice(0, 10)}T00:00:00Z`) + 86_400_000); break; }
          if (FATAL_KINDS.has(failure.kind) || consecutive >= 3) break; // every further call would fail the same way — stop hammering Google
        }
      }
    }
    if (mode === "refresh") meta.lastManualRefreshAt = iso(now);

    // 5. sitemap status (cached; read-only here — submitting is a deliberate administrator action)
    if (apiUsable && !paused && ctx.site.sitemapUrl && budget.left() > 6 && (!meta.sitemap?.checkedAt || now - Date.parse(meta.sitemap.checkedAt) > cfg.sitemapCheckHours * 3_600_000 || mode === "refresh")) {
      budget.use();
      const got = await client.getSitemap(ctx.site.sitemapUrl);
      if (got.ok) meta.sitemap = sitemapView(got.data, ctx.site.sitemapUrl, now);
      else meta.sitemap = { url: ctx.site.sitemapUrl, status: got.kind === "not-found" ? "NOT_SUBMITTED" : "UNAVAILABLE", checkedAt: iso(now), errorKind: got.kind, message: got.message };
    }

    // 6. Search Analytics (cached once a day): metrics per URL and the first-impression dates
    if (apiUsable && !paused && budget.left() > 6 && (!meta.analytics?.at || now - Date.parse(meta.analytics.at) > cfg.analyticsRefreshHours * 3_600_000)) {
      const lookback = 90;
      const end = iso(now - 86_400_000).slice(0, 10);
      const start = iso(now - lookback * 86_400_000).slice(0, 10);
      const rows = [];
      let failed = null;
      let truncated = false;
      for (let page = 0; page < 3; page++) {
        budget.use();
        const r = await client.searchAnalytics({ startDate: start, endDate: end, dimensions: ["page", "date"], rowLimit: 25000, startRow: page * 25000, type: "web" });
        if (!r.ok) { failed = r; break; }
        const got = Array.isArray(r.data?.rows) ? r.data.rows : [];
        rows.push(...got);
        if (got.length < 25000) break;
        if (page === 2) truncated = true;
      }
      if (!failed) { registry.records = applyAnalytics(registry.records, rows, { origin, now, windowDays: cfg.windowDays, lookbackDays: lookback, truncated }); meta.analytics = { at: iso(now), status: "OK", rows: rows.length, truncated }; }
      else meta.analytics = { ...(meta.analytics ?? {}), status: "UNAVAILABLE", errorKind: failed.kind, errorAt: iso(now) };
    }

    // 7. staging must stay hidden (read-only evidence; never an indexing action)
    if (ctx.fetchStaging && ctx.site.stagingUrl && (!meta.staging?.checkedAt || now - Date.parse(meta.staging.checkedAt) > cfg.stagingCheckHours * 3_600_000)) {
      budget.use(3);
      try { meta.staging = { ...evaluateStagingProtection(await ctx.fetchStaging()), checkedAt: iso(now), url: ctx.site.stagingUrl }; }
      catch { meta.staging = { status: "UNKNOWN", reasons: ["the staging check failed"], indexable: null, checkedAt: iso(now), url: ctx.site.stagingUrl }; }
    }

    // 8. recompute health, alerts, summary
    const derived = {};
    for (const [p, r] of Object.entries(registry.records)) {
      const h = evaluateHealth(r, now, cfg);
      registry.records[p] = { ...r, ...h, stage: currentStage(r) };
      derived[p] = deriveAlerts(registry.records[p], now, cfg);
    }
    const siteAlerts = [];
    if (meta.staging && (meta.staging.status === "EXPOSED" || meta.staging.status === "PARTIAL")) siteAlerts.push({ key: "staging-indexable", type: "STAGING_INDEXABLE", at: iso(now), status: meta.staging.status, warning: meta.staging.warning });
    if ((meta.googleApi.consecutiveFailures ?? 0) >= cfg.failureAlertAfter) siteAlerts.push({ key: "google-api-unavailable", type: "GOOGLE_STATUS_UNAVAILABLE", at: iso(now), kind: meta.googleApi.lastErrorKind, note: "Google status is temporarily unavailable. Pages keep their last known state; nothing was marked not indexed." });
    if (meta.sitemap && Number(meta.sitemap.errors) > 0) siteAlerts.push({ key: "sitemap-errors", type: "SITEMAP_ERRORS", at: iso(now), errors: meta.sitemap.errors });
    meta.alerts = mergeAlerts(meta.alerts, derived, siteAlerts, now, cfg);
    meta.lastRun = { at: iso(now), mode, inspected: out.inspected, errors: out.errors.length, subrequests: budget.used() };
    meta.v = 1;

    await store.put(KEYS.registry, registry);
    await store.put(KEYS.links, links);
    await store.put(KEYS.meta, meta);
    await store.put(KEYS.summary, summarize(Object.values(registry.records), meta, now));
    out.subrequests = budget.used() + 4;
    out.summary = await store.get(KEYS.summary);
    if (out.errors.length && !out.inspected && out.errors.some((e) => e.stage === "inspect")) out.ok = false;
    return out;
  } finally {
    await releaseLock(store, KEYS.lock, lock.owner);
  }
}

// An administrator's explicit "Submit sitemap". Idempotent: a sitemap Google already has is reported, not resubmitted.
export async function submitSitemapNow(ctx, { force = false } = {}) {
  const now = (ctx.now ?? Date.now)();
  const r = await reconcileSitemap({ client: ctx.client, config: ctx.searchConsoleConfig, dryRun: false, force });
  const { meta } = await loadState(ctx.store);
  if (r.sitemap) {
    const got = await ctx.client.getSitemap(ctx.site.sitemapUrl);
    meta.sitemap = got.ok ? sitemapView(got.data, ctx.site.sitemapUrl, now, r.sitemap.submissionAt) : meta.sitemap;
    await ctx.store.put(KEYS.meta, meta);
  }
  return r;
}

// Fields exactly as the Sitemaps API returns them; nothing the API omits is invented.
export function sitemapView(data, url, now, submittedHint) {
  const errors = Number(data?.errors ?? 0);
  const warnings = Number(data?.warnings ?? 0);
  const web = (data?.contents ?? []).find((c) => c.type === "web");
  return {
    url,
    status: errors > 0 ? "ERRORS" : data?.isPending ? "PENDING" : "HEALTHY",
    lastSubmitted: data?.lastSubmitted ?? submittedHint ?? null,
    lastDownloaded: data?.lastDownloaded ?? null,
    isPending: data?.isPending === true,
    errors,
    warnings,
    submittedUrls: Number.isFinite(Number(web?.submitted)) ? Number(web.submitted) : null,
    indexedUrls: Number.isFinite(Number(web?.indexed)) ? Number(web.indexed) : null, // Google has deprecated this count; shown only if returned
    checkedAt: iso(now),
  };
}

export { DEFAULTS, scheduleInfo };
