import { describe, it, expect } from "vitest";
import {
  normalizeUrl, sameUrl, isProductionUrl, parseSitemapLocs, isSitemapIndex, compareCanonical, robotsInterpretation, normalizeInspection,
  classifyIndexState, describeState, EXPLANATIONS, INDEX_STATES, evaluateHealth, recommendChecks, scheduleInfo, dueRecords, quotaFor, quotaRemaining,
  checkCooldown, newRecord, applyInspection, applyInspectionFailure, applyAnalytics, buildTimeline, computeTimings, deriveAlerts, mergeAlerts,
  evaluateStagingProtection, queryRecords, summarize, currentStage, resolveConfig, DEFAULTS,
} from "./index-monitor.mjs";

const ORIGIN = "https://example.com";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const D = 86_400_000;
const iso = (t) => new Date(t).toISOString();
const api = (idx = {}, extra = {}) => ({
  inspectionResult: {
    indexStatusResult: {
      verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL",
      lastCrawlTime: "2026-10-08T03:00:00Z", googleCanonical: `${ORIGIN}/a`, userCanonical: `${ORIGIN}/a`, sitemap: [`${ORIGIN}/sitemap.xml`], crawledAs: "MOBILE", ...idx,
    },
    ...extra,
  },
});
const norm = (idx, extra) => normalizeInspection(api(idx, extra), { origin: ORIGIN });
const state = (idx) => classifyIndexState(norm(idx));
const fresh = (path, over = {}) => ({ ...newRecord(path, `${ORIGIN}${path}`, NOW - 30 * D), publishedAt: iso(NOW - 30 * D), inSitemap: true, ...over });

describe("URL normalization and the production guard", () => {
  it("normalizes slashes, fragments and double slashes; the root is /", () => {
    expect(normalizeUrl(`${ORIGIN}/a/`, ORIGIN)).toEqual({ url: `${ORIGIN}/a`, path: "/a" });
    expect(normalizeUrl(`${ORIGIN}`, ORIGIN)).toEqual({ url: `${ORIGIN}/`, path: "/" });
    expect(normalizeUrl("/a//b#frag", ORIGIN)?.path).toBe("/a/b");
    expect(sameUrl(`${ORIGIN}/a`, `${ORIGIN}/a/`, ORIGIN)).toBe(true);
  });
  it("rejects other hosts, http, staging and non-web schemes", () => {
    expect(normalizeUrl("https://staging.example.com/a", ORIGIN)).toBeNull();
    expect(normalizeUrl("http://example.com/a", ORIGIN)).toBeNull();
    expect(normalizeUrl("mailto:a@b.c", ORIGIN)).toBeNull();
    expect(normalizeUrl("", ORIGIN)).toBeNull();
  });
  it("only the configured production origin counts as production", () => {
    expect(isProductionUrl(`${ORIGIN}/a`, { productionUrl: ORIGIN })).toBe(true);
    expect(isProductionUrl("https://staging.example.com/a", { productionUrl: ORIGIN })).toBe(false);
    expect(isProductionUrl("http://example.com/a", { productionUrl: ORIGIN })).toBe(false);
    expect(isProductionUrl("http://localhost:4321/a", { productionUrl: ORIGIN })).toBe(false);
  });
});

describe("sitemap parsing", () => {
  it("reads <loc> entries, entities and CDATA; detects a sitemap index", () => {
    const xml = `<urlset><url><loc>${ORIGIN}/a</loc></url><url><loc> ${ORIGIN}/b?x=1&amp;y=2 </loc></url><url><loc><![CDATA[${ORIGIN}/c]]></loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b?x=1&y=2`, `${ORIGIN}/c`]);
    expect(isSitemapIndex("<sitemapindex><sitemap><loc>x</loc></sitemap></sitemapindex>")).toBe(true);
    expect(isSitemapIndex(xml)).toBe(false);
    expect(parseSitemapLocs("")).toEqual([]);
  });
});

