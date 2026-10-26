// BWESEO Keyword Performance — fetching, caching and orchestration. Zero dependencies, no Node-only imports (runs in a Cloudflare
// Worker and in Node). Engine 1.10.0. The pure rules live in keyword-performance.mjs, keyword-registry.mjs and keyword-target.mjs.
//
// A site supplies the same thin adapter the Google index monitor uses (index-monitor-run.mjs):
//   store        { get, put, delete }   kvStore(kv) for Cloudflare KV, memoryStore() for tests (re-exported here)
//   client       createSearchConsoleClient(...) from gsc-client.mjs  (credentials stay in the host's secrets, server-side only)
//   site         { productionUrl, stagingUrl?, sitemapUrl }          from the site's own seo-config — never hard-coded here
//   environment  "production" (default) | anything else refuses to call Google
//   fetchPage(path) → { status, redirectedTo?, xRobotsTag?, html }     optional: lets target pages be validated
//   fetchText(url)  → string | null                                    optional: the sitemap and robots.txt
//
// Nothing here runs during a visitor request: call it from a scheduled handler or an administrator action. It never scrapes or
// simulates Google. It reads Search Console's Search Analytics (query × page) — the site's own data.
//
// Storage (all keys prefixed "kw:"; the monitor's "gi:" keys are only READ):
//   kw:snapshot  { v, fetchedAt, range, prevRange, rows[[query,path,clicks,impressions,position]], prevRows, truncated, dropped }
//   kw:targets   { at, byPath: { <target>: inspectTargetPage result }, checks: { <target>: { checkedAt, attemptedAt, error? } }, sitemap }
//                validation cache; each run checks at most `maxTargets` pages (never-checked first, then least recently attempted)
//   kw:lock:*    { at, owner }   run locks (refresh / targets). Concurrency contract: see index-monitor-run.mjs — single-flight is
//                guaranteed only on a store with an atomic `acquire`; on plain KV it is best-effort and the daily call cap may be
//                exceeded by at most one other overlapping run's spend.
//   kw:meta      { lastRefreshAt, lastError, calls: { date, used } }
// History is NOT stored: Search Console returns up to 16 months on demand, so the "previous period" is fetched with the current one.
import { checkCooldown, normalizeUrl, isProductionUrl } from "./index-monitor.mjs";
import { KEYS as GI_KEYS, kvStore, memoryStore, acquireLock, releaseLock } from "./index-monitor-run.mjs";
import { rangeFor, previousRange, parseRows, indexRows, analyzeSite, analyzeKeyword, pageView, resolveThresholds, tableRows, queryTable } from "./keyword-performance.mjs";
import { registryOf, findKeyword, normalizeKeyword } from "./keyword-registry.mjs";
import { inspectTargetPage, analyzeSitemap, inboundCounts, readPage } from "./keyword-target.mjs";

export { kvStore, memoryStore };
export const KW_KEYS = { snapshot: "kw:snapshot", targets: "kw:targets", meta: "kw:meta", lockRefresh: "kw:lock:refresh", lockTargets: "kw:lock:targets" };
export const LIMITS = Object.freeze({
  ttlHours: 6, // a cached snapshot this young is served without calling Google
  manualRefreshCooldownMinutes: 15,
  dailyCallCap: 40, // our own ceiling on Search Analytics requests per UTC day (Google's is far higher)
  rowLimit: 25_000, // the API's maximum rows per request
  maxPages: 4,
  targetTtlHours: 24, // a target validated more recently than this is not due again
  targetRetryMinutes: 60, // a target whose last fetch failed is due again after this long
  lockMinutes: 5, // a run lock older than this is treated as abandoned
  maxTargets: 25, // pages fetched per validation run (Worker subrequest budget)
});

const iso = (t) => new Date(t).toISOString();
const utcDay = (t) => iso(t).slice(0, 10);
const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const fail = (kind, message, extra = {}) => ({ ok: false, kind, message, ...extra });

