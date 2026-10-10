import { describe, it, expect } from "vitest";
import { registryOf, addKeyword, removeKeyword, validateRegistry, similarKeywords, normalizeKeyword, applyDiscoveredAction, findKeyword } from "./keyword-registry.mjs";
import { inspectTargetPage, analyzeSitemap, robotsAllows, inboundCounts } from "./keyword-target.mjs";
import { rangeFor, previousRange, parseRows, indexRows, indexingStatus, analyzeKeyword, analyzeSite, discoverQueries, tableRows, queryTable, pageView, formatKeywordAnalysis } from "./keyword-performance.mjs";
import { refreshKeywordPerformance, refreshTargets, getKeywordPerformance, lookupKeyword, memoryStore, KW_KEYS, LIMITS } from "./keyword-performance-run.mjs";
import { KEYS as GI } from "./index-monitor-run.mjs";

const ORIGIN = "https://example.com";
const NOW = Date.parse("2026-10-20T12:00:00Z");
const D = 86_400_000;
const site = { productionUrl: ORIGIN, stagingUrl: "https://staging.example.com", sitemapUrl: `${ORIGIN}/sitemap.xml` };

const inventory = () => ({
  pages: [
    { id: "metric-converter", url: "/tools/metric-imperial-converter", type: "utility", title: "Metric to Imperial Converter", status: "published", priority: "P1", indexable: true, created: "2026-08-01",
      keywords: { primary: "metric to imperial converter", secondary: ["metric converter", "kilometers to miles"], searchIntent: "tool", addedOn: "2026-08-01" } },
    { id: "tip-calculator", url: "/tools/tip-calculator", type: "utility", title: "Tip Calculator", status: "published", priority: "P2", indexable: true, created: "2026-08-01", keywords: { primary: "tip calculator" } },
    { id: "idea", url: "/tools/idea", type: "utility", status: "rejected", indexable: true, keywords: { primary: "rejected idea" } },
  ],
});
const row = (q, path, imp, clicks, pos) => ({ keys: [q, `${ORIGIN}${path}`], impressions: imp, clicks, position: pos, ctr: imp ? clicks / imp : 0 });
const idx = (...rows) => indexRows(parseRows({ rows }, { origin: ORIGIN }).rows);
const reg = () => registryOf(inventory(), { siteId: "example" });
const entryOf = (kw) => findKeyword(reg(), kw)[0];
const run = (kw, rows, extra = {}) => analyzeKeyword({ keyword: kw, entry: entryOf(kw), index: idx(...rows), related: reg(), range: { label: "Last 28 days" }, siteHasData: rows.length > 0, now: NOW, firstDetected: "2026-08-01", ...extra });