describe("Google response parsing and state normalization", () => {
  it("keeps what Google returned and nothing it did not", () => {
    const n = norm({ referringUrls: [`${ORIGIN}/`] }, { mobileUsabilityResult: { verdict: "PASS" }, richResultsResult: { verdict: "PASS", detectedItems: [{ richResultType: "Breadcrumbs" }] } });
    expect(n.ok).toBe(true);
    expect(n.google).toMatchObject({ verdict: "PASS", coverageState: "Submitted and indexed", crawledAs: "MOBILE", mobileUsability: "PASS", richResultTypes: ["Breadcrumbs"] });
    expect(n.google.referringUrls).toEqual([`${ORIGIN}/`]);
    const bare = normalizeInspection({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } } }, { origin: ORIGIN });
    expect(bare.google.lastCrawlTime).toBeNull();
    expect(bare.google.googleCanonical).toBeNull();
    expect(bare.google.sitemaps).toEqual([]);
  });
  it("flags malformed responses instead of guessing", () => {
    expect(normalizeInspection({}, { origin: ORIGIN })).toMatchObject({ ok: false, kind: "malformed" });
    expect(normalizeInspection({ inspectionResult: {} }, { origin: ORIGIN }).ok).toBe(false);
    expect(normalizeInspection(null, { origin: ORIGIN }).ok).toBe(false);
    expect(classifyIndexState({ ok: false })).toBe("UNKNOWN");
  });
  it("maps every documented situation without oversimplifying", () => {
    expect(state({})).toBe("INDEXED");
    expect(state({ coverageState: "Indexed, not submitted in sitemap" })).toBe("INDEXED");
    expect(state({ verdict: "NEUTRAL", coverageState: "URL is unknown to Google" })).toBe("NOT_DISCOVERED_BY_GOOGLE");
    expect(state({ verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", lastCrawlTime: undefined })).toBe("DISCOVERED_NOT_INDEXED");
    expect(state({ verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" })).toBe("CRAWLED_NOT_INDEXED");
    expect(state({ verdict: "NEUTRAL", coverageState: "Blocked by robots.txt", robotsTxtState: "DISALLOWED" })).toBe("BLOCKED_BY_ROBOTS");
    expect(state({ verdict: "NEUTRAL", coverageState: "Excluded by 'noindex' tag", indexingState: "BLOCKED_BY_META_TAG" })).toBe("NOINDEX");
    expect(state({ verdict: "NEUTRAL", coverageState: "Excluded by 'noindex' tag", indexingState: "BLOCKED_BY_HTTP_HEADER" })).toBe("NOINDEX");
    expect(state({ verdict: "NEUTRAL", coverageState: "Duplicate, Google chose different canonical than user", googleCanonical: `${ORIGIN}/other` })).toBe("CANONICAL_CONFLICT");
    expect(state({ verdict: "NEUTRAL", coverageState: "Duplicate without user-selected canonical" })).toBe("DUPLICATE");
    expect(state({ verdict: "NEUTRAL", coverageState: "Page with redirect" })).toBe("REDIRECTED");
    expect(state({ verdict: "FAIL", coverageState: "Server error (5xx)", pageFetchState: "SERVER_ERROR" })).toBe("FETCH_ERROR");
    expect(state({ verdict: "FAIL", coverageState: "Submitted URL not found (404)", pageFetchState: "NOT_FOUND" })).toBe("FETCH_ERROR");
  });
  it("a state it does not recognise is UNKNOWN, with Google's wording kept", () => {
    const n = norm({ verdict: "NEUTRAL", coverageState: "Something Google added next year" });
    expect(classifyIndexState(n)).toBe("UNKNOWN");
    expect(n.google.coverageState).toBe("Something Google added next year");
  });
  it("an indexed verdict needs Google's own PASS; text alone with a FAIL verdict is not enough", () => {
    expect(state({ verdict: "FAIL", coverageState: "Indexed, though blocked by robots.txt" })).not.toBe("INDEXED");
  });
  it("every state has a plain-language explanation that only suggests things to check", () => {
    for (const s of INDEX_STATES) expect(describeState(s).plain.length).toBeGreaterThan(20);
    expect(EXPLANATIONS.CRAWLED_NOT_INDEXED.plain).toMatch(/has not chosen to include it/);
    expect(JSON.stringify(EXPLANATIONS.CRAWLED_NOT_INDEXED)).not.toMatch(/is caused by|because the content is thin/i);
  });
});

describe("canonical comparison and robots interpretation", () => {
  it("compares after normalization (a trailing slash does not matter)", () => {
    expect(compareCanonical(`${ORIGIN}/a`, `${ORIGIN}/a/`, ORIGIN).status).toBe("match");
    expect(compareCanonical(`${ORIGIN}/a`, `${ORIGIN}/b`, ORIGIN)).toMatchObject({ status: "mismatch", declared: `${ORIGIN}/a`, google: `${ORIGIN}/b` });
  });
  it("an unindexed page has no Google canonical: unknown, not a mismatch", () => {
    expect(compareCanonical(`${ORIGIN}/a`, null, ORIGIN).status).toBe("unknown");
    expect(compareCanonical(null, `${ORIGIN}/a`, ORIGIN).status).toBe("unknown");
  });
  it("interprets documented robots/indexing states", () => {
    expect(robotsInterpretation({ robotsTxtState: "DISALLOWED" }).robotsBlocked).toBe(true);
    expect(robotsInterpretation({ indexingState: "BLOCKED_BY_META_TAG" })).toMatchObject({ noindex: true, noindexSource: "meta robots tag", indexingAllowed: false });
    expect(robotsInterpretation({ indexingState: "BLOCKED_BY_HTTP_HEADER" }).noindexSource).toBe("X-Robots-Tag header");
    expect(robotsInterpretation({ indexingState: "INDEXING_ALLOWED" }).indexingAllowed).toBe(true);
    expect(robotsInterpretation({}).indexingAllowed).toBeNull();
  });
});

describe("health, attention and the 'not indexed' honesty rules", () => {
  it("indexed with zero impressions is healthy and never 'not indexed'", () => {
    let r = applyInspection(fresh("/a"), norm(), NOW - 10 * D).record;
    r = applyAnalytics({ "/a": r }, [], { origin: ORIGIN, now: NOW })["/a"];
    expect(r.indexState).toBe("INDEXED");
    expect(r.metrics.impressions).toBe(0);
    expect(r.seoHealth).toBe("OK");
    expect(r.attention).toBe(false);
    expect(r.stage).toBe("INDEXED");
  });
  it("indexed plus impressions is a further stage", () => {
    let r = applyInspection(fresh("/a"), norm(), NOW - D).record;
    r = applyAnalytics({ "/a": r }, [{ keys: [`${ORIGIN}/a`, "2026-10-05"], impressions: 10, clicks: 1, position: 4 }], { origin: ORIGIN, now: NOW })["/a"];
    expect(r.stage).toBe("RECEIVING_IMPRESSIONS");
    expect(r.metrics).toMatchObject({ impressions: 10, clicks: 1, ctr: 0.1, position: 4 });
  });
  it("search analytics never changes the Google index state", () => {
    let r = applyInspection(fresh("/a"), norm({ verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" }), NOW - D).record;
    r = applyAnalytics({ "/a": r }, [{ keys: [`${ORIGIN}/a`, "2026-10-05"], impressions: 99, clicks: 9, position: 2 }], { origin: ORIGIN, now: NOW })["/a"];
    expect(r.indexState).toBe("CRAWLED_NOT_INDEXED");
  });
  it("no alerting noise right after publishing; hard blocks are immediate", () => {
    const young = { ...fresh("/n"), publishedAt: iso(NOW - D), discoveredAt: iso(NOW - D) };
    const nd = applyInspection(young, norm({ verdict: "NEUTRAL", coverageState: "URL is unknown to Google" }), NOW).record;
    expect(nd.seoHealth).toBe("PENDING");
    expect(deriveAlerts(nd, NOW)).toEqual([]);
    const blocked = applyInspection(young, norm({ verdict: "NEUTRAL", coverageState: "Excluded by 'noindex' tag", indexingState: "BLOCKED_BY_META_TAG" }), NOW).record;
    expect(blocked.attention).toBe(true);
  });
  it("not discovered after the threshold becomes attention and an alert (thresholds are configurable)", () => {
    const old = fresh("/n", { publishedAt: iso(NOW - 9 * D) });
    const nd = applyInspection(old, norm({ verdict: "NEUTRAL", coverageState: "URL is unknown to Google" }), NOW).record;
    expect(nd.attention).toBe(true);
    expect(deriveAlerts(nd, NOW).map((a) => a.type)).toContain("NEW_PAGE_NOT_DISCOVERED");
    expect(evaluateHealth(nd, NOW, resolveConfig({ notDiscoveredAlertDays: 30 })).attention).toBe(false);
  });
  it("a page that WAS indexed and no longer is raises NEW_INDEXING_PROBLEM until it recovers", () => {
    let r = applyInspection(fresh("/a"), norm(), NOW - 5 * D).record;
    r = applyInspection(r, norm({ verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" }), NOW).record;
    const a = deriveAlerts(r, NOW).find((x) => x.type === "NEW_INDEXING_PROBLEM");
    expect(a).toMatchObject({ previously: "INDEXED", now: "CRAWLED_NOT_INDEXED", googleStatus: "Crawled - currently not indexed" });
    r = applyInspection(r, norm(), NOW + D).record;
    expect(deriveAlerts(r, NOW + D).find((x) => x.type === "NEW_INDEXING_PROBLEM")).toBeUndefined();
  });
  it("the page's own noindex is flagged immediately", () => {
    const r = { ...fresh("/a"), pageCheck: { at: iso(NOW), noindex: true } };
    expect(evaluateHealth(r, NOW)).toMatchObject({ seoHealth: "ATTENTION", attention: true });
  });
  it("pages marked not indexable by the site are never flagged", () => {
    expect(evaluateHealth({ ...fresh("/x"), indexable: false, indexState: "NOINDEX" }, NOW).attention).toBe(false);
  });
});

describe("API failures never become 'not indexed'", () => {
  it("keeps the previous state and marks the check unavailable", () => {
    const r = applyInspection(fresh("/a"), norm(), NOW - D).record;
    for (const kind of ["quota", "permission-denied", "network", "timeout", "malformed", "auth-failed", "not-found"]) {
      const f = applyInspectionFailure(r, { kind, message: "boom" }, NOW);
      expect(f.indexState).toBe("INDEXED");
      expect(f.inspect).toMatchObject({ status: "UNAVAILABLE", errorKind: kind });
      expect(f.seoHealth).toBe("UNAVAILABLE");
      expect(f.inspect.at).toBe(r.inspect.at);
    }
  });
  it("a never-checked page that fails stays 'not checked' (not 'not indexed')", () => {
    expect(applyInspectionFailure(fresh("/a"), { kind: "network", message: "x" }, NOW).indexState).toBe("NOT_CHECKED");
  });
});

describe("history, milestones and the indexing timeline", () => {
  it("records milestones once and reports a state change as an event", () => {
    let res = applyInspection(fresh("/a"), norm({ verdict: "NEUTRAL", coverageState: "URL is unknown to Google", lastCrawlTime: undefined, sitemap: undefined }), NOW - 6 * D);
    expect(res.event).toMatchObject({ from: "NOT_CHECKED", to: "NOT_DISCOVERED_BY_GOOGLE" });
    expect(res.record.milestones.googleDiscovered).toBeUndefined();
    res = applyInspection(res.record, norm({ verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-06T01:00:00Z" }), NOW - 3 * D);
    expect(res.record.milestones.googleDiscovered).toBe(iso(NOW - 3 * D));
    expect(res.record.milestones.firstCrawlSeen).toBe("2026-10-06T01:00:00Z");
    res = applyInspection(res.record, norm({ lastCrawlTime: "2026-10-08T01:00:00Z" }), NOW - D);
    expect(res.event).toMatchObject({ from: "CRAWLED_NOT_INDEXED", to: "INDEXED" });
    expect(res.record.milestones.firstCrawlSeen).toBe("2026-10-06T01:00:00Z");
    expect(res.record.milestones.firstIndexedSeen).toBe(iso(NOW - D));
    const again = applyInspection(res.record, norm(), NOW);
    expect(again.event).toBeNull();
    expect(again.record.milestones.firstIndexedSeen).toBe(iso(NOW - D));
  });
  it("first impression is only recorded when the search window can prove it", () => {
    const inWindow = fresh("/a", { publishedAt: iso(NOW - 20 * D), discoveredAt: iso(NOW - 20 * D) });
    const tooOld = fresh("/b", { publishedAt: iso(NOW - 300 * D), discoveredAt: iso(NOW - 300 * D) });
    const out = applyAnalytics({ "/a": inWindow, "/b": tooOld }, [
      { keys: [`${ORIGIN}/a`, "2026-09-30"], impressions: 3, clicks: 0, position: 8 },
      { keys: [`${ORIGIN}/b`, "2026-09-30"], impressions: 3, clicks: 0, position: 8 },
    ], { origin: ORIGIN, now: NOW });
    expect(out["/a"].milestones.firstImpression).toBe("2026-09-30");
    expect(out["/b"].milestones.firstImpression).toBeUndefined();
  });
  it("builds the timeline from recorded milestones only, labelling what each is based on", () => {
    const r = { ...fresh("/a"), milestones: { googleDiscovered: iso(NOW - 3 * D), firstCrawlSeen: "2026-10-07T00:00:00Z", firstIndexedSeen: iso(NOW - D), firstImpression: "2026-10-09" } };
    const t = buildTimeline(r, [{ at: iso(NOW - D), from: "CRAWLED_NOT_INDEXED", to: "INDEXED" }]);
    expect(t.map((e) => e.key)).toEqual(expect.arrayContaining(["published", "google-discovered", "first-crawl", "first-indexed", "first-impression"]));
    expect(t.find((e) => e.key === "first-crawl").basis).toBe("google");
    expect(t.find((e) => e.key === "first-indexed").basis).toBe("observed");
    expect(buildTimeline(fresh("/b")).some((e) => e.key === "first-indexed")).toBe(false);
    expect(t).toEqual([...t].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
  });
  it("measures typical times across pages and needs both ends of a span", () => {
    const mk = (pub, crawl, idx) => ({ ...fresh("/x"), publishedAt: iso(pub), milestones: { firstCrawlSeen: crawl && iso(crawl), firstIndexedSeen: idx && iso(idx) } });
    const t = computeTimings([mk(NOW - 10 * D, NOW - 8 * D, NOW - 5 * D), mk(NOW - 10 * D, NOW - 6 * D, null), mk(NOW - 2 * D, null, null)]);
    expect(t.toCrawl).toMatchObject({ samples: 2, medianDays: 3, averageDays: 3 });
    expect(t.toIndexed).toMatchObject({ samples: 1, medianDays: 5 });
    expect(t.toFirstImpression.samples).toBe(0);
    expect(t.toFirstImpression.medianDays).toBeNull();
  });
});

describe("recommendations come from observed conditions", () => {
  it("names both canonicals when Google disagrees", () => {
    const r = applyInspection(fresh("/a"), norm({ verdict: "NEUTRAL", coverageState: "Duplicate, Google chose different canonical than user", googleCanonical: `${ORIGIN}/other`, userCanonical: `${ORIGIN}/a` }), NOW).record;
    const rec = recommendChecks(r, ORIGIN).find((x) => x.id === "canonical-differs");
    expect(rec.text).toContain(`${ORIGIN}/a`);
    expect(rec.text).toContain(`${ORIGIN}/other`);
    expect(rec.text).toMatch(/before changing any canonical/);
  });
  it("makes no recommendation for a healthy indexed page with impressions", () => {
    const r = applyAnalytics({ "/a": applyInspection(fresh("/a"), norm(), NOW).record }, [{ keys: [`${ORIGIN}/a`, "2026-10-05"], impressions: 5, clicks: 0, position: 9 }], { origin: ORIGIN, now: NOW })["/a"];
    expect(recommendChecks(r, ORIGIN)).toEqual([]);
  });
  it("says zero impressions is not an indexing problem", () => {
    const r = applyAnalytics({ "/a": applyInspection(fresh("/a"), norm(), NOW).record }, [], { origin: ORIGIN, now: NOW })["/a"];
    expect(recommendChecks(r, ORIGIN).find((x) => x.id === "no-impressions").text).toMatch(/does not mean the page is not indexed/);
  });
});

describe("scheduling, priority, quota and throttling", () => {
  const cfg = resolveConfig();
  const checked = (path, daysAgo, indexState, changedDaysAgo, over = {}) => ({ ...fresh(path, over), inspect: { at: iso(NOW - daysAgo * D), status: "OK" }, indexState, changedAt: iso(NOW - changedDaysAgo * D) });
  it("never-checked pages come first, then new pages, problems, recent changes, older indexed, stable", () => {
    const never = fresh("/never");
    const young = checked("/young", 2, "INDEXED", 2, { publishedAt: iso(NOW - 2 * D) });
    const problem = checked("/problem", 3, "CRAWLED_NOT_INDEXED", 20);
    const changed = checked("/changed", 3, "INDEXED", 5);
    const older = checked("/older", 15, "INDEXED", 40);
    const stable = checked("/stable", 31, "INDEXED", 120);
    const notDue = checked("/notdue", 2, "INDEXED", 120);
    expect([never, young, problem, changed, older, stable].map((r) => scheduleInfo(r, NOW, cfg).priority)).toEqual([1, 1, 2, 3, 4, 5]);
    const order = dueRecords([stable, older, changed, problem, young, never, notDue], NOW, cfg).map((r) => r.path);
    expect(order).toEqual(["/never", "/young", "/problem", "/changed", "/older", "/stable"]);
    expect(order).not.toContain("/notdue");
  });
  it("retries a failed check sooner, and ignores removed pages", () => {
    const failed = { ...fresh("/f"), inspect: { at: iso(NOW - 3 * D), status: "UNAVAILABLE", errorAt: iso(NOW - 7 * 3_600_000) } };
    expect(scheduleInfo(failed, NOW, cfg).dueAt).toBeLessThanOrEqual(NOW);
    expect(dueRecords([{ ...fresh("/gone"), active: false }], NOW, cfg)).toEqual([]);
  });
  it("daily quota resets at midnight UTC and caps below Google's own limit", () => {
    expect(DEFAULTS.dailyInspectionCap).toBeLessThan(2000);
    expect(quotaRemaining({ date: "2026-10-10", used: DEFAULTS.dailyInspectionCap - 1 }, NOW)).toBe(1);
    expect(quotaRemaining({ date: "2026-10-09", used: 399 }, NOW)).toBe(DEFAULTS.dailyInspectionCap);
    expect(quotaFor(null, NOW)).toEqual({ date: "2026-10-10", used: 0 });
  });
  it("throttles repeated administrator clicks and explains how long to wait", () => {
    expect(checkCooldown(null, NOW, 30, "x").ok).toBe(true);
    const c = checkCooldown(iso(NOW - 5 * 60_000), NOW, 30, "/a");
    expect(c.ok).toBe(false);
    expect(c.retryAfterSeconds).toBe(25 * 60);
    expect(c.reason).toMatch(/wait 25 minute/);
    expect(checkCooldown(iso(NOW - 31 * 60_000), NOW, 30, "/a").ok).toBe(true);
  });
  it("scales: ten thousand URLs yield only a bounded batch per run", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => checked(`/p${i}`, 20, "INDEXED", 60));
    expect(dueRecords(many, NOW, cfg).slice(0, cfg.batchSize)).toHaveLength(cfg.batchSize);
    expect(dueRecords(many.map((r) => ({ ...r, inspect: { at: iso(NOW - D), status: "OK" } })), NOW, cfg)).toHaveLength(0);
  });
});

describe("staging protection evidence", () => {
  it("noindex by header or meta is PROTECTED", () => {
    expect(evaluateStagingProtection({ xRobotsTag: "noindex, nofollow" }).status).toBe("PROTECTED");
    expect(evaluateStagingProtection({ html: '<meta name="robots" content="noindex,nofollow">' }).status).toBe("PROTECTED");
    expect(evaluateStagingProtection({ html: '<meta content="noindex" name="robots">' }).status).toBe("PROTECTED");
  });
  it("robots.txt alone is PARTIAL; nothing at all is EXPOSED; unreachable is UNKNOWN (never protected)", () => {
    expect(evaluateStagingProtection({ robotsTxt: "User-agent: *\nDisallow: /\n" }).status).toBe("PARTIAL");
    expect(evaluateStagingProtection({ robotsTxt: "User-agent: *\nAllow: /\n", html: "<html></html>" })).toMatchObject({ status: "EXPOSED", indexable: true });
    expect(evaluateStagingProtection({ reachable: false })).toMatchObject({ status: "UNKNOWN", indexable: null });
  });
});

describe("filtering, searching, sorting and summarizing", () => {
  const mk = (path, indexState, over = {}) => ({ ...fresh(path, { title: over.title ?? path }), indexState, inspect: { at: iso(NOW - D), status: "OK" }, ...over });
  const recs = [
    mk("/a", "INDEXED", { title: "Word Counter", metrics: { at: "x", impressions: 10, clicks: 2 } }),
    mk("/b", "INDEXED", { title: "Loan Calculator", metrics: { at: "x", impressions: 0, clicks: 0 } }),
    mk("/c", "CRAWLED_NOT_INDEXED", { attention: true, title: "Tip Calculator" }),
    mk("/d", "NOT_DISCOVERED_BY_GOOGLE"),
    mk("/e", "NOINDEX", { attention: true }),
    mk("/f", "CANONICAL_CONFLICT", { attention: true }),
    mk("/g", "FETCH_ERROR"),
    mk("/gone", "INDEXED", { active: false }),
  ];
  it("filters", () => {
    const f = (filter) => queryRecords(recs, { filter }).rows.map((r) => r.path).sort();
    expect(f("all")).toEqual(["/a", "/b", "/c", "/d", "/e", "/f", "/g"]);
    expect(f("indexed")).toEqual(["/a", "/b"]);
    expect(f("impressions")).toEqual(["/a"]);
    expect(f("crawled_not_indexed")).toEqual(["/c"]);
    expect(f("not_discovered")).toEqual(["/d"]);
    expect(f("blocked")).toEqual(["/e"]);
    expect(f("canonical")).toEqual(["/f"]);
    expect(f("errors")).toEqual(["/g"]);
    expect(f("attention")).toEqual(["/c", "/e", "/f"]);
    expect(f("nonsense")).toHaveLength(7);
  });
  it("searches title, tool name and URL/path", () => {
    expect(queryRecords(recs, { q: "calculator" }).rows.map((r) => r.path).sort()).toEqual(["/b", "/c"]);
    expect(queryRecords(recs, { q: "/d" }).rows.map((r) => r.path)).toEqual(["/d"]);
    expect(queryRecords([{ ...recs[0], itemName: "Counter Pro" }], { q: "counter pro" }).total).toBe(1);
  });
  it("sorts both ways and paginates", () => {
    expect(queryRecords(recs, { sort: "impressions", dir: "desc" }).rows[0].path).toBe("/a");
    expect(queryRecords(recs, { sort: "page", dir: "asc" }).rows[0].title).toBe("/d");
    const p = queryRecords(recs, { pageSize: 3, page: 2 });
    expect(p).toMatchObject({ total: 7, pages: 3, page: 2 });
    expect(p.rows).toHaveLength(3);
    expect(queryRecords(recs, { page: 99, pageSize: 3 }).page).toBe(3);
  });
  it("summarizes without turning the indexing rate into a score", () => {
    const s = summarize(recs, { googleApi: { status: "OK" }, alerts: [{ resolvedAt: null }, { resolvedAt: "x" }] }, NOW);
    expect(s).toMatchObject({ productionUrls: 7, indexed: 2, receivingImpressions: 1, crawledNotIndexed: 1, notDiscovered: 1, blocked: 1, canonicalProblems: 1, errors: 1, needAttention: 3, openAlerts: 1 });
    expect(s.indexingRate).toEqual({ indexed: 2, of: 7 });
    expect(s).not.toHaveProperty("score");
    expect(s.searchConsole.connected).toBe(true);
    expect(summarize(recs, {}, NOW).searchConsole).toMatchObject({ connected: null, status: "NOT_CONFIGURED" });
    expect(currentStage({ ...recs[0], metrics: { impressions: 3 } })).toBe("RECEIVING_IMPRESSIONS");
  });
  it("alerts merge: opened once, resolved when the condition clears", () => {
    const a = [{ key: "k", type: "T" }];
    let list = mergeAlerts([], { "/x": a }, [], NOW);
    expect(list).toHaveLength(1);
    list = mergeAlerts(list, { "/x": a }, [], NOW + D);
    expect(list).toHaveLength(1);
    expect(list[0].openedAt).toBe(iso(NOW));
    list = mergeAlerts(list, {}, [], NOW + 2 * D);
    expect(list[0].resolvedAt).toBe(iso(NOW + 2 * D));
  });
});
