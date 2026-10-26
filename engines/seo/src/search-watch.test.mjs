// Tests for the search watch workflow: pure rules, then the CLI end to end in a disposable project. Fictional data only
// (reserved .example domain), an injected fetch and an injected Search Console client: no network, no real credential.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newLedger, newState, applyEvents, normalizeEvent, buildSitemaps, shrinkCheck, rotatingSample, selectTargets, deriveFindings, resolveWatchConfig,
  compareWeeks, topFixes, weeklyPeriods, seedFromSitemap, migrateLedger, crawlFacts,
} from "./search-watch.mjs";
import { main as watch } from "./seo-watch.mjs";
import { main as queue } from "./seo-queue.mjs";
import { fromSearchWatch } from "./improvement-sources.mjs";
import { reconcile } from "./improvement-queue.mjs";
import { extractHead } from "./post-publish-check.mjs";
import { validateConfig } from "./validate-seo-data.mjs";

const ORIGIN = "https://shop.example";
const NOW = Date.parse("2026-10-26T09:00:00Z");
const DAY = 86_400_000;
const cfg = resolveWatchConfig({});

const ledgerOf = (paths, extra = {}) => {
  const { ledger } = applyEvents(newLedger(ORIGIN), paths.map((p) => ({ event: "published", url: p, ...extra })), { origin: ORIGIN, now: NOW - 30 * DAY });
  return ledger;
};

describe("page events and the ledger", () => {
  it("accepts production pages and rejects off-origin, unknown events and bad dates", () => {
    expect(normalizeEvent({ event: "published", url: "https://shop.example/a/#top" }, ORIGIN)).toMatchObject({ ok: true, entry: { path: "/a" } });
    expect(normalizeEvent({ event: "published", url: "https://staging.shop.example/a" }, ORIGIN).ok).toBe(false);
    expect(normalizeEvent({ event: "launched", url: "/a" }, ORIGIN).ok).toBe(false);
    expect(normalizeEvent({ event: "changed", url: "/a", lastmod: "yesterday" }, ORIGIN).ok).toBe(false);
    expect(normalizeEvent({ event: "changed", url: "/a", canonical: "https://elsewhere.example/a" }, ORIGIN).ok).toBe(false);
  });
  it("is idempotent: replaying an event changes nothing; removal and republish both work", () => {
    const ev = [{ event: "published", url: "/a", lastmod: "2026-10-01" }];
    const one = applyEvents(newLedger(ORIGIN), ev, { origin: ORIGIN, now: NOW });
    const two = applyEvents(one.ledger, ev, { origin: ORIGIN, now: NOW + DAY });
    expect(two.report.unchanged).toEqual(["/a"]);
    expect(two.ledger.pages["/a"].firstSeen).toBe(one.ledger.pages["/a"].firstSeen);
    const gone = applyEvents(two.ledger, [{ event: "removed", url: "/a" }], { origin: ORIGIN, now: NOW });
    expect(gone.ledger.pages["/a"].status).toBe("removed");
    const back = applyEvents(gone.ledger, ev, { origin: ORIGIN, now: NOW });
    expect(back.ledger.pages["/a"].status).toBe("live");
  });
  it("one bad event does not stop the others", () => {
    const r = applyEvents(newLedger(ORIGIN), [{ event: "published", url: "/ok" }, { nope: true }, { event: "published", url: "/ok2" }], { origin: ORIGIN, now: NOW });
    expect(r.report.added).toEqual(["/ok", "/ok2"]);
    expect(r.report.rejected).toHaveLength(1);
  });
  it("refuses a ledger written by a newer engine", () => {
    expect(() => migrateLedger({ watchSchemaVersion: 99 })).toThrow(/Update the engine/);
  });
});

