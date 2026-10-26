// Tests for regression detection: the pure comparison core and workflow rules. Everything is a fictional site on example.test —
// no network, no customer data.
import { describe, expect, it } from "vitest";
import { compareObservations, checkCompatibility, findingId, severityFor, urlKey, validateObservation, normalizeObservation, MIN_ORPHAN_COVERAGE } from "./regression-detect.mjs";
import {
  addException, buildReadModel, emptyExceptions, emptyFindings, mergeFindings, planBaseline, setDecision, toIssueCandidates, validateException, closeAcceptedFindings,
} from "./regression-workflow.mjs";

const O = "https://site.example";
const T0 = "2026-10-01T00:00:00.000Z"; const T1 = "2026-10-08T00:00:00.000Z"; const T2 = "2026-10-15T00:00:00.000Z";
const PATHS = ["/", "/services", "/about", "/contact"];

const page = (path, over = {}) => ({ url: O + path, state: "ok", fetchedAt: T0, status: 200, finalUrl: O + path, chain: [{ url: O + path, status: 200, location: null }], redirectLoop: false, chainExceeded: false, metaRobots: [], xRobotsTag: [], canonicals: [O + path], links: PATHS.filter((p) => p !== path).map((p) => O + p), ...over });
function site({ at = T0, over = {}, pages = {}, robots = "User-agent: *\nAllow: /\n", sitemap = PATHS.map((p) => O + p), id = "obs" } = {}) {
  const ps = Object.fromEntries(PATHS.map((p) => [O + p, page(p, { fetchedAt: at })]));
  for (const [p, v] of Object.entries(pages)) ps[O + p] = v === null ? undefined : { ...(ps[O + p] ?? page(p, { fetchedAt: at })), ...v };
  for (const k of Object.keys(ps)) if (!ps[k]) delete ps[k];
  return {
    format: "bweseo.regression.observation", version: 1, id: `${id}-${at}`, project: { id: "proj-a" }, observedAt: at, environment: { name: "production", origin: O }, status: "complete",
    scope: { origin: O, sitemapUrls: [`${O}/sitemap.xml`], includePaths: [], excludePaths: [], robotsAgent: "Googlebot", maxPages: 100, seeds: ["/"] }, config: { importantPaths: ["/", "/services"] },
    coverage: { discovered: Object.keys(ps).length, fetched: Object.keys(ps).length, failed: 0, truncated: false, linkGraphComplete: true },
    checks: { robots: { state: "ok", httpStatus: 200, fetchedAt: at, text: robots }, sitemap: { state: "ok", fetchedAt: at, documents: [{ url: `${O}/sitemap.xml`, role: "urlset", state: "ok", httpStatus: 200, locs: sitemap }] } },
    pages: ps, ...over,
  };
}
const redirect = (path, to, extra = {}) => ({ status: 301, finalUrl: to, chain: [{ url: O + path, status: 301, location: to }, { url: to, status: 200, location: null }], canonicals: [to], ...extra });
const types = (cmp) => cmp.detections.map((d) => d.type).sort();
const cmp = (cur, base = site()) => compareObservations(base, cur, { now: T2 });
// Pages listed in the sitemap are reported once, by the sitemap-entry finding (one root cause, one finding); these helpers use a site
// without a sitemap listing so the page-level finding types can be exercised on their own.
const bare = (at, extra = {}) => site({ at, sitemap: [], ...extra });
const cmpBare = (cur) => cmp(cur, bare(T0));
const only = (c, type) => c.detections.filter((d) => d.type === type);

describe("observation validity and baseline eligibility", () => {
  it("accepts a complete observation as a baseline", () => {
    const v = validateObservation(site(), { purpose: "baseline" });
    expect(v.ok).toBe(true); expect(v.acceptable).toBe(true);
  });
  it("is usable but not acceptable when partial, truncated, with failures or with an unreadable robots.txt or sitemap", () => {
    for (const over of [{ status: "partial" }, { coverage: { discovered: 9, fetched: 4, failed: 0, truncated: true } }, { coverage: { discovered: 4, fetched: 4, failed: 1 } }]) {
      const v = validateObservation(site({ over }), { purpose: "baseline" });
      expect(v.usable).toBe(true); expect(v.acceptable).toBe(false); expect(v.ok).toBe(false);
    }
    const robotsDown = site(); robotsDown.checks.robots = { state: "unavailable", httpStatus: 503, reason: "HTTP 503" };
    expect(validateObservation(robotsDown, { purpose: "baseline" }).acceptable).toBe(false);
    const smDown = site(); smDown.checks.sitemap.state = "partial";
    expect(validateObservation(smDown, { purpose: "baseline" }).acceptable).toBe(false);
  });
  it("rejects an unsupported version, a failed observation and malformed input", () => {
    expect(validateObservation({ ...site(), version: 2 }).usable).toBe(false);
    expect(validateObservation(site({ over: { status: "failed" } })).usable).toBe(false);
    expect(validateObservation({}).ok).toBe(false);
  });
});