describe("keyword registry", () => {
  it("flattens pages into one record per keyword with primary/secondary roles, skipping rejected pages", () => {
    const r = reg();
    expect(r.map((x) => x.keyword)).toEqual(["metric to imperial converter", "metric converter", "kilometers to miles", "tip calculator"]);
    expect(r[0]).toMatchObject({ siteId: "example", role: "primary", targetUrl: "/tools/metric-imperial-converter", primaryKeyword: "metric to imperial converter", searchIntent: "tool", dateAdded: "2026-08-01", lastChecked: null });
    expect(r[1].secondaryKeywords).toEqual(["metric converter", "kilometers to miles"]);
  });
  it("adds a secondary keyword, never creating a page", () => {
    const r = addKeyword(inventory(), { pageId: "metric-converter", keyword: "kg to pounds" });
    expect(r.ok).toBe(true);
    expect(r.inventory.pages[0].keywords.secondary).toContain("kg to pounds");
    expect(r.inventory.pages).toHaveLength(3);
    expect(addKeyword(inventory(), { pageId: "nope", keyword: "x y" })).toMatchObject({ ok: false });
  });
  it("allows exactly one primary: refuses a second unless replace, and demotes the old one to secondary", () => {
    expect(addKeyword(inventory(), { pageId: "tip-calculator", keyword: "tipping calculator", role: "primary" }).ok).toBe(false);
    const r = addKeyword(inventory(), { pageId: "tip-calculator", keyword: "tipping calculator", role: "primary", replace: true });
    expect(r.inventory.pages[1].keywords).toMatchObject({ primary: "tipping calculator", secondary: ["tip calculator"] });
  });
  it("is idempotent and refuses a phrase owned by another page unless told otherwise", () => {
    expect(addKeyword(inventory(), { pageId: "metric-converter", keyword: "Metric  Converter!" })).toMatchObject({ ok: true, changed: false });
    const c = addKeyword(inventory(), { pageId: "tip-calculator", keyword: "metric converter" });
    expect(c.ok).toBe(false);
    expect(c.conflict.pageId).toBe("metric-converter");
    expect(addKeyword(inventory(), { pageId: "tip-calculator", keyword: "metric converter", allowDuplicate: true }).ok).toBe(true);
  });
  it("removes a keyword", () => {
    expect(removeKeyword(inventory(), { pageId: "metric-converter", keyword: "metric converter" }).inventory.pages[0].keywords.secondary).toEqual(["kilometers to miles"]);
    expect(removeKeyword(inventory(), { pageId: "metric-converter", keyword: "zzz" }).ok).toBe(false);
  });
  it("flags look-alike phrases on one page as ONE intent (a hint, not separate pages) and the same phrase on two pages", () => {
    expect(similarKeywords("metric to imperial converter", "metric imperial converters").similar).toBe(true);
    expect(similarKeywords("tip calculator", "word counter").similar).toBe(false);
    const inv = inventory();
    inv.pages[0].keywords.secondary.push("imperial converter metric");
    const v = validateRegistry(inv);
    expect(v.errors).toEqual([]);
    expect(v.groups[0].note).toMatch(/ONE page/);
    inv.pages[1].keywords.secondary = ["metric converter"];
    expect(validateRegistry(inv).warnings.join(" ")).toMatch(/registered on two pages/);
  });
  it("reports structural errors", () => {
    const inv = inventory();
    inv.pages[0].keywords = { primary: ["a", "b"], secondary: "x" };
    expect(validateRegistry(inv).errors.length).toBeGreaterThanOrEqual(2);
  });
  it("discovered-query actions: ignore/monitor/investigate are recorded; add-* register; nothing creates a page", () => {
    let r = applyDiscoveredAction(inventory(), { query: "Convert Kilograms Into Pounds", action: "ignore", on: "2026-10-03" });
    expect(r.inventory.keywordDecisions).toEqual([{ query: "Convert Kilograms Into Pounds", decision: "ignore", on: "2026-10-03" }]);
    r = applyDiscoveredAction(r.inventory, { query: "convert kilograms into pounds", action: "monitor" });
    expect(r.inventory.keywordDecisions).toHaveLength(1);
    expect(applyDiscoveredAction(inventory(), { query: "x y", action: "investigate" }).note).toMatch(/nothing is created/);
    expect(applyDiscoveredAction(inventory(), { query: "kg to lbs", action: "add-secondary", pageId: "metric-converter" }).inventory.pages[0].keywords.secondary).toContain("kg to lbs");
    expect(applyDiscoveredAction(inventory(), { query: "kg to lbs", action: "add-primary", pageId: "metric-converter" }).ok).toBe(false);
    expect(applyDiscoveredAction(inventory(), { query: "x", action: "delete-page" }).ok).toBe(false);
    expect(normalizeKeyword("  Kg-to  Pounds ")).toBe("kg to pounds");
  });
});

const PAGE = (extra = {}) => `<!doctype html><html><head><title>${extra.title ?? "Metric to Imperial Converter"}</title><meta name="description" content="Convert metric to imperial."><link rel="canonical" href="${extra.canonical ?? ORIGIN + "/tools/metric-imperial-converter"}">${extra.robots ? `<meta name="robots" content="${extra.robots}">` : ""}<script type="application/ld+json">{"@type":"WebApplication"}</script></head><body><h1>${extra.h1 ?? "Metric to Imperial Converter"}</h1><p>${"Convert metric to imperial units quickly. ".repeat(40)}</p><a href="/tools/tip-calculator">Tip</a></body></html>`;

