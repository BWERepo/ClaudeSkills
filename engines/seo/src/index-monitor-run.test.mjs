import { describe, it, expect } from "vitest";
import { runMonitor, memoryStore, KEYS, syncRegistry, discoverFromSitemap, parseOnPage, submitSitemapNow, kvStore, loadState } from "./index-monitor-run.mjs";
import { queryRecords } from "./index-monitor.mjs";

const ORIGIN = "https://example.com";
const STAGING = "https://staging.example.com";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const D = 86_400_000;
const site = { productionUrl: ORIGIN, stagingUrl: STAGING, sitemapUrl: `${ORIGIN}/sitemap.xml` };

const indexed = (path) => ({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL", lastCrawlTime: "2026-10-09T01:00:00Z", googleCanonical: `${ORIGIN}${path}`, userCanonical: `${ORIGIN}${path}`, sitemap: [`${ORIGIN}/sitemap.xml`] } } });
const unknown = { inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } } };

// A Search Console client double: no network, fully scripted. Counts every call it receives.
function mockClient({ inspect, analytics = { ok: true, data: { rows: [] } }, sitemap, available = true } = {}) {
  const calls = { inspect: [], analytics: 0, sitemap: 0 };
  return {
    calls,
    available,
    status: { enabled: available, reason: available ? null : "the Search Console API is not configured" },
    inspectUrl: async (url) => { calls.inspect.push(url); return typeof inspect === "function" ? inspect(url, calls.inspect.length) : { ok: true, data: indexed(new URL(url).pathname) }; },
    searchAnalytics: async () => { calls.analytics += 1; return analytics; },
    getSitemap: async () => { calls.sitemap += 1; return sitemap ?? { ok: true, data: { lastSubmitted: "2026-10-01T00:00:00Z", lastDownloaded: "2026-10-09T00:00:00Z", isPending: false, errors: "0", warnings: "0", contents: [{ type: "web", submitted: "3", indexed: "0" }] } }; },
    submitSitemap: async () => ({ ok: true, data: {} }),
  };
}

const items = (...paths) => ({ items: paths.map((p) => ({ url: `${ORIGIN}${p}`, title: `Page ${p}`, pageType: "tool", inSitemap: true })) });
const ctxOf = (over = {}) => ({ store: memoryStore(), client: mockClient(), site, now: () => NOW, discover: async () => items("/a", "/b", "/c"), ...over });

