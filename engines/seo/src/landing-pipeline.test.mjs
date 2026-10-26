import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importKeywordsCsv, groupKeywords } from "./landing-keywords.mjs";
import { planOpportunities, pageOverlap } from "./landing-opportunities.mjs";
import { checkPage, canTransition, approve, similarity, contentHash } from "./landing-quality.mjs";
import { main, loadState } from "./seo-landing.mjs";

const pages = [
  { path: "/pricing", title: "Small Business Website Pricing | Example Studio", h1: "What a small business website costs", h2: ["Website plans"], description: "Fixed prices." },
  { path: "/website-redesign", title: "Website Redesign for Small Businesses", h1: "Website redesign for small businesses", h2: ["What a website redesign costs"], description: "Rebuild it." },
];
const kws = importKeywordsCsv("Affordable website design\nCheap website design for small business\nWebsite redesign cost\nSmall business website packages\n").keywords;

describe("opportunity planning", () => {
  it("improves an existing page instead of duplicating its intent", () => {
    const plan = planOpportunities(groupKeywords(kws), pages);
    const cost = plan.find((p) => p.primary === "Website redesign cost");
    expect(cost.action).toBe("improve-existing");
    expect(cost.target).toBe("/website-redesign");
  });
  it("makes one new page for look-alike keywords", () => {
    const plan = planOpportunities(groupKeywords(kws), pages);
    expect(plan.filter((p) => p.action === "new-page")).toHaveLength(1);
  });
  it("never invents competition or volume", () => {
    const [p] = planOpportunities(groupKeywords(kws), pages);
    expect(p.score.competition.value).toBe("unavailable");
    expect(p.score.volume).toBe("unavailable");
  });
  it("scores overlap on title/H1 highest", () => {
    expect(pageOverlap({ primary: "website pricing" }, pages[0]).score).toBeGreaterThan(0.8);
  });
});

const body = (extra = "") => ("We design every site by hand for local owners who want clear pricing and a simple process. ".repeat(40)) + extra;
const good = { path: "/x", title: "Custom Websites | Example", description: "Custom websites for small businesses with fixed prices and a free prototype you can review first.", h1: "Custom websites", body: body("Plans start at $499."), headings: ["a", "b", "c"], images: [{ alt: "desk" }], links: ["/a", "/b"] };

describe("price-wording variants and place pages", () => {
  const live = [...pages,
    { path: "/", title: "Small Business Websites, Free Prototype", h1: "See Your New Website Before You Commit", h2: [], description: "Affordable website design prototype." },
    { path: "/knoxville-web-design", title: "Small Business Website Design in Knoxville, TN", h1: "Small business website design in Knoxville, TN.", h2: [], description: "" },
    { path: "/east-tennessee-web-design", title: "East Tennessee Small Business Web Design", h1: "Small business website design in East Tennessee.", h2: [], description: "Affordable website design for small businesses." }];
  const k = importKeywordsCsv("Affordable website design\nLow cost website design\nWebsite design under $1000\nSmall business website packages\nWebsite design Knoxville TN\nAffordable website designer Knoxville\n").keywords;
  const plan = planOpportunities(groupKeywords(k, { locations: ["Knoxville"] }), live, { places: ["Knoxville", "East Tennessee"] });
  it("folds low cost / under $1000 into one new page, not three", () => {
    const news = plan.filter((p) => p.action === "new-page");
    expect(news).toHaveLength(1);
    expect(news[0].secondary.length).toBeGreaterThanOrEqual(2);
  });
  it("sends place keywords to the place page and package keywords to pricing", () => {
    expect(plan.find((p) => /Knoxville/.test(p.primary)).target).toBe("/knoxville-web-design");
    expect(plan.find((p) => /packages/.test(p.primary)).target).toBe("/pricing");
  });
});