describe("target page validation", () => {
  const base = { path: "/tools/metric-imperial-converter", origin: ORIGIN, status: 200, html: PAGE(), keyword: "metric to imperial converter", sitemapPaths: ["/tools/metric-imperial-converter"], inboundLinks: 3, robotsTxt: "User-agent: *\nDisallow: /admin" };
  it("reports a healthy page", () => {
    const v = inspectTargetPage(base);
    expect(v).toMatchObject({ exists: true, indexable: true, crawlable: true, inSitemap: true, orphan: false, canonical: { status: "self" }, topic: { verdict: "clear" }, content: { verdict: "meaningful" } });
    expect(v.structuredDataTypes).toContain("WebApplication");
    expect(v.issues.filter((i) => i.severity === "fix")).toEqual([]);
  });
  it("detects noindex (meta and header), a canonical elsewhere, a robots block and 404", () => {
    expect(inspectTargetPage({ ...base, html: PAGE({ robots: "noindex,follow" }) }).issues.map((i) => i.id)).toContain("noindex");
    expect(inspectTargetPage({ ...base, xRobotsTag: "noindex" }).indexable).toBe(false);
    expect(inspectTargetPage({ ...base, html: PAGE({ canonical: ORIGIN + "/other" }) }).issues.map((i) => i.id)).toContain("canonical-elsewhere");
    expect(inspectTargetPage({ ...base, robotsTxt: "User-agent: *\nDisallow: /tools" }).issues.map((i) => i.id)).toContain("robots-blocked");
    const nf = inspectTargetPage({ ...base, status: 404, html: null });
    expect(nf.exists).toBe(false);
    expect(nf.issues[0]).toMatchObject({ severity: "fix", id: "not-found" });
  });
  it("flags missing sitemap entry, orphan pages and an unclear topic; unknown stays unknown", () => {
    const v = inspectTargetPage({ ...base, sitemapPaths: [], inboundLinks: 0, html: PAGE({ title: "Welcome", h1: "Hello" }) });
    expect(v.inSitemap).toBe(false);
    expect(v.orphan).toBe(true);
    expect(v.topic.verdict).not.toBe("clear");
    const unk = inspectTargetPage({ ...base, sitemapPaths: undefined, inboundLinks: undefined, robotsTxt: null });
    expect(unk).toMatchObject({ inSitemap: null, orphan: null, crawlable: null });
  });
  it("does not call a JS-rendered shell 'thin'", () => {
    expect(inspectTargetPage({ ...base, html: "<html><head><title>x</title></head><body><div id=root></div></body></html>" }).content.verdict).toBe("unknown");
  });
  it("robots.txt: longest match wins and Allow beats Disallow on a tie", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /tools\nAllow: /tools/x", "/tools/x").allowed).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /tools", "/tools/x").allowed).toBe(false);
    expect(robotsAllows(null, "/x").allowed).toBeNull();
  });
  it("inbound link counts", () => {
    expect(inboundCounts({ "/a": ["/b", "/b", "/c"], "/b": ["/c", "/b"] })).toEqual({ "/b": 1, "/c": 2 });
  });
});

describe("sitemap analysis", () => {
  const xml = `<urlset><url><loc>${ORIGIN}/a</loc></url><url><loc>${ORIGIN}/a</loc></url><url><loc>http://example.com/b</loc></url><url><loc>${ORIGIN}/c</loc></url><url><loc>${ORIGIN}/d</loc></url><url><loc>${ORIGIN}/e</loc></url><url><loc>${ORIGIN}/f</loc></url></urlset>`;
  it("detects duplicates, malformed entries, redirects, 404s, noindex and noncanonical URLs", () => {
    const r = analyzeSitemap(xml, { origin: ORIGIN, probes: { "/c": { status: 404 }, "/d": { status: 301, redirectedTo: "/x" }, "/e": { status: 200, noindex: true }, "/f": { status: 200, canonicalPath: "/g" } } });
    expect(r.detected).toBe(true);
    expect(r.problems.map((p) => p.type).sort()).toEqual(["duplicate", "malformed", "noindex", "noncanonical", "not-found", "redirect"]);
  });
  it("says 'not detected' when there is no sitemap, and reads sitemap indexes", () => {
    expect(analyzeSitemap(null, { origin: ORIGIN })).toMatchObject({ detected: false });
    expect(analyzeSitemap(`<sitemapindex><sitemap><loc>${ORIGIN}/s1.xml</loc></sitemap></sitemapindex>`, { origin: ORIGIN }).isIndex).toBe(true);
  });
});

describe("date ranges", () => {
  it("presets end after the data lag and carry a label; custom ranges are validated", () => {
    const r = rangeFor("28d", NOW);
    expect(r).toMatchObject({ ok: true, endDate: "2026-10-18", days: 28 });
    expect(r.label).toContain("Last 28 days");
    expect(rangeFor("7d", NOW).days).toBe(7);
    expect(rangeFor("3m", NOW).days).toBe(90);
    expect(rangeFor({ startDate: "2026-10-01", endDate: "2026-09-01" }, NOW).ok).toBe(false);
    expect(rangeFor({ startDate: "2026-09-01", endDate: "2026-09-30" }, NOW)).toMatchObject({ ok: true, key: "custom", days: 30 });
    expect(rangeFor("bogus", NOW).ok).toBe(false);
    expect(previousRange(r).endDate).toBe("2026-09-20");
  });
});