describe("unchanged observations", () => {
  it("reports nothing and has no unknowns", () => {
    const c = cmp(site({ at: T1 }));
    expect(c.comparable).toBe(true); expect(c.status).toBe("clean"); expect(c.detections).toEqual([]); expect(c.unknown).toEqual([]);
  });
  it("does not report existing defects present in both observations (the first run is not a flood of 'new' issues)", () => {
    const base = site({ pages: { "/about": { status: 500, canonicals: null, metaRobots: null } } });
    const c = cmp(site({ at: T1, pages: { "/about": { status: 500, canonicals: null, metaRobots: null } } }), base);
    expect(c.detections).toEqual([]);
  });
});

describe("each regression type", () => {
  it("noindex via meta robots on an important page is critical; on another page high", () => {
    const c = cmpBare(bare(T1, { pages: { "/services": { metaRobots: ["noindex, follow"] }, "/about": { metaRobots: ["googlebot: none"] } } }));
    const ds = only(c, "noindex-added");
    expect(ds.map((d) => [d.subject.url, d.severity])).toEqual([[`${O}/services`, "critical"], [`${O}/about`, "high"]]);
    expect(ds[0].previous.evidence.noindex).toEqual({ meta: false, header: false });
    expect(ds[0].current.evidence.via).toEqual(["meta"]);
  });
  it("noindex via X-Robots-Tag; a directive for an unrelated bot is ignored", () => {
    const c = cmpBare(bare(T1, { pages: { "/about": { xRobotsTag: ["noindex"] }, "/contact": { xRobotsTag: ["otherbot: noindex"] } } }));
    expect(only(c, "noindex-added").map((d) => d.subject.url)).toEqual([`${O}/about`]);
  });
  it("a missing X-Robots-Tag capture is UNKNOWN, not a failure, and not a clean pass", () => {
    const c = cmp(site({ at: T1, pages: { "/about": { xRobotsTag: null } } }));
    expect(c.detections).toEqual([]);
    expect(c.unknown.find((u) => u.subject === `${O}/about` && u.type === "noindex-added")).toBeTruthy();
  });
  it("a baseline that never captured headers cannot establish a header noindex change", () => {
    const base = site({ pages: { "/about": { xRobotsTag: null } } });
    const c = cmp(site({ at: T1, pages: { "/about": { xRobotsTag: ["noindex"] } } }), base);
    expect(only(c, "noindex-added")).toEqual([]);
    expect(c.unknown.some((u) => u.type === "noindex-added" && /baseline did not capture/.test(u.reason))).toBe(true);
  });
  it("robots.txt restrictions: a blocking rule is grouped; important pages and the whole site are critical", () => {
    const some = cmp(site({ at: T1, robots: "User-agent: *\nDisallow: /about\n" }));
    expect(only(some, "robots-restriction")).toHaveLength(1);
    expect(only(some, "robots-restriction")[0]).toMatchObject({ severity: "high", affectedUrls: 1 });
    const important = cmp(site({ at: T1, robots: "User-agent: *\nDisallow: /services\n" }));
    expect(only(important, "robots-restriction")[0].severity).toBe("critical");
    const all = cmp(site({ at: T1, robots: "User-agent: *\nDisallow: /\n" }));
    expect(only(all, "robots-restriction")).toHaveLength(1);
    expect(only(all, "robots-restriction")[0]).toMatchObject({ severity: "critical", affectedUrls: 4 });
    expect(only(all, "robots-restriction")[0].impact).toMatch(/whole site/);
  });
  it("a failed robots.txt fetch is UNKNOWN, not a block", () => {
    const cur = site({ at: T1 }); cur.checks.robots = { state: "unavailable", httpStatus: 503, reason: "HTTP 503" };
    const c = cmp(cur);
    expect(c.detections).toEqual([]);
    expect(c.unknown.some((u) => u.check === "sitemap" || u.check === "robots")).toBe(true);
  });
  it("canonical missing, conflicting and changed (trailing slash is a real change)", () => {
    const c = cmp(site({ at: T1, pages: { "/about": { canonicals: [] }, "/contact": { canonicals: [`${O}/contact`, `${O}/other`] }, "/services": { canonicals: [`${O}/services/`] }, "/": { canonicals: [`${O}/services`] } } }));
    // pages listed in the sitemap are reported once, as the sitemap-entry finding (one root cause, one finding)
    expect(types(c)).toEqual(["canonical-conflict", "canonical-missing", "sitemap-entry-noncanonical", "sitemap-entry-noncanonical"]);
    expect(only(c, "sitemap-entry-noncanonical").find((d) => d.subject.url === `${O}/`).previous.evidence.canonicals).toEqual([`${O}/`]);
    expect(only(c, "sitemap-entry-noncanonical").find((d) => d.subject.url === `${O}/services`).severity).toBe("critical");
    expect(types(cmpBare(bare(T1, { pages: { "/about": { canonicals: [`${O}/team`] } } }))).filter((t) => t.startsWith("canonical"))).toEqual(["canonical-changed"]);
  });
  it("host and path case differences are preserved by the URL key", () => {
    expect(urlKey("https://Site.example/About")).toBe("https://site.example/About");
    expect(urlKey("https://site.example/about")).not.toBe(urlKey("https://site.example/About"));
    expect(urlKey("https://www.site.example/a")).not.toBe(urlKey("https://site.example/a"));
    expect(urlKey("https://site.example/a/")).not.toBe(urlKey("https://site.example/a"));
    expect(urlKey("https://site.example/a?b=2&a=1#x")).toBe(urlKey("https://site.example/a?a=1&b=2"));
    expect(urlKey("https://user:pw@site.example/a?token=abc")).toBe("https://site.example/a?token=%5Bredacted%5D");
  });
  it("errors: 5xx/404 on previously valid pages; a timeout is UNKNOWN", () => {
    const c = cmp(site({ at: T1, pages: { "/about": { status: 500, canonicals: null, metaRobots: null, links: null }, "/services": { status: 404 }, "/contact": { state: "unreachable", error: "timed out after 10000 ms" } } }));
    expect(only(c, "page-error").map((d) => [d.subject.url.replace(O, ""), d.severity])).toEqual([["/services", "critical"], ["/about", "high"]]);
    expect(only(c, "page-error").find((d) => d.subject.url.endsWith("/about")).limitations.join(" ")).toMatch(/transient/);
    expect(c.unknown.some((u) => u.subject === `${O}/contact` && /timed out/.test(u.reason))).toBe(true);
    expect(c.detections.some((d) => d.subject.url === `${O}/contact`)).toBe(false);
  });
  it("unexpected redirects, chains and loops", () => {
    const c = cmpBare(bare(T1, { pages: {
      "/about": redirect("/about", `${O}/team`),
      "/contact": { status: 301, finalUrl: `${O}/c3`, chain: [{ url: `${O}/contact`, status: 301, location: `${O}/c2` }, { url: `${O}/c2`, status: 302, location: `${O}/c3` }, { url: `${O}/c3`, status: 200, location: null }], canonicals: [`${O}/c3`] },
      "/services": { status: 301, redirectLoop: true, chain: [{ url: `${O}/services`, status: 301, location: `${O}/services/` }, { url: `${O}/services/`, status: 301, location: `${O}/services` }], canonicals: null } } }));
    expect(only(c, "unexpected-redirect").map((d) => d.subject.url.replace(O, "")).sort()).toEqual(["/about", "/contact"]);
    expect(only(c, "redirect-chain").map((d) => d.subject.url.replace(O, ""))).toEqual(["/contact"]);
    expect(only(c, "redirect-loop")).toHaveLength(1);
    expect(only(c, "redirect-loop")[0].severity).toBe("critical");
  });
  it("a redirect chain that already existed in the baseline is not new", () => {
    const base = site({ pages: { "/old": { ...redirect("/old", `${O}/mid`), chain: [{ url: `${O}/old`, status: 301, location: `${O}/mid` }, { url: `${O}/mid`, status: 301, location: `${O}/about` }, { url: `${O}/about`, status: 200, location: null }] } } });
    const cur = site({ at: T1, pages: { "/old": { ...redirect("/old", `${O}/mid`), chain: [{ url: `${O}/old`, status: 301, location: `${O}/mid` }, { url: `${O}/mid`, status: 301, location: `${O}/about` }, { url: `${O}/about`, status: 200, location: null }] } } });
    expect(only(cmp(cur, base), "redirect-chain")).toEqual([]);
  });
  it("sitemap removal; an unreadable sitemap is UNKNOWN; removal is not inferred from a different source file failing", () => {
    const c = cmp(site({ at: T1, sitemap: [O + "/", O + "/services", O + "/contact"] }));
    expect(only(c, "sitemap-removal").map((d) => d.subject.url)).toEqual([`${O}/about`]);
    const down = site({ at: T1 }); down.checks.sitemap = { state: "unavailable", documents: [{ url: `${O}/sitemap.xml`, role: "urlset", state: "unavailable", httpStatus: 503, locs: [] }] };
    const d = cmp(down);
    expect(only(d, "sitemap-removal")).toEqual([]);
    expect(d.unknown.filter((u) => u.type === "sitemap-removal")).toHaveLength(4);
    const partial = site({ at: T1, sitemap: [O + "/"] }); partial.checks.sitemap.documents.push({ url: `${O}/sitemap-2.xml`, role: "urlset", state: "unavailable", locs: [] }); partial.checks.sitemap.state = "partial";
    const e = cmp(partial);
    expect(only(e, "sitemap-removal")).toEqual([]);
    expect(e.unknown.some((u) => u.type === "sitemap-removal" && /could not be read/.test(u.reason))).toBe(true);
  });
  it("sitemap entries that become redirected, non-canonical, blocked or noindex", () => {
    const c = cmp(site({ at: T1, robots: "User-agent: *\nDisallow: /contact\n", pages: { "/about": redirect("/about", `${O}/team`), "/services": { canonicals: [`${O}/services-new`] }, "/": { metaRobots: ["noindex"] } } }));
    expect(types(c)).toEqual(["robots-restriction", "sitemap-entry-noindex", "sitemap-entry-noncanonical", "sitemap-entry-redirected"]);
    expect(only(c, "robots-restriction")[0]).toMatchObject({ sitemapUrlsAffected: 1 });
  });
  it("new broken internal links; existing ones and unobserved targets are not reported", () => {
    const base = site({ pages: { "/gone": page("/gone", { status: 404, canonicals: null }), "/about": { links: [O + "/", O + "/gone"] } } });
    const cur = site({ at: T1, pages: { "/gone": page("/gone", { status: 404, canonicals: null, fetchedAt: T1 }), "/about": { links: [O + "/", O + "/gone"] }, "/contact": { links: [O + "/", O + "/gone", O + "/nowhere"] }, "/": { links: [O + "/services", O + "/about", O + "/contact", "https://elsewhere.test/x"] } } });
    const c = cmp(cur, base);
    expect(only(c, "broken-internal-link").map((d) => `${d.subject.source.replace(O, "")}>${d.subject.target.replace(O, "")}`)).toEqual(["/contact>/gone"]);
  });
  it("orphaned important pages are reported only when crawl coverage is sufficient", () => {
    const orphaned = { pages: { "/": { links: [O + "/about", O + "/contact"] }, "/about": { links: [O + "/"] }, "/contact": { links: [O + "/"] }, "/services": { links: [O + "/"] } } };
    const c = cmp(site({ at: T1, ...orphaned }));
    expect(only(c, "orphaned-page").map((d) => d.subject.url)).toEqual([`${O}/services`]);
    expect(only(c, "orphaned-page")[0].previous.evidence.inboundLinks).toBeGreaterThan(0);
    for (const over of [{ status: "partial" }, { coverage: { discovered: 10, fetched: 4, failed: 0, truncated: false, linkGraphComplete: true } }, { coverage: { discovered: 4, fetched: 4, failed: 0, truncated: true, linkGraphComplete: true } }, { coverage: { discovered: 4, fetched: 4, failed: 0, truncated: false, linkGraphComplete: false } }]) {
      const p = cmp(site({ at: T1, ...orphaned, over }));
      expect(only(p, "orphaned-page")).toEqual([]);
      expect(p.checks.find((x) => x.id === "orphans")).toMatchObject({ state: "unknown" });
      expect(p.checks.find((x) => x.id === "orphans").reason).toMatch(/orphan/);
    }
    expect(MIN_ORPHAN_COVERAGE).toBeGreaterThan(0.9);
  });
  it("a partial crawl compares only fetched pages and reports the rest as UNKNOWN", () => {
    const cur = site({ at: T1, pages: { "/about": null, "/contact": null }, over: { status: "partial" } });
    cur.coverage = { discovered: 4, fetched: 2, failed: 0, truncated: true, linkGraphComplete: false };
    const c = cmp(cur);
    expect(c.detections.filter((d) => ["page-error", "noindex-added"].includes(d.type))).toEqual([]);
    expect(c.unknown.some((u) => u.subject === `${O}/about` && /not observed/.test(u.reason))).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/partial/);
  });
  it("findings carry the full contract", () => {
    const d = cmpBare(bare(T1, { pages: { "/services": { metaRobots: ["noindex"] } } })).detections[0];
    expect(d.id).toBe(findingId("noindex-added", `${O}/services`));
    expect(d.id).toMatch(/^rg-noindex-added-[0-9a-f]{10}$/);
    for (const f of ["title", "impact", "recommendedAction", "verification", "previous", "current", "limitations", "confidence", "severity", "subject"]) expect(d[f]).toBeTruthy();
    expect(d.limitations[0]).toMatch(/not Google's indexing status/);
    expect(d.previous.observedAt).toBe(T0); expect(d.current.observedAt).toBe(T1);
    expect(d.verification.length).toBeGreaterThan(0);
  });
  it("severity rules are deterministic", () => {
    expect(severityFor("noindex-added", { important: true })).toBe("critical");
    expect(severityFor("noindex-added", {})).toBe("high");
    expect(severityFor("redirect-chain", {})).toBe("low");
    expect(severityFor("robots-restriction", { siteWide: true })).toBe("critical");
    expect(severityFor("robots-restriction", {})).toBe("high");
  });
});