describe("quality gate", () => {
  it("passes a sound page and flags a thin one for review without blocking", () => {
    expect(checkPage(good, { verifiedPrices: ["$499"] }).ok).toBe(true);
    const thin = checkPage({ ...good, body: "short" });
    expect(thin.findings.find((f) => f.id === "thin")).toMatchObject({ level: "review" });
    expect(thin).toMatchObject({ ok: true, reviews: 1 });
  });
  it("blocks unsupported claims, wrong prices and duplicate titles; stuffing is a review signal", () => {
    const ids = (p, c) => checkPage(p, c).findings.map((f) => f.id);
    const stuffed = checkPage({ ...good, primary: "custom websites", body: body("custom websites ".repeat(60)) });
    expect(stuffed.findings.find((f) => f.id === "stuffing")).toMatchObject({ level: "review" });
    expect(stuffed.ok).toBe(true);
    expect(ids({ ...good, body: body("We guarantee first page rankings. Loved by 500+ clients.") })).toContain("claim");
    expect(ids(good, { verifiedPrices: ["$999"] })).toContain("price");
    expect(ids(good, { others: [{ path: "/y", title: "custom websites | example" }] })).toContain("dup-title");
  });
  it("blocks near-identical city pages and unverified locations", () => {
    const city = { ...good, type: "location", path: "/a-city" };
    const r = checkPage(city, { locationPages: [{ path: "/b-city", body: city.body }], verifiedLocation: false }).findings.map((f) => f.id);
    expect(r).toEqual(expect.arrayContaining(["doorway", "location-claim"]));
    expect(similarity(city.body, city.body)).toBe(1);
  });
});

describe("approval workflow", () => {
  it("cannot publish without approval or after an edit", () => {
    const d = { ...good, status: "draft" };
    expect(canTransition({ ...d, status: "approved" }, "published").reason).toMatch(/not approved/);
    const a = approve(d, "Owner");
    expect(canTransition(a, "published").ok).toBe(true);
    expect(canTransition({ ...a, title: "Changed" }, "published").reason).toMatch(/changed after approval/);
    expect(() => approve(d, "")).toThrow();
    expect(canTransition({ status: "proposed" }, "published").ok).toBe(false);
  });
});

describe("CLI", () => {
  it("imports, plans, checks, approves and moves — publishing only after approval", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "landing-"));
    const out = []; const run = (a) => main(a, { cwd, out: (s) => out.push(s) });
    writeFileSync(join(cwd, "k.csv"), "Affordable website design\nWebsite redesign cost\n");
    writeFileSync(join(cwd, "pages.json"), JSON.stringify({ pages }));
    expect(await run(["import", "k.csv"])).toBe(0);
    expect(await run(["plan", "--pages", "pages.json"])).toBe(0);
    const id = loadState(cwd).opportunities.find((o) => o.action === "new-page").id;
    writeFileSync(join(cwd, "p.json"), JSON.stringify(good));
    expect(await run(["move", id, "--to", "draft"])).toBe(0);
    expect(await run(["approve", id, "--by", "Owner"])).toBe(1); // gate not run yet
    expect(await run(["check", id, "--page", "p.json", "--prices", "$499"])).toBe(0);
    expect(await run(["approve", id, "--by", "Owner"])).toBe(0);
    expect(await run(["move", id, "--to", "published"])).toBe(0);
    expect(loadState(cwd).opportunities.find((o) => o.id === id).status).toBe("published");
  });
});

