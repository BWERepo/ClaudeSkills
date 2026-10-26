// CLI tests for seo-queue.mjs, seo-outcomes.mjs and seo-doctor.mjs on throw-away projects with fictional data. No network.
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main as queue } from "./seo-queue.mjs";
import { main as outcomes } from "./seo-outcomes.mjs";
import { main as doctor, runDiagnostics } from "./seo-doctor.mjs";
import { createHash } from "node:crypto";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const project = (site = "https://shop.example", inventoryIssues = []) => {
  const dir = mkdtempSync(join(tmpdir(), "impr-"));
  mkdirSync(join(dir, "seo", "data"), { recursive: true });
  writeFileSync(join(dir, "seo", "seo-config.json"), JSON.stringify({ schemaVersion: 1, website: site, adapter: "static-html", paths: { data: "seo/data" } }));
  writeFileSync(join(dir, "seo", "content-inventory.json"), JSON.stringify({ schemaVersion: 1, pages: [], issues: inventoryIssues }));
  return dir;
};
const cli = async (fn, dir, args, extra = {}) => { const out = [], err = []; const code = await fn(args, { project: dir, out: (s) => out.push(s), err: (s) => err.push(s), now: NOW, ...extra }); return { code, out: out.join("\n"), err: err.join("\n") }; };
const issue = (id, over = {}) => ({ id, title: `Issue ${id}`, severity: "high", area: "technical", status: "open", foundOn: "2026-10-20", ...over });
const snapshot = (dir) => Object.fromEntries(["seo/content-inventory.json", "seo/seo-config.json"].map((f) => [f, readFileSync(join(dir, f), "utf8")]));