describe("environment, scope and project guards", () => {
  it("never compares staging with a production baseline", () => {
    const stg = site({ at: T1, over: { environment: { name: "staging", origin: O } } });
    const c = cmp(stg);
    expect(c.comparable).toBe(false); expect(c.status).toBe("incompatible"); expect(c.reasons.join(" ")).toMatch(/environment differs/);
  });
  it("rejects a different origin, project or crawl scope", () => {
    expect(cmp(site({ at: T1, over: { environment: { name: "production", origin: "https://other.example" } } })).status).toBe("incompatible");
    expect(cmp(site({ at: T1, over: { project: { id: "proj-b" } } })).reasons.join(" ")).toMatch(/project differs/);
    const scoped = site({ at: T1 }); scoped.scope.excludePaths = ["/blog/"];
    const c = cmp(scoped);
    expect(c.status).toBe("incompatible"); expect(c.reasons.join(" ")).toMatch(/excludePaths/);
    expect(checkCompatibility(site(), site({ at: T1 })).ok).toBe(true);
  });
  it("is not comparable when the observation is unusable", () => {
    expect(cmp(site({ at: T1, over: { status: "failed" } })).status).toBe("not-comparable");
    expect(cmp({ ...site({ at: T1 }), version: 9 }).status).toBe("not-comparable");
  });
});