describe("merging requires the same service identity, not just the same intent", () => {
  const home = [{ path: "/", title: "Example Home Services", h1: "Example Home Services", h2: [], description: "" }];
  const plan = (words, pgs = home, opts = {}) => planOpportunities(groupKeywords(importKeywordsCsv(words.join("\n") + "\n").keywords, { locations: opts.places ?? [] }), pgs, opts);
  it("keeps unrelated services with the same intent apart", () => {
    const p = plan(["emergency plumbing", "roof repair"]);
    expect(p.map((x) => x.primary).sort()).toEqual(["emergency plumbing", "roof repair"]);
    expect(p.every((x) => !x.merged)).toBe(true);
  });
  it("still folds genuine wording variants of one service", () => {
    const p = plan(["emergency plumbing", "emergency plumber", "affordable website design", "website design under $1000"]);
    expect(p.find((x) => x.primary === "emergency plumbing").secondary).toContain("emergency plumber");
    expect(p.filter((x) => /website design/i.test(x.primary))).toHaveLength(1);
  });
  it("treats different places as different pages", () => {
    const p = plan(["roof repair Knoxville", "roof repair Atlanta"], home, { places: ["Knoxville", "Atlanta"] });
    expect(p).toHaveLength(2);
  });
  it("does not fold a plain service into its place variant", () => {
    expect(plan(["roof repair", "roof repair Knoxville"], home, { places: ["Knoxville"] })).toHaveLength(2);
  });
  it("keeps unrelated services apart when they point at the same existing page", () => {
    const pgs = [{ path: "/services", title: "Plumbing and roofing services", h1: "Plumbing and roofing services", h2: [], description: "" }];
    const p = plan(["plumbing services", "roofing services"], pgs);
    expect(p.every((x) => x.action === "improve-existing" && x.target === "/services")).toBe(true);
    expect(p).toHaveLength(2);
  });
  it("still folds variants that point at the same existing page", () => {
    const pgs = [{ path: "/pricing", title: "Website pricing", h1: "Website pricing", h2: [], description: "" }];
    const p = plan(["website pricing", "pricing for websites"], pgs);
    expect(p).toHaveLength(1);
    expect(p[0].target).toBe("/pricing");
  });
});

describe("quality gate: review signals, thresholds and alt text", () => {
  const find = (page, id, ctx) => checkPage(page, ctx).findings.filter((f) => f.id === id);
  it("makes word-count and density thresholds configurable and ignores invalid overrides", () => {
    expect(find({ ...good, body: "short" }, "thin", { thresholds: { minWords: 1 } })).toHaveLength(0);
    expect(find({ ...good, body: "short" }, "thin", { thresholds: { minWords: "lots" } })).toHaveLength(1);
    const r = checkPage(good, { thresholds: { minWords: 700 } });
    expect(r.thresholds.minWords).toBe(700);
    expect(find({ ...good, primary: "custom websites", body: body("custom websites ".repeat(60)) }, "stuffing", { thresholds: { stuffingDensity: 0.99, stuffingWarnHits: 999 } })).toHaveLength(0);
  });
  it("still blocks an empty body and keeps hard blocks for claims and invalid approval", () => {
    expect(checkPage({ ...good, body: "" }).findings.find((f) => f.id === "empty")).toMatchObject({ level: "error" });
    expect(checkPage({ ...good, body: body("We guarantee first page rankings.") }).ok).toBe(false);
  });
  it("tells a missing alt attribute from an intentional empty one", () => {
    const withImages = (images) => ({ ...good, images });
    expect(find(withImages([{ src: "/a.png" }]), "alt-missing")).toHaveLength(1);
    expect(find(withImages([{ src: "/a.png", alt: null }]), "alt-missing")).toHaveLength(1);
    expect(checkPage(withImages([{ src: "/a.png" }])).ok).toBe(false);
    const decorative = checkPage(withImages([{ src: "/divider.svg", alt: "" }]));
    expect(decorative.ok).toBe(true);
    expect(decorative.findings.find((f) => f.id === "alt-decorative")).toMatchObject({ level: "review" });
    expect(find(withImages([{ src: "/chart.png", alt: "", informative: true }]), "alt-empty-informative")[0]).toMatchObject({ level: "error" });
    expect(find(withImages([{ src: "/chart.png", alt: "", decorative: false }]), "alt-empty-informative")).toHaveLength(1);
    expect(find(withImages([{ src: "/a.png", alt: "   " }]), "alt-invalid")).toHaveLength(1);
    expect(checkPage(withImages([{ src: "/a.png", alt: "A storefront" }])).findings.some((f) => f.id.startsWith("alt"))).toBe(false);
  });
  it("keeps missing and empty alt distinct in the approval hash, without changing existing hashes", () => {
    const base = { ...good, path: "/x" };
    expect(contentHash({ ...base, images: [{ src: "/a.png" }] })).not.toBe(contentHash({ ...base, images: [{ src: "/a.png", alt: "" }] }));
    expect(contentHash({ ...base, images: [{ src: "/a.png", alt: "" }] })).not.toBe(contentHash({ ...base, images: [{ src: "/a.png", alt: "", decorative: false }] }));
  });
});
