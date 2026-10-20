// /BWESEO integration of Google index monitoring: the display model, the dashboard lines, the state-aware next actions,
// the separation of SEO/indexing health from website health, the validator, and the developer-side CLI (pull / explain).
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateState, formatDashboard, googleIndexOf, indexMonitorOf, indexSummaryLine, STATE_VERSION } from "./seo-state-core.mjs";
import { validateConfig } from "./validate-seo-data.mjs";
import { buildPullCommand, pullSnapshot, explainRecord, investigationReport } from "./seo-google-index.mjs";
import { applyInspection, normalizeInspection, newRecord, summarize } from "./index-monitor.mjs";

const TODAY = "2026-11-02";
const SITE = "https://acme-heating.example.com";

const config = (monitor = { enabled: true, snapshot: { source: "cloudflare-kv", kvNamespaceId: "0123456789abcdef0123456789abcdef" } }) => ({
  schemaVersion: 1,
  projectId: "acme-heating",
  website: SITE,
  repo: { gitRemote: "acme/site" },
  engine: { version: STATE_VERSION },
  adapter: "static-html",
  stack: {},
  workflows: { build: "npm run build", test: "npm test", deployProduction: "npm run release" },
  conversion: { primary: "A booked service call" },
  paths: { businessProfile: "seo/business-profile.json", contentInventory: "seo/content-inventory.json", docs: "docs/seo" },
  analytics: { searchConsole: { access: "api", configured: "yes", propertyType: "Domain", verifiedProperty: "acme-heating.example.com", verificationMethod: "DNS", verifiedOn: "2026-10-01", sitemapSubmission: "verified", ...(monitor ? { indexMonitor: monitor } : {}) } },
  publication: { usesSitemap: true, sitemapUrl: `${SITE}/sitemap.xml` },
});
const profile = { identity: { businessName: { value: "Acme Heating", status: "verified" } }, lastReviewed: TODAY, openQuestions: [] };
const homePage = { id: "home", url: "/", type: "home", status: "published", title: "Acme Heating", topic: "Home", indexable: true };
const doc = { exists: true, updated: TODAY, hasContent: true };
const evidence = (cfg, googleIndex) => ({
  today: TODAY,
  repo: { remote: "https://github.com/acme/site.git", folderName: "site" },
  config: cfg,
  profile,
  inventory: { schemaVersion: 1, projectId: "acme-heating", pages: [homePage, { id: "old", url: "/old", status: "rejected", type: "service", topic: "x", indexable: true }] },
  validation: { errors: [], warnings: [] },
  docs: { baseline: doc, roadmap: doc },
  searchConsoleExports: [],
  sources: {},
  live: { checked: false, reason: "not checked in tests" },
  ...(googleIndex ? { googleIndex } : {}),
});

const summary = (over = {}) => ({
  v: 1,
  generatedAt: "2026-11-02T09:00:00.000Z",
  productionUrls: 87, indexed: 81, receivingImpressions: 63, crawledNotIndexed: 4, discoveredNotIndexed: 0, notDiscovered: 2,
  blocked: 0, canonicalProblems: 0, errors: 0, notYetChecked: 0, unavailable: 0, needAttention: 6, notInSitemap: 0, indexedNoImpressions: 0,
  indexingRate: { indexed: 81, of: 87 },
  lastGoogleCheckAt: "2026-11-02T09:00:00.000Z",
  searchConsole: { connected: true, status: "OK" },
  sitemap: { status: "HEALTHY", errors: 0 },
  stagingProtection: { status: "PROTECTED" },
  openAlerts: 1,
  attention: [
    { path: "/pages/a", state: "CRAWLED_NOT_INDEXED", reason: "Crawled — not indexed for 20 days", googleStatus: "Crawled - currently not indexed", lastCrawl: "2026-10-20T01:00:00Z", lastCheckedAt: "2026-11-02T08:00:00Z" },
    { path: "/pages/b", state: "NOT_DISCOVERED_BY_GOOGLE", reason: "Google has no record of this page 9 days after it was published", googleStatus: "URL is unknown to Google", lastCrawl: null, lastCheckedAt: "2026-11-02T08:00:00Z" },
  ],
  ...over,
});
const snap = (over = {}, pulledAt = "2026-11-02T09:05:00.000Z") => ({ pulledAt, summary: summary("attention" in over && !("needAttention" in over) ? { ...over, needAttention: over.attention.length } : over) });
const run = (cfg, g) => evaluateState(evidence(cfg, g), { today: TODAY });
const kinds = (s) => s.actions.map((a) => a.kind);