describe("sitemap", () => {
  it("keeps only live, indexable, canonical pages; omits lastmod it was not given; escapes XML", () => {
    let l = ledgerOf(["/a", "/b", "/c", "/d", "/e", "/f?x=1&y=2"]);
    l = applyEvents(l, [{ event: "removed", url: "/b" }, { event: "changed", url: "/c", noindex: true }, { event: "changed", url: "/d", canonical: ORIGIN + "/a" }, { event: "changed", url: "/a", lastmod: "2026-10-20" }], { origin: ORIGIN, now: NOW }).ledger;
    const s = buildSitemaps(l, { origin: ORIGIN, checks: { "/e": { crawl: { status: 410 } } } });
    const xml = s.files[0].xml;
    expect(xml).toContain("<loc>https://shop.example/a</loc>\n    <lastmod>2026-10-20</lastmod>");
    expect(xml).toContain("/f?x=1&amp;y=2");
    expect(xml).not.toMatch(/\/(b|c|d|e)</);
    expect(s.excluded.map((e) => `${e.url.slice(-2)}:${e.reason}`).sort()).toEqual(["/b:removed", "/c:noindex", "/d:not-canonical", "/e:gone"]);
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
  });
  it("a transient 503 does not drop a page; output is deterministic", () => {
    const l = ledgerOf(["/z", "/a"]);
    const a = buildSitemaps(l, { origin: ORIGIN, checks: { "/a": { crawl: { status: 503 } } } });
    expect(a.included).toBe(2);
    expect(a.files[0].xml.indexOf("/a<")).toBeLessThan(a.files[0].xml.indexOf("/z<"));
    expect(buildSitemaps(l, { origin: ORIGIN }).files[0].xml).toBe(buildSitemaps(l, { origin: ORIGIN }).files[0].xml);
  });
  it("splits into an index plus parts above the URL limit", () => {
    const s = buildSitemaps(ledgerOf(["/1", "/2", "/3"]), { origin: ORIGIN, maxUrls: 2 });
    expect(s.files.map((f) => f.name)).toEqual(["sitemap.xml", "sitemap-1.xml", "sitemap-2.xml"]);
    expect(s.files[0].xml).toContain("<sitemapindex");
  });
  it("shrink guard refuses a big drop and allows a small one", () => {
    const xml = Array.from({ length: 10 }, (_, i) => `<url><loc>${ORIGIN}/${i}</loc></url>`).join("");
    expect(shrinkCheck(xml, 3, 20).ok).toBe(false);
    expect(shrinkCheck(xml, 9, 20).ok).toBe(true);
    expect(shrinkCheck(null, 0, 20).ok).toBe(true);
  });
  it("seeding from an existing sitemap keeps its pages", () => {
    const xml = `<urlset><url><loc>${ORIGIN}/x</loc><lastmod>2026-09-01</lastmod></url><url><loc>https://other.example/y</loc></url></urlset>`;
    const r = seedFromSitemap(newLedger(ORIGIN), xml, { origin: ORIGIN, now: NOW });
    expect(Object.keys(r.ledger.pages)).toEqual(["/x"]);
    expect(r.ledger.pages["/x"].lastmod).toBe("2026-09-01");
  });
});

describe("rotation and quota", () => {
  it("walks in order, wraps, and survives pages being added or removed", () => {
    const paths = ["/a", "/b", "/c", "/d", "/e"];
    expect(rotatingSample(paths, null, 2)).toEqual(["/a", "/b"]);
    expect(rotatingSample(paths, "/b", 2)).toEqual(["/c", "/d"]);
    expect(rotatingSample(paths, "/e", 2)).toEqual(["/a", "/b"]);
    expect(rotatingSample([...paths, "/bb"], "/b", 2)).toEqual(["/bb", "/c"]); // inserted page is not skipped
    expect(rotatingSample(paths.filter((p) => p !== "/c"), "/c", 2)).toEqual(["/d", "/e"]); // cursor page removed
    expect(rotatingSample(["/a"], "/a", 5)).toEqual(["/a"]);
    expect(rotatingSample([], null, 3)).toEqual([]);
  });
  it("takes never-checked pages first, then the sample, never above the inspection allowance", () => {
    const l = ledgerOf(["/n1", "/n2", "/o1", "/o2", "/o3"]);
    const state = { ...newState(), cursor: null, pages: { "/o1": { lastCheckedAt: "x" }, "/o2": { lastCheckedAt: "x" }, "/o3": { lastCheckedAt: "x" } } };
    const sel = selectTargets(l, state, { ...cfg, sampleSize: 2, newPerRun: 5, dailyInspectionCap: 3 }, { now: NOW, inspector: true });
    expect(sel.newPaths).toEqual(["/n1", "/n2"]);
    expect(sel.samplePaths).toEqual(["/o1"]);
    expect(sel.quotaBlocked).toBe(true);
    const used = { ...state, quota: { date: "2026-10-26", used: 3 } };
    const none = selectTargets(l, used, { ...cfg, dailyInspectionCap: 3 }, { now: NOW, inspector: true });
    expect([...none.newPaths, ...none.samplePaths]).toEqual([]);
  });
  it("bounds the number of new pages per run and reports the backlog", () => {
    const l = ledgerOf(Array.from({ length: 8 }, (_, i) => `/p${i}`));
    const sel = selectTargets(l, newState(), { ...cfg, newPerRun: 3 }, { now: NOW, inspector: false });
    expect(sel.newPaths).toHaveLength(3);
    expect(sel.backlog).toBe(5);
  });
});