describe("intentional changes", () => {
  const baseOpts = { origin: O, now: T2 };
  const ex = (input) => { const r = addException(emptyExceptions(), { author: "Dana", reason: "planned", createdAt: T1, ...input }, baseOpts); if (!r.ok) throw new Error(r.errors.join()); return r.store; };
  const run = (cur, exceptions, store = emptyFindings()) => { const c = cmpBare(cur); return mergeFindings(store, c, { baseline: bare(T0), observation: cur, exceptions, now: T2 }).store; };

  it("an approved redirect with the expected target is intentional; a different target is not", () => {
    const cur = bare(T1, { pages: { "/about": redirect("/about", `${O}/team`) } });
    const good = run(cur, ex({ kind: "redirect", url: O + "/about", expect: { target: O + "/team" } }));
    expect(good.findings.find((f) => f.type === "unexpected-redirect")).toMatchObject({ status: "intentional", intentionalChange: { kind: "redirect" } });
    const bad = run(cur, ex({ kind: "redirect", url: O + "/about", expect: { target: O + "/elsewhere" } }));
    const f = bad.findings.find((x) => x.type === "unexpected-redirect");
    expect(f.status).toBe("open"); expect(f.exceptionNotes.join(" ")).toMatch(/does not match/);
  });
  it("a sitemap URL that redirects as approved is intentional too (reported once, as the sitemap-entry finding)", () => {
    const cur = site({ at: T1, pages: { "/about": redirect("/about", `${O}/team`) } });
    const c = cmp(cur);
    const s = mergeFindings(emptyFindings(), c, { baseline: site(), observation: cur, exceptions: ex({ kind: "redirect", url: O + "/about", expect: { target: O + "/team" } }), now: T2 }).store;
    expect(s.findings.find((f) => f.type === "sitemap-entry-redirected")).toMatchObject({ status: "intentional" });
    expect(s.findings.find((f) => f.type === "unexpected-redirect")).toBeUndefined();
  });
  it("an approved removal needs the expected status; a 500 is not an approved removal", () => {
    const removal = ex({ kind: "removal", url: O + "/about" });
    expect(run(bare(T1, { pages: { "/about": { status: 410 } } }), removal).findings.find((f) => f.type === "page-error").status).toBe("intentional");
    const wrong = run(bare(T1, { pages: { "/about": { status: 500 } } }), removal).findings.find((f) => f.type === "page-error");
    expect(wrong.status).toBe("open"); expect(wrong.exceptionNotes.join(" ")).toMatch(/expected status 404\/410 but observed 500/);
  });
  it("approving one change does not suppress an unrelated regression on the same URL or another URL", () => {
    const cur = bare(T1, { pages: { "/about": { ...redirect("/about", `${O}/team`), metaRobots: ["noindex"] }, "/contact": redirect("/contact", `${O}/team`) } });
    const s = run(cur, ex({ kind: "redirect", url: O + "/about", expect: { target: O + "/team" } }));
    expect(s.findings.find((f) => f.type === "unexpected-redirect" && f.subject.url.endsWith("/about")).status).toBe("intentional");
    expect(s.findings.find((f) => f.type === "unexpected-redirect" && f.subject.url.endsWith("/contact")).status).toBe("open");
  });
  it("an approved canonical change must name the observed canonical", () => {
    const cur = bare(T1, { pages: { "/about": { canonicals: [`${O}/team`] } } });
    expect(run(cur, ex({ kind: "canonical", url: O + "/about", expect: { canonical: O + "/team" } })).findings[0].status).toBe("intentional");
    expect(run(cur, ex({ kind: "canonical", url: O + "/about", expect: { canonical: O + "/nope" } })).findings[0].status).toBe("open");
  });
  it("an approved indexability change matches noindex by prefix and an approved robots block per URL", () => {
    const cur = bare(T1, { pages: { "/about": { metaRobots: ["noindex"] }, "/contact": { metaRobots: ["noindex"] } } });
    const s = run(cur, ex({ kind: "indexability", pathPrefix: "/about", expect: { indexable: false } }));
    expect(Object.fromEntries(s.findings.map((f) => [f.subject.url.replace(O, ""), f.status]))).toEqual({ "/about": "intentional", "/contact": "open" });
    const robots = bare(T1, { robots: "User-agent: *\nDisallow: /about\n" });
    expect(run(robots, ex({ kind: "indexability", url: O + "/about", expect: { indexable: false, via: "robots" } })).findings[0].status).toBe("intentional");
    expect(run(robots, ex({ kind: "indexability", url: O + "/about", expect: { indexable: false, via: "noindex" } })).findings[0].status).toBe("open");
  });
  it("an expired record no longer excuses a change, and says so", () => {
    const cur = bare(T1, { pages: { "/about": redirect("/about", `${O}/team`) } });
    const expired = ex({ kind: "redirect", url: O + "/about", expect: { target: O + "/team" }, expiresAt: "2026-10-10T00:00:00.000Z" });
    const f = run(cur, expired).findings[0];
    expect(f.status).toBe("open"); expect(f.exceptionNotes.join(" ")).toMatch(/expired/);
  });
  it("loops, chains, broken links and orphans can never be excused", () => {
    const cur = bare(T1, { pages: { "/services": { status: 301, redirectLoop: true, chain: [{ url: `${O}/services`, status: 301, location: `${O}/x` }], canonicals: null } } });
    const s = run(cur, ex({ kind: "removal", url: O + "/services" }));
    expect(s.findings.find((f) => f.type === "redirect-loop").status).toBe("open");
  });
  it("records need a narrow scope, reason, author and a sensible expiry", () => {
    expect(validateException({ kind: "removal", pathPrefix: "/", reason: "x", author: "a", createdAt: T1 }, baseOpts).join(" ")).toMatch(/narrower/);
    expect(validateException({ kind: "removal", url: O + "/a", pathPrefix: "/a/", reason: "x", author: "a", createdAt: T1 }, baseOpts).join(" ")).toMatch(/exactly one/);
    expect(validateException({ kind: "redirect", url: O + "/a", expect: {}, reason: "", author: "", createdAt: T1 }, baseOpts).length).toBeGreaterThanOrEqual(3);
    expect(validateException({ kind: "removal", url: O + "/a", reason: "x", author: "a", createdAt: T1, expiresAt: T0 }, baseOpts).join(" ")).toMatch(/expiresAt/);
    expect(addException(emptyExceptions(), { kind: "indexability", url: O + "/a", reason: "x", author: "a", expect: { indexable: true } }, { origin: O, now: T1 }).ok).toBe(false);
  });
});