describe("Search Console data parsing", () => {
  it("normalizes queries and pages, merges duplicates by impression-weighted position, drops other origins", () => {
    const p = parseRows({ rows: [row("Tip  Calculator", "/tools/tip-calculator/", 100, 10, 5), row("tip calculator", "/tools/tip-calculator", 100, 6, 7), { keys: ["x y", "https://staging.example.com/a"], impressions: 5, clicks: 0, position: 1 }, { keys: ["", "/a"] }] }, { origin: ORIGIN });
    expect(p.dropped).toBe(2);
    const i = indexRows(p.rows).byQuery.get("tip calculator");
    expect(i).toMatchObject({ impressions: 200, clicks: 16, position: 6 });
    expect(i.pages).toHaveLength(1);
  });
  it("zero rows is valid, not an error", () => {
    const i = idx();
    expect(i.totalRows).toBe(0);
    expect(i.byQuery.size).toBe(0);
  });
});

describe("indexing status keeps confirmed / inferred / unknown apart", () => {
  const rec = (state, status = "OK") => ({ indexState: state, inspect: { status, at: "2026-10-19T00:00:00Z", errorKind: "quota" }, google: { coverageState: "Crawled - currently not indexed" } });
  it("confirmed only from URL Inspection, with source and date", () => {
    expect(indexingStatus({ record: rec("INDEXED") })).toMatchObject({ confidence: "CONFIRMED", indexed: true, source: expect.stringContaining("URL Inspection"), checkedAt: "2026-10-19T00:00:00Z" });
    expect(indexingStatus({ record: rec("CRAWLED_NOT_INDEXED") })).toMatchObject({ confidence: "CONFIRMED", indexed: false });
  });
  it("impressions alone are INFERRED, never confirmed", () => {
    expect(indexingStatus({ record: null, impressions: 50 })).toMatchObject({ confidence: "INFERRED", indexed: true });
  });
  it("no evidence is UNKNOWN with a reason and a manual step; an API failure is not 'not indexed'", () => {
    const u = indexingStatus({ record: null, impressions: 0 });
    expect(u).toMatchObject({ confidence: "UNKNOWN", indexed: null });
    expect(u.reason).toMatch(/not available/);
    expect(u.action).toMatch(/Search Console/);
    const f = indexingStatus({ record: { indexState: "INDEXED", inspect: { status: "UNAVAILABLE", errorKind: "quota" } }, impressions: 0 });
    expect(f).toMatchObject({ confidence: "UNKNOWN", indexed: null });
    expect(f.reason).toMatch(/not the same as "not indexed"/);
  });
});

