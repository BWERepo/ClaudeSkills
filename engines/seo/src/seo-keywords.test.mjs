// The developer CLI: registry edits, offline reads, a refresh with a mocked Search Console, pull from KV, and secrets hygiene.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cli, pullFromKv, dataDirOf } from "./seo-keywords.mjs";
import { evaluateState } from "./seo-state-core.mjs";

const SITE = "https://example.com";
let dir; let lines; let errs;
const io = (extra = {}) => ({ out: (s) => lines.push(String(s)), err: (s) => errs.push(String(s)), ...extra });
const text = () => lines.join("\n");
const config = (kp = { enabled: true }) => ({ schemaVersion: 1, projectId: "example", website: SITE, paths: { contentInventory: "seo/content-inventory.json", data: "seo/data" }, environments: { production: { url: SITE, hosts: ["example.com"] } }, publication: { sitemapUrl: `${SITE}/sitemap.xml` }, analytics: { searchConsole: { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON", propertyType: "Domain", verifiedProperty: "example.com", keywordPerformance: kp, indexMonitor: { enabled: true, snapshot: { source: "cloudflare-kv", kvNamespaceId: "0123456789abcdef0123456789abcdef" } } } } });
const inventory = () => ({ schemaVersion: 1, projectId: "example", pages: [{ id: "tip", url: "/tools/tip-calculator", type: "utility", topic: "tips", title: "Tip Calculator", status: "published", indexable: true, created: "2026-08-01" }] });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bwe-kw-"));
  mkdirSync(join(dir, "seo"), { recursive: true });
  writeFileSync(join(dir, "seo", "seo-config.json"), JSON.stringify(config()));
  writeFileSync(join(dir, "seo", "content-inventory.json"), JSON.stringify(inventory()));
  lines = []; errs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const inv = () => JSON.parse(readFileSync(join(dir, "seo", "content-inventory.json"), "utf8"));
const run = (args, extra) => cli([...args, "--project", dir], io(extra));

describe("registry commands", () => {
  it("adds a primary and a secondary keyword to an existing page — and changes nothing else", async () => {
    expect(await run(["add", "tip", "tip calculator", "--primary"])).toBe(0);
    expect(await run(["add", "tip", "gratuity calculator"])).toBe(0);
    expect(inv().pages[0].keywords).toMatchObject({ primary: "tip calculator", secondary: ["gratuity calculator"] });
    expect(inv().pages).toHaveLength(1);
    expect(text()).toMatch(/No page was created or changed/);
  });
  it("refuses a keyword for a page that does not exist, and a second primary", async () => {
    expect(await run(["add", "nope", "x y"])).toBe(1);
    await run(["add", "tip", "tip calculator", "--primary"]);
    expect(await run(["add", "tip", "tipping tool", "--primary"])).toBe(1);
    expect(errs.join(" ")).toMatch(/one primary/);
  });
  it("list, validate and remove", async () => {
    await run(["add", "tip", "tip calculator", "--primary"]);
    lines.length = 0;
    expect(await run(["list"])).toBe(0);
    expect(text()).toMatch(/PRIMARY\s+tip calculator\s+->\s+\/tools\/tip-calculator/);
    expect(await run(["validate"])).toBe(0);
    expect(await run(["remove", "tip", "tip calculator"])).toBe(0);
    expect(inv().pages[0].keywords.primary).toBeNull();
  });
});

describe("refresh with a mocked Search Console", () => {
  const rows = [{ keys: ["tip calculator", `${SITE}/tools/tip-calculator`], clicks: 5, impressions: 400, position: 11.7 }, { keys: ["restaurant tip", `${SITE}/calculators/restaurant-tip`], clicks: 1, impressions: 50, position: 9 }];
  const sa = JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: "unused" });
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    if (String(url).includes("searchAnalytics")) return new Response(JSON.stringify({ rows }), { status: 200 });
    if (String(url).endsWith("/sitemap.xml")) return new Response(`<urlset><url><loc>${SITE}/tools/tip-calculator</loc></url></urlset>`, { status: 200 });
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
    return new Response("<html><head><title>Tip Calculator</title></head><body><h1>Tip Calculator</h1></body></html>", { status: 200 });
  };
  it("without a configured credential, refresh says so and keeps going offline", async () => {
    await run(["add", "tip", "tip calculator", "--primary"]);
    expect(await run(["refresh"], { env: {} })).toBe(1);
    expect(text()).toMatch(/not-configured|Not refreshed/);
    expect(existsSync(join(dataDirOf(config(), dir), "summary.json"))).toBe(true);
  });
  it("fetches once, caches, then analyzes and lists discovered queries from the local copy", async () => {
    await run(["add", "tip", "tip calculator", "--primary"]);
    // the service-account key cannot really sign here; short-circuit the client with a pre-signed-token stub
    const { createSearchConsoleClient } = await import("./gsc-client.mjs");
    expect(createSearchConsoleClient({ config: config(), env: { BWESEO_GSC_SERVICE_ACCOUNT_JSON: sa } }).available).toBe(true);
    // Seed the store as `pull`/`refresh` would, then read offline.
    mkdirSync(dataDirOf(config(), dir), { recursive: true });
    writeFileSync(join(dataDirOf(config(), dir), "store.json"), JSON.stringify({ "kw:snapshot": { v: 1, fetchedAt: "2026-10-19T00:00:00.000Z", range: { key: "28d", startDate: "2026-09-21", endDate: "2026-10-18", days: 28, label: "Last 28 days (2026-09-21 to 2026-10-18)" }, prevRange: null, rows: [["tip calculator", "/tools/tip-calculator", 5, 400, 11.7], ["restaurant tip", "/calculators/restaurant-tip", 1, 50, 9]], prevRows: [] } }));
    lines.length = 0;
    expect(await run(["analyze", "tip calculator"])).toBe(0);
    expect(text()).toMatch(/not a Google search/);
    expect(text()).toMatch(/KEYWORD ANALYSIS/);
    expect(text()).toMatch(/Impressions\s+400/);
    expect(text()).toMatch(/not a live ranking/);
    lines.length = 0;
    await run(["discovered"]);
    expect(text()).toMatch(/"restaurant tip".*impressions 50/);
    expect(text()).toMatch(/nothing is created automatically/);
    lines.length = 0;
    expect(await run(["discovered", "--query", "restaurant tip", "--action", "ignore"])).toBe(0);
    expect(inv().keywordDecisions[0]).toMatchObject({ query: "restaurant tip", decision: "ignore" });
    lines.length = 0;
    await run(["discovered"]);
    expect(text()).toMatch(/No unregistered queries/);
    await run(["table", "--filter", "near-page-one"]);
    expect(await run(["table", "--filter", "bogus"])).toBe(2);
  });
  it("never writes a credential into the project's data folder", async () => {
    await run(["add", "tip", "tip calculator", "--primary"]);
    await run(["refresh"], { env: { BWESEO_GSC_SERVICE_ACCOUNT_JSON: sa }, fetchImpl });
    const all = ["store.json", "summary.json"].map((f) => { const p = join(dataDirOf(config(), dir), f); return existsSync(p) ? readFileSync(p, "utf8") : ""; }).join("");
    expect(all).not.toMatch(/private_key|client_email|Bearer|eyJ/);
  });
});

describe("pull from the site's production KV (wrangler)", () => {
  it("uses the developer's own wrangler login against the production namespace, and stores what it reads", async () => {
    const calls = [];
    const exec = (cmd, args) => { calls.push(args); const key = args[args.indexOf("get") + 1]; return key === "kw:snapshot" ? JSON.stringify({ v: 1, fetchedAt: "2026-10-19T00:00:00.000Z", range: { label: "Last 28 days" }, rows: [], prevRows: [] }) : key === "gi:registry" ? JSON.stringify({ v: 1, records: {} }) : ""; };
    expect(await run(["pull"], { exec })).toBe(0);
    expect(calls[0]).toEqual(expect.arrayContaining(["--namespace-id", "0123456789abcdef0123456789abcdef", "--remote"]));
    expect(existsSync(join(dataDirOf(config(), dir), "summary.json"))).toBe(true);
  });
  it("a site that has not stored anything yet is explained, not guessed", () => {
    expect(() => pullFromKv(config(), dir, { exec: () => "" })).toThrow(/has not stored keyword performance yet|could not read/);
  });
  it("/BWESEO reads the pulled summary and recommends the next action", async () => {
    await run(["add", "tip", "tip calculator", "--primary"]);
    mkdirSync(dataDirOf(config(), dir), { recursive: true });
    writeFileSync(join(dataDirOf(config(), dir), "store.json"), JSON.stringify({ "kw:snapshot": { v: 1, fetchedAt: "2026-10-19T00:00:00.000Z", range: { key: "28d", label: "Last 28 days" }, rows: [["tip calculator", "/tools/tip-calculator", 1, 2000, 4]], prevRows: [] } }));
    await run(["status"]);
    const summary = JSON.parse(readFileSync(join(dataDirOf(config(), dir), "summary.json"), "utf8"));
    expect(summary.summary.lowCtr).toBe(1);
    const ev = { today: "2026-10-20", repo: { remote: "https://github.com/x/example.git", folderName: "example" }, config: { ...config(), engine: { version: "1.10.0" }, adapter: "static-html", stack: {}, repo: { gitRemote: "x/example" }, workflows: { build: "b", test: "t", deployProduction: "d" }, conversion: { primary: "x" } }, profile: { identity: { businessName: { value: "Ex", status: "verified" } }, lastReviewed: "2026-10-20", openQuestions: [] }, inventory: inv(), validation: { errors: [], warnings: [] }, docs: { baseline: { exists: true, updated: "2026-10-20", hasContent: true }, roadmap: { exists: true, updated: "2026-10-20", hasContent: true } }, searchConsoleExports: [], sources: {}, live: { checked: false }, keywordPerformance: { ...summary, pulledAt: "2026-10-19T00:00:00.000Z" } };
    const s = evaluateState(ev, { today: "2026-10-20" });
    expect(s.actions.map((a) => a.kind)).toContain("improve-keyword-snippets");
  });
});
