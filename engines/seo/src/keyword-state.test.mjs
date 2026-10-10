// /BWESEO integration of the Keyword Performance System: display model, dashboard lines and the state-aware next actions.
import { describe, expect, it } from "vitest";
import { evaluateState, formatDashboard, keywordPerformanceOf, keywordSummaryLine, STATE_VERSION } from "./seo-state-core.mjs";
import { validateConfig, validateInventory } from "./validate-seo-data.mjs";

const TODAY = "2026-11-02";
const SITE = "https://acme-heating.example.com";
const config = (kp = { enabled: true }) => ({
  schemaVersion: 1, projectId: "acme-heating", website: SITE, repo: { gitRemote: "acme/site" }, engine: { version: STATE_VERSION }, adapter: "static-html", stack: {},
  workflows: { build: "npm run build", test: "npm test", deployProduction: "npm run release" }, conversion: { primary: "A booked service call" },
  paths: { businessProfile: "seo/business-profile.json", contentInventory: "seo/content-inventory.json", docs: "docs/seo" },
  analytics: { searchConsole: { access: "api", configured: "yes", propertyType: "Domain", verifiedProperty: "acme-heating.example.com", verificationMethod: "DNS", verifiedOn: "2026-10-01", sitemapSubmission: "verified", ...(kp ? { keywordPerformance: kp } : {}) } },
  publication: { usesSitemap: true, sitemapUrl: `${SITE}/sitemap.xml` },
});
const profile = { identity: { businessName: { value: "Acme Heating", status: "verified" } }, lastReviewed: TODAY, openQuestions: [] };
const doc = { exists: true, updated: TODAY, hasContent: true };
const home = (keywords) => ({ id: "home", url: "/", type: "home", status: "published", title: "Acme Heating", topic: "Home", indexable: true, ...(keywords ? { keywords } : {}) });
const evidence = (cfg, { keywords, snap } = {}) => ({
  today: TODAY, repo: { remote: "https://github.com/acme/site.git", folderName: "site" }, config: cfg, profile,
  inventory: { schemaVersion: 1, projectId: "acme-heating", pages: [home(keywords)] }, validation: { errors: [], warnings: [] },
  docs: { baseline: doc, roadmap: doc }, searchConsoleExports: [], sources: {}, live: { checked: false, reason: "not checked in tests" }, ...(snap ? { keywordPerformance: snap } : {}),
});
const summary = (over = {}) => ({ keywords: 6, byPriority: { "FIX NOW": 0, "HIGH OPPORTUNITY": 0, IMPROVE: 0, MONITOR: 0, HEALTHY: 0, "INSUFFICIENT DATA": 0 }, siteHasData: true, range: { label: "Last 28 days (2026-10-04 to 2026-10-31)" }, notIndexed: 0, indexingUnknown: 0, mismatches: 0, cannibalization: 0, withImpressions: 3, zeroImpressions: 3, nearPageOne: 0, lowCtr: 0, indexedNoImpressions: 0, discovered: 0, ...over });
const snap = (over = {}, byPriority = {}, pulledAt = "2026-11-01T09:00:00.000Z") => ({ pulledAt, summary: summary({ ...over, byPriority: { ...summary().byPriority, ...byPriority } }) });
const run = (cfg, opts) => evaluateState(evidence(cfg, opts), { today: TODAY });
const kinds = (s) => s.actions.map((a) => a.kind);
const KW = { primary: "acme furnace repair", secondary: ["furnace repair near me"] };

describe("display model", () => {
  it("is not applicable unless the project declares keywordPerformance", () => {
    expect(keywordPerformanceOf(config(null), { pages: [home(KW)] }, null, TODAY).applicable).toBe(false);
    expect(formatDashboard(run(config(null), { keywords: KW }))).not.toContain("Keyword performance");
  });
  it("counts registered keywords and the published pages that have none", () => {
    const k = keywordPerformanceOf(config(), { pages: [home(KW), { id: "x", url: "/x", status: "published" }, { id: "r", url: "/r", status: "rejected", keywords: { primary: "z" } }] }, null, TODAY);
    expect(k).toMatchObject({ applicable: true, enabled: true, keywordCount: 2, pagesWithKeywords: 1, unregisteredPublished: 1, hasSnapshot: false });
  });
  it("knows when the pulled data is stale", () => {
    expect(keywordPerformanceOf(config(), { pages: [home(KW)] }, snap({}, {}, "2026-10-01T00:00:00.000Z"), TODAY)).toMatchObject({ stale: true, ageDays: 32 });
  });
  it("summarises in plain words and states 'no data' honestly", () => {
    expect(keywordSummaryLine({ keywordCount: 2, summary: null })).toMatch(/no performance data pulled yet/);
    expect(keywordSummaryLine({ keywordCount: 6, summary: snap({ mismatches: 1, discovered: 4 }, { "HIGH OPPORTUNITY": 2 }).summary })).toBe("6 keyword(s) · 3 with Google impressions · 2 high opportunity · 1 where Google shows another page · 4 new Google queries");
  });
  it("dashboard shows the section only when there is something to show, and names the period", () => {
    const out = formatDashboard(run(config(), { keywords: KW, snap: snap() }));
    expect(out).toContain("Keyword performance");
    expect(out).toMatch(/Period \.+ Last 28 days/);
  });
});