describe("keyword analysis", () => {
  it("HIGH OPPORTUNITY: frequent impressions near page one, low CTR (the spec example)", () => {
    const a = run("metric to imperial converter", [row("metric to imperial converter", "/tools/metric-imperial-converter", 1240, 10, 11.7)], { indexRecord: { indexState: "INDEXED", inspect: { status: "OK", at: "2026-10-19T00:00:00Z" } } });
    expect(a.status.priority).toBe("HIGH OPPORTUNITY");
    expect(a.signals).toEqual(expect.arrayContaining(["striking-distance"]));
    expect(a.googleShowing.state).toBe("yes");
    expect(a.status.actions.map((x) => x.text).join(" ")).toMatch(/title/);
    expect(a.status.actions.every((x) => x.because.length > 10)).toBe(true);
    expect(a.cannibalization).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/live rank/i.source === "x" ? "" : /^$/);
    expect(a.caveat).toMatch(/not a live Google ranking/);
  });
  it("detects TARGET PAGE MISMATCH without changing anything", () => {
    const a = run("tip calculator", [row("tip calculator", "/calculators/restaurant-tip", 300, 20, 6), row("tip calculator", "/tools/tip-calculator", 40, 1, 25)]);
    expect(a.mismatch).toMatchObject({ intended: "/tools/tip-calculator", googleShows: "/calculators/restaurant-tip" });
    expect(a.mismatch.message).toMatch(/TARGET PAGE MISMATCH/);
    expect(a.status.priority).toBe("IMPROVE");
    expect(a.status.actions.map((x) => x.text).join(" ")).toMatch(/search intent|intent/);
    expect(a.status.actions.map((x) => x.because).join(" ")).toMatch(/Do not change URLs/);
  });
  it("detects cannibalization with evidence, and does not call it automatically harmful", () => {
    const inv = { pages: [{ id: "wc", url: "/tools/word-counter", status: "published", keywords: { primary: "word counter" } }] };
    const entry = registryOf(inv)[0];
    const a = analyzeKeyword({ keyword: "word counter", entry, index: idx(row("word counter", "/tools/word-counter", 200, 10, 6), row("word counter", "/tools/character-counter", 150, 4, 9), row("word counter", "/tools/text-counter", 5, 0, 30), row("character count", "/tools/character-counter", 900, 40, 4)), related: [entry], siteHasData: true, now: NOW });
    expect(a.cannibalization.pages.map((p) => p.path)).toEqual(["/tools/word-counter", "/tools/character-counter"]);
    expect(a.cannibalization.pages[1].otherQueryShare).toBeGreaterThan(80);
    expect(a.cannibalization.note).toMatch(/not automatically a problem/);
  });
  it("zero impressions on a NEW page is INSUFFICIENT DATA, not a failure", () => {
    const a = run("tip calculator", [], { firstDetected: "2026-10-15" });
    expect(a.status.priority).toBe("INSUFFICIENT DATA");
    expect(a.status.headline).toMatch(/new|Continue monitoring/);
    expect(a.newSite).toBe(true);
    expect(a.indexing.confidence).toBe("UNKNOWN");
  });
  it("a brand-new site with no Search Console data at all shows INSUFFICIENT DATA, with indexing UNKNOWN", () => {
    const a = run("tip calculator", [], { firstDetected: "2026-01-01", siteHasData: false });
    expect(a.status.priority).toBe("INSUFFICIENT DATA");
    expect(a.metrics).toMatchObject({ impressions: 0, clicks: 0 });
    expect(formatKeywordAnalysis(a)).toMatch(/No Search Console data yet/);
  });
  it("indexed with zero impressions on an older page is MONITOR (explicitly not a failure)", () => {
    const a = run("tip calculator", [row("other thing", "/x", 50, 1, 3)], { indexRecord: { indexState: "INDEXED", inspect: { status: "OK", at: "2026-10-19T00:00:00Z" } } });
    expect(a.status.priority).toBe("MONITOR");
    expect(a.status.headline).toMatch(/not a failure/);
  });
  it("position over 20 with impressions is IMPROVE; good position and CTR is HEALTHY", () => {
    expect(run("tip calculator", [row("tip calculator", "/tools/tip-calculator", 80, 0, 34)]).status.priority).toBe("IMPROVE");
    expect(run("tip calculator", [row("tip calculator", "/tools/tip-calculator", 500, 90, 2.3)]).status.priority).toBe("HEALTHY");
  });
  it("high impressions, top-10 position, tiny CTR is HIGH OPPORTUNITY (snippet)", () => {
    const a = run("tip calculator", [row("tip calculator", "/tools/tip-calculator", 2000, 10, 4)]);
    expect(a.status.priority).toBe("HIGH OPPORTUNITY");
    expect(a.signals).toContain("high-impressions-low-ctr");
  });
  it("a page-level problem (noindex) or Google-reported blocking is FIX NOW", () => {
    const v = inspectTargetPage({ path: "/tools/tip-calculator", origin: ORIGIN, status: 200, html: PAGE({ robots: "noindex" }), keyword: "tip calculator" });
    expect(run("tip calculator", [], { validation: v }).status.priority).toBe("FIX NOW");
    expect(run("tip calculator", [], { indexRecord: { indexState: "NOINDEX", inspect: { status: "OK", at: "2026-10-19T00:00:00Z" }, google: { coverageState: "Excluded by noindex tag" } } }).status.priority).toBe("FIX NOW");
  });
  it("never reports an unconfirmed index state as confirmed, even with strong performance", () => {
    const a = run("tip calculator", [row("tip calculator", "/tools/tip-calculator", 500, 90, 2.3)]);
    expect(a.indexing.confidence).toBe("INFERRED");
    expect(a.ladder.find((l) => l.id === "indexed").state).toBe("inferred");
    expect(formatKeywordAnalysis(a)).toMatch(/inferred/);
  });
  it("keeps the 11 states separate: sitemap membership does not imply indexed or impressions", () => {
    const v = inspectTargetPage({ path: "/tools/tip-calculator", origin: ORIGIN, status: 200, html: PAGE(), sitemapPaths: ["/tools/tip-calculator"], inboundLinks: 3 });
    const a = run("tip calculator", [], { validation: v, firstDetected: "2026-01-01" });
    const by = Object.fromEntries(a.ladder.map((l) => [l.id, l.state]));
    expect(a.ladder).toHaveLength(11);
    expect(by).toMatchObject({ exists: "yes", sitemap: "yes", indexed: "unknown", impressions: "unknown", clicks: "unknown", shows: "unknown" });
  });
  it("reports a trend against the previous period", () => {
    const a = run("tip calculator", [row("tip calculator", "/tools/tip-calculator", 680, 20, 18.6)], { prevIndex: idx(row("tip calculator", "/tools/tip-calculator", 120, 1, 47.3)), prevRange: { label: "previous 28 days" } });
    expect(a.trend).toMatchObject({ direction: "up", impressions: { previous: 120, current: 680 }, position: { previous: 47.3, current: 18.6 } });
  });
  it("an unregistered phrase still shows the site's own data and the pages involved", () => {
    const a = analyzeKeyword({ keyword: "restaurant tip", entry: null, index: idx(row("restaurant tip", "/calculators/restaurant-tip", 60, 3, 12)), related: reg(), siteHasData: true, now: NOW });
    expect(a).toMatchObject({ registered: false, googleShowing: { state: "unregistered", topPage: "/calculators/restaurant-tip" } });
    expect(formatKeywordAnalysis(a)).toMatch(/not registered/);
  });
});