describe("display model", () => {
  it("is not applicable unless the project declares an indexMonitor", () => {
    expect(googleIndexOf(config(null), snap()).applicable).toBe(false);
    expect(indexMonitorOf(config(null)).declared).toBe(false);
    expect(formatDashboard(run(config(null), snap()))).not.toContain("Google indexing");
  });
  it("reports the figures exactly as the monitor stored them, and the rate as a plain ratio", () => {
    const g = googleIndexOf(config(), snap(), TODAY);
    expect(g).toMatchObject({ applicable: true, hasSnapshot: true, searchConsole: "Connected", sitemap: "Healthy", rate: { indexed: 81, of: 87 }, stale: false });
    expect(indexSummaryLine(g)).toBe("87 production URLs · 81 indexed · 4 crawled — not indexed · 2 not discovered");
    expect(g).not.toHaveProperty("score");
    expect(JSON.stringify(g)).not.toMatch(/"score"/);
  });
  it("without a snapshot nothing is claimed", () => {
    const g = googleIndexOf(config(), null, TODAY);
    expect(g).toMatchObject({ hasSnapshot: false, counts: null, rate: null });
    expect(g.searchConsole).toMatch(/no monitoring data pulled yet/);
  });
  it("knows when the snapshot is stale", () => {
    expect(googleIndexOf(config(), snap({}, "2026-10-20T00:00:00.000Z"), TODAY)).toMatchObject({ stale: true, ageDays: 13 });
  });
});

describe("dashboard", () => {
  it("shows Search Console, Sitemap, Indexing and the indexing rate", () => {
    const out = formatDashboard(run(config(), snap()));
    expect(out).toContain("Google indexing");
    expect(out).toMatch(/Search Console \.+ Connected/);
    expect(out).toMatch(/Sitemap \.+ Healthy/);
    expect(out).toMatch(/Indexing \.+ 87 production URLs · 81 indexed · 4 crawled — not indexed · 2 not discovered/);
    expect(out).toMatch(/Indexing rate \.+ 81 \/ 87/);
  });
  it("warns, in the dashboard, when staging appears indexable", () => {
    expect(formatDashboard(run(config(), snap({ stagingProtection: { status: "EXPOSED" } })))).toMatch(/WARNING \.+ staging appears indexable/);
  });
});

describe("state-aware recommendations", () => {
  it("not connected: connect Google Search Console (a manual step for the owner)", () => {
    const s = run(config(), snap({ searchConsole: { connected: false, status: "NOT_CONFIGURED" }, productionUrls: 5, indexed: 0, crawledNotIndexed: 0, notDiscovered: 0, indexingRate: { indexed: 0, of: 5 }, attention: [] }));
    const a = s.actions.find((x) => x.kind === "connect-search-console");
    expect(a).toMatchObject({ actor: "user", manual: true, headline: "Connect Google Search Console." });
    expect(a.command).toBe("docs/google-search-console-setup.md");
  });
  it("sitemap not registered: submit it (the owner clicks SUBMIT SITEMAP)", () => {
    const s = run(config(), snap({ sitemap: { status: "NOT_SUBMITTED" }, crawledNotIndexed: 0, notDiscovered: 0, attention: [] }));
    expect(kinds(s)).toContain("register-sitemap");
  });
  it("published pages missing from the sitemap: repair sitemap generation", () => {
    const s = run(config(), snap({ notInSitemap: 3, crawledNotIndexed: 0, notDiscovered: 0, attention: [] }));
    const a = s.actions.find((x) => x.kind === "repair-sitemap");
    expect(a.headline).toBe("Repair sitemap generation.");
    expect(a.what).toMatch(/3 published/);
    expect(formatDashboard(run(config(), snap({ notInSitemap: 3 })))).toMatch(/Sitemap \.+ Attention required — 3 published page\(s\) missing/);
  });
  it("crawled-but-not-indexed pages: investigate, listing the URLs with Google's own evidence", () => {
    const s = run(config(), snap());
    const a = s.actions.find((x) => x.kind === "investigate-indexing");
    expect(a.headline).toBe("Investigate 6 URLs Google has not indexed.");
    expect(a.what).toMatch(/content quality, canonicalization, duplication and internal-linking/);
    expect(a.evidence[0]).toContain("/pages/a");
    expect(a.evidence[0]).toContain("Crawled - currently not indexed");
    expect(a.evidence[1]).toContain("no Google crawl reported");
    expect(a.why).toMatch(/not guarantees/);
  });
  it("indexed pages with no impressions: review targeting — never called an indexing problem", () => {
    const s = run(config(), snap({ crawledNotIndexed: 0, notDiscovered: 0, attention: [], indexedNoImpressions: 4 }));
    const a = s.actions.find((x) => x.kind === "review-impressions");
    expect(a.why).toMatch(/not an indexing problem/);
    expect(kinds(s)).not.toContain("investigate-indexing");
  });
  it("no snapshot yet: pull it; a stale snapshot is refreshed at low priority", () => {
    expect(kinds(run(config(), null))).toContain("pull-index-snapshot");
    const stale = run(config(), snap({ crawledNotIndexed: 0, notDiscovered: 0, attention: [] }, "2026-10-20T00:00:00.000Z"));
    expect(stale.actions.find((x) => x.kind === "pull-index-snapshot")).toMatchObject({ stale: true, rank: 610 });
  });
  it("a declared but disabled monitor never nags", () => {
    expect(kinds(run(config({ enabled: false }), null)).filter((k) => /index|sitemap|search-console/.test(k))).toEqual([]);
  });
  it("a healthy snapshot recommends nothing about indexing", () => {
    const s = run(config(), snap({ crawledNotIndexed: 0, notDiscovered: 0, attention: [], indexingRate: { indexed: 87, of: 87 }, indexed: 87 }));
    expect(kinds(s).filter((k) => /investigate|repair|connect|register|pull/.test(k))).toEqual([]);
  });
});