async function loadMeta(store, now) {
  const m = (await store.get(KW_KEYS.meta)) ?? {};
  return { ...m, calls: m.calls?.date === utcDay(now) ? m.calls : { date: utcDay(now), used: 0 } };
}

// ---------------------------------------------------------------- refresh from Search Console

// Fetch (or serve from cache) the keyword × page performance for a range. Never throws. A failed call keeps the previous
// snapshot, which is returned with stale:true — an API problem is never shown as "no impressions".
export async function refreshKeywordPerformance(ctx, { range = "28d", force = false } = {}) {
  const now = ctx.now?.() ?? Date.now();
  const { store, client, site } = ctx;
  const cfg = resolveThresholds(ctx.cfg);
  const limits = { ...LIMITS, ...(ctx.limits ?? {}) };
  const env = ctx.environment ?? "production";
  // Staging, preview and local never talk to Google about this site's keywords.
  if (env !== "production") return fail("not-production", `Keyword performance is only fetched for the production site (this is ${env}). Staging, preview and local are never submitted to Google.`);
  const origin = site?.productionUrl;
  if (!origin) return fail("not-configured", "the site's production URL is not configured");
  const r = rangeFor(range, now, cfg);
  if (!r.ok) return fail("bad-range", r.error);
  const fresh = (c) => c && c.range?.key === r.key && c.range?.startDate === r.startDate && c.range?.endDate === r.endDate && now - (ms(c.fetchedAt) ?? 0) < limits.ttlHours * 3_600_000;
  const early = await store.get(KW_KEYS.snapshot);
  if (!force && fresh(early)) return { ok: true, cached: true, fetchedAt: early.fetchedAt, range: early.range, message: "Served from cache — Search Console was not called." };
  // Serialize with any overlapping scheduled or manual run. Everything below re-reads its state AFTER the lock is held, so the
  // second run sees the first one's snapshot and budget instead of overwriting them. (Atomic only where the store is; see the header.)
  const lock = await acquireLock(store, KW_KEYS.lockRefresh, { now, ttlMs: limits.lockMinutes * 60_000 });
  if (!lock.ok) return fail("busy", "Another keyword refresh is already running.");
  try {
    const res = await (async () => {
    const meta = await loadMeta(store, now);
    const cached = await store.get(KW_KEYS.snapshot);
    const sameRange = cached && cached.range?.key === r.key && cached.range?.startDate === r.startDate && cached.range?.endDate === r.endDate;
    const age = cached ? now - (ms(cached.fetchedAt) ?? 0) : Infinity;
    if (sameRange && !force && age < limits.ttlHours * 3_600_000) return { ok: true, cached: true, fetchedAt: cached.fetchedAt, range: cached.range, message: "Served from cache — Search Console was not called." };
    if (force) {
      const cd = checkCooldown(meta.lastRefreshAt, now, limits.manualRefreshCooldownMinutes, "Keyword performance");
      if (!cd.ok) return fail("cooldown", cd.reason, { retryAfterSeconds: cd.retryAfterSeconds, cached: !!cached, fetchedAt: cached?.fetchedAt ?? null });
    }
    if (!client?.available) {
      const m = { ...meta, lastError: { kind: client?.status?.enabled ? "not-configured" : "disabled", message: client?.status?.reason ?? "the Search Console API is not available", at: iso(now) } };
      await store.put(KW_KEYS.meta, m);
      return fail(m.lastError.kind, m.lastError.message, { stale: !!cached, fetchedAt: cached?.fetchedAt ?? null });
    }
    let used = meta.calls.used;
    const spend = (n = 1) => { if (used + n > limits.dailyCallCap) return false; used += n; return true; };
    const pull = async (rg) => {
      const rows = [];
      for (let page = 0; page < limits.maxPages; page++) {
        if (!spend()) return fail("budget", `Today's Search Console request allowance for keyword performance (${limits.dailyCallCap}) is used up. It resets at midnight UTC.`);
        const res = await client.searchAnalytics({ startDate: rg.startDate, endDate: rg.endDate, dimensions: ["query", "page"], rowLimit: limits.rowLimit, startRow: page * limits.rowLimit });
        if (!res.ok) return res;
        const got = Array.isArray(res.data?.rows) ? res.data.rows : [];
        rows.push(...got);
        if (got.length < limits.rowLimit) return { ok: true, rows, truncated: false };
      }
      return { ok: true, rows, truncated: true };
    };
    let rg = r;
    let cur = await pull(rg);
    let widened = false;
    // A brand-new site may have nothing in 28 days but something in 3 months; say so rather than showing an empty screen.
    if (cur.ok && !cur.rows.length && r.key === "28d" && ctx.autoWiden !== false) {
      const wide = rangeFor("3m", now, cfg);
      const again = await pull(wide);
      if (again.ok && again.rows.length) { cur = again; rg = wide; widened = true; }
    }
    if (!cur.ok) {
      const m = { ...meta, calls: { date: utcDay(now), used }, lastError: { kind: cur.kind, message: cur.message, at: iso(now) } };
      await store.put(KW_KEYS.meta, m);
      return fail(cur.kind, cur.message, { stale: !!cached, fetchedAt: cached?.fetchedAt ?? null });
    }
    const prevR = previousRange(rg);
    const prev = await pull(prevR); // trend; failure here only removes the trend
    const parsed = parseRows({ rows: cur.rows }, { origin });
    const prevParsed = prev.ok ? parseRows({ rows: prev.rows }, { origin }) : { rows: [], dropped: 0 };
    const keep = (rows) => [...rows].sort((a, b) => b.impressions - a.impressions).slice(0, cfg.maxRows).map((x) => [x.rawQuery, x.path, x.clicks, x.impressions, x.position]);
    const snapshot = { v: 1, fetchedAt: iso(now), range: rg, prevRange: prev.ok ? prevR : null, rows: keep(parsed.rows), prevRows: keep(prevParsed.rows), truncated: !!(cur.truncated || parsed.rows.length > cfg.maxRows), dropped: parsed.dropped, widened };
    await store.put(KW_KEYS.snapshot, snapshot);
    await store.put(KW_KEYS.meta, { lastRefreshAt: iso(now), lastError: null, calls: { date: utcDay(now), used } });
    return { ok: true, cached: false, fetchedAt: snapshot.fetchedAt, range: rg, rows: snapshot.rows.length, widened, truncated: snapshot.truncated, trend: prev.ok, message: widened ? "No data in the last 28 days, so the last 3 months are shown." : "Refreshed from Search Console." };
    })();
    return { ...res, lock: { atomic: lock.atomic } };
  } finally {
    await releaseLock(store, KW_KEYS.lockRefresh, lock.owner);
  }
}

