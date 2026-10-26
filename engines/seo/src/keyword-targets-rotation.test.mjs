import { describe, it, expect } from "vitest";
import { refreshTargets, refreshKeywordPerformance, targetCoverage, memoryStore, kvStore, KW_KEYS, LIMITS } from "./keyword-performance-run.mjs";
import { acquireLock, releaseLock } from "./index-monitor-run.mjs";

const ORIGIN = "https://example.test";
const T0 = Date.parse("2026-10-20T12:00:00Z");
const H = 3_600_000;
const site = { productionUrl: ORIGIN, sitemapUrl: `${ORIGIN}/sitemap.xml` };
const html = (p) => `<!doctype html><html><head><title>${p}</title><link rel="canonical" href="${ORIGIN}${p}"></head><body><h1>${p}</h1><p>${"Words about this page. ".repeat(40)}</p></body></html>`;
const regOf = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ targetUrl: `/p/${from + i}`, keyword: `keyword ${from + i}`, primaryKeyword: `keyword ${from + i}` }));
function mk(over = {}) {
  const calls = [];
  const t = { now: T0 };
  const ctx = { store: memoryStore(), site, now: () => t.now, fetchPage: async (p) => { calls.push(p); return { status: 200, html: html(p) }; }, fetchText: async () => null, ...over };
  return { ctx, calls, t };
}

describe("target validation reaches every page over successive runs", () => {
  it("rotates through 60 targets 25 at a time without repeating or starving", async () => {
    const { ctx, calls, t } = mk();
    const reg = regOf(60);
    const r1 = await refreshTargets(ctx, reg);
    expect(r1).toMatchObject({ ok: true, checked: 25, coverage: { total: 60, checked: 25, pending: 35, neverChecked: 35 } });
    t.now += 60_000;
    const r2 = await refreshTargets(ctx, reg);
    expect(r2.coverage).toMatchObject({ checked: 50, pending: 10 });
    t.now += 60_000;
    const r3 = await refreshTargets(ctx, reg);
    expect(r3).toMatchObject({ checked: 10, coverage: { total: 60, checked: 60, fresh: 60, pending: 0, neverChecked: 0 } });
    expect(new Set(calls).size).toBe(60); // every page exactly once so far
    expect(calls).toHaveLength(60);
    const cache = await ctx.store.get(KW_KEYS.targets);
    expect(Object.keys(cache.byPath)).toHaveLength(60); // results from earlier batches are retained
  });
  it("serves from cache once everything is fresh and re-checks only what ages out, oldest first", async () => {
    const { ctx, calls, t } = mk();
    const reg = regOf(30);
    await refreshTargets(ctx, reg); t.now += 60_000; await refreshTargets(ctx, reg);
    calls.length = 0; t.now += 60_000;
    expect(await refreshTargets(ctx, reg)).toMatchObject({ ok: true, cached: true, coverage: { pending: 0 } });
    expect(calls).toHaveLength(0);
    t.now += 24 * H; // the first batch (25) ages out before the last 5 do
    const r = await refreshTargets(ctx, reg);
    expect(r.checked).toBe(25);
    expect(calls[0]).toBe("/p/0");
  });
  it("force re-checks regardless of age but stays within the per-run bound and rotates by oldest check", async () => {
    const { ctx, calls, t } = mk();
    const reg = regOf(30);
    await refreshTargets(ctx, reg); t.now += 60_000; await refreshTargets(ctx, reg);
    calls.length = 0; t.now += 60_000;
    const r = await refreshTargets(ctx, reg, { force: true });
    expect(r.checked).toBe(25);
    expect(calls).toEqual(Array.from({ length: 25 }, (_, i) => `/p/${i}`)); // the 25 oldest checks, not the first 25 of the list again
    calls.length = 0; t.now += 60_000;
    await refreshTargets(ctx, reg, { force: true });
    expect(calls.slice(0, 5)).toEqual(["/p/25", "/p/26", "/p/27", "/p/28", "/p/29"]); // a second forced run moves on to the rest
  });
  it("picks up added targets first and drops removed ones from the cache", async () => {
    const { ctx, calls, t } = mk();
    await refreshTargets(ctx, regOf(10));
    calls.length = 0; t.now += 60_000;
    const reg = [...regOf(8, 2), ...regOf(3, 100)]; // /p/0 and /p/1 removed, three added
    const r = await refreshTargets(ctx, reg);
    expect(calls.sort()).toEqual(["/p/100", "/p/101", "/p/102"]);
    expect(r.coverage).toMatchObject({ total: 11, checked: 11, pending: 0 });
    const cache = await ctx.store.get(KW_KEYS.targets);
    expect(cache.byPath["/p/0"]).toBeUndefined();
    expect(cache.checks["/p/1"]).toBeUndefined();
  });
  it("keeps the last valid result when a fetch fails, reports it, and retries after the retry interval", async () => {
    let fail = false;
    const calls = [];
    const { ctx, t } = mk({ fetchPage: async (p) => { calls.push(p); if (fail && p === "/p/1") throw new Error("socket hang up"); return { status: 200, html: html(p) }; } });
    const reg = regOf(3);
    await refreshTargets(ctx, reg);
    const good = (await ctx.store.get(KW_KEYS.targets)).byPath["/p/1"];
    fail = true; t.now += 25 * H;
    const r = await refreshTargets(ctx, reg);
    expect(r).toMatchObject({ ok: true, failed: 1, coverage: { failing: 1, checked: 3 } });
    const cache = await ctx.store.get(KW_KEYS.targets);
    expect(cache.byPath["/p/1"]).toEqual(good); // stale-but-valid result kept
    expect(cache.checks["/p/1"].error).toMatch(/socket/);
    expect(cache.checks["/p/1"].checkedAt).toBe(new Date(T0).toISOString()); // freshness is not advanced by a failure
    expect(r.coverage.pending).toBe(1);
    calls.length = 0; t.now += 10 * 60_000;
    expect((await refreshTargets(ctx, reg)).cached).toBe(true); // not hammered
    t.now += H; fail = false;
    expect(await refreshTargets(ctx, reg)).toMatchObject({ checked: 1, coverage: { failing: 0, pending: 0 } });
    expect(calls).toEqual(["/p/1"]);
  });
  it("a target that never fetched is recorded as unreachable, not as valid, and does not block others", async () => {
    const { ctx } = mk({ fetchPage: async (p) => { if (p === "/p/0") throw new Error("boom"); return { status: 200, html: html(p) }; } });
    const r = await refreshTargets(ctx, regOf(3));
    expect(r).toMatchObject({ failed: 1, checked: 2, coverage: { total: 3, checked: 2, neverChecked: 1, failing: 1 } });
  });
  it("targetCoverage understands a cache written before per-target stamps", () => {
    const cov = targetCoverage({ at: new Date(T0).toISOString(), byPath: { "/p/0": {} } }, regOf(2), T0 + H);
    expect(cov).toMatchObject({ total: 2, checked: 1, fresh: 1, pending: 1 });
  });
  it("never fetches a non-production target and refuses outside production", async () => {
    const { ctx, calls } = mk();
    await refreshTargets(ctx, [{ targetUrl: "https://staging.example.test/x", keyword: "k" }, ...regOf(1)]);
    expect(calls).toEqual(["/p/0"]);
    expect(await refreshTargets({ ...ctx, environment: "staging" }, regOf(1))).toMatchObject({ ok: false, kind: "not-production" });
  });
});