describe("findings lifecycle", () => {
  const base = site();
  const merge = (store, cur, opts = {}) => mergeFindings(store, compareObservations(base, cur, { now: cur.observedAt }), { baseline: base, observation: cur, now: cur.observedAt, ...opts });
  const bad = (at, over = {}) => site({ at, pages: { "/services": { metaRobots: ["noindex"] }, ...over } });

  it("creates a finding once, with first and last observed times; recording the same observation again does not duplicate or recount", () => {
    const a = merge(emptyFindings(), bad(T1));
    expect(a.store.findings).toHaveLength(1);
    const again = merge(a.store, bad(T1));
    expect(again.store.findings).toHaveLength(1);
    expect(again.store.findings[0].occurrences).toBe(1);
    expect(again.store.findings[0]).toMatchObject({ firstObservedAt: T1, lastObservedAt: T1, status: "open" });
  });
  it("a later observation updates last observed and keeps first observed; human decisions survive", () => {
    let s = merge(emptyFindings(), bad(T1)).store;
    const id = s.findings[0].id;
    s = setDecision(s, id, { state: "acknowledged", by: "Dana", note: "ticket 12", now: T1 }).store;
    s = merge(s, bad(T2)).store;
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0]).toMatchObject({ firstObservedAt: T1, lastObservedAt: T2, occurrences: 2, decision: { state: "acknowledged", by: "Dana", note: "ticket 12" } });
  });
  it("resolves only on confirmed recovery; a failed or inconclusive check never resolves", () => {
    let s = merge(emptyFindings(), bad(T1)).store;
    const timedOut = site({ at: T2, pages: { "/services": { state: "unreachable", error: "timed out" } } });
    const r1 = merge(s, timedOut);
    expect(r1.store.findings[0].status).toBe("open");
    expect(r1.store.findings[0].lastCheck).toMatchObject({ outcome: "inconclusive" });
    const headerMissing = site({ at: T2, pages: { "/services": { xRobotsTag: null } } });
    expect(merge(s, headerMissing).store.findings[0].status).toBe("open");
    const partial = site({ at: T2, pages: { "/services": null }, over: { status: "partial" } });
    expect(merge(s, partial).store.findings[0].status).toBe("open");
    const fixed = merge(s, site({ at: T2 }));
    expect(fixed.store.findings[0]).toMatchObject({ status: "resolved", resolvedAt: T2 });
    expect(fixed.changes.resolved).toEqual([s.findings[0].id]);
    const reopened = merge(fixed.store, bad("2026-10-22T00:00:00.000Z")).store.findings[0];
    expect(reopened).toMatchObject({ status: "open", reopenedAt: "2026-10-22T00:00:00.000Z", firstObservedAt: T1 });
  });
  it("robots and sitemap findings resolve only when robots.txt / the sitemap were readable", () => {
    const blocked = site({ at: T1, robots: "User-agent: *\nDisallow: /about\n" });
    const s = merge(emptyFindings(), blocked).store;
    const down = site({ at: T2 }); down.checks.robots = { state: "unavailable", reason: "HTTP 503" };
    expect(merge(s, down).store.findings[0].status).toBe("open");
    expect(merge(s, site({ at: T2 })).store.findings[0].status).toBe("resolved");
  });
  it("refuses to roll findings back to an older observation", () => {
    const s = merge(emptyFindings(), bad(T2)).store;
    expect(() => merge(s, bad(T1))).toThrow(/older than the last recorded/);
  });
  it("a finding becomes intentional when a record is added later, and open again when it expires or is removed", () => {
    let s = merge(emptyFindings(), bad(T1)).store;
    const ex = addException(emptyExceptions(), { kind: "indexability", url: O + "/services", reason: "retired offer", author: "Dana", expect: { indexable: false }, createdAt: T1 }, { origin: O, now: T1 }).store;
    s = merge(s, bad(T2), { exceptions: ex }).store;
    expect(s.findings[0].status).toBe("intentional");
    s = merge(s, bad("2026-10-22T00:00:00.000Z"), { exceptions: emptyExceptions() }).store;
    expect(s.findings[0].status).toBe("open");
  });
  it("accepted findings are closed with history and the issue projection lists only actionable ones", () => {
    let s = merge(emptyFindings(), bad(T1, { "/about": { metaRobots: ["noindex"] } })).store;
    expect(toIssueCandidates(s).map((i) => i.severity)).toEqual(["critical", "high"]);
    const [a, b] = s.findings;
    s = setDecision(s, b.id, { state: "wont-fix", by: "Dana", now: T1 }).store;
    expect(toIssueCandidates(s)).toHaveLength(1);
    s = closeAcceptedFindings(s, [a.id], { now: T2, by: "Dana", seq: 2 });
    expect(s.findings.find((f) => f.id === a.id)).toMatchObject({ status: "accepted", acceptedBy: "Dana" });
    expect(toIssueCandidates(s)).toHaveLength(0);
    expect(setDecision(s, "nope", { state: "wont-fix", by: "x", now: T1 }).ok).toBe(false);
    expect(setDecision(s, a.id, { state: "wont-fix", by: "", now: T1 }).ok).toBe(false);
  });
});

