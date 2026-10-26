// Tests for the regression-detection CLI, store and collector. Temp folders stand in for customer projects; fetch is always a fake.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./seo-regression.mjs";
import { collectObservation } from "./regression-collect.mjs";
import { compareObservations, validateObservation } from "./regression-detect.mjs";

const O = "https://site.example";
const PATHS = ["/", "/services", "/about", "/contact"];
const page = (path, at, over = {}) => ({ url: O + path, state: "ok", fetchedAt: at, status: 200, finalUrl: O + path, chain: [{ url: O + path, status: 200, location: null }], redirectLoop: false, chainExceeded: false, metaRobots: [], xRobotsTag: [], canonicals: [O + path], links: PATHS.filter((p) => p !== path).map((p) => O + p), ...over });
function site(at, { pages = {}, project = "proj-a", env = "production", over = {} } = {}) {
  const ps = Object.fromEntries(PATHS.map((p) => [O + p, page(p, at)]));
  for (const [p, v] of Object.entries(pages)) ps[O + p] = { ...ps[O + p], ...v };
  return { format: "bweseo.regression.observation", version: 1, id: `obs-${at}`, project: { id: project }, observedAt: at, environment: { name: env, origin: O }, status: "complete",
    scope: { origin: O, sitemapUrls: [`${O}/sitemap.xml`], includePaths: [], excludePaths: [], robotsAgent: "Googlebot", maxPages: 100, seeds: ["/"] }, config: { importantPaths: ["/", "/services"] },
    coverage: { discovered: 4, fetched: 4, failed: 0, truncated: false, linkGraphComplete: true },
    checks: { robots: { state: "ok", httpStatus: 200, fetchedAt: at, text: "User-agent: *\nAllow: /\n" }, sitemap: { state: "ok", fetchedAt: at, documents: [{ url: `${O}/sitemap.xml`, role: "urlset", state: "ok", httpStatus: 200, locs: PATHS.map((p) => O + p) }] } },
    pages: ps, ...over };
}
const dirs = [];
function project(projectId = "proj-a") {
  const d = mkdtempSync(join(tmpdir(), "bweseo-regression-"));
  dirs.push(d);
  mkdirSync(join(d, "seo"), { recursive: true });
  writeFileSync(join(d, "seo", "seo-config.json"), JSON.stringify({ projectId, paths: { data: "seo/data" } }));
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const save = (d, name, obs) => { writeFileSync(join(d, name), JSON.stringify(obs)); return name; };
const T = (n) => `2026-10-${String(n).padStart(2, "0")}T00:00:00.000Z`;
function run(d, args, { now = T(20), fetchImpl } = {}) {
  const lines = [];
  return main(args, { cwd: d, out: (s) => lines.push(s), now: () => new Date(now), fetchImpl }).then((code) => ({ code, text: lines.join("\n"), json: () => JSON.parse(lines.join("\n")) }));
}
const reg = (d, f) => join(d, "seo", "data", "regression", f);
const regFiles = (d) => (existsSync(reg(d, "")) ? readdirSync(reg(d, "")).sort() : []);

describe("baseline initialization", () => {
  it("compare before any baseline reports nothing as a regression and writes nothing", async () => {
    const d = project(); save(d, "o1.json", site(T(1), { pages: { "/about": { status: 500 } } }));
    const r = await run(d, ["compare", "--observation", "o1.json", "--json"]);
    expect(r.code).toBe(0); expect(r.json()).toMatchObject({ status: "no-baseline" });
    expect(regFiles(d)).toEqual([]);
  });
  it("init needs a complete, valid observation and a named person; then it creates the baseline once", async () => {
    const d = project();
    save(d, "partial.json", site(T(1), { over: { status: "partial", coverage: { discovered: 9, fetched: 4, failed: 0, truncated: true } } }));
    expect((await run(d, ["init", "--observation", "partial.json", "--by", "Dana"])).code).toBe(2);
    save(d, "o1.json", site(T(1)));
    expect((await run(d, ["init", "--observation", "o1.json"])).code).toBe(2);
    expect(regFiles(d)).toEqual([]);
    const ok = await run(d, ["init", "--observation", "o1.json", "--by", "Dana", "--json"]);
    expect(ok.code).toBe(0);
    const b = JSON.parse(readFileSync(reg(d, "baseline.json"), "utf8"));
    expect(b).toMatchObject({ seq: 1, acceptedBy: "Dana", kind: "init", format: "bweseo.regression.baseline" });
    expect(JSON.parse(readFileSync(reg(d, "audit.json"), "utf8")).entries[0]).toMatchObject({ action: "baseline-initialized", by: "Dana" });
    expect((await run(d, ["init", "--observation", "o1.json", "--by", "Dana"])).code).toBe(2);
  });
  it("status shows the baseline, history count and whether an observation could become a baseline", async () => {
    const d = project(); save(d, "o1.json", site(T(1)));
    expect((await run(d, ["status"])).text).toMatch(/No baseline yet/);
    await run(d, ["init", "--observation", "o1.json", "--by", "Dana"]);
    save(d, "o2.json", site(T(2), { over: { status: "partial", coverage: { discovered: 6, fetched: 4, failed: 0, truncated: true } } }));
    const r = await run(d, ["status", "--observation", "o2.json", "--json"]);
    const j = r.json();
    expect(j.baseline).toMatchObject({ state: "accepted", seq: 1, pages: 4 });
    expect(j.observation).toMatchObject({ usable: true, status: "partial", acceptableAsBaseline: false });
    expect(j.observation.incomplete.join(" ")).toMatch(/truncated/);
  });
});

describe("compare and record", () => {
  async function withBaseline() { const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]); return d; }
  it("unchanged observation: exit 0; compare is read-only", async () => {
    const d = await withBaseline(); save(d, "o2.json", site(T(2)));
    const before = regFiles(d);
    const r = await run(d, ["compare", "--observation", "o2.json"]);
    expect(r.code).toBe(0); expect(r.text).toMatch(/No regressions/);
    expect(regFiles(d)).toEqual(before);
  });
  it("a regression: exit 1, structured JSON and a plain summary; still writes nothing", async () => {
    const d = await withBaseline(); save(d, "o2.json", site(T(2), { pages: { "/services": { metaRobots: ["noindex"] } } }));
    const before = regFiles(d);
    const r = await run(d, ["compare", "--observation", "o2.json", "--json"]);
    expect(r.code).toBe(1);
    const j = r.json();
    expect(j.status).toBe("regressions"); expect(j.exit).toBe(1);
    expect(j.detections[0]).toMatchObject({ type: "sitemap-entry-noindex", severity: "critical", actionable: true });
    expect(j.detections[0]._detail).toBeUndefined();
    expect(regFiles(d)).toEqual(before);
    expect((await run(d, ["compare", "--observation", "o2.json"])).text).toMatch(/\[CRITICAL\].*rg-sitemap-entry-noindex/);
  });
  it("exit codes: invalid json / missing file = 3, incompatible environment = 2", async () => {
    const d = await withBaseline();
    writeFileSync(join(d, "bad.json"), "{nope");
    expect((await run(d, ["compare", "--observation", "bad.json"])).code).toBe(3);
    expect((await run(d, ["compare", "--observation", "missing.json"])).code).toBe(3);
    expect((await run(d, ["compare"])).code).toBe(3);
    save(d, "stg.json", site(T(2), { env: "staging" }));
    const r = await run(d, ["compare", "--observation", "stg.json", "--json"]);
    expect(r.code).toBe(2); expect(r.json().reasons.join(" ")).toMatch(/environment differs/);
    save(d, "failed.json", site(T(2), { over: { status: "failed" } }));
    expect((await run(d, ["compare", "--observation", "failed.json"])).code).toBe(2);
    expect((await run(d, ["nonsense"])).code).toBe(3);
  });
  it("record stores findings once, repeated runs do not duplicate, and recovery is confirmed before resolving", async () => {
    const d = await withBaseline();
    save(d, "o2.json", site(T(2), { pages: { "/services": { metaRobots: ["noindex"] } } }));
    expect((await run(d, ["record", "--observation", "o2.json"])).code).toBe(1);
    expect((await run(d, ["record", "--observation", "o2.json"])).code).toBe(1);
    let fs = JSON.parse(readFileSync(reg(d, "findings.json"), "utf8"));
    expect(fs.findings).toHaveLength(1); expect(fs.findings[0]).toMatchObject({ occurrences: 1, status: "open", firstObservedAt: T(2) });
    const id = fs.findings[0].id;
    expect((await run(d, ["decision", id, "--state", "acknowledged", "--by", "Dana", "--note", "on it"])).code).toBe(0);
    save(d, "o3.json", site(T(3), { pages: { "/services": { metaRobots: ["noindex"] } } }));
    await run(d, ["record", "--observation", "o3.json"]);
    fs = JSON.parse(readFileSync(reg(d, "findings.json"), "utf8"));
    expect(fs.findings[0]).toMatchObject({ occurrences: 2, lastObservedAt: T(3), decision: { state: "acknowledged", by: "Dana" } });
    save(d, "o4.json", site(T(4), { pages: { "/services": { state: "unreachable", error: "timed out after 10000 ms" } } }));
    expect((await run(d, ["record", "--observation", "o4.json"])).code).toBe(0);
    expect(JSON.parse(readFileSync(reg(d, "findings.json"), "utf8")).findings[0].status).toBe("open");
    save(d, "o5.json", site(T(5)));
    const rec = await run(d, ["record", "--observation", "o5.json", "--json"]);
    expect(rec.code).toBe(0); expect(rec.json().recorded.resolved).toEqual([id]);
    expect(JSON.parse(readFileSync(reg(d, "findings.json"), "utf8")).findings[0]).toMatchObject({ status: "resolved", decision: { state: "acknowledged" } });
    save(d, "old.json", site(T(2)));
    expect((await run(d, ["record", "--observation", "old.json"])).code).toBe(2);
  });
  it("findings, explain, issues and the read model", async () => {
    const d = await withBaseline(); save(d, "o2.json", site(T(2), { pages: { "/services": { metaRobots: ["noindex"] }, "/about": { status: 410 } } }));
    await run(d, ["record", "--observation", "o2.json"]);
    const list = (await run(d, ["findings", "--severity", "critical", "--json"])).json();
    expect(list.count).toBeGreaterThan(0); expect(list.findings.every((f) => f.severity === "critical")).toBe(true);
    const id = list.findings[0].id;
    const ex = await run(d, ["explain", id]);
    expect(ex.text).toMatch(/Previous evidence/); expect(ex.text).toMatch(/Verify recovery when/); expect(ex.text).toMatch(/not Google's indexing status/);
    expect((await run(d, ["explain", "rg-nope"])).code).toBe(3);
    const issues = (await run(d, ["issues", "--json"])).json();
    expect(issues.issues[0]).toMatchObject({ area: "technical", source: "regression-detection", status: "open" });
    const rm = (await run(d, ["read-model"])).json();
    expect(rm).toMatchObject({ format: "bweseo.regression.readmodel", baseline: { state: "accepted" } });
    expect(rm.findings.actionable).toBeGreaterThan(0);
  });
});