describe("discovery", () => {
  it("adds production pages, records timestamps, and ignores every other host", () => {
    const r = syncRegistry({ v: 1, records: {} }, [{ url: `${ORIGIN}/a` }, { url: `${STAGING}/a` }, { url: "http://example.com/b" }, { path: "/c/" }], { origin: ORIGIN, now: NOW });
    expect(Object.keys(r.registry.records).sort()).toEqual(["/a", "/c"]);
    expect(r.ignored).toHaveLength(2);
    expect(r.registry.records["/a"].discoveredAt).toBe(new Date(NOW).toISOString());
    expect(r.registry.records["/a"].environment).toBe("production");
  });
  it("marks pages that disappeared as removed (history kept) and reactivates them if they return", () => {
    let r = syncRegistry({ v: 1, records: {} }, [{ url: `${ORIGIN}/a` }, { url: `${ORIGIN}/b` }], { origin: ORIGIN, now: NOW });
    r = syncRegistry(r.registry, [{ url: `${ORIGIN}/a` }], { origin: ORIGIN, now: NOW + D });
    expect(r.removed).toEqual(["/b"]);
    expect(r.registry.records["/b"]).toMatchObject({ active: false, seoHealth: "REMOVED" });
    r = syncRegistry(r.registry, [{ url: `${ORIGIN}/a` }, { url: `${ORIGIN}/b` }], { origin: ORIGIN, now: NOW + 2 * D });
    expect(r.registry.records["/b"]).toMatchObject({ active: true, removedAt: null });
  });
  it("reads a sitemap, follows one level of sitemap index, and drops other origins", async () => {
    const xml = `<urlset><url><loc>${ORIGIN}/a</loc></url><url><loc>${STAGING}/x</loc></url></urlset>`;
    const d = await discoverFromSitemap({ sitemapXml: xml, origin: ORIGIN, sitemapUrl: site.sitemapUrl });
    expect(d.items.map((i) => i.url)).toEqual([`${ORIGIN}/a`]);
    expect(d.ignored).toEqual([`${STAGING}/x`]);
    const idx = `<sitemapindex><sitemap><loc>${ORIGIN}/s1.xml</loc></sitemap></sitemapindex>`;
    const d2 = await discoverFromSitemap({ sitemapXml: idx, origin: ORIGIN, sitemapUrl: site.sitemapUrl, fetchText: async () => `<urlset><url><loc>${ORIGIN}/z</loc></url></urlset>` });
    expect(d2.items.map((i) => i.url)).toEqual([`${ORIGIN}/z`]);
  });
  it("a failed discovery does NOT mark every page removed", async () => {
    const ctx = ctxOf();
    await runMonitor(ctx);
    const res = await runMonitor({ ...ctx, discover: async () => { throw new Error("boom"); }, now: () => NOW + 3_600_000 * 8 });
    expect(res.errors[0].stage).toBe("discovery");
    const { registry } = await loadState(ctx.store);
    expect(Object.values(registry.records).every((r) => r.active)).toBe(true);
  });
  it("a new tool published later enters monitoring on the next run", async () => {
    const ctx = ctxOf();
    await runMonitor(ctx);
    const res = await runMonitor({ ...ctx, discover: async () => items("/a", "/b", "/c", "/new"), now: () => NOW + 8 * 3_600_000 });
    expect(res.added).toEqual(["/new"]);
    const { registry } = await loadState(ctx.store);
    expect(registry.records["/new"]).toMatchObject({ indexState: "INDEXED", environment: "production" });
  });
});