describe("findings", () => {
  const page = (path, age = 30) => ({ [path]: { url: ORIGIN + path, path, status: "live", firstSeen: new Date(NOW - age * DAY).toISOString() } });
  const L = (...ps) => ({ ...newLedger(ORIGIN), pages: Object.assign({}, ...ps) });
  const ok = (extra = {}) => ({ at: "2026-10-26T09:00:00Z", ok: true, status: 200, kind: "ok", canonical: null, canonicalDeclared: true, ...extra });
  const insp = (extra = {}) => ({ at: "2026-10-26T09:00:00Z", ok: true, indexState: "INDEXED", canonicalStatus: "match", ...extra });
  const find = (ledger, pages) => deriveFindings(ledger, { ...newState(), pages }, cfg, { now: NOW });

  it("flags not indexed only from Search Console evidence, never from a healthy crawl", () => {
    const l = L(page("/a"));
    expect(find(l, { "/a": { crawl: ok() } }).findings).toEqual([]);
    const r = find(l, { "/a": { crawl: ok(), inspect: insp({ indexState: "CRAWLED_NOT_INDEXED", coverageState: "Crawled - currently not indexed" }) } });
    expect(r.findings).toMatchObject([{ type: "not-indexed", basis: "search-console", indexState: "CRAWLED_NOT_INDEXED" }]);
  });
  it("does not flag a young page: it is waiting; an unclassified state is not flagged either", () => {
    const l = L(page("/new", 1), page("/odd"));
    const r = find(l, { "/new": { inspect: insp({ indexState: "DISCOVERED_NOT_INDEXED" }) }, "/odd": { inspect: insp({ indexState: "UNKNOWN" }) } });
    expect(r.findings).toEqual([]);
    expect(r.waiting).toMatchObject([{ path: "/new" }]);
  });
  it("flags a 404 at once but a 503 only after it repeats; recovery clears it", () => {
    const l = L(page("/gone"), page("/flaky"));
    const crawl = (status) => ({ at: "t", ok: false, status, kind: status >= 500 ? "server-error" : "client-error" });
    const first = find(l, { "/gone": { crawl: crawl(404), crawlFailures: 1 }, "/flaky": { crawl: crawl(503), crawlFailures: 1 } });
    expect(first.findings.map((f) => f.path)).toEqual(["/gone"]);
    expect(first.unconfirmed.map((u) => u.path)).toEqual(["/flaky"]);
    const second = find(l, { "/gone": { crawl: crawl(404), crawlFailures: 2 }, "/flaky": { crawl: crawl(503), crawlFailures: 2 } });
    expect(second.findings.map((f) => f.path).sort()).toEqual(["/flaky", "/gone"]);
    const fixed = find(l, { "/gone": { crawl: ok(), crawlFailures: 0 }, "/flaky": { crawl: ok(), crawlFailures: 0 } });
    expect(fixed.findings).toEqual([]);
  });
  it("flags unexpected canonicals from the page and from Google as separate evidence, and honours a recorded intended canonical", () => {
    const l = L(page("/a"), page("/b"), page("/c"));
    l.pages["/c"].canonical = ORIGIN + "/c-main";
    const r = find(l, {
      "/a": { crawl: ok({ canonical: ORIGIN + "/other" }) },
      "/b": { crawl: ok({ canonical: ORIGIN + "/b" }), inspect: insp({ canonicalStatus: "mismatch", googleCanonical: ORIGIN + "/z", userCanonical: ORIGIN + "/b", indexState: "CANONICAL_CONFLICT" }) },
      "/c": { crawl: ok({ canonical: ORIGIN + "/c-main" }) },
    });
    expect(r.findings.map((f) => `${f.path}:${f.type}:${f.basis}`).sort()).toEqual(["/a:unexpected-canonical:crawl", "/b:unexpected-canonical:search-console"]);
  });
  it("a page that redirects is a crawl failure that names the target", () => {
    const l = L(page("/old"));
    const r = find(l, { "/old": { crawl: { at: "t", ok: false, kind: "redirected", status: 200, finalUrl: ORIGIN + "/new" } } });
    expect(r.findings[0]).toMatchObject({ type: "crawl-failure", detail: `redirects to ${ORIGIN}/new` });
  });
  it("crawlFacts reads canonical and noindex from the page and its header", () => {
    const html = `<html><head><link rel="canonical" href="/a"><meta name="robots" content="noindex"></head></html>`;
    const res = { chain: [{ url: ORIGIN + "/a", status: 200 }], final: { url: ORIGIN + "/a", status: 200, headers: new Headers(), text: html } };
    expect(crawlFacts(res, { url: ORIGIN + "/a" }, { parseHead: extractHead, now: NOW })).toMatchObject({ ok: true, canonical: ORIGIN + "/a", noindex: true });
  });
});

