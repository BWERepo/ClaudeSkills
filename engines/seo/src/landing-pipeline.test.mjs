import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importKeywordsCsv, groupKeywords } from "./landing-keywords.mjs";
import { planOpportunities, pageOverlap } from "./landing-opportunities.mjs";
import { checkPage, canTransition, approve, similarity } from "./landing-quality.mjs";
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
  it("passes a sound page and flags a thin one", () => {
    expect(checkPage(good, { verifiedPrices: ["$499"] }).ok).toBe(true);
    expect(checkPage({ ...good, body: "short" }).findings.map((f) => f.id)).toContain("thin");
  });
  it("blocks stuffing, unsupported claims, wrong prices and duplicate titles", () => {
    const ids = (p, c) => checkPage(p, c).findings.map((f) => f.id);
    expect(ids({ ...good, primary: "custom websites", body: body("custom websites ".repeat(60)) })).toContain("stuffing");
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