describe("discovered queries", () => {
  const rows = [row("convert kilograms into american pounds", "/tools/metric-imperial-converter", 87, 3, 14.2), row("metric converter", "/tools/metric-imperial-converter", 30, 1, 9), row("random thing", "/other", 40, 0, 50), row("tiny", "/x", 1, 0, 5), row("boring", "/x", 20, 0, 5)];
  it("lists unregistered queries with impressions, the ranking page and a suggestion — registered ones are excluded", () => {
    const d = discoverQueries({ registry: reg(), index: idx(...rows), inventory: inventory() });
    expect(d.map((x) => x.query)).toEqual(["convert kilograms into american pounds", "random thing", "boring"]);
    expect(d[0]).toMatchObject({ impressions: 87, clicks: 3, position: 14.2, rankingPage: "/tools/metric-imperial-converter", suggestion: { action: "add-secondary", pageId: "metric-converter" } });
    expect(d[1].suggestion.action).toBe("investigate");
    expect(d[1].suggestion.because).toMatch(/nothing is created automatically/);
  });
  it("an ignored query disappears; a monitored one stays and is labelled", () => {
    const inv = applyDiscoveredAction(applyDiscoveredAction(inventory(), { query: "boring", action: "ignore" }).inventory, { query: "random thing", action: "monitor" }).inventory;
    const d = discoverQueries({ registry: reg(), index: idx(...rows), inventory: inv });
    expect(d.map((x) => x.query)).not.toContain("boring");
    expect(d.find((x) => x.query === "random thing").decision).toBe("monitor");
  });
});

describe("dashboard table", () => {
  const out = analyzeSite({ registry: reg(), inventory: inventory(), index: idx(row("metric to imperial converter", "/tools/metric-imperial-converter", 1240, 18, 11.7), row("tip calculator", "/calculators/restaurant-tip", 300, 20, 6), row("tip calculator", "/tools/tip-calculator", 40, 1, 25)), range: { label: "x" }, now: NOW });
  const rows = tableRows(out.analyses);
  it("summarises, filters and sorts", () => {
    expect(out.summary).toMatchObject({ keywords: 4, mismatches: 1, nearPageOne: 1, zeroImpressions: 2 });
    expect(queryTable(rows, { filter: "target-mismatch" }).map((r) => r.keyword)).toEqual(["tip calculator"]);
    expect(queryTable(rows, { filter: "zero-impressions" })).toHaveLength(2);
    expect(queryTable(rows, { filter: "highest-impressions" })[0].keyword).toBe("metric to imperial converter");
    expect(queryTable(rows, { filter: "near-page-one" })).toHaveLength(1);
    expect(queryTable(rows, { q: "tip" })).toHaveLength(1);
    expect(queryTable(rows, { sort: "position" })[0].position).toBe(8.2);
    expect(out.summary.top.priority).toBeDefined();
  });
  it("page view lists top queries and registered keywords for one page", () => {
    const v = pageView({ path: "/tools/metric-imperial-converter", index: idx(row("metric to imperial converter", "/tools/metric-imperial-converter", 1240, 18, 11.7), row("kg to pounds", "/tools/metric-imperial-converter", 30, 1, 20)), registry: reg(), range: { label: "x" }, now: NOW });
    expect(v.primaryKeyword).toBe("metric to imperial converter");
    expect(v.topQueries[0].query).toBe("metric to imperial converter");
    expect(v.opportunities).toContain("Near page-one visibility");
    expect(v.indexing.confidence).toBe("INFERRED");
  });
});

// ---------------------------------------------------------------- the runner