// ---------------------------------------------------------------- validating target pages (site crawl; no Google)

// Fetch registered target pages (production only), read the sitemap and robots.txt, and cache the facts.
// Work per run is bounded (`maxTargets` page fetches, a Worker subrequest budget) but every target is reached over successive runs:
// targets never checked go first (in registry order), then the least recently attempted. A target whose fetch fails keeps its last
// valid result (marked with the error) and yields its place to others next time. Targets that leave the registry are dropped from
// the cache; new ones are picked up at once. `force` re-checks regardless of age, still within the per-run bound.
export function targetCoverage(cache, registry, now, limits = LIMITS) {
  const uniq = [...new Map(registry.map((r) => [r.targetUrl, r])).keys()];
  const ttl = limits.targetTtlHours * 3_600_000;
  const info = (u) => cache?.checks?.[u] ?? (cache?.byPath?.[u] ? { checkedAt: cache.at, attemptedAt: cache.at } : null); // caches from before per-target stamps
  const checked = uniq.filter((u) => ms(info(u)?.checkedAt) != null);
  const fresh = checked.filter((u) => now - ms(info(u).checkedAt) < ttl);
  const times = checked.map((u) => ms(info(u).checkedAt));
  return {
    total: uniq.length, checked: checked.length, fresh: fresh.length, pending: uniq.length - fresh.length, neverChecked: uniq.length - checked.length,
    failing: uniq.filter((u) => info(u)?.error).length,
    oldestCheckedAt: times.length ? iso(Math.min(...times)) : null, newestCheckedAt: times.length ? iso(Math.max(...times)) : null,
  };
}