describe("overlapping runs", () => {
  it("serializes two simultaneous target validations on an atomic store: pages are fetched once", async () => {
    const { ctx, calls } = mk();
    const slow = { ...ctx, fetchPage: async (p) => { calls.push(p); await new Promise((r) => setTimeout(r, 5)); return { status: 200, html: html(p) }; } };
    const [a, b] = await Promise.all([refreshTargets(slow, regOf(5)), refreshTargets(slow, regOf(5))]);
    expect([a, b].filter((x) => x.kind === "busy")).toHaveLength(1);
    expect(calls).toHaveLength(5);
    expect(await ctx.store.get(KW_KEYS.lockTargets)).toBeNull();
  });
  it("two simultaneous keyword refreshes make one Search Console pull and spend the budget once", async () => {
    let n = 0;
    const client = { available: true, status: { enabled: true }, searchAnalytics: async () => { n += 1; await new Promise((r) => setTimeout(r, 5)); return { ok: true, data: { rows: [{ keys: ["tip", `${ORIGIN}/p/1`], impressions: 10, clicks: 1, position: 3 }] } }; } };
    const ctx = { store: memoryStore(), client, site, now: () => T0 };
    const [a, b] = await Promise.all([refreshKeywordPerformance(ctx), refreshKeywordPerformance(ctx)]);
    expect([a, b].filter((x) => x.kind === "busy")).toHaveLength(1);
    expect(n).toBe(2); // current + previous period, once
    expect((await ctx.store.get(KW_KEYS.meta)).calls.used).toBe(2);
    const c = await refreshKeywordPerformance(ctx);
    expect(c.cached).toBe(true);
  });
  it("a lock is released when the run throws, and a stale lock does not block forever", async () => {
    const ctx = { store: memoryStore(), client: { available: true, searchAnalytics: async () => { throw new Error("x"); } }, site, now: () => T0 };
    await expect(refreshKeywordPerformance(ctx)).rejects.toThrow();
    expect(await ctx.store.get(KW_KEYS.lockRefresh)).toBeNull();
    await ctx.store.put(KW_KEYS.lockRefresh, { at: new Date(T0 - 10 * 60_000).toISOString(), owner: "dead" });
    const ok = { ...ctx, client: { available: true, searchAnalytics: async () => ({ ok: true, data: { rows: [] } }) } };
    expect((await refreshKeywordPerformance(ok)).ok).toBe(true);
  });
  it("a late finisher does not release a newer owner's lock", async () => {
    const store = memoryStore();
    const a = await acquireLock(store, "k", { now: T0, ttlMs: 1000 });
    const b = await acquireLock(store, "k", { now: T0 + 5000, ttlMs: 1000 }); // a expired; b takes over
    expect(b.ok).toBe(true);
    await releaseLock(store, "k", a.owner);
    expect(await store.get("k")).toMatchObject({ owner: b.owner });
  });
  it("on a store without atomic acquire the lock is best-effort and says so", async () => {
    const m = new Map();
    const kv = { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
    const store = kvStore(kv);
    expect(store.atomic).toBe(false);
    const a = await acquireLock(store, "k", { now: T0, ttlMs: 60_000 });
    expect(a).toMatchObject({ ok: true, atomic: false });
    expect((await acquireLock(store, "k", { now: T0 + 1, ttlMs: 60_000 })).ok).toBe(false);
    await releaseLock(store, "k", a.owner);
    expect(m.has("k")).toBe(false);
  });
});
