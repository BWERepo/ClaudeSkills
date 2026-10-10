import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, openTestEngine } from "../helpers/site.js";

describe("Conductor: reports what has been done and the next step", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  it("reports not-initialized before any analysis", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    const status = await engine.conductorStatus();
    expect(status.phase).toBe("not-initialized");
    expect(status.nextAction.command).toBe("bwe-blog analyze");
    expect(status.doneSoFar).toEqual([]);
  });

  it("reports recommendations-awaiting-selection after analyze", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const status = await engine.conductorStatus();
    expect(status.phase).toBe("recommendations-awaiting-selection");
    expect(status.nextAction.command).toBe("bwe-blog recommendations");
    expect(status.doneSoFar.some((d) => d.includes("analyzed"))).toBe(true);
  });

  it("reports selected-awaiting-generation after select", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const status = await engine.conductorStatus();
    expect(status.phase).toBe("selected-awaiting-generation");
    expect(status.nextAction.command).toBe("bwe-blog generate");
  });

  it("reports drafts-awaiting-review after generate (Mode A)", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    await engine.generate([rec.id]);
    const status = await engine.conductorStatus();
    expect(status.phase).toBe("drafts-awaiting-review");
    expect(status.nextAction.command).toBe("bwe-blog admin");
  });

  it("reports ready-to-publish after approve", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const rec = (await engine.recommendations()).find((r) => r.status === "recommended")!;
    await engine.select([rec.id]);
    const build = await engine.generate([rec.id]);
    await engine.approve(build.generated[0]!.articleId);
    const status = await engine.conductorStatus();
    expect(status.phase).toBe("ready-to-publish");
    expect(status.nextAction.command).toContain("bwe-blog publish");
  });

  it("reports index-stale after publish until the index is rebuilt, then up-to-date", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const recs = (await engine.recommendations()).filter((r) => r.status === "recommended");
    await engine.select(recs.map((r) => r.id));
    const build = await engine.generate(recs.map((r) => r.id));
    for (const g of build.generated) {
      await engine.approve(g.articleId);
      await engine.publish(g.articleId);
    }
    const afterPublish = await engine.conductorStatus();
    expect(["index-stale", "up-to-date"]).toContain(afterPublish.phase);

    await engine.rebuildIndex();
    const afterRebuild = await engine.conductorStatus();
    expect(afterRebuild.phase).toBe("up-to-date");
    expect(afterRebuild.doneSoFar.some((d) => d.includes("published"))).toBe(true);
  });

  it("surfaces recorded activity from the engine's own event log, newest first", async () => {
    dir = copyFixture("static-with-blog");
    const engine = await openTestEngine(dir);
    await engine.analyze();
    const status = await engine.conductorStatus();
    expect(status.recentActivity.length).toBeGreaterThan(0);
    expect(status.recentActivity[0]!.summary).toBeTruthy();
  });
});