describe("accepting a new baseline", () => {
  it("refuses while regressions are unresolved; an explicit acknowledgement is audited; history is preserved", async () => {
    const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]);
    save(d, "o2.json", site(T(2), { pages: { "/services": { metaRobots: ["noindex"] } } }));
    await run(d, ["record", "--observation", "o2.json"]);
    const refused = await run(d, ["accept", "--observation", "o2.json", "--by", "Dana", "--reason", "redesign"]);
    expect(refused.code).toBe(2); expect(refused.text).toMatch(/unresolved regression/);
    expect(JSON.parse(readFileSync(reg(d, "baseline.json"), "utf8")).seq).toBe(1);
    expect((await run(d, ["accept", "--observation", "o2.json", "--by", "Dana", "--acknowledge-regressions"])).code).toBe(2); // reason missing
    expect((await run(d, ["accept", "--observation", "o2.json", "--by", "Dana", "--reason", "redesign", "--acknowledge-regressions"])).code).toBe(0);
    const b = JSON.parse(readFileSync(reg(d, "baseline.json"), "utf8"));
    expect(b).toMatchObject({ seq: 2, previousSeq: 1, acceptedBy: "Dana", reason: "redesign" }); expect(b.acknowledgedFindings).toHaveLength(1);
    expect(readdirSync(reg(d, "baseline-history"))).toHaveLength(1);
    const old = JSON.parse(readFileSync(join(reg(d, "baseline-history"), readdirSync(reg(d, "baseline-history"))[0]), "utf8"));
    expect(old.seq).toBe(1);
    const audit = JSON.parse(readFileSync(reg(d, "audit.json"), "utf8")).entries;
    expect(audit.map((a) => a.action)).toEqual(["baseline-initialized", "baseline-accepted"]);
    expect(JSON.parse(readFileSync(reg(d, "findings.json"), "utf8")).findings[0]).toMatchObject({ status: "accepted", acceptedBy: "Dana" });
    // the accepted state is now the norm: comparing the same observation is clean
    expect((await run(d, ["compare", "--observation", "o2.json"])).code).toBe(0);
  });
  it("a failed or partial observation never replaces the last valid baseline", async () => {
    const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]);
    const before = readFileSync(reg(d, "baseline.json"), "utf8");
    for (const [name, over] of [["partial", { status: "partial" }], ["failed", { status: "failed" }], ["fail-pages", { coverage: { discovered: 4, fetched: 4, failed: 2, truncated: false } }]]) {
      save(d, `${name}.json`, site(T(2), { over }));
      expect((await run(d, ["accept", "--observation", `${name}.json`, "--by", "Dana", "--reason", "x"])).code).toBe(2);
    }
    expect(readFileSync(reg(d, "baseline.json"), "utf8")).toBe(before);
    expect(existsSync(reg(d, "baseline-history"))).toBe(false);
  });
  it("is atomic: if the history write fails the accepted baseline is untouched", async () => {
    const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]);
    writeFileSync(reg(d, "baseline-history"), "i am a file, so the history folder cannot be created");
    const before = readFileSync(reg(d, "baseline.json"), "utf8");
    save(d, "o2.json", site(T(2)));
    const r = await run(d, ["accept", "--observation", "o2.json", "--by", "Dana", "--reason", "refresh"]);
    expect(r.code).toBe(3);
    expect(readFileSync(reg(d, "baseline.json"), "utf8")).toBe(before);
    expect(readdirSync(reg(d, "")).filter((n) => n.includes(".tmp-"))).toEqual([]);
    expect(JSON.parse(readFileSync(reg(d, "audit.json"), "utf8")).entries).toHaveLength(1);
  });
  it("refuses a corrupt baseline file instead of replacing it", async () => {
    const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]);
    writeFileSync(reg(d, "baseline.json"), "{broken");
    save(d, "o2.json", site(T(2)));
    const r = await run(d, ["accept", "--observation", "o2.json", "--by", "Dana", "--reason", "x"]);
    expect(r.code).toBe(3); expect(readFileSync(reg(d, "baseline.json"), "utf8")).toBe("{broken");
  });
});