export async function refreshTargets(ctx, registry, { force = false } = {}) {
  const now = ctx.now?.() ?? Date.now();
  const { store, site } = ctx;
  const limits = { ...LIMITS, ...(ctx.limits ?? {}) };
  if ((ctx.environment ?? "production") !== "production") return fail("not-production", "Target pages are validated on the production site only.");
  if (typeof ctx.fetchPage !== "function") return fail("not-configured", "this site did not supply fetchPage, so target pages cannot be validated");
  const origin = site.productionUrl;
  const ttl = limits.targetTtlHours * 3_600_000;
  const retry = limits.targetRetryMinutes * 60_000; // a failed fetch is retried sooner than a healthy target is re-validated
  const unique = [...new Map(registry.map((r) => [r.targetUrl, r])).values()];
  const due = (cache) => {
    const checks = cache?.checks ?? {};
    const stamp = (u) => checks[u] ?? (cache?.byPath?.[u] ? { checkedAt: cache.at, attemptedAt: cache.at } : null);
    return unique.map((r, i) => ({ r, i, s: stamp(r.targetUrl) }))
      .filter((x) => force || !x.s || now - (ms(x.s.attemptedAt) ?? 0) >= (x.s.error ? retry : ttl))
      .sort((a, b) => (a.s ? 1 : 0) - (b.s ? 1 : 0) || (ms(a.s?.attemptedAt) ?? 0) - (ms(b.s?.attemptedAt) ?? 0) || a.i - b.i)
      .map((x) => x.r);
  };
  const early = await store.get(KW_KEYS.targets);
  if (!due(early).length) return { ok: true, cached: true, at: early?.at ?? null, coverage: targetCoverage(early, registry, now, limits) };
  const lock = await acquireLock(store, KW_KEYS.lockTargets, { now, ttlMs: limits.lockMinutes * 60_000 });
  if (!lock.ok) return fail("busy", "Another target validation is already running.");
  try {
    const cached = await store.get(KW_KEYS.targets); // re-read: an overlapping run may just have finished
    const batch = due(cached).slice(0, limits.maxTargets);
    if (!batch.length) return { ok: true, cached: true, at: cached?.at ?? null, coverage: targetCoverage(cached, registry, now, limits), lock: { atomic: lock.atomic } };
    const sitemapXml = typeof ctx.fetchText === "function" && site.sitemapUrl ? await ctx.fetchText(site.sitemapUrl).catch(() => null) : null;
    const robotsTxt = typeof ctx.fetchText === "function" ? await ctx.fetchText(`${origin.replace(/\/+$/, "")}/robots.txt`).catch(() => null) : null;
    const sm = analyzeSitemap(sitemapXml, { origin });
    const links = (await store.get(GI_KEYS.links)) ?? {};
    const inbound = inboundCounts(links);
    const have = Object.keys(links).length > 0;
    const keep = new Set(unique.map((r) => r.targetUrl));
    const byPath = Object.fromEntries(Object.entries(cached?.byPath ?? {}).filter(([u]) => keep.has(u))); // removed targets leave the cache
    const checks = Object.fromEntries(unique.map((r) => [r.targetUrl, cached?.checks?.[r.targetUrl] ?? (cached?.byPath?.[r.targetUrl] ? { checkedAt: cached.at, attemptedAt: cached.at } : null)]).filter(([, v]) => v));
    let ok = 0, failed = 0, skipped = 0;
    for (const r of batch) {
      const n = normalizeUrl(r.targetUrl, origin);
      if (!n || !isProductionUrl(n.url, { productionUrl: origin })) { skipped += 1; continue; } // never fetch anything but the production origin
      const res = await ctx.fetchPage(n.path).catch((e) => ({ status: null, error: String(e?.message ?? e) }));
      if (res?.status == null) { // the fetch itself failed: keep any earlier valid result, remember the failure, retry in turn
        failed += 1;
        checks[r.targetUrl] = { ...(checks[r.targetUrl] ?? { checkedAt: null }), attemptedAt: iso(now), error: redactErr(res?.error ?? "no response") };
        if (!byPath[r.targetUrl]) byPath[r.targetUrl] = inspectTargetPage({ path: n.path, origin, status: null, robotsTxt, sitemapPaths: sm.detected ? sm.paths : null, inboundLinks: have ? inbound[n.path] ?? 0 : null, keyword: r.primaryKeyword ?? r.keyword });
        continue;
      }
      ok += 1;
      byPath[r.targetUrl] = inspectTargetPage({ path: n.path, origin, status: res.status, redirectedTo: res.redirectedTo, xRobotsTag: res.xRobotsTag, html: res.html, robotsTxt, sitemapPaths: sm.detected ? sm.paths : null, inboundLinks: have ? inbound[n.path] ?? 0 : null, keyword: r.primaryKeyword ?? r.keyword });
      checks[r.targetUrl] = { checkedAt: iso(now), attemptedAt: iso(now) };
    }
    // The sitemap verdict covers EVERY cached target, not only this batch.
    const probes = {};
    for (const r of unique) {
      const v = byPath[r.targetUrl]; const n = normalizeUrl(r.targetUrl, origin);
      if (v && n) probes[n.path] = { status: v.httpStatus, redirectedTo: v.redirectedTo, noindex: v.robotsDirectives.some((d) => /noindex|none/.test(d)), canonicalPath: v.canonical?.status === "other" ? normalizeUrl(v.canonical.url, origin)?.path : null };
    }
    const sitemap = sm.detected ? { ...analyzeSitemap(sitemapXml, { origin, probes }), paths: undefined, targetsListed: registry.filter((r) => sm.paths.includes(normalizeUrl(r.targetUrl, origin)?.path)).length } : { detected: false, problems: [], entries: 0 };
    const out = { at: iso(now), byPath, checks, sitemap, robotsFetched: robotsTxt != null };
    await store.put(KW_KEYS.targets, out);
    return { ok: true, cached: false, at: out.at, checked: ok, failed, skipped, batch: batch.length, coverage: targetCoverage(out, registry, now, limits), lock: { atomic: lock.atomic } };
  } finally {
    await releaseLock(store, KW_KEYS.lockTargets, lock.owner);
  }
}
const redactErr = (m) => String(m).replace(/[\r\n]+/g, " ").slice(0, 200);

