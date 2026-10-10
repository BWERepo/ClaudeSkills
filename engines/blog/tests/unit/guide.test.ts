import { describe, expect, it } from "vitest";
import { findGuideSection, guideSectionMarkdown, guideSections, loadGuideHtml, loadGuideMarkdown } from "../../src/docs/guide.js";

describe("Install/usage guide (bundled with the package, read without any network or AI involved)", () => {
  it("loads the Markdown guide", () => {
    const md = loadGuideMarkdown();
    expect(md).toContain("# Installing and using the BWE Blog Engine");
    expect(md).toContain("bwe-blog status");
  });

  it("every section id matches the id actually rendered into the HTML (so dashboard links land correctly)", () => {
    const sections = guideSections();
    expect(sections.length).toBeGreaterThan(0);
    const html = loadGuideHtml();
    const htmlIds = [...html.matchAll(/<h[1-4] id="([^"]+)"/g)].map((m) => m[1]);
    expect(sections.map((s) => s.id)).toEqual(htmlIds);
  });

  it("finds a section by keyword", () => {
    const section = findGuideSection("basic workflow");
    expect(section?.title).toContain("basic workflow");
  });

  it("returns undefined for a keyword that matches nothing", () => {
    expect(findGuideSection("totally-unrelated-keyword-xyz")).toBeUndefined();
  });

  it("extracts one section's Markdown without bleeding into the next section", () => {
    const section = findGuideSection("basic workflow")!;
    const body = guideSectionMarkdown(section.id)!;
    expect(body).toContain("The engine works in stages");
    expect(body).not.toContain("admin dashboard's Overview tab");
  });
});