describe("intentional-change records via the CLI", () => {
  it("add, list and remove with an audit trail; a record only excuses the matching change", async () => {
    const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]);
    const bad = await run(d, ["exception", "add", "--kind", "redirect", "--url", "/about", "--reason", "merged", "--by", "Dana"]);
    expect(bad.code).toBe(3); expect(bad.text).toMatch(/expect\.target/);
    expect((await run(d, ["exception", "add", "--kind", "removal", "--path-prefix", "/", "--reason", "x", "--by", "Dana"])).code).toBe(3);
    const add = await run(d, ["exception", "add", "--kind", "redirect", "--url", "/about", "--expect-target", "/team", "--reason", "pages merged", "--by", "Dana", "--expires", "2027-01-31", "--json"]);
    expect(add.code).toBe(0);
    const id = add.json().record.id;
    expect(add.json().record).toMatchObject({ url: `${O}/about`, expect: { status: [301, 308], target: `${O}/team` }, author: "Dana", expiresAt: "2027-01-31T00:00:00.000Z" });
    expect((await run(d, ["exception", "list"])).text).toMatch(/pages merged/);
    const redirectTo = (to) => ({ status: 301, finalUrl: to, chain: [{ url: `${O}/about`, status: 301, location: to }, { url: to, status: 200, location: null }], canonicals: [to] });
    save(d, "o2.json", site(T(2), { pages: { "/about": redirectTo(`${O}/team`), "/contact": redirectTo(`${O}/team`) } }));
    const r = await run(d, ["compare", "--observation", "o2.json", "--json"]);
    expect(r.code).toBe(1);
    const ds = r.json().detections;
    expect(ds.find((x) => x.subjectKey === `${O}/about` && x.type === "sitemap-entry-redirected")).toMatchObject({ actionable: false, intentionalChangeId: id });
    expect(ds.find((x) => x.subjectKey === `${O}/contact` && x.type === "sitemap-entry-redirected")).toMatchObject({ actionable: true });
    save(d, "o3.json", site(T(3), { pages: { "/about": redirectTo(`${O}/team`) } }));
    expect((await run(d, ["compare", "--observation", "o3.json"])).code).toBe(0);
    expect((await run(d, ["exception", "remove", id])).code).toBe(3);
    expect((await run(d, ["exception", "remove", id, "--by", "Dana"])).code).toBe(0);
    expect((await run(d, ["compare", "--observation", "o3.json"])).code).toBe(1);
    expect(JSON.parse(readFileSync(reg(d, "audit.json"), "utf8")).entries.map((a) => a.action)).toEqual(["baseline-initialized", "intentional-change-added", "intentional-change-removed"]);
  });
  it("an expired record does not excuse the change", async () => {
    const d = project(); save(d, "base.json", site(T(1))); await run(d, ["init", "--observation", "base.json", "--by", "Dana"]);
    await run(d, ["exception", "add", "--kind", "redirect", "--url", "/about", "--expect-target", "/team", "--reason", "merged", "--by", "Dana", "--expires", "2026-10-10"], { now: T(2) });
    save(d, "o2.json", site(T(20), { pages: { "/about": { status: 301, finalUrl: `${O}/team`, chain: [{ url: `${O}/about`, status: 301, location: `${O}/team` }, { url: `${O}/team`, status: 200, location: null }], canonicals: [`${O}/team`] } } }));
    expect((await run(d, ["compare", "--observation", "o2.json"], { now: T(20) })).code).toBe(1);
    expect((await run(d, ["exception", "list"], { now: T(20) })).text).toMatch(/EXPIRED/);
  });
});