describe("baseline initialization and acceptance rules", () => {
  it("initializes from a complete observation and records who and why", () => {
    const p = planBaseline(null, site(), { kind: "init", by: "Dana", now: T0 });
    expect(p.ok).toBe(true);
    expect(p.record).toMatchObject({ seq: 1, acceptedBy: "Dana", kind: "init", previousSeq: null });
    expect(p.audit).toMatchObject({ action: "baseline-initialized", by: "Dana" });
  });
  it("refuses an incomplete observation, a missing name, a second init, and accept without a baseline", () => {
    expect(planBaseline(null, site({ over: { status: "partial" } }), { kind: "init", by: "Dana", now: T0 }).ok).toBe(false);
    expect(planBaseline(null, site(), { kind: "init", by: "", now: T0 }).ok).toBe(false);
    const cur = planBaseline(null, site(), { kind: "init", by: "Dana", now: T0 }).record;
    expect(planBaseline(cur, site({ at: T1 }), { kind: "init", by: "Dana", now: T1 }).errors.join(" ")).toMatch(/already exists/);
    expect(planBaseline(null, site(), { kind: "accept", by: "Dana", reason: "r", now: T0 }).errors.join(" ")).toMatch(/no baseline/);
    expect(planBaseline(cur, site({ at: T1 }), { kind: "accept", by: "Dana", now: T1 }).errors.join(" ")).toMatch(/--reason/);
  });
  it("never accepts automatically over unresolved regressions; an explicit acknowledgement is recorded in the audit", () => {
    const cur = planBaseline(null, site(), { kind: "init", by: "Dana", now: T0 }).record;
    const regressed = site({ at: T1, pages: { "/services": { metaRobots: ["noindex"] } } });
    const refused = planBaseline(cur, regressed, { kind: "accept", by: "Dana", reason: "redesign", now: T1 });
    expect(refused.ok).toBe(false); expect(refused.errors.join(" ")).toMatch(/unresolved regression/);
    const ok = planBaseline(cur, regressed, { kind: "accept", by: "Dana", reason: "redesign", acknowledgeRegressions: true, now: T1 });
    expect(ok.ok).toBe(true);
    expect(ok.audit.acknowledgedFindings).toHaveLength(1);
    expect(ok.record).toMatchObject({ seq: 2, previousSeq: 1 });
    expect(ok.record.previousObservationHash).toBe(cur.observationHash);
  });
  it("accepts a clean newer observation and refuses an incompatible one", () => {
    const cur = planBaseline(null, site(), { kind: "init", by: "Dana", now: T0 }).record;
    expect(planBaseline(cur, site({ at: T1 }), { kind: "accept", by: "Dana", reason: "routine refresh", now: T1 }).ok).toBe(true);
    const stg = site({ at: T1, over: { environment: { name: "staging", origin: O } } });
    expect(planBaseline(cur, stg, { kind: "accept", by: "Dana", reason: "x", now: T1 }).errors.join(" ")).toMatch(/not comparable/);
  });
  it("a regression covered by an approved record does not block acceptance", () => {
    const cur = planBaseline(null, site(), { kind: "init", by: "Dana", now: T0 }).record;
    const ex = addException(emptyExceptions(), { kind: "indexability", url: O + "/services", reason: "retired", author: "Dana", expect: { indexable: false }, createdAt: T1 }, { origin: O, now: T1 }).store;
    const p = planBaseline(cur, site({ at: T1, pages: { "/services": { metaRobots: ["noindex"] } } }), { kind: "accept", by: "Dana", reason: "retired offer", exceptions: ex, now: T1 });
    expect(p.ok).toBe(true); expect(p.record.matchedIntentionalChanges).toHaveLength(1);
  });
});