describe("seo-queue.mjs", () => {
  it("builds, lists, explains and picks the next action without changing source records", async () => {
    const dir = project("https://shop.example", [issue("slow-pages"), issue("no-sitemap", { severity: "critical", blocking: true })]);
    const before = snapshot(dir);
    mkdirSync(join(dir, "seo/data/local-gbp"), { recursive: true });
    writeFileSync(join(dir, "seo/data/local-gbp/recommendations.json"), JSON.stringify([{ id: "gbp-add-hours-1", type: "add-hours", reason: "Hours missing", priority: "medium", state: "new", foundOn: "2026-10-20", publicChange: true }]));
    mkdirSync(join(dir, "seo/data/landing"), { recursive: true });
    writeFileSync(join(dir, "seo/data/landing/state.json"), JSON.stringify({ opportunities: [{ id: "lp-x", action: "new-page", primary: "custom things", target: "/custom-things", status: "proposed", score: { priority: "P2" } }] }));
    const b = await cli(queue, dir, ["build"]);
    expect(b.code).toBe(0);
    expect(b.out).toMatch(/4 item\(s\)/);
    expect(snapshot(dir)).toEqual(before);
    const list = await cli(queue, dir, ["list", "--json"]);
    const model = JSON.parse(list.out);
    expect(model.items.map((i) => i.category)).toEqual(expect.arrayContaining(["technical", "gbp", "landing-page"]));
    expect(model.items[0].source.ref).toBe("no-sitemap");
    const next = await cli(queue, dir, ["next"]);
    expect(next.code).toBe(0);
    expect(next.out).toMatch(/APPROVE .*no-sitemap|APPROVE q-/);
    expect(next.out).toMatch(/Higher-ranked|Why this one/);
    const id = model.items[0].id;
    const ex = await cli(queue, dir, ["explain", id]);
    expect(ex.out).toMatch(/Evidence:/); expect(ex.out).toMatch(/Verify by:/); expect(ex.out).toMatch(/History:/);
    expect((await cli(queue, dir, ["explain", "nope"])).code).toBe(1);
  });
  it("records a person's decision, which survives a rebuild, and refuses invalid ones", async () => {
    const dir = project("https://shop.example", [issue("slow-pages", { needsApproval: false })]);
    await cli(queue, dir, ["build"]);
    const id = JSON.parse((await cli(queue, dir, ["list", "--json"])).out).items[0].id;
    expect((await cli(queue, dir, ["decide", id, "--to", "deferred"])).code).toBe(3);
    expect((await cli(queue, dir, ["decide", id, "--to", "resolved", "--by", "Dana"])).code).toBe(1);
    expect((await cli(queue, dir, ["decide", id, "--to", "deferred", "--by", "Dana", "--note", "later"])).code).toBe(0);
    expect((await cli(queue, dir, ["assign", id, "--owner", "Sam", "--by", "Dana"])).code).toBe(0);
    await cli(queue, dir, ["build"]);
    const item = JSON.parse((await cli(queue, dir, ["list", "--json"])).out).items[0];
    expect(item).toMatchObject({ status: "deferred", owner: "Sam" });
    expect((await cli(queue, dir, ["next"])).code).toBe(1);
  });
  it("mirrors a status the inventory owner changed", async () => {
    const dir = project("https://shop.example", [issue("slow-pages")]);
    await cli(queue, dir, ["build"]);
    const inv = JSON.parse(readFileSync(join(dir, "seo/content-inventory.json"), "utf8"));
    inv.issues[0].status = "wont-fix";
    writeFileSync(join(dir, "seo/content-inventory.json"), JSON.stringify(inv));
    await cli(queue, dir, ["build"]);
    expect(JSON.parse((await cli(queue, dir, ["list", "--json"])).out).items[0].status).toBe("wont-fix");
  });
  it("consumes a saved regression report and does not resolve from a partial one", async () => {
    const dir = project();
    const report = (status, findings) => writeFileSync(join(dir, "report.json"), JSON.stringify({ run: { status, observedAt: "2026-10-23" }, findings }));
    report("complete", [{ type: "noindex-added", severity: "critical", url: "/pricing", action: "Remove noindex", verification: ["rerun"] }]);
    expect((await cli(queue, dir, ["build", "--regression", "report.json"])).code).toBe(0);
    report("partial", []);
    await cli(queue, dir, ["build", "--regression", "report.json"]);
    expect(JSON.parse((await cli(queue, dir, ["list", "--json"])).out).items[0].status).toBe("open");
    report("complete", []);
    await cli(queue, dir, ["build", "--regression", "report.json"]);
    expect(JSON.parse((await cli(queue, dir, ["list", "--json"])).out).items[0].status).toBe("resolved");
    expect((await cli(queue, dir, ["build", "--regression", "missing.json"])).code).toBe(1);
  });
  it("keeps customers apart: separate projects, separate queues, no cross-site merge", async () => {
    const a = project("https://a.example", [issue("only-in-a")]);
    const b = project("https://b.example", [issue("only-in-b")]);
    await cli(queue, a, ["build"]); await cli(queue, b, ["build"]);
    const refs = async (d) => JSON.parse((await cli(queue, d, ["list", "--json"])).out).items.map((i) => i.source.ref);
    expect(await refs(a)).toEqual(["only-in-a"]); expect(await refs(b)).toEqual(["only-in-b"]);
    writeFileSync(join(b, "seo/data/improvement-queue.json"), readFileSync(join(a, "seo/data/improvement-queue.json")));
    const r = await cli(queue, b, ["build"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/belongs to https:\/\/a.example/);
  });
  it("leaves a corrupt or newer queue file untouched and says so", async () => {
    const dir = project();
    const f = join(dir, "seo/data/improvement-queue.json");
    writeFileSync(f, "{not json");
    expect((await cli(queue, dir, ["list"])).code).toBe(1);
    expect(readFileSync(f, "utf8")).toBe("{not json");
    writeFileSync(f, JSON.stringify({ queueSchemaVersion: 9, items: [] }));
    expect((await cli(queue, dir, ["build"])).err).toMatch(/Update the engine/);
    expect(JSON.parse(readFileSync(f, "utf8")).queueSchemaVersion).toBe(9);
    expect(readdirSync(join(dir, "seo/data")).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
  it("counts an item resolved at its source in the build summary", async () => {
    const dir = project("https://shop.example", [issue("slow-pages")]);
    expect((await cli(queue, dir, ["build"])).out).toMatch(/1 new, 0 resolved/);
    writeFileSync(join(dir, "seo", "content-inventory.json"), JSON.stringify({ schemaVersion: 1, pages: [], issues: [issue("slow-pages", { status: "resolved" })] }));
    const b = await cli(queue, dir, ["build"]);
    expect(b.out).toMatch(/0 new, 1 resolved/);
    expect(JSON.parse((await cli(queue, dir, ["list", "--json"])).out).items[0].status).toBe("resolved");
  });
  it("is not a BWESEO project without seo-config.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-"));
    expect((await cli(queue, dir, ["list"])).code).toBe(2);
  });
});

describe("seo-outcomes.mjs", () => {
  it("records a change, lists it and compares saved rows; compare is read-only", async () => {
    const dir = project();
    const rows = []; for (let d = Date.parse("2026-08-04T00:00:00Z"); d <= Date.parse("2026-09-29T00:00:00Z"); d += 86_400_000) rows.push({ date: new Date(d).toISOString().slice(0, 10), clicks: 5, impressions: 150 });
    writeFileSync(join(dir, "rows.json"), JSON.stringify(rows));
    expect((await cli(outcomes, dir, ["record", "chg-1", "--page", "/widgets", "--category", "content", "--published", "2026-09-01", "--hash", "abc", "--by", "Dana"])).code).toBe(0);
    expect((await cli(outcomes, dir, ["record", "chg-1", "--page", "/w", "--published", "2026-09-01", "--by", "Dana"])).code).toBe(3);
    const file = join(dir, "seo/data/outcomes.json");
    const stored = readFileSync(file, "utf8");
    const c = await cli(outcomes, dir, ["compare", "chg-1", "--rows", "rows.json", "--today", "2026-10-20"]);
    expect(c.code).toBe(0);
    expect(c.out).toMatch(/clicks: 140 -> 140/); expect(c.out).toMatch(/conversions: unavailable/); expect(c.out).toMatch(/does not show that the change caused/);
    expect(readFileSync(file, "utf8")).toBe(stored);
    expect((await cli(outcomes, dir, ["due", "--today", "2026-09-20"])).out).toMatch(/2026-09-15/);
    expect((await cli(outcomes, dir, ["review", "chg-1", "--rows", "rows.json", "--today", "2026-09-10", "--by", "Dana"])).code).toBe(1); // not final yet
    expect((await cli(outcomes, dir, ["review", "chg-1", "--rows", "rows.json", "--today", "2026-10-20", "--review-date", "2026-09-15", "--by", "Dana"])).code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).changes[0].reviews).toHaveLength(1);
    // repeating a review of the same date must not inflate the "reviews n/m" count shown by list
    await cli(outcomes, dir, ["review", "chg-1", "--rows", "rows.json", "--today", "2026-10-20", "--review-date", "2026-09-15", "--by", "Dana"]);
    expect((await cli(outcomes, dir, ["list"])).out).toMatch(/reviews 1\/3/);
    expect((await cli(outcomes, dir, ["compare", "nope", "--rows", "rows.json"])).code).toBe(1);
  });
});