describe("weekly comparison and the three fixes", () => {
  const today = "2026-10-26";
  const P = weeklyPeriods(today, 2);
  const days = (period) => { const out = []; for (let t = Date.parse(period.start); t <= Date.parse(period.end); t += DAY) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
  const rowsFor = (page, before, after, skip = []) => [...days(P.before).map((date) => ({ date, page, clicks: before, impressions: before * 10 })), ...days(P.after).filter((d) => !skip.includes(d)).map((date) => ({ date, page, clicks: after, impressions: after * 10 }))];
  it("uses two equal, complete weeks and leaves out the last two days", () => {
    expect(P.after).toEqual({ start: "2026-10-18", end: "2026-10-24" });
    expect(P.before).toEqual({ start: "2026-10-11", end: "2026-10-17" });
  });
  it("compares complete weeks, treats a quiet page-day as zero, calls a day nobody reported unavailable (not zero), and flags low volume", () => {
    const rows = [...rowsFor("/big", 10, 6), ...rowsFor("/quiet", 10, 6, ["2026-10-20"]), ...rowsFor("/tiny", 1, 0)];
    const c = compareWeeks(rows, today);
    const by = Object.fromEntries(c.pages.map((p) => [p.page, p]));
    expect(by["/big"].clicks).toMatchObject({ available: true, before: 70, after: 42, change: -28 });
    expect(by["/big"].lowSample).toBe(false);
    expect(by["/quiet"].clicks).toMatchObject({ available: true, after: 36 }); // the omitted day counts as 0 because other pages were reported that day
    expect(by["/tiny"].lowSample).toBe(true);
    expect(c.note).toMatch(/does not show that the change caused/);
    const hole = compareWeeks(rows.filter((r) => r.date !== "2026-10-20"), today);
    expect(hole.site.clicks.available).toBe(false);
    expect(hole.site.clicks.reason).toMatch(/6\/7 after/);
    expect(hole.pages.find((p) => p.page === "/big").clicks.available).toBe(false);
  });
  const f = (type, path, severity = "medium", extra = {}) => ({ type, path, severity, basis: "crawl", observedAt: "2026-10-25T00:00:00Z", detail: `${type} detail`, action: `fix ${type}`, ...extra });
  it("returns exactly three, grouped by type, ranked by severity, size and lost clicks; never pads", () => {
    const comparison = compareWeeks([...rowsFor("/a", 12, 6), ...rowsFor("/b", 10, 10)], today);
    const findings = [f("crawl-failure", "/a", "high"), f("crawl-failure", "/b", "high"), f("unexpected-canonical", "/c", "high"), f("missing-canonical", "/d", "low"), f("not-indexed", "/e", "medium", { basis: "search-console", indexState: "CRAWLED_NOT_INDEXED" })];
    const r = topFixes(findings, comparison);
    expect(r.fixes).toHaveLength(3);
    expect(r.fixes[0]).toMatchObject({ type: "crawl-failure", pages: ["/a", "/b"] });
    expect(r.fixes[0].reasons.join(" ")).toMatch(/coincides with the problem; it does not prove/);
    expect(r.shortfall).toBeNull();
    const few = topFixes([f("crawl-failure", "/a", "high")], { pages: [] });
    expect(few.fixes).toHaveLength(1);
    expect(few.shortfall).toMatch(/none were added/);
  });
  it("offers a traffic drop with no finding only as a low-confidence lead", () => {
    const comparison = compareWeeks(rowsFor("/slump", 20, 5), today);
    const r = topFixes([], comparison);
    expect(r.fixes[0]).toMatchObject({ type: "traffic-drop", confidence: "low" });
    expect(r.fixes[0].reasons.join(" ")).toMatch(/cause is unknown/);
  });
  it("never recommends from a low-sample drop", () => {
    expect(topFixes([], compareWeeks(rowsFor("/tiny", 2, 0), today)).fixes).toEqual([]);
  });
});

// ---------------------------------------------------------------- the CLI in a disposable project

const html = (canonical, extra = "") => `<html><head><title>t</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}${extra}</head><body>ok</body></html>`;
const makeFetch = (table) => async (url) => {
  const e = table[url] ?? { status: 404, body: "" };
  if (e.throw) throw new Error(e.throw);
  return new Response(e.body ?? "", { status: e.status ?? 200, headers: e.headers ?? {} });
};
const inspectResponse = (coverageState, verdict = "NEUTRAL", extra = {}) => ({ ok: true, data: { inspectionResult: { indexStatusResult: { verdict, coverageState, ...extra } } } });
const fakeClient = (answers, calls = []) => ({ available: true, status: {}, inspectUrl: async (url) => { calls.push(url); const a = answers[url]; return typeof a === "function" ? a() : a ?? inspectResponse("Submitted and indexed", "PASS"); } });

describe("seo-watch CLI in a disposable project", () => {
  let dir, logs, errs;
  const io = (extra = {}) => ({ project: dir, out: (s) => logs.push(s), err: (s) => errs.push(s), now: NOW, sleep: async () => {}, ...extra });
  const w = (args, extra) => watch(args, io(extra));
  const read = (rel) => JSON.parse(readFileSync(join(dir, rel), "utf8"));
  const sitemapPath = () => join(dir, "public", "sitemap.xml");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bweseo-watch-"));
    mkdirSync(join(dir, "seo"), { recursive: true });
    writeFileSync(join(dir, "seo", "seo-config.json"), JSON.stringify({ website: ORIGIN, environments: { production: { url: ORIGIN } }, paths: { data: "seo/data" }, analytics: { searchConsole: { searchWatch: { sampleSize: 2, newPerRun: 5, dailyInspectionCap: 6, crawlDelayMs: 0 } } } }, null, 2));
    mkdirSync(join(dir, "public"), { recursive: true });
    writeFileSync(sitemapPath(), `<urlset>${["/", "/a", "/b", "/c", "/d"].map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join("")}</urlset>`);
    logs = []; errs = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is ON by default and can be switched off and on; notify never fails a build while off", async () => {
    expect(await w(["status", "--json"])).toBe(0);
    expect(JSON.parse(logs.at(-1)).enabled).toBe(true);
    expect(await w(["disable"])).toBe(3); // needs --by
    expect(await w(["disable", "--by", "Owner"])).toBe(0);
    expect(read("seo/seo-config.json").analytics.searchConsole.searchWatch).toMatchObject({ enabled: false, changedBy: "Owner", sampleSize: 2 });
    expect(await w(["notify", "/x", "--event", "published"])).toBe(0);
    expect(existsSync(join(dir, "seo/data/search-watch/inbox"))).toBe(false);
    expect(await w(["sync"])).toBe(1);
    expect(errs.join()).toMatch(/switched off/);
    expect(await w(["enable", "--by", "Owner"])).toBe(0);
    expect(await w(["seed", "--sitemap", "public/sitemap.xml"])).toBe(0);
  });

  it("keeps the sitemap current: seed, publish, change, remove; atomic, idempotent, no stale or non-canonical entries", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    await w(["notify", "/new-page", "--event", "published", "--lastmod", "2026-10-26"]);
    await w(["notify", `${ORIGIN}/b`, "--event", "removed"]);
    await w(["notify", "/c", "--event", "changed", "--canonical", `${ORIGIN}/a`]);
    await w(["notify", "https://staging.shop.example/s", "--event", "published"]);
    expect(errs.join()).toMatch(/not on the production origin/);
    logs.length = 0;
    expect(await w(["sync"])).toBe(0);
    const xml = readFileSync(sitemapPath(), "utf8");
    expect(xml).toContain(`${ORIGIN}/new-page`);
    expect(xml).not.toMatch(/\/b</);
    expect(xml).not.toMatch(/\/c</);
    expect(xml).not.toContain("staging");
    expect(readdirSync(join(dir, "seo/data/search-watch/inbox"))).toEqual(["processed"]);
    expect(readdirSync(join(dir, "public")).filter((n) => n.startsWith("."))).toEqual([]); // no temp files left
    logs.length = 0;
    expect(await w(["sync"])).toBe(0);
    expect(logs.join()).toMatch(/already up to date, nothing written/);
  });

  it("refuses to shrink the sitemap sharply, leaves the inbox for recovery, and recovers with the explicit flag", async () => {
    await w(["notify", "/only", "--event", "published"]); // no seed: a ledger with one page would replace a five-page sitemap
    const before = readFileSync(sitemapPath(), "utf8");
    expect(await w(["sync"])).toBe(1);
    expect(errs.join()).toMatch(/Refused/);
    expect(readFileSync(sitemapPath(), "utf8")).toBe(before);
    expect(readdirSync(join(dir, "seo/data/search-watch/inbox")).filter((n) => n.endsWith(".json"))).toHaveLength(1);
    expect(await w(["sync", "--dry-run", "--allow-shrink"])).toBe(0);
    expect(readFileSync(sitemapPath(), "utf8")).toBe(before);
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    expect(await w(["sync"])).toBe(0);
    expect(readFileSync(sitemapPath(), "utf8")).toContain(`${ORIGIN}/only`);
    expect(readFileSync(sitemapPath(), "utf8")).toContain(`${ORIGIN}/a`);
  });

  it("moves an unreadable inbox file aside instead of blocking every later sync", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    mkdirSync(join(dir, "seo/data/search-watch/inbox"), { recursive: true });
    writeFileSync(join(dir, "seo/data/search-watch/inbox/broken.json"), "{ not json");
    expect(await w(["sync"])).toBe(1);
    expect(readdirSync(join(dir, "seo/data/search-watch/inbox/rejected"))).toEqual(["broken.json"]);
    expect(await w(["sync"])).toBe(0);
  });

  it("refuses a sitemap path outside the project", async () => {
    const cfg = read("seo/seo-config.json"); cfg.analytics.searchConsole.searchWatch.sitemapPath = "../outside.xml";
    writeFileSync(join(dir, "seo/seo-config.json"), JSON.stringify(cfg));
    await w(["notify", "/x", "--event", "published"]);
    await expect(w(["sync"])).resolves.toBe(1).catch(() => {});
  });

  it("daily: checks new pages first then a rotating sample, respects the inspection allowance, and resumes the rotation next day", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const table = Object.fromEntries(["/", "/a", "/b", "/c", "/d"].map((p) => [ORIGIN + p, { body: html(ORIGIN + p) }]));
    const calls = [];
    const opts = { fetchImpl: makeFetch(table), client: fakeClient({}, calls) };
    expect(await w(["daily"], opts)).toBe(0);
    expect(calls).toHaveLength(5); // all five were never checked: new pages first (newPerRun 5), no sample slot left under cap 6 → 1 sample slot but nothing checked yet
    const state1 = read("seo/data/search-watch/state.json");
    expect(state1.quota.used).toBe(calls.length);
    expect(Object.keys(state1.pages).sort()).toEqual(["/", "/a", "/b", "/c", "/d"]);
    // next day: nothing is new; the sample of 2 starts after the cursor
    calls.length = 0;
    const next = { ...opts, now: NOW + DAY, client: fakeClient({}, calls) };
    expect(await w(["daily"], next)).toBe(0);
    expect(calls).toEqual([ORIGIN + "/", ORIGIN + "/a"]);
    calls.length = 0;
    await w(["daily"], { ...next, now: NOW + 2 * DAY, client: fakeClient({}, calls) });
    expect(calls).toEqual([ORIGIN + "/b", ORIGIN + "/c"]);
    expect(read("seo/data/search-watch/state.json").cursor).toBe("/c");
  });

  it("daily: the allowance is a hard cap; when it is used up nothing is inspected and the run says so", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const cfg = read("seo/seo-config.json"); cfg.analytics.searchConsole.searchWatch.dailyInspectionCap = 2;
    writeFileSync(join(dir, "seo/seo-config.json"), JSON.stringify(cfg));
    const calls = [];
    const opts = { fetchImpl: makeFetch({}), client: fakeClient({}, calls) };
    await w(["daily"], opts);
    expect(calls).toHaveLength(2);
    expect(read("seo/data/search-watch/findings.json").run).toMatchObject({ status: "partial", quotaBlocked: true });
    await w(["daily"], opts);
    expect(calls).toHaveLength(2);
    expect(logs.join("\n")).toMatch(/allowance limited this run/);
  });

  it("daily: flags not-indexed (Google evidence), crawl failures and unexpected canonicals, feeds the queue, then clears them after fixes", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const ledgerPath = join(dir, "seo/data/search-watch/ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    for (const p of Object.values(ledger.pages)) p.firstSeen = new Date(NOW - 30 * DAY).toISOString();
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const table = {
      [ORIGIN + "/"]: { body: html(ORIGIN + "/") },
      [ORIGIN + "/a"]: { body: html(ORIGIN + "/a") }, // healthy and not indexed according to Google
      [ORIGIN + "/b"]: { status: 404 }, // crawl failure
      [ORIGIN + "/c"]: { body: html(ORIGIN + "/c-duplicate") }, // unexpected canonical
      [ORIGIN + "/d"]: { body: html(ORIGIN + "/d") },
    };
    const answers = { [ORIGIN + "/a"]: inspectResponse("Crawled - currently not indexed") };
    expect(await w(["daily"], { fetchImpl: makeFetch(table), client: fakeClient(answers) })).toBe(0);
    const f = read("seo/data/search-watch/findings.json");
    expect(f.findings.map((x) => `${x.path}:${x.type}:${x.basis}`).sort()).toEqual(["/a:not-indexed:search-console", "/b:crawl-failure:crawl", "/c:unexpected-canonical:crawl"]);
    expect(f.sitemapInSync).toBe(false); // /b is confirmed gone, so the sitemap should drop it
    expect(await queue(["build"], io())).toBe(0);
    const q = read("seo/data/improvement-queue.json");
    expect(q.items.map((i) => i.source.module)).toEqual(["search-watch", "search-watch", "search-watch"]);
    // two of five pages are now confirmed gone or non-canonical: that is a 40% drop, so the guard stops it until a person agrees
    expect(await w(["sync"])).toBe(1);
    expect(readFileSync(sitemapPath(), "utf8")).toMatch(/\/b</);
    expect(await w(["sync", "--allow-shrink"])).toBe(0);
    expect(readFileSync(sitemapPath(), "utf8")).not.toMatch(/\/b</);
    // fixes: the 404 page is back, the canonical is corrected, Google indexes /a; the next day's checks clear the items
    table[ORIGIN + "/b"] = { body: html(ORIGIN + "/b") };
    table[ORIGIN + "/c"] = { body: html(ORIGIN + "/c") };
    const fixedClient = fakeClient({});
    const calls = [];
    for (let i = 1; i <= 3; i++) await w(["daily"], { fetchImpl: makeFetch(table), client: fakeClient({}, calls), now: NOW + i * DAY });
    expect(read("seo/data/search-watch/findings.json").findings).toEqual([]);
    await queue(["build"], io({ now: NOW + 3 * DAY }));
    expect(read("seo/data/improvement-queue.json").items.every((i) => i.status === "resolved")).toBe(true);
    expect(fixedClient.available).toBe(true);
  });

  it("daily: a transient 503 is not flagged until it repeats; a network error is recorded without stopping the run", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const table = Object.fromEntries(["/", "/a", "/b", "/c", "/d"].map((p) => [ORIGIN + p, { body: html(ORIGIN + p) }]));
    table[ORIGIN + "/a"] = { status: 503 };
    table[ORIGIN + "/b"] = { throw: "socket hang up" };
    await w(["daily"], { fetchImpl: makeFetch(table), client: fakeClient({}) });
    let f = read("seo/data/search-watch/findings.json");
    expect(f.findings).toEqual([]);
    expect(f.unconfirmed.map((u) => u.path).sort()).toEqual(["/a", "/b"]);
    expect(read("seo/data/search-watch/state.json").pages["/c"].crawl.ok).toBe(true);
  });

  it("daily: with no Search Console access it still crawls, says indexing was not checked, and never marks a page not indexed", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const table = Object.fromEntries(["/", "/a", "/b", "/c", "/d"].map((p) => [ORIGIN + p, { body: html(ORIGIN + p) }]));
    const down = { available: false, status: { reason: "no credential named in the configuration" } };
    expect(await w(["daily"], { fetchImpl: makeFetch(table), client: down })).toBe(0);
    expect(logs.join("\n")).toMatch(/not collected this run - no credential named/);
    const f = read("seo/data/search-watch/findings.json");
    expect(f.findings.filter((x) => x.type === "not-indexed")).toEqual([]);
    expect(f.run.inspector).toMatch(/no credential/);
  });

  it("daily: a fatal Search Console error stops inspecting, keeps what was learned, and the next run resumes the unchecked pages", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const table = Object.fromEntries(["/", "/a", "/b", "/c", "/d"].map((p) => [ORIGIN + p, { body: html(ORIGIN + p) }]));
    let n = 0;
    const flaky = fakeClient({}); const real = flaky.inspectUrl;
    flaky.inspectUrl = async (u) => (++n === 3 ? { ok: false, kind: "permission-denied", message: "the service account is not a user of this property" } : real(u));
    expect(await w(["daily"], { fetchImpl: makeFetch(table), client: flaky })).toBe(1);
    const s = read("seo/data/search-watch/state.json");
    expect(Object.values(s.pages).filter((p) => p.lastCheckedAt)).toHaveLength(2);
    expect(s.pages["/b"].crawl).toBeTruthy(); // crawl evidence kept
    expect(s.runs.at(-1)).toMatchObject({ status: "partial", stopped: "permission-denied" });
    const calls = [];
    expect(await w(["daily"], { fetchImpl: makeFetch(table), client: fakeClient({}, calls), now: NOW + DAY })).toBe(0);
    expect(calls.slice(0, 3)).toEqual([ORIGIN + "/b", ORIGIN + "/c", ORIGIN + "/d"]); // the unreached pages come first
  });

  it("weekly: writes the report with exactly three fixes from findings and traffic, and says what it cannot show", async () => {
    await w(["seed", "--sitemap", "public/sitemap.xml"]);
    const ledgerPath = join(dir, "seo/data/search-watch/ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    for (const p of Object.values(ledger.pages)) p.firstSeen = new Date(NOW - 30 * DAY).toISOString();
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const table = { [ORIGIN + "/"]: { body: html(ORIGIN + "/") }, [ORIGIN + "/a"]: { body: html(ORIGIN + "/a") }, [ORIGIN + "/b"]: { status: 404 }, [ORIGIN + "/c"]: { body: html(ORIGIN + "/c-copy") }, [ORIGIN + "/d"]: { body: html(ORIGIN + "/d") } };
    await w(["daily"], { fetchImpl: makeFetch(table), client: fakeClient({ [ORIGIN + "/a"]: inspectResponse("Crawled - currently not indexed") }) });
    const P = weeklyPeriods("2026-10-26", 2);
    const rows = [];
    for (let t = Date.parse(P.before.start); t <= Date.parse(P.after.end); t += DAY) {
      const date = new Date(t).toISOString().slice(0, 10), after = date >= P.after.start;
      rows.push({ date, page: `${ORIGIN}/b`, clicks: after ? 1 : 9, impressions: after ? 20 : 120 }, { date, page: `${ORIGIN}/`, clicks: 30, impressions: 400 }, { date, page: "https://other.example/x", clicks: 99, impressions: 99 });
    }
    writeFileSync(join(dir, "rows.json"), JSON.stringify(rows));
    logs.length = 0;
    expect(await w(["weekly", "--rows", "rows.json", "--json"])).toBe(0);
    const r = JSON.parse(logs.join(""));
    expect(r.fixes.fixes).toHaveLength(3);
    expect(r.fixes.fixes[0]).toMatchObject({ type: "crawl-failure", pages: ["/b"] });
    expect(r.fixes.fixes.map((x) => x.type).sort()).toEqual(["crawl-failure", "not-indexed", "unexpected-canonical"]);
    expect(r.pages.some((p) => p.page.includes("other.example"))).toBe(false);
    const md = readFileSync(join(dir, "seo/data/search-watch/reports", "weekly-2026-10-26.md"), "utf8");
    expect(md).toMatch(/does not show that the change caused/);
    expect(md).toMatch(/The three most useful fixes/);
  });

  it("weekly: without rows and without Search Console it explains and writes nothing", async () => {
    const down = { available: false, status: { reason: "no credential" } };
    expect(await w(["weekly"], { client: down })).toBe(1);
    expect(errs.join()).toMatch(/--rows/);
    expect(existsSync(join(dir, "seo/data/search-watch/reports"))).toBe(false);
  });
});

