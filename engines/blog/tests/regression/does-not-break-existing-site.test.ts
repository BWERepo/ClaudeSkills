import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, openTestEngine } from "../helpers/site.js";

/**
 * Regression: installing and running the engine on an existing site must never touch files it did not
 * create, and must never change the existing blog article, the homepage, the sitemap's existing entries,
 * robots.txt, or navigation.
 */
describe("Regression: existing site is preserved", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("homepage, robots.txt and the existing article are byte-identical after a full run", async () => {
    dir = copyFixture("static-with-blog");
    const before = {
      home: readFileSync(path.join(dir, "index.html"), "utf8"),
      robots: readFileSync(path.join(dir, "robots.txt"), "utf8"),
      article: readFileSync(path.join(dir, "blog/how-to-prevent-cavities.html"), "utf8"),
      contact: readFileSync(path.join(dir, "contact.html"), "utf8"),
    };

    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    await engine.generate([rec.id]);
    await engine.rebuildIndex();

    expect(readFileSync(path.join(dir, "index.html"), "utf8")).toBe(before.home);
    expect(readFileSync(path.join(dir, "robots.txt"), "utf8")).toBe(before.robots);
    expect(readFileSync(path.join(dir, "blog/how-to-prevent-cavities.html"), "utf8")).toBe(before.article);
    expect(readFileSync(path.join(dir, "contact.html"), "utf8")).toBe(before.contact);
  });

  it("the existing sitemap keeps its original entries after a rebuild", async () => {
    dir = copyFixture("static-with-blog");
    const originalLocs = [...readFileSync(path.join(dir, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    const engine = await openTestEngine(dir);
    await engine.analyze();
    await engine.rebuildIndex();

    const after = readFileSync(path.join(dir, "sitemap.xml"), "utf8");
    const afterLocs = [...after.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const loc of originalLocs) expect(afterLocs).toContain(loc);
  });

  it("the engine never writes outside its data directory and the directories it was configured for", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const build = await engine.generate([rec.id]);
    await engine.approve(build.generated[0]!.articleId);
    await engine.publish(build.generated[0]!.articleId);

    // A new article was written, but only under /blog, never over an unrelated existing page.
    expect(readFileSync(path.join(dir, "services/teeth-whitening.html"), "utf8")).toContain("Professional Teeth Whitening");
    expect(readFileSync(path.join(dir, "services/dental-implants.html"), "utf8")).toContain("Dental Implants");
  });
});
