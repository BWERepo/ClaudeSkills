import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, openTestEngine } from "../helpers/site.js";

/**
 * Analyze -> Recommend -> Select -> Generate -> Review -> Publish -> Sitemap -> Blog Index -> Internal
 * Links -> BWESEO Discovery, end to end, against the static-with-blog fixture.
 */
describe("E2E: the full pipeline", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("runs the whole pipeline and leaves a consistent, cross-referenced result", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);

    // Analyze
    const analysis = await engine.analyze();
    expect(analysis.existingArticles).toBe(1);
    expect(analysis.recommendations).toBeGreaterThan(0);

    // Recommend (already produced by analyze) -> Select
    const recs = (await engine.recommendations()).filter((r) => r.status === "recommended");
    const picked = recs.slice(0, 2);
    await engine.select(picked.map((r) => r.id));

    // Generate
    const build = await engine.generate(picked.map((r) => r.id));
    expect(build.generated.length).toBe(picked.length);
    for (const g of build.generated) expect(g.status).toBe("draft");

    // Review -> Publish
    for (const g of build.generated) {
      await engine.approve(g.articleId);
      const { article, validation } = await engine.publish(g.articleId);
      expect(validation.passed).toBe(true);
      expect(article.status).toBe("published");
    }

    // Sitemap, Blog Index, Internal Links, BWESEO Discovery
    const rebuild = await engine.rebuildIndex();
    expect(rebuild.indexValid).toBe(true);
    expect(rebuild.indexArticles).toBe(1 + picked.length); // existing + newly published
    expect(rebuild.discoveryWritten).toBe(true);

    const links = await engine.links();
    expect(links.broken.length).toBe(0);

    const sitemapXml = await engine.context.readFs.readText("sitemap.xml");
    for (const g of build.generated) {
      const article = engine.article(g.articleId)!;
      expect(sitemapXml).toContain(new URL(article.url).pathname);
    }

    const indexRaw = await engine.context.readFs.readText("blog-seo-index.json");
    const index = JSON.parse(indexRaw!);
    expect(index.articles.length).toBe(1 + picked.length);
    expect(index.summary.published).toBe(1 + picked.length);

    // The published articles were written to disk under the host's blog path.
    for (const g of build.generated) {
      const article = engine.article(g.articleId)!;
      expect(article.storage?.path).toMatch(/^blog\//);
    }

    const bweseo = await engine.bweseoStatus();
    expect(bweseo?.status).toBe("not-installed"); // this fixture has no BWESEO inventory yet
  });

  it("a second full run (reanalyze + rebuild) stays idempotent: no duplicate articles or links", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const build = await engine.generate([rec.id]);
    await engine.approve(build.generated[0]!.articleId);
    await engine.publish(build.generated[0]!.articleId);
    await engine.rebuildIndex();

    const countBefore = engine.articles().length;
    await engine.reanalyze();
    await engine.rebuildIndex();
    expect(engine.articles().length).toBe(countBefore);
  });
});
