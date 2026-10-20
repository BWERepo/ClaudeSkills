import { describe, it, expect } from "vitest";
import { importKeywordsCsv, metricOf, groupKeywords, classifyIntent, targetedKeywords, parseCsv, UNAVAILABLE } from "./landing-keywords.mjs";

describe("metrics are never invented", () => {
  it("is unavailable without a source and date", () => {
    expect(metricOf(900, null, "2026-10-01").value).toBe(UNAVAILABLE);
    expect(metricOf(900, "Tool X", null).verified).toBe(false);
    expect(metricOf("n/a", "Tool X", "2026-10-01").value).toBe(UNAVAILABLE);
  });
  it("keeps a sourced, dated number", () => {
    expect(metricOf("1,200", "Tool X", "2026-10-01")).toMatchObject({ value: 1200, verified: true });
  });
});

describe("CSV import", () => {
  it("reads a bare list, drops duplicates and blanks", () => {
    const r = importKeywordsCsv("Affordable website design\naffordable  website design!\n\n");
    expect(r.keywords).toHaveLength(1);
    expect(r.duplicates).toHaveLength(1);
    expect(r.keywords[0].metrics.searchVolume.value).toBe(UNAVAILABLE);
  });
  it("reads headed metrics only when sourced and dated", () => {
    const r = importKeywordsCsv('keyword,volume,source,date\n"low cost, website design",500,ToolX,2026-10-02\nwebsite redesign cost,300,,\n');
    expect(r.keywords[0].metrics.searchVolume.value).toBe(500);
    expect(r.keywords[1].metrics.searchVolume.value).toBe(UNAVAILABLE);
  });
  it("parses quotes and CRLF", () => { expect(parseCsv('a,"b ""q"""\r\nc,d')).toEqual([["a", 'b "q"'], ["c", "d"]]); });
});

describe("intent grouping", () => {
  const kws = ["Affordable website design", "Affordable web design for small business", "Website redesign cost", "Website design under $1000", "Website design Knoxville TN"].map((keyword) => ({ keyword }));
  it("classifies by wording", () => {
    expect(classifyIntent("website redesign cost")).toBe("cost-research");
    expect(classifyIntent("website design under $1000")).toBe("comparison");
    expect(classifyIntent("website design Knoxville TN", { locations: ["Knoxville"] })).toBe("local");
  });
  it("puts same-intent look-alikes on one page", () => {
    const g = groupKeywords(kws.slice(0, 2));
    expect(g).toHaveLength(1);
    expect(g[0].secondary).toHaveLength(1);
  });
  it("keeps different intents apart", () => { expect(groupKeywords(kws).length).toBeGreaterThan(2); });
});

describe("existing targets", () => {
  it("finds keywords already on a page", () => {
    const m = targetedKeywords({ pages: [{ id: "p1", status: "published", keywords: { primary: "Web Design", secondary: ["site design"] } }, { id: "p2", status: "rejected", keywords: { primary: "x y" } }] });
    expect(m.get("web design")).toEqual(["p1"]);
    expect(m.has("x y")).toBe(false);
  });
});