describe("website health and SEO/indexing health stay separate", () => {
  it("indexing problems never become conflicts, never touch live health and never mention a deploy", () => {
    const withProblems = run(config(), snap());
    const without = run(config(null), null);
    expect(withProblems.conflicts).toEqual(without.conflicts);
    expect(withProblems.liveHealth).toEqual(without.liveHealth);
    const text = JSON.stringify(withProblems.actions.filter((a) => /index|sitemap|search-console/.test(a.kind)));
    expect(text).not.toMatch(/redeploy|re-deploy|roll ?back|site is down|is down/i);
  });
});

describe("validator", () => {
  const errors = (monitor) => {
    const r = { errors: [], warnings: [] };
    return validateConfig(config(monitor), r) ?? r;
  };
  it("accepts a valid indexMonitor block", () => {
    expect(errors({ enabled: true, staleAfterDays: 3, thresholds: { batchSize: 12 }, snapshot: { source: "cloudflare-kv", kvNamespaceId: "0123456789abcdef0123456789abcdef" } }).errors.filter((e) => /indexMonitor/.test(e))).toEqual([]);
  });
  it("rejects bad types and any credential-like key", () => {
    const e = errors({ enabled: "yes", staleAfterDays: 0, snapshot: { source: "ftp", kvNamespaceId: "nope" }, serviceAccountKey: "x" }).errors.join("\n");
    expect(e).toMatch(/indexMonitor.enabled must be true or false/);
    expect(e).toMatch(/staleAfterDays must be a positive integer/);
    expect(e).toMatch(/snapshot.source must be cloudflare-kv or file/);
    expect(e).toMatch(/kvNamespaceId must be a 32-character/);
    expect(e).toMatch(/never store credentials/);
  });
  it("warns when enabled without a snapshot source", () => {
    expect(errors({ enabled: true }).warnings.join("\n")).toMatch(/snapshot is not configured/);
  });
});

