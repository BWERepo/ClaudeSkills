import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, openTestEngine } from "../helpers/site.js";

describe("Rebuild Blog SEO Index", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("writes a schema-valid public index and updates the existing sitemap", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const report = await engine.rebuildIndex();

    expect(report.indexValid).toBe(true);
    expect(report.indexArticles).toBe(1); // only the existing, published article
    expect(["created", "merged", "unchanged"]).toContain(report.sitemap.action);

    const index = await engine.context.readFs.readText("blog-seo-index.json");
    expect(index).toBeDefined();
    const parsed = JSON.parse(index!);
    expect(parsed.articles[0].url).toContain("how-to-prevent-cavities");
  });

  it("never regenerates article content", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const before = engine.article(engine.articles()[0]!.id)!.contentHash;
    await engine.rebuildIndex();
    const after = engine.article(engine.articles()[0]!.id)!.contentHash;
    expect(after).toBe(before);
  });

  it("running twice is idempotent: no duplicate sitemap entries", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    await engine.rebuildIndex();
    await engine.rebuildIndex();
    const xml = await engine.context.readFs.readText("sitemap.xml");
    const locs = [...xml!.matchAll(/<loc>/g)];
    const uniqueLocs = new Set([...xml!.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    expect(uniqueLocs.size).toBe(locs.length);
  });

  it("writes the BWESEO discovery file when integration is enabled", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const report = await engine.rebuildIndex();
    expect(report.discoveryWritten).toBe(true);
    const discovery = await engine.context.readFs.readText(".well-known/bwe-blog.json");
    expect(discovery).toBeDefined();
  });
});