describe("queue source", () => {
  it("resolves an item only when a complete run covered that page and no longer reports it", () => {
    const rep = (findings, extra = {}) => ({ run: { observedAt: "2026-10-26T00:00:00Z", status: "complete", coveredRefs: ["/a"], ...extra }, findings });
    const fnd = { type: "crawl-failure", path: "/a", severity: "high", basis: "crawl", observedAt: "2026-10-26T00:00:00Z", detail: "HTTP 404", action: "Restore it" };
    const q1 = reconcile(null, [fromSearchWatch(rep([fnd]), { now: NOW })], { now: NOW, site: ORIGIN }).queue;
    expect(q1.items).toHaveLength(1);
    const partial = reconcile(q1, [fromSearchWatch(rep([], { status: "partial" }), { now: NOW })], { now: NOW, site: ORIGIN }).queue;
    expect(partial.items[0].status).toBe("open");
    const elsewhere = reconcile(q1, [fromSearchWatch(rep([], { coveredRefs: ["/other"] }), { now: NOW })], { now: NOW, site: ORIGIN }).queue;
    expect(elsewhere.items[0].status).toBe("open");
    const done = reconcile(q1, [fromSearchWatch(rep([]), { now: NOW })], { now: NOW, site: ORIGIN }).queue;
    expect(done.items[0].status).toBe("resolved");
  });
});

describe("configuration validation", () => {
  const errorsFor = (searchWatch) => validateConfig({ analytics: { searchConsole: { searchWatch } } }).errors.filter((e) => /searchWatch/.test(e));
  it("accepts the template defaults and an absent block; rejects bad values, outside paths and credentials", () => {
    expect(errorsFor({ enabled: true, sitemapPath: "public/sitemap.xml", sampleSize: 10 })).toEqual([]);
    expect(errorsFor(undefined)).toEqual([]);
    expect(errorsFor({ enabled: "yes" }).join()).toMatch(/enabled must be true or false/);
    expect(errorsFor({ sampleSize: -1 }).join()).toMatch(/sampleSize/);
    expect(errorsFor({ sitemapPath: "../x.xml" }).join()).toMatch(/inside the project/);
    expect(errorsFor({ credentialsToken: "x" }).join()).toMatch(/never store credentials/);
  });
});