describe("read model", () => {
  it("summarizes baseline, findings and records for a dashboard without any I/O", () => {
    const base = planBaseline(null, site(), { kind: "init", by: "Dana", now: T0 }).record;
    const cur = site({ at: T1, pages: { "/services": { metaRobots: ["noindex"] } } });
    const s = mergeFindings(emptyFindings(), compareObservations(site(), cur, { now: T1 }), { baseline: site(), observation: cur, now: T1 }).store;
    const m = buildReadModel({ baseline: base, findings: s, exceptions: emptyExceptions(), audit: [], now: T2 });
    expect(m.format).toBe("bweseo.regression.readmodel");
    expect(m.baseline).toMatchObject({ state: "accepted", seq: 1, environment: { name: "production" } });
    expect(m.findings).toMatchObject({ total: 1, actionable: 1, openBySeverity: { critical: 1 } });
    expect(m.indexingStatement).toMatch(/not Google/);
    expect(buildReadModel({ baseline: null, now: T2 }).baseline.state).toBe("none");
  });
  it("normalizeObservation re-keys pages so hand-written files compare correctly", () => {
    const o = site(); o.pages = { whatever: { ...o.pages[O + "/about"], url: "https://SITE.example/about" } };
    expect(Object.keys(normalizeObservation(o).pages)).toEqual([`${O}/about`]);
  });
});
