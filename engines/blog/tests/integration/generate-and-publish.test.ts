import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, openTestEngine } from "../helpers/site.js";

describe("Generate -> Link -> Validate -> Publish (Mode A: review required)", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("selecting more than the configured limit is refused", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const recs = await engine.recommendations();
    const ids = recs.filter((r) => r.status === "recommended").map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    // A second engine over the same data directory, but configured with a lower selection limit.
    const limited = await openTestEngine(dir, { maxRecommendations: 1 });
    await limited.select(ids.slice(0, 1));
    await expect(limited.select(ids.slice(1))).rejects.toThrow(/limit/);
  });

  it("generates selected recommendations into draft/review articles, never straight to published", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const recs = (await engine.recommendations()).filter((r) => r.status === "recommended");
    expect(recs.length).toBeGreaterThan(0);
    const picked = recs.slice(0, 2).map((r) => r.id);

    await engine.select(picked);
    const build = await engine.generate(picked);

    expect(build.generated.length + build.failed.length).toBe(picked.length);
    for (const g of build.generated) expect(["review", "draft"]).toContain(g.status);
    expect(build.published).toBe(0);
    expect(build.awaitingReview).toBe(build.generated.length);

    const article = engine.article(build.generated[0]!.articleId)!;
    expect(article.source).toBe("blog-engine");
    expect(article.indexable).toBe(false); // never indexable before publication
  });

  it("approve then publish runs the validation gate and writes the article to disk", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const build = await engine.generate([rec.id]);
    const articleId = build.generated[0]!.articleId;

    await engine.approve(articleId);
    const { article, validation } = await engine.publish(articleId);

    expect(validation.passed).toBe(true);
    expect(article.status).toBe("published");
    expect(article.indexable).toBe(true);
    expect(article.storage?.path).toBeDefined();
  });

  it("publishing an article that is not approved is refused", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const build = await engine.generate([rec.id]);
    const articleId = build.generated[0]!.articleId;
    await expect(engine.publish(articleId)).rejects.toThrow();
  });
});

describe("Mode B: approved-selection-publishes", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("a passing article is published automatically once selected and generated", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir, { approvalRequired: false });
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const build = await engine.generate([rec.id]);
    expect(build.published).toBe(1);
    const article = engine.article(build.generated[0]!.articleId)!;
    expect(article.status).toBe("published");
  });
});