// ---------------------------------------------------------------- the read model

// Everything the admin screen / CLI / /BWESEO needs, computed from what is STORED — it never calls Google or fetches pages.
//   inventory: the site's seo/content-inventory.json (the registry lives in it)
export async function getKeywordPerformance(ctx, { inventory, siteId = null } = {}) {
  const now = ctx.now?.() ?? Date.now();
  const cfg = resolveThresholds(ctx.cfg);
  const registry = registryOf(inventory, { siteId });
  const snap = await ctx.store.get(KW_KEYS.snapshot);
  const meta = await loadMeta(ctx.store, now);
  const targets = await ctx.store.get(KW_KEYS.targets);
  const gi = await ctx.store.get(GI_KEYS.registry);
  const toRows = (arr, origin) => parseRows({ rows: (arr ?? []).map((a) => ({ keys: [a[0], origin + a[1]], clicks: a[2], impressions: a[3], position: a[4] })) }, { origin }).rows;
  const origin = ctx.site?.productionUrl ?? "https://invalid.example";
  const index = indexRows(toRows(snap?.rows, origin));
  const prevIndex = snap?.prevRange ? indexRows(toRows(snap?.prevRows, origin)) : null;
  const records = gi?.records ?? {};
  const normPath = (p) => normalizeUrl(p, origin)?.path ?? p;
  const indexRecords = Object.fromEntries(registry.map((r) => [r.targetUrl, records[normPath(r.targetUrl)] ?? null]));
  const firstDetected = Object.fromEntries(registry.map((r) => { const rec = records[normPath(r.targetUrl)]; const page = inventory?.pages?.find((p) => p.id === r.pageId); return [r.targetUrl, rec?.publishedAt ?? rec?.discoveredAt ?? page?.publishedOn ?? page?.created ?? null]; }));
  const regNorm = registry.map((r) => ({ ...r, targetUrl: normPath(r.targetUrl) }));
  const validations = Object.fromEntries(registry.map((r) => [normPath(r.targetUrl), targets?.byPath?.[r.targetUrl] ?? null]));
  const site = analyzeSite({ registry: regNorm, inventory, index, prevIndex, range: snap?.range ?? null, prevRange: snap?.prevRange ?? null, validations, indexRecords: Object.fromEntries(regNorm.map((r, i) => [r.targetUrl, indexRecords[registry[i].targetUrl]])), firstDetected: Object.fromEntries(regNorm.map((r, i) => [r.targetUrl, firstDetected[registry[i].targetUrl]])), now, cfg });
  const age = snap ? now - (ms(snap.fetchedAt) ?? 0) : null;
  return {
    ...site, registry: regNorm, index, prevIndex, snapshot: snap ? { fetchedAt: snap.fetchedAt, range: snap.range, truncated: snap.truncated, widened: !!snap.widened, droppedOtherOrigin: snap.dropped } : null,
    lastUpdated: snap?.fetchedAt ?? null, stale: age != null && age > (ctx.limits?.ttlHours ?? LIMITS.ttlHours) * 3_600_000 * 4,
    lastError: meta.lastError ?? null, sitemap: targets?.sitemap ?? null, targetsCheckedAt: targets?.at ?? null, targetCoverage: targetCoverage(targets, registry, now, { ...LIMITS, ...(ctx.limits ?? {}) }),
    table: (opts) => queryTable(tableRows(site.analyses), opts),
  };
}

// "Check a Google keyword": analyze ONE phrase from the site's own stored Search Console data. NOT a Google search.
export async function lookupKeyword(ctx, { inventory, keyword }) {
  const data = await getKeywordPerformance(ctx, { inventory });
  const entry = findKeyword(data.registry, keyword)[0] ?? null;
  const origin = ctx.site?.productionUrl;
  const mine = entry ? data.analyses.find((x) => x.target?.path === entry.targetUrl) : null;
  const rec = entry ? ((await ctx.store.get(GI_KEYS.registry))?.records?.[normalizeUrl(entry.targetUrl, origin)?.path ?? entry.targetUrl] ?? null) : null;
  const a = analyzeKeyword({ keyword, entry, index: data.index, prevIndex: data.prevIndex, related: data.registry, validation: mine?.validation ?? null, indexRecord: rec, range: data.snapshot?.range ?? null, siteHasData: (data.index?.totalRows ?? 0) > 0, firstDetected: entry?.dateAdded, now: ctx.now?.() ?? Date.now(), cfg: ctx.cfg });
  return { ok: true, source: "the site's own Search Console data (not a Google search)", lastUpdated: data.lastUpdated, analysis: a };
}

export { pageView, normalizeKeyword, readPage };