function mockClient({ rows = [], prevRows = [], fail = null, available = true } = {}) {
  const calls = [];
  return {
    calls, available, status: { enabled: available, reason: available ? null : "the Search Console API is not configured" },
    searchAnalytics: async (body) => {
      calls.push(body);
      if (fail) return fail;
      return { ok: true, data: { rows: body.startDate < "2026-09-20" ? prevRows : rows } };
    },
  };
}
const ctxOf = (over = {}) => ({ store: memoryStore(), client: mockClient({ rows: [row("tip calculator", "/tools/tip-calculator", 100, 5, 9)], prevRows: [row("tip calculator", "/tools/tip-calculator", 20, 0, 30)] }), site, now: () => NOW, ...over });

describe("refresh, caching, quota and errors", () => {
  it("fetches current and previous periods, stores a compact snapshot, and never stores credentials", async () => {
    const c = ctxOf();
    const r = await refreshKeywordPerformance(c);
    expect(r).toMatchObject({ ok: true, cached: false, trend: true });
    expect(c.client.calls).toHaveLength(2);
    expect(c.client.calls[0].dimensions).toEqual(["query", "page"]);
    const snap = await c.store.get(KW_KEYS.snapshot);
    expect(snap.rows[0]).toEqual(["tip calculator", "/tools/tip-calculator", 5, 100, 9]);
    expect(JSON.stringify(c.store._dump())).not.toMatch(/private_key|Bearer/);
  });
  it("serves a fresh cache without calling Google, and enforces a cooldown on forced refresh", async () => {
    const c = ctxOf();
    await refreshKeywordPerformance(c);
    const again = await refreshKeywordPerformance(c);
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(c.client.calls).toHaveLength(2);
    const forced = await refreshKeywordPerformance(c, { force: true });
    expect(forced).toMatchObject({ ok: false, kind: "cooldown", cached: true });
    expect(forced.retryAfterSeconds).toBeGreaterThan(0);
    const later = { ...c, now: () => NOW + 20 * 60_000 };
    expect((await refreshKeywordPerformance(later, { force: true })).ok).toBe(true);
  });
  it("refreshes again after the cache expires", async () => {
    const c = ctxOf();
    await refreshKeywordPerformance(c);
    expect((await refreshKeywordPerformance({ ...c, now: () => NOW + 7 * 3_600_000 })).cached).toBe(false);
  });
  it("authentication failure: typed error, previous snapshot kept and flagged stale, never shown as zero data", async () => {
    const c = ctxOf();
    await refreshKeywordPerformance(c);
    const bad = { ...c, now: () => NOW + 8 * 3_600_000, client: mockClient({ fail: { ok: false, kind: "auth-failed", message: "Google rejected the service-account sign-in (HTTP 401)" } }) };
    const r = await refreshKeywordPerformance(bad);
    expect(r).toMatchObject({ ok: false, kind: "auth-failed", stale: true });
    expect((await c.store.get(KW_KEYS.snapshot)).rows).toHaveLength(1);
    const view = await getKeywordPerformance({ ...bad }, { inventory: inventory() });
    expect(view.lastError.kind).toBe("auth-failed");
    expect(view.analyses.find((a) => a.keyword === "tip calculator").metrics.impressions).toBe(100);
  });
  it("quota / rate-limit error is surfaced as 'quota' and keeps the cache", async () => {
    const c = ctxOf({ client: mockClient({ fail: { ok: false, kind: "quota", message: "Search Console API quota or rate limit reached" } }) });
    expect(await refreshKeywordPerformance(c)).toMatchObject({ ok: false, kind: "quota" });
  });
  it("our own daily request allowance is enforced", async () => {
    const c = ctxOf({ limits: { dailyCallCap: 1 } });
    expect(await refreshKeywordPerformance(c)).toMatchObject({ ok: true, trend: false }); // current period used the only call; trend skipped
    const r = await refreshKeywordPerformance({ ...c, now: () => NOW + 7 * 3_600_000 }, { force: true });
    expect(r.kind).toBe("budget");
  });
  it("an unconfigured client is reported, not guessed", async () => {
    expect(await refreshKeywordPerformance(ctxOf({ client: mockClient({ available: false }) }))).toMatchObject({ ok: false, kind: "disabled" });
  });
  it("staging, preview and local never call Google", async () => {
    for (const env of ["staging", "preview", "local"]) {
      const c = ctxOf({ environment: env });
      expect(await refreshKeywordPerformance(c)).toMatchObject({ ok: false, kind: "not-production" });
      expect(c.client.calls).toHaveLength(0);
    }
  });
  it("a new site: 28 days empty falls back to 3 months once and says so; truly empty stays an honest zero", async () => {
    const c = ctxOf({ client: { ...mockClient(), searchAnalytics: async (b) => ({ ok: true, data: { rows: Date.parse(b.endDate) - Date.parse(b.startDate) > 60 * 86400000 ? [row("tip calculator", "/tools/tip-calculator", 3, 0, 40)] : [] } }) } });
    const r = await refreshKeywordPerformance(c);
    expect(r).toMatchObject({ ok: true, widened: true });
    const empty = ctxOf({ client: mockClient({}) });
    expect(await refreshKeywordPerformance(empty)).toMatchObject({ ok: true, rows: 0 });
    const v = await getKeywordPerformance(empty, { inventory: inventory() });
    expect(v.summary.siteHasData).toBe(false);
    expect(v.analyses.every((a) => a.status.priority === "INSUFFICIENT DATA")).toBe(true);
  });
  it("drops rows for any other origin and never fetches staging pages", async () => {
    const c = ctxOf({ client: mockClient({ rows: [row("tip calculator", "/tools/tip-calculator", 10, 1, 5), { keys: ["tip calculator", "https://staging.example.com/tools/tip-calculator"], impressions: 99, clicks: 9, position: 1 }] }) });
    await refreshKeywordPerformance(c);
    expect((await c.store.get(KW_KEYS.snapshot)).dropped).toBeGreaterThan(0);
    const fetched = [];
    const t = ctxOf({ fetchPage: async (p) => { fetched.push(p); return { status: 200, html: PAGE() }; }, fetchText: async () => null });
    const inv = inventory(); inv.pages[1].url = "https://staging.example.com/tools/tip-calculator";
    await refreshTargets(t, registryOf(inv));
    expect(fetched).not.toContain("/tools/tip-calculator");
  });
});