describe("state-aware next actions (one useful next step, not an audit)", () => {
  it("published pages but no keywords: register them", () => {
    expect(kinds(run(config()))).toContain("register-keywords");
  });
  it("keywords but no data yet: pull; stale data is refreshed at low priority", () => {
    expect(kinds(run(config(), { keywords: KW }))).toContain("pull-keyword-performance");
    const stale = run(config(), { keywords: KW, snap: snap({}, {}, "2026-10-01T00:00:00.000Z") });
    expect(stale.actions.find((a) => a.kind === "pull-keyword-performance")).toMatchObject({ stale: true, rank: 611 });
  });
  it("not indexed or blocked: resolve indexing/discovery first", () => {
    const s = run(config(), { keywords: KW, snap: snap({ notIndexed: 2 }, { "FIX NOW": 2 }) });
    const a = s.actions.find((x) => x.kind === "fix-keyword-pages");
    expect(a.headline).toBe("Resolve indexing and discovery problems on target pages.");
    expect(a.rank).toBeLessThan(300);
  });
  it("wrong page / competing pages: review before changing anything", () => {
    const a = run(config(), { keywords: KW, snap: snap({ mismatches: 1, cannibalization: 1 }, { IMPROVE: 2 }) }).actions.find((x) => x.kind === "review-target-mismatch");
    expect(a.count).toBe(2);
    expect(a.why).toMatch(/Nothing is changed automatically/);
  });
  it("good position, weak CTR: improve search-result presentation", () => {
    expect(kinds(run(config(), { keywords: KW, snap: snap({ lowCtr: 2 }, { "HIGH OPPORTUNITY": 2 }) }))).toContain("improve-keyword-snippets");
  });
  it("impressions but weak position: improve relevance and internal links", () => {
    expect(kinds(run(config(), { keywords: KW, snap: snap({ nearPageOne: 1 }, { IMPROVE: 1 }) }))).toContain("improve-keyword-relevance");
  });
  it("indexed but no impressions: review targeting, and never call it an indexing problem", () => {
    const s = run(config(), { keywords: KW, snap: snap({ indexedNoImpressions: 3 }) });
    expect(s.actions.find((x) => x.kind === "review-keyword-targeting").why).toMatch(/not a failure/);
    expect(kinds(s)).not.toContain("fix-keyword-pages");
  });
  it("only new pages / insufficient data: wait - no keyword action at all", () => {
    expect(kinds(run(config(), { keywords: KW, snap: snap({ withImpressions: 0 }, { "INSUFFICIENT DATA": 6 }) })).filter((k) => /keyword/.test(k))).toEqual([]);
  });
  it("strong performance: protect it and look at related queries (lowest priority)", () => {
    const a = run(config(), { keywords: KW, snap: snap({}, { HEALTHY: 4 }) }).actions.find((x) => x.kind === "protect-keyword-performance");
    expect(a.headline).toMatch(/Protect what is working/);
    expect(a.rank).toBeGreaterThan(700);
  });
  it("a declared but disabled system never nags", () => {
    expect(kinds(run(config({ enabled: false }))).filter((k) => /keyword/.test(k))).toEqual([]);
  });
  it("never creates a website conflict or touches website health", () => {
    const s = run(config(), { keywords: KW, snap: snap({ mismatches: 3, notIndexed: 3 }, { "FIX NOW": 3 }) });
    expect(s.conflicts.filter((c) => /keyword/i.test(c))).toEqual([]);
  });
});

describe("validator", () => {
  it("accepts keywordPerformance config and registry keywords, and rejects malformed ones", () => {
    expect(validateConfig(config({ enabled: true, staleAfterDays: 7, defaultRange: "28d", thresholds: { minImpressions: 10 } })).errors).toEqual([]);
    expect(validateConfig(config({ enabled: "yes", defaultRange: "5y", serviceAccount: "x" })).errors.length).toBeGreaterThanOrEqual(2);
    const inv = (kw) => ({ schemaVersion: 1, projectId: "acme-heating", pages: [{ ...home(kw), topic: "Home" }] });
    expect(validateInventory(inv(KW), {}).errors.filter((e) => /keywords/.test(e))).toEqual([]);
    expect(validateInventory(inv({ primary: ["a"], secondary: "x" }), {}).errors.filter((e) => /keywords/.test(e)).length).toBeGreaterThanOrEqual(2);
  });
});