describe("customer isolation", () => {
  it("refuses an observation that belongs to another project, and keeps each project's data in its own folder", async () => {
    const a = project("proj-a"); const b = project("proj-b");
    save(a, "o.json", site(T(1), { project: "proj-a" })); save(b, "o.json", site(T(1), { project: "proj-a" }));
    expect((await run(a, ["init", "--observation", "o.json", "--by", "Dana"])).code).toBe(0);
    const r = await run(b, ["init", "--observation", "o.json", "--by", "Dana"]);
    expect(r.code).toBe(2); expect(r.text).toMatch(/belongs to project/);
    expect(regFiles(b)).toEqual([]);
    expect(regFiles(a)).toContain("baseline.json");
    const other = site(T(2), { project: "proj-b" }); save(a, "x.json", other);
    expect((await run(a, ["compare", "--observation", "x.json"])).code).toBe(2);
  });
  it("stores only under the project's own data folder (no machine paths in stored data)", async () => {
    const d = project(); save(d, "o.json", site(T(1))); await run(d, ["init", "--observation", "o.json", "--by", "Dana"]);
    const text = readFileSync(reg(d, "baseline.json"), "utf8");
    expect(text).not.toContain(d);
    expect(readdirSync(join(d, "seo", "data"))).toEqual(["regression"]);
  });
});