describe("seo-doctor.mjs", () => {
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  const byId = (r, id) => r.checks.find((c) => c.id === id);
  it("reports UNKNOWN, not PASS, where there is no evidence, and changes nothing", () => {
    const dir = project();
    const before = JSON.stringify(readdirSync(join(dir, "seo"), { recursive: true }));
    const r = runDiagnostics({ project: dir, env: {}, now: NOW, nodeVersion: "22.1.0" });
    expect(byId(r, "install").status).toBe("UNKNOWN");
    expect(byId(r, "credentials").status).toBe("UNKNOWN");
    expect(byId(r, "scheduler").status).toBe("UNKNOWN");
    expect(byId(r, "fresh:keyword-performance/summary.json").status).toBe("UNKNOWN");
    expect(byId(r, "runtime").status).toBe("PASS");
    expect(JSON.stringify(readdirSync(join(dir, "seo"), { recursive: true }))).toBe(before);
  });
  it("lists keyword performance as enabled only when its own enabled flag is true", () => {
    const dir = project();
    const set = (kp) => { const cfg = JSON.parse(readFileSync(join(dir, "seo/seo-config.json"), "utf8")); cfg.analytics = { searchConsole: { keywordPerformance: kp } }; writeFileSync(join(dir, "seo/seo-config.json"), JSON.stringify(cfg)); return byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "adapter").detail; };
    expect(set({ enabled: false, defaultRange: "28d" })).not.toMatch(/keyword performance/);
    expect(set({ enabled: true })).toMatch(/enabled by configuration: keyword performance/);
  });
  it("fails an old runtime and detects a missing or modified installed file", () => {
    const dir = project();
    expect(byId(runDiagnostics({ project: dir, env: {}, now: NOW, nodeVersion: "16.20.0" }), "runtime").status).toBe("FAIL");
    mkdirSync(join(dir, "seo/tools"), { recursive: true });
    writeFileSync(join(dir, "seo/tools/a.mjs"), "// a\n");
    writeFileSync(join(dir, "seo/bweseo-install.json"), JSON.stringify({ engineVersion: "2026.10.23.01", files: { "seo/tools/a.mjs": { sha256: sha("// a\n") } } }));
    expect(byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "install").status).toBe("PASS");
    writeFileSync(join(dir, "seo/tools/a.mjs"), "// edited\n");
    expect(byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "install").status).toBe("WARN");
    writeFileSync(join(dir, "seo/bweseo-install.json"), JSON.stringify({ files: { "seo/tools/gone.mjs": { sha256: "x" } } }));
    expect(byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "install")).toMatchObject({ status: "FAIL", next: expect.stringMatching(/Update/) });
  });
  it("reports credentials by name only and never prints the value", () => {
    const dir = project();
    const cfg = JSON.parse(readFileSync(join(dir, "seo/seo-config.json"), "utf8"));
    cfg.analytics = { searchConsole: { enabled: true, access: "api", credentialsSource: "env:EXAMPLE_GSC_KEY", propertyType: "Domain", verifiedProperty: "shop.example" } };
    writeFileSync(join(dir, "seo/seo-config.json"), JSON.stringify(cfg));
    const secret = "TOP-SECRET-VALUE-123";
    const missing = byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "credentials");
    expect(missing.detail).toMatch(/EXAMPLE_GSC_KEY/);
    const wrong = runDiagnostics({ project: dir, env: { EXAMPLE_GSC_KEY: secret }, now: NOW });
    expect(byId(wrong, "credentials").status).toBe("FAIL");
    expect(JSON.stringify(wrong)).not.toContain(secret);
    const good = runDiagnostics({ project: dir, env: { EXAMPLE_GSC_KEY: JSON.stringify({ client_email: "svc@example.test", private_key: secret }) }, now: NOW });
    expect(byId(good, "credentials").status).toBe("PASS");
    expect(JSON.stringify(good)).not.toContain(secret);
    expect(JSON.stringify(good)).not.toContain("svc@example.test");
  });
  it("grades stored-data age and labels scheduler success as recorded evidence", () => {
    const dir = project();
    mkdirSync(join(dir, "seo/data/google-index"), { recursive: true });
    writeFileSync(join(dir, "seo/data/google-index/snapshot.json"), JSON.stringify({ pulledAt: "2026-08-01T00:00:00Z", lastRun: { at: "2026-10-22T03:00:00Z", errors: 0 } }));
    const r = runDiagnostics({ project: dir, env: {}, now: NOW });
    expect(byId(r, "fresh:google-index/snapshot.json").status).toBe("WARN");
    const s = byId(r, "scheduler");
    expect(s.status).toBe("PASS");
    expect(s.detail).toMatch(/stored record, not a live check/);
    writeFileSync(join(dir, "seo/data/google-index/snapshot.json"), JSON.stringify({ pulledAt: "2026-10-22T00:00:00Z", lastRun: { at: "2026-10-22T03:00:00Z", errors: 3 } }));
    expect(byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "scheduler").status).toBe("UNKNOWN");
    writeFileSync(join(dir, "seo/data/google-index/snapshot.json"), "{broken");
    expect(byId(runDiagnostics({ project: dir, env: {}, now: NOW }), "fresh:google-index/snapshot.json").status).toBe("FAIL");
  });
  it("CLI: JSON output, exit codes, and 2 outside a project", () => {
    const dir = project();
    const out = []; const code = doctor(["--project", dir, "--json"], { out: (s) => out.push(s), err: () => {}, now: NOW });
    const j = JSON.parse(out.join(""));
    expect(j.counts).toBeDefined();
    expect(code).toBe(j.counts.FAIL ? 1 : 0);
    expect(doctor(["--project", join(dir, "nowhere")], { out: () => {}, err: () => {} })).toBe(2);
    expect(existsSync(join(dir, "seo/data/improvement-queue.json"))).toBe(false);
  });
});