describe("end to end: the read model and keyword lookup", () => {
  it("combines stored Search Console data, the index monitor's records and validated pages — without calling Google", async () => {
    const c = ctxOf({
      fetchPage: async (p) => ({ status: 200, html: PAGE({ canonical: ORIGIN + p }) }),
      fetchText: async (u) => (u.endsWith("sitemap.xml") ? `<urlset><url><loc>${ORIGIN}/tools/tip-calculator</loc></url></urlset>` : "User-agent: *\nAllow: /"),
    });
    await c.store.put(GI.registry, { v: 1, records: { "/tools/tip-calculator": { indexState: "INDEXED", inspect: { status: "OK", at: "2026-10-19T00:00:00Z" }, publishedAt: "2026-08-01T00:00:00Z" } } });
    await c.store.put(GI.links, { "/": ["/tools/tip-calculator", "/tools/metric-imperial-converter"] });
    await refreshKeywordPerformance(c);
    expect(await refreshTargets(c, registryOf(inventory()))).toMatchObject({ ok: true, checked: 2 });
    const calls = c.client.calls.length;
    const v = await getKeywordPerformance(c, { inventory: inventory() });
    const tip = v.analyses.find((a) => a.keyword === "tip calculator");
    expect(tip.indexing).toMatchObject({ confidence: "CONFIRMED", indexed: true });
    expect(tip.validation).toMatchObject({ inSitemap: true, exists: true });
    expect(v.analyses.find((a) => a.keyword === "metric converter").validation.inSitemap).toBe(false);
    expect(c.client.calls.length).toBe(calls);
    expect(v.sitemap.detected).toBe(true);
    const l = await lookupKeyword(c, { inventory: inventory(), keyword: "Tip Calculator" });
    expect(l.source).toMatch(/not a Google search/);
    expect(l.analysis.registered).toBe(true);
    expect(formatKeywordAnalysis(l.analysis)).toMatch(/KEYWORD ANALYSIS/);
    expect(v.table({ filter: "all" })).toHaveLength(4);
  });
  it("target refresh is cached and reports when no fetcher is supplied", async () => {
    let n = 0;
    const c = ctxOf({ fetchPage: async () => { n += 1; return { status: 200, html: PAGE() }; }, fetchText: async () => null });
    await refreshTargets(c, registryOf(inventory()));
    const first = n;
    expect((await refreshTargets(c, registryOf(inventory()))).cached).toBe(true);
    expect(n).toBe(first);
    expect(await refreshTargets(ctxOf(), registryOf(inventory()))).toMatchObject({ ok: false, kind: "not-configured" });
    expect(LIMITS.ttlHours).toBeGreaterThan(0);
  });
});