describe("collector with an injected fetch", () => {
  const html = (title, links = [], head = "") => `<html><head><title>${title}</title>${head}</head><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;
  function fakeSite(overrides = {}) {
    const routes = {
      "/robots.txt": () => new Response("User-agent: *\nAllow: /\nSitemap: https://site.example/sitemap.xml\n", { status: 200 }),
      "/sitemap.xml": () => new Response(`<urlset><url><loc>${O}/</loc></url><url><loc>${O}/about</loc></url></urlset>`, { status: 200 }),
      "/": () => new Response(html("Home", ["/about", "/old", "/missing"], `<link rel="canonical" href="${O}/">`), { status: 200, headers: { "content-type": "text/html", "x-robots-tag": "all" } }),
      "/about": () => new Response(html("About", ["/"], `<link rel="canonical" href="${O}/about"><meta name="robots" content="noindex">`), { status: 200, headers: { "content-type": "text/html" } }),
      "/old": () => new Response("", { status: 301, headers: { location: "/about" } }),
      "/missing": () => new Response("gone", { status: 404 }),
      ...overrides,
    };
    const calls = [];
    const fetchImpl = async (url) => { calls.push(String(url)); const u = new URL(url); const r = routes[u.pathname]; if (!r) return new Response("nf", { status: 404 }); return r(); };
    return { fetchImpl, calls };
  }
  const clock = () => "2026-10-20T00:00:00.000Z";
  it("records robots, sitemap, redirects, directives, canonicals and links without leaving the site", async () => {
    const { fetchImpl, calls } = fakeSite();
    const obs = await collectObservation({ fetchImpl, origin: O, projectId: "proj-a", importantPaths: ["/"], now: clock });
    expect(calls.every((u) => u.startsWith(O + "/"))).toBe(true);
    expect(obs.status).toBe("complete");
    expect(obs.pages[`${O}/about`]).toMatchObject({ metaRobots: ["noindex"], canonicals: [`${O}/about`], status: 200 });
    expect(obs.pages[`${O}/`].xRobotsTag).toEqual(["all"]);
    expect(obs.pages[`${O}/old`]).toMatchObject({ status: 200, finalUrl: `${O}/about` }); expect(obs.pages[`${O}/old`].chain[0]).toMatchObject({ status: 301 });
    expect(obs.pages[`${O}/missing`].status).toBe(404);
    expect(obs.checks.robots.state).toBe("ok"); expect(obs.checks.sitemap.state).toBe("ok");
    expect(validateObservation(obs, { purpose: "baseline" }).acceptable).toBe(true);
    // the observation it produces round-trips through the comparison core
    expect(compareObservations(obs, obs).status).toBe("clean");
  });
  it("timeouts, failed robots/sitemap fetches and truncation make the observation partial, never a baseline", async () => {
    const hang = () => new Promise(() => {});
    const { fetchImpl } = fakeSite({ "/about": hang, "/robots.txt": () => new Response("err", { status: 503 }), "/sitemap.xml": () => new Response("x", { status: 500 }) });
    const obs = await collectObservation({ fetchImpl, origin: O, importantPaths: ["/", "/about"], timeoutMs: 20, now: clock });
    expect(obs.status).toBe("partial");
    expect(obs.pages[`${O}/about`]).toMatchObject({ state: "unreachable" }); expect(obs.pages[`${O}/about`].error).toMatch(/timed out/);
    expect(obs.checks.robots.state).toBe("unavailable"); expect(obs.checks.sitemap.state).toBe("unavailable");
    expect(validateObservation(obs, { purpose: "baseline" }).acceptable).toBe(false);
    const { fetchImpl: f2 } = fakeSite();
    const small = await collectObservation({ fetchImpl: f2, origin: O, importantPaths: ["/"], maxPages: 2, now: clock });
    expect(small.coverage.truncated).toBe(true); expect(small.status).toBe("partial");
  });
  it("detects a redirect loop", async () => {
    const { fetchImpl } = fakeSite({ "/about": () => new Response("", { status: 301, headers: { location: "/about/" } }), "/about/": () => new Response("", { status: 301, headers: { location: "/about" } }) });
    const obs = await collectObservation({ fetchImpl, origin: O, importantPaths: ["/about"], now: clock });
    expect(obs.pages[`${O}/about`]).toMatchObject({ state: "ok", redirectLoop: true });
  });
  it("the observe command saves an observation file and never a baseline", async () => {
    const d = project(); const { fetchImpl } = fakeSite();
    const r = await run(d, ["observe", "--env", "production", "--origin", O, "--important", "/", "--out", "obs.json"], { fetchImpl });
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "obs.json"), "utf8"))).toMatchObject({ format: "bweseo.regression.observation", project: { id: "proj-a" } });
    expect(existsSync(reg(d, "baseline.json"))).toBe(false);
    expect((await run(d, ["observe", "--env", "staging"], { fetchImpl })).code).toBe(3);
  });
});