describe("a monitoring run", () => {
  it("inspects due production URLs, stores normalized fields, the raw response and a summary", async () => {
    const ctx = ctxOf();
    const res = await runMonitor(ctx);
    expect(res).toMatchObject({ ok: true, inspected: 3 });
    const { registry, meta } = await loadState(ctx.store);
    expect(registry.records["/a"]).toMatchObject({ indexState: "INDEXED", stage: "INDEXED", seoHealth: "OK", checks: 1 });
    expect(registry.records["/a"].google).toMatchObject({ verdict: "PASS", coverageState: "Submitted and indexed" });
    expect(meta.googleApi).toMatchObject({ status: "OK" });
    const detail = await ctx.store.get(KEYS.detail("/a"));
    expect(detail.raw.inspectionResult.indexStatusResult.verdict).toBe("PASS");
    expect((await ctx.store.get(KEYS.summary)).productionUrls).toBe(3);
    expect(meta.quota.used).toBe(3);
  });
  it("only ever sends production URLs to Google", async () => {
    const ctx = ctxOf({ discover: async () => ({ items: [{ url: `${ORIGIN}/a` }, { url: `${STAGING}/a` }] }) });
    await runMonitor(ctx);
    expect(ctx.client.calls.inspect).toEqual([`${ORIGIN}/a`]);
  });
  it("creates history on a state change and not otherwise", async () => {
    let n = 0;
    const client = mockClient({ inspect: (url) => ({ ok: true, data: n++ === 0 ? unknown : indexed(new URL(url).pathname) }) });
    const ctx = ctxOf({ client, discover: async () => items("/a") });
    await runMonitor(ctx);
    await runMonitor({ ...ctx, now: () => NOW + 2 * D });
    await runMonitor({ ...ctx, now: () => NOW + 4 * D });
    const { registry } = await loadState(ctx.store);
    expect(registry.records["/a"].history.map((h) => `${h.from}>${h.to}`)).toEqual(["NOT_CHECKED>NOT_DISCOVERED_BY_GOOGLE", "NOT_DISCOVERED_BY_GOOGLE>INDEXED"]);
  });
  it("walks a new page through the whole lifecycle and records each milestone once", async () => {
    const pub = new Date(NOW - 8 * D).toISOString();
    const steps = [unknown, { inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-06T01:00:00Z" } } }, indexed("/a")];
    let i = 0;
    const client = mockClient({ inspect: () => ({ ok: true, data: steps[Math.min(i++, 2)] }), analytics: { ok: true, data: { rows: [{ keys: [`${ORIGIN}/a`, "2026-10-08"], impressions: 4, clicks: 0, position: 9 }] } } });
    const ctx = ctxOf({ client, discover: async () => ({ items: [{ url: `${ORIGIN}/a`, publishedAt: pub }] }) });
    for (let k = 0; k < 4; k++) await runMonitor({ ...ctx, now: () => NOW + k * D });
    const { registry } = await loadState(ctx.store);
    const m = registry.records["/a"].milestones;
    expect(m.googleDiscovered).toBe(new Date(NOW + D).toISOString());
    expect(m.firstCrawlSeen).toBe("2026-10-06T01:00:00Z");
    expect(m.firstIndexedSeen).toBe(new Date(NOW + 2 * D).toISOString());
    expect(m.firstImpression).toBe("2026-10-08");
    expect(registry.records["/a"].stage).toBe("RECEIVING_IMPRESSIONS");
  });
  it("respects the batch size and never inspects more than the daily cap allows", async () => {
    const many = { items: Array.from({ length: 60 }, (_, i) => ({ url: `${ORIGIN}/p${i}` })) };
    const ctx = ctxOf({ discover: async () => many, config: { batchSize: 10 } });
    expect((await runMonitor(ctx)).inspected).toBe(10);
    const ctx2 = ctxOf({ discover: async () => many, config: { batchSize: 10, dailyInspectionCap: 4 } });
    expect((await runMonitor(ctx2)).inspected).toBe(4);
    expect((await runMonitor({ ...ctx2, now: () => NOW + 3_600_000 * 7 })).inspected).toBe(0); // allowance used up until midnight UTC
    expect((await runMonitor({ ...ctx2, now: () => NOW + D })).inspected).toBe(4); // a new UTC day
  });
  it("stays inside the subrequest budget", async () => {
    const many = { items: Array.from({ length: 60 }, (_, i) => ({ url: `${ORIGIN}/p${i}` })) };
    const res = await runMonitor(ctxOf({ discover: async () => many, config: { batchSize: 60 }, subrequestBudget: 40 }));
    expect(res.inspected).toBeGreaterThan(5);
    expect(res.subrequests).toBeLessThanOrEqual(40);
  });
  it("does not re-inspect stable pages on the next run", async () => {
    const ctx = ctxOf();
    await runMonitor(ctx);
    const before = ctx.client.calls.inspect.length;
    await runMonitor({ ...ctx, now: () => NOW + 3_600_000 });
    expect(ctx.client.calls.inspect.length).toBe(before);
  });
});

describe("Google failures", () => {
  const failing = (kind, message = "x") => mockClient({ inspect: () => ({ ok: false, kind, message }) });
  it("an API outage keeps previous states and reports 'unavailable', never 'not indexed'", async () => {
    const ctx = ctxOf();
    await runMonitor(ctx);
    const down = { ...ctx, client: failing("network"), now: () => NOW + 3 * D };
    const res = await runMonitor(down);
    expect(res.ok).toBe(false);
    const { registry, meta } = await loadState(ctx.store);
    for (const r of Object.values(registry.records)) {
      expect(r.indexState).toBe("INDEXED");
      expect(r.seoHealth).toBe("UNAVAILABLE");
    }
    expect(meta.googleApi).toMatchObject({ status: "ERROR", lastErrorKind: "network" });
    expect((await ctx.store.get(KEYS.summary)).unavailable).toBe(3);
  });
  it("stops after three consecutive failures instead of hammering Google", async () => {
    const ctx = ctxOf({ client: failing("api-error"), discover: async () => ({ items: Array.from({ length: 20 }, (_, i) => ({ url: `${ORIGIN}/p${i}` })) }) });
    await runMonitor(ctx);
    expect(ctx.client.calls.inspect).toHaveLength(3);
  });
  it("permission and authentication failures stop the whole run at the first call", async () => {
    for (const kind of ["permission-denied", "auth-failed"]) {
      const ctx = ctxOf({ client: failing(kind) });
      await runMonitor(ctx);
      expect(ctx.client.calls.inspect).toHaveLength(1);
      expect((await loadState(ctx.store)).meta.googleApi.lastErrorKind).toBe(kind);
    }
  });
  it("a quota failure pauses Google calls until the next UTC day", async () => {
    const ctx = ctxOf({ client: failing("quota") });
    await runMonitor(ctx);
    const { meta } = await loadState(ctx.store);
    expect(meta.googleApi.pausedUntil).toBe("2026-10-11T00:00:00.000Z");
    const again = await runMonitor({ ...ctx, client: mockClient(), now: () => NOW + 3_600_000 });
    expect(again.inspected).toBe(0);
  });
  it("a malformed Google response is recorded as a failure, not a state", async () => {
    const ctx = ctxOf({ client: mockClient({ inspect: () => ({ ok: true, data: { nonsense: true } }) }) });
    const res = await runMonitor(ctx);
    expect(res.errors[0].kind).toBe("malformed");
    expect(Object.values((await loadState(ctx.store)).registry.records).every((r) => r.indexState === "NOT_CHECKED")).toBe(true);
  });
  it("without credentials it still discovers pages and says Search Console is not configured", async () => {
    const ctx = ctxOf({ client: mockClient({ available: false }) });
    const res = await runMonitor(ctx);
    expect(res.inspected).toBe(0);
    const s = await ctx.store.get(KEYS.summary);
    expect(s.productionUrls).toBe(3);
    expect(s.searchConsole).toMatchObject({ connected: null, status: "NOT_CONFIGURED" });
    expect(ctx.client.calls.inspect).toHaveLength(0);
  });
  it("Search Analytics failing does not disturb index states", async () => {
    const ctx = ctxOf({ client: mockClient({ analytics: { ok: false, kind: "network", message: "x" } }) });
    await runMonitor(ctx);
    const { registry, meta } = await loadState(ctx.store);
    expect(meta.analytics.status).toBe("UNAVAILABLE");
    expect(registry.records["/a"].indexState).toBe("INDEXED");
    expect(registry.records["/a"].metrics).toBeNull();
  });
});

describe("administrator actions are throttled", () => {
  it("Refresh Google status can't be spammed", async () => {
    const ctx = ctxOf();
    await runMonitor(ctx);
    const a = await runMonitor({ ...ctx, now: () => NOW + 3_600_000 }, { mode: "refresh" });
    expect(a.ok).toBe(true);
    const calls = ctx.client.calls.inspect.length;
    const b = await runMonitor({ ...ctx, now: () => NOW + 3_600_000 + 60_000 }, { mode: "refresh" });
    expect(b).toMatchObject({ ok: false, skipped: "throttled" });
    expect(b.retryAfterSeconds).toBeGreaterThan(0);
    expect(ctx.client.calls.inspect.length).toBe(calls);
  });
  it("Check URL now is throttled per URL and does not need the URL to be due", async () => {
    const ctx = ctxOf();
    await runMonitor(ctx);
    const a = await runMonitor({ ...ctx, now: () => NOW + 3_600_000 }, { mode: "url", paths: ["/a"] });
    expect(a).toMatchObject({ ok: true, inspected: 1 });
    const b = await runMonitor({ ...ctx, now: () => NOW + 3_600_000 + 120_000 }, { mode: "url", paths: ["/a"] });
    expect(b).toMatchObject({ ok: false, skipped: "throttled" });
    const c = await runMonitor({ ...ctx, now: () => NOW + 3_600_000 + 120_000 }, { mode: "url", paths: ["/b"] });
    expect(c.inspected).toBe(1); // a different URL is its own cooldown
    expect((await runMonitor({ ...ctx, now: () => NOW + 4_000_000 }, { mode: "url", paths: ["/nope"] })).skipped).toBe("unknown-url");
  });
  it("two overlapping runs do not both execute (soft lock)", async () => {
    const ctx = ctxOf();
    await ctx.store.put(KEYS.lock, { at: new Date(NOW - 60_000).toISOString() });
    expect(await runMonitor(ctx)).toMatchObject({ ok: false, skipped: "busy" });
    await ctx.store.put(KEYS.lock, { at: new Date(NOW - 10 * 60_000).toISOString() }); // a stale lock does not block forever
    expect((await runMonitor(ctx)).ok).toBe(true);
    expect(await ctx.store.get(KEYS.lock)).toBeNull();
  });
});

describe("site-level state, alerts and staging", () => {
  it("raises a staging-indexable alert, and no alert when staging is hidden", async () => {
    const exposed = ctxOf({ fetchStaging: async () => ({ reachable: true, xRobotsTag: null, html: "<html></html>", robotsTxt: "User-agent: *\nAllow: /" }) });
    await runMonitor(exposed);
    expect((await loadState(exposed.store)).meta.alerts.some((a) => a.type === "STAGING_INDEXABLE")).toBe(true);
    const hidden = ctxOf({ fetchStaging: async () => ({ reachable: true, xRobotsTag: "noindex, nofollow", html: "", robotsTxt: "User-agent: *\nDisallow: /" }) });
    await runMonitor(hidden);
    const meta = (await loadState(hidden.store)).meta;
    expect(meta.staging.status).toBe("PROTECTED");
    expect(meta.alerts.some((a) => a.type === "STAGING_INDEXABLE")).toBe(false);
  });
  it("opens a NEW_INDEXING_PROBLEM alert when an indexed page drops out, and resolves it on recovery", async () => {
    let phase = 0;
    const client = mockClient({ inspect: (url) => ({ ok: true, data: phase === 1 ? { inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-09T01:00:00Z" } } } : indexed(new URL(url).pathname) }) });
    const ctx = ctxOf({ client, discover: async () => items("/a") });
    await runMonitor(ctx);
    phase = 1;
    await runMonitor({ ...ctx, now: () => NOW + 20 * D });
    let alerts = (await loadState(ctx.store)).meta.alerts;
    expect(alerts.find((a) => a.type === "NEW_INDEXING_PROBLEM" && !a.resolvedAt)).toMatchObject({ previously: "INDEXED", now: "CRAWLED_NOT_INDEXED" });
    phase = 0;
    await runMonitor({ ...ctx, now: () => NOW + 40 * D });
    alerts = (await loadState(ctx.store)).meta.alerts;
    expect(alerts.find((a) => a.type === "NEW_INDEXING_PROBLEM").resolvedAt).toBeTruthy();
  });
  it("a repeated outage raises a site-level 'temporarily unavailable' alert, never page alerts", async () => {
    const ctx = ctxOf({ client: mockClient({ inspect: () => ({ ok: false, kind: "network", message: "x" }) }) });
    for (let k = 0; k < 4; k++) await runMonitor({ ...ctx, now: () => NOW + k * 8 * 3_600_000 });
    const alerts = (await loadState(ctx.store)).meta.alerts;
    expect(alerts.map((a) => a.type)).toContain("GOOGLE_STATUS_UNAVAILABLE");
    expect(alerts.some((a) => a.type === "NEW_INDEXING_PROBLEM")).toBe(false);
  });
  it("sitemap status is read and cached; Search Analytics fills impressions and clicks", async () => {
    const ctx = ctxOf({ client: mockClient({ analytics: { ok: true, data: { rows: [{ keys: [`${ORIGIN}/a`, "2026-10-08"], impressions: 12, clicks: 3, position: 6.4 }] } } }) });
    await runMonitor(ctx);
    const { registry, meta } = await loadState(ctx.store);
    expect(meta.sitemap).toMatchObject({ status: "HEALTHY", errors: 0, lastDownloaded: "2026-10-09T00:00:00Z" });
    expect(registry.records["/a"].metrics).toMatchObject({ impressions: 12, clicks: 3, position: 6.4 });
    expect(registry.records["/b"].metrics).toMatchObject({ impressions: 0 });
    await runMonitor({ ...ctx, now: () => NOW + 3_600_000 });
    expect(ctx.client.calls.sitemap).toBe(1); // cached for a day: not re-read on every run
    expect(ctx.client.calls.analytics).toBe(1);
  });
  it("sitemap errors reported by Google become an alert", async () => {
    const ctx = ctxOf({ client: mockClient({ sitemap: { ok: true, data: { errors: "2", warnings: "0", contents: [] } } }) });
    await runMonitor(ctx);
    expect((await loadState(ctx.store)).meta.alerts.some((a) => a.type === "SITEMAP_ERRORS")).toBe(true);
  });
  it("submitting the sitemap is idempotent: an already-registered sitemap is not resubmitted", async () => {
    let puts = 0;
    const client = { ...mockClient(), submitSitemap: async () => { puts += 1; return { ok: true, data: {} }; }, status: { enabled: true } };
    const searchConsoleConfig = { analytics: { searchConsole: { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON", verifiedProperty: "example.com", propertyType: "Domain", sitemap: { url: site.sitemapUrl } } }, environments: { production: { url: ORIGIN, hosts: ["example.com"] }, staging: { url: STAGING, hosts: ["staging.example.com"] } } };
    const r = await submitSitemapNow({ client, store: memoryStore(), site, searchConsoleConfig, now: () => NOW });
    expect(r.action).toBe("none");
    expect(puts).toBe(0);
  });
});

describe("on-page checks", () => {
  it("reads noindex, the canonical and the internal links from the page itself", () => {
    const html = `<html><head><title>Word &amp; Counter</title><meta name="robots" content="index, follow"><link rel="canonical" href="${ORIGIN}/a"></head><body><a href="/b">b</a><a href="${ORIGIN}/c/">c</a><a href="https://other.test/x">x</a><a href="#top">t</a><a href="mailto:a@b.c">m</a></body></html>`;
    expect(parseOnPage(html, ORIGIN)).toMatchObject({ noindex: false, canonicalUrl: `${ORIGIN}/a`, title: "Word & Counter", links: ["/b", "/c"] });
    expect(parseOnPage('<meta name="robots" content="noindex,nofollow">', ORIGIN).noindex).toBe(true);
  });
  it("counts internal links to a page and flags a page that says noindex itself", async () => {
    const pages = { "/a": `<a href="/b">b</a>`, "/b": `<a href="/a">a</a><a href="/c">c</a>`, "/c": `<meta name="robots" content="noindex">` };
    const ctx = ctxOf({ fetchHtml: async (p) => pages[p] });
    await runMonitor(ctx);
    const { registry } = await loadState(ctx.store);
    expect(registry.records["/b"].internalLinksIn).toBe(1);
    expect(registry.records["/a"].internalLinksIn).toBe(1);
    expect(registry.records["/c"]).toMatchObject({ attention: true });
    expect(registry.records["/c"].attentionReason).toMatch(/noindex/);
  });
  it("a page that cannot be read is left unchecked instead of guessed", async () => {
    const ctx = ctxOf({ fetchHtml: async () => { throw new Error("nope"); } });
    await runMonitor(ctx);
    const { registry } = await loadState(ctx.store);
    expect(registry.records["/a"].pageCheck).toBeUndefined();
    expect(registry.records["/a"].internalLinksIn ?? null).toBeNull();
  });
});

describe("storage and the admin list", () => {
  it("kvStore reads and writes JSON and treats unreadable data as empty", async () => {
    const data = new Map();
    const kv = { get: async (k, t) => { const v = data.get(k); if (v === "BAD") throw new Error("bad json"); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, put: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
    const s = kvStore(kv);
    await s.put("gi:x", { a: 1 });
    expect(await s.get("gi:x")).toEqual({ a: 1 });
    data.set("gi:bad", "BAD");
    expect(await s.get("gi:bad")).toBeNull();
    await s.delete("gi:x");
    expect(await s.get("gi:x")).toBeNull();
  });
  it("a stored registry can be listed, filtered and sorted straight away", async () => {
    const ctx = ctxOf({ client: mockClient({ inspect: (url) => ({ ok: true, data: url.endsWith("/c") ? unknown : indexed(new URL(url).pathname) }) }) });
    await runMonitor(ctx);
    const { registry } = await loadState(ctx.store);
    const q = queryRecords(Object.values(registry.records), { filter: "not_discovered" });
    expect(q.rows.map((r) => r.path)).toEqual(["/c"]);
  });
});
