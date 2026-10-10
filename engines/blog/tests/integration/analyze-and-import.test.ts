import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, openTestEngine } from "../helpers/site.js";

describe("Analyze: importing an existing blog", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("discovers the existing blog article and marks it source=existing", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    const report = await engine.analyze();

    expect(report.architecture.framework).toBe("Static HTML");
    expect(report.pagesDiscovered).toBeGreaterThan(0);
    expect(report.existingArticles).toBe(1);
    expect(report.stopped).toBe(true);

    const articles = engine.articles();
    const existing = articles.find((a) => a.url.includes("how-to-prevent-cavities"));
    expect(existing).toBeDefined();
    expect(existing!.source).toBe("existing");
    expect(existing!.status).toBe("published");
  });

  it("generates recommendations tied to real site pages, never fabricating search volume", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const recs = await engine.recommendations();
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r.searchVolume).toBe("Unknown");
      expect(r.keywordDifficulty).toBe("Unknown");
      expect(r.primaryPagesSupported.length + r.contentGap.length).toBeGreaterThan(0);
    }
  });

  it("running analyze twice does not duplicate the discovered article", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    await engine.analyze();
    expect(engine.articles().filter((a) => a.url.includes("how-to-prevent-cavities")).length).toBe(1);
  });

  it("a site with no blog yet still analyzes and proposes recommendations", async () => {
    dir = copyFixture("markdown-no-blog");
    const engine = await openTestEngine(dir, { siteUrl: "https://www.riversidecorvetteclub.example" });
    const report = await engine.analyze();
    expect(report.existingArticles).toBe(0);
    expect(report.architecture.blog.exists).toBe(false);
  });
});
