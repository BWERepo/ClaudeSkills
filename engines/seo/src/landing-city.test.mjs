import { describe, it, expect } from "vitest";
import { upsertEntry, checkBrief, localPresenceClaims, stampPublicChange, publicHash, sitemapEligibility, planSitemapChanges, renderUrlset, checkRobotsSitemap, linkReport, cityReadiness, releasePackage, validLastmod } from "./landing-city.mjs";

const origin = "https://www.example.test";
const mk = (o = {}) => ({ city: "Springfield", state: "ZZ", service: "web-design", status: "published", publicContent: { title: "T", description: "D", h1: "H", body: "Original body text.", links: ["/pricing"] }, ...o });
const xml = renderUrlset([{ loc: `${origin}/`, lastmod: "2026-01-01" }, { loc: `${origin}/old`, lastmod: "2026-01-02" }]);

describe("registry", () => {
  it("is idempotent and blocks route conflicts", () => {
    const a = upsertEntry({ entries: [] }, mk({ path: "/springfield-web-design" }));
    expect(a.ok && a.created).toBe(true);
    const again = upsertEntry(a.registry, mk({ path: "/springfield-web-design" }));
    expect(again.created).toBe(false); expect(again.registry.entries).toHaveLength(1);
    expect(upsertEntry(a.registry, mk({ city: "Other", path: "/springfield-web-design" })).ok).toBe(false);
    expect(upsertEntry({ entries: [] }, mk(), { existingPaths: ["/springfield-web-design/"] }).ok).toBe(false);
  });
});
describe("brief and claims", () => {
  it("blocks unverified availability and unsourced verified facts", () => {
    const r = checkBrief({ city: "A", state: "B", availability: { status: "unknown" }, facts: [{ claim: "x", status: "verified" }], sources: [] });
    expect(r.findings.map((x) => x.id)).toEqual(expect.arrayContaining(["availability", "fact-source", "no-sources"]));
  });
  it("flags office and local-team claims but allows the home base", () => {
    expect(localPresenceClaims("Visit our office in Springfield.", { city: "Springfield", homeBase: "Knoxville" })).toHaveLength(1);
    expect(localPresenceClaims("We are based in Knoxville and work remotely.", { city: "Springfield", homeBase: "Knoxville" })).toHaveLength(0);
  });
  it("does not flag honest no-office disclaimers", () => {
    expect(localPresenceClaims("We do not have an office in Springfield and work remotely.", { city: "Springfield", homeBase: "Knoxville" })).toHaveLength(0);
    expect(localPresenceClaims("Acme Plumbing is based in Knoxville, not in Springfield.", { city: "Springfield", homeBase: "Knoxville" })).toHaveLength(0);
    expect(localPresenceClaims("Our office in Springfield is open daily.", { city: "Springfield", homeBase: "Knoxville" })).toHaveLength(1);
  });
  it("readiness blocks presence claims", () => {
    const e = mk({ publicContent: { title: "T", description: "D", body: "Our team in Springfield will visit you." } });
    const ok = { city: "Springfield", state: "ZZ", availability: { status: "verified" }, sources: [{ url: "https://s.example", retrievedOn: "2026-10-21" }] };
    expect(cityReadiness(e, ok).ready).toBe(false);
  });
});
describe("lastmod", () => {
  it("does not move on unchanged rebuilds, moves on public change only", () => {
    const e1 = stampPublicChange(mk({ path: "/a" }), "2026-10-01");
    expect(stampPublicChange(e1, "2026-11-01").lastmod).toBe("2026-10-01");
    const e2 = stampPublicChange({ ...e1, publicContent: { ...e1.publicContent, body: "Changed." } }, "2026-11-01");
    expect(e2.lastmod).toBe("2026-11-01");
    expect(stampPublicChange({ ...e1, research: "draft note" }, "2026-12-01").lastmod).toBe("2026-10-01");
    expect(publicHash(e1)).toBe(publicHash({ ...e1, analytics: 1 }));
  });
  it("rejects future dates", () => expect(validLastmod("2027-01-01", "2026-10-21")).toBe(false));
});
describe("sitemap", () => {
  it("excludes redirects, noindex, drafts, robots-blocked, canonical mismatches", () => {
    const base = mk({ path: "/a" });
    expect(sitemapEligibility(base, { origin }).eligible).toBe(true);
    for (const o of [{ status: "draft" }, { indexable: false }, { redirectTo: "/b" }, { publicContent: { ...base.publicContent, canonical: origin + "/z" } }])
      expect(sitemapEligibility({ ...base, ...o }, { origin }).eligible).toBe(false);
    expect(sitemapEligibility(base, { origin, robotsTxt: "User-agent: *\nDisallow: /a" }).eligible).toBe(false);
  });
  it("surfaces configured vs observed disagreement", () => {
    const r = sitemapEligibility(mk({ path: "/a" }), { origin, observed: { status: 200, robotsMeta: "noindex" } });
    expect(r.eligible).toBe(false); expect(r.reasons.join()).toMatch(/disagree/);
  });
  it("plans changes and keeps unrelated entries", () => {
    const e = stampPublicChange(mk({ path: "/a" }), "2026-10-01");
    const p = planSitemapChanges(xml, [e, { ...mk({ path: "/old" }), status: "unpublished" }], { origin, today: "2026-10-21" });
    expect(p.adds).toEqual([{ url: origin + "/a", lastmod: "2026-10-01" }]);
    expect(p.removes.map((x) => x.url)).toEqual([origin + "/old"]);
    expect(p.unrelatedKept).toBe(1);
  });
  it("refuses a malformed sitemap and omits untrusted lastmod", () => {
    expect(planSitemapChanges("<urlset><url>", [], { origin, today: "2026-10-21" }).ok).toBe(false);
    const p = planSitemapChanges(xml, [mk({ path: "/b" })], { origin, today: "2026-10-21" });
    expect(p.blocked).toHaveLength(1);
  });
  it("renders escaped, de-duplicated XML", () => {
    const x = renderUrlset([{ loc: "https://e.test/a?x=1&y=2" }, { loc: "https://e.test/a?x=1&y=2" }]);
    expect(x.match(/<url>/g)).toHaveLength(1); expect(x).toContain("&amp;");
  });
});
describe("robots, links, release", () => {
  it("requires the real sitemap reference", () => {
    expect(checkRobotsSitemap("Sitemap: https://<verified-production-host>/sitemap.xml", `${origin}/sitemap.xml`).ok).toBe(false);
    expect(checkRobotsSitemap(`User-agent: *\nSitemap: ${origin}/sitemap.xml`, `${origin}/sitemap.xml`).ok).toBe(true);
  });
  it("finds orphans and broken links", () => {
    const r = linkReport([mk({ path: "/a", publicContent: { links: ["/missing"] } })], { existingPaths: [] });
    expect(r.orphans).toEqual(["/a"]); expect(r.broken).toEqual([{ from: "/a", to: "/missing" }]);
  });
  it("release package does not call links to existing site pages broken", () => {
    const e = stampPublicChange(mk({ path: "/a", publicContent: { ...mk().publicContent, links: ["/pricing"] } }), "2026-10-01");
    const r = releasePackage({ entries: [e], currentSitemapXml: xml, origin, today: "2026-10-21", robotsTxt: `Sitemap: ${origin}/sitemap.xml`, existingPaths: ["/pricing"] });
    expect(r.links.broken).toEqual([]);
  });
  it("voids approval when the package changes", () => {
    const e = stampPublicChange(mk({ path: "/a" }), "2026-10-01");
    const args = { entries: [e], currentSitemapXml: xml, origin, today: "2026-10-21", robotsTxt: `Sitemap: ${origin}/sitemap.xml` };
    const p = releasePackage(args);
    expect(releasePackage({ ...args, approval: { packageHash: p.packageHash } }).approved).toBe(true);
    const changed = stampPublicChange({ ...e, publicContent: { ...e.publicContent, body: "New." } }, "2026-10-05");
    expect(releasePackage({ ...args, entries: [changed], approval: { packageHash: p.packageHash } }).approved).toBe(false);
  });
});

describe("worker-safe hashing", () => {
  it("sha256hex matches node crypto, including multi-byte text and block edges", async () => {
    const { sha256hex } = await import("./landing-hash.mjs");
    const { createHash } = await import("node:crypto");
    for (const t of ["", "abc", "é — 漢字 😀", "x".repeat(55), "x".repeat(56), "x".repeat(64), "y".repeat(1000)])
      expect(sha256hex(t)).toBe(createHash("sha256").update(t).digest("hex"));
  });
});