describe("developer CLI: pull, explain, investigate", () => {
  const cfg = config();
  const origin = SITE;
  it("builds the wrangler read command for PRODUCTION only, with arguments and no shell string", () => {
    const c = buildPullCommand(cfg, "gi:summary", "linux");
    expect(c).toEqual({ ok: true, command: "npx", args: ["wrangler", "kv", "key", "get", "gi:summary", "--namespace-id", "0123456789abcdef0123456789abcdef", "--remote"] });
    expect(buildPullCommand(cfg, "gi:summary", "win32").command).toBe("npx.cmd");
    expect(buildPullCommand(config({ enabled: true }), "gi:summary").ok).toBe(false);
    expect(buildPullCommand(config({ enabled: true, snapshot: { source: "cloudflare-kv", kvNamespaceId: "x" } }), "k").ok).toBe(false);
  });
  it("pulls the summary and registry into seo/data/google-index, never into tracked files", () => {
    const dir = mkdtempSync(join(tmpdir(), "bweseo-gi-"));
    try {
      const calls = [];
      const exec = (cmd, args) => { calls.push(args[4]); return args[4] === "gi:summary" ? JSON.stringify(summary()) : JSON.stringify({ v: 1, records: { "/a": { path: "/a" } } }); };
      const r = pullSnapshot(cfg, dir, { exec, now: Date.parse("2026-11-02T10:00:00Z") });
      expect(calls).toEqual(["gi:summary", "gi:registry"]);
      expect(r.hasRegistry).toBe(true);
      const snapJson = JSON.parse(readFileSync(join(dir, "seo", "data", "google-index", "snapshot.json"), "utf8"));
      expect(snapJson).toMatchObject({ pulledAt: "2026-11-02T10:00:00.000Z", source: "cloudflare-kv" });
      expect(snapJson.summary.productionUrls).toBe(87);
      expect(existsSync(join(dir, "seo", "data", "google-index", "registry.json"))).toBe(true);
      expect(JSON.stringify(snapJson)).not.toMatch(/private_key|client_email|token/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("says so when the monitor has not stored anything yet, and tolerates a missing registry", () => {
    const dir = mkdtempSync(join(tmpdir(), "bweseo-gi-"));
    try {
      expect(() => pullSnapshot(cfg, dir, { exec: () => "" })).toThrow(/has not stored a summary yet/);
      expect(() => pullSnapshot(cfg, dir, { exec: () => "not json" })).toThrow(/not valid JSON/);
      let n = 0;
      const r = pullSnapshot(cfg, dir, { exec: () => (n++ === 0 ? JSON.stringify(summary()) : ""), now: 0 });
      expect(r.hasRegistry).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("explains one URL in Google's words, then in plain language, with the observed checks and a timeline", () => {
    let rec = { ...newRecord("/pages/a", `${origin}/pages/a`, Date.parse("2026-10-01T00:00:00Z")), publishedAt: "2026-10-01T00:00:00.000Z", inSitemap: true };
    rec = applyInspection(rec, normalizeInspection({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-20T01:00:00Z", userCanonical: `${origin}/pages/a`, googleCanonical: `${origin}/pages/a` } } }, { origin }), Date.parse("2026-11-02T00:00:00Z")).record;
    const e = explainRecord(rec, origin);
    expect(e).toMatchObject({ status: "Crawled — not indexed", googleSays: "Crawled - currently not indexed", lastCrawl: "2026-10-20T01:00:00Z" });
    expect(e.plainLanguage).toMatch(/has not chosen to include it/);
    expect(e.suggestedChecks.length).toBeGreaterThan(3);
    expect(e.timeline.some((t) => t.key === "first-crawl")).toBe(true);
    expect(e.timeline.some((t) => t.key === "first-indexed")).toBe(false);
    expect(investigationReport({ records: { [rec.path]: { ...rec, attention: true }, "/ok": { ...rec, path: "/ok", attention: false } } }, origin).map((x) => x.path)).toEqual(["/pages/a"]);
  });
  it("summaries produced by the monitor are accepted by /BWESEO unchanged", () => {
    const r = { ...newRecord("/a", `${origin}/a`, Date.now()), indexState: "INDEXED" };
    const g = googleIndexOf(config(), { pulledAt: new Date().toISOString(), summary: summarize([r], { googleApi: { status: "OK" } }, Date.now()) }, new Date().toISOString().slice(0, 10));
    expect(g.counts).toMatchObject({ productionUrls: 1, indexed: 1 });
    expect(g.searchConsole).toBe("Connected");
  });
});

describe("the engine stays generic (usable on any website)", () => {
  it("pull supports a plain file source for sites that are not on Cloudflare", () => {
    const dir = mkdtempSync(join(tmpdir(), "bweseo-gi-file-"));
    try {
      const src = join(dir, "feeds");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "summary.json"), JSON.stringify(summary()));
      writeFileSync(join(src, "registry.json"), JSON.stringify({ v: 1, records: { "/a": { path: "/a" } } }));
      const cfg = config({ enabled: true, snapshot: { source: "file", dir: "feeds" } });
      const r = pullSnapshot(cfg, dir, { now: Date.parse("2026-11-02T10:00:00Z") });
      expect(r.hasRegistry).toBe(true);
      expect(r.snapshot.summary.productionUrls).toBe(87);
      expect(r.snapshot.source).toBe("file");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("no engine file hard-codes a website, a property or an id: only Google, standards and reserved example hosts appear", () => {
    const files = ["gsc-client.mjs", "index-monitor.mjs", "index-monitor-run.mjs", "seo-google-index.mjs", "../docs/methodology/google-index-monitoring.md"];
    const allowed = /(^|\.)(googleapis\.com|google\.com|example\.com|example\.org|schema\.org|sitemaps\.org|w3\.org|invalid|invalid.example|cloudflare\.com|github\.com)$/i;
    // The methodology doc stays in the engine; an installed website has only the code files.
    for (const f of files.filter((f) => !f.startsWith("../") || existsSync(new URL(`./${f}`, import.meta.url)))) {
      const text = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) expect(m[1], `${f}: ${m[0]}`).toMatch(allowed);
      expect(text, f).not.toMatch(/[0-9a-f]{32}/); // no namespace / account ids
    }
  });
});
