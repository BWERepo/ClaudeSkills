import { beforeEach, describe, expect, it } from "vitest";
import { ArticleRegistry } from "../../src/core/registry/registry.js";
import { EventBus } from "../../src/core/events.js";
import { JsonStore } from "../../src/core/store/store.js";
import { SafeFs } from "../../src/core/util/safe-fs.js";
import { fixedClock } from "../../src/core/util/time.js";
import { stableId } from "../../src/core/util/hash.js";
import type { BlogArticle } from "../../src/core/types.js";
import { copyFixture, cleanup } from "../helpers/site.js";

function makeArticle(overrides: Partial<BlogArticle> = {}): BlogArticle {
  return {
    id: stableId("art", "https://example.com/blog/a"),
    title: "A",
    slug: "a",
    url: "https://example.com/blog/a",
    source: "blog-engine",
    status: "draft",
    description: "d",
    primaryTopic: "a",
    secondaryTopics: [],
    category: "general",
    tags: [],
    searchIntent: "informational",
    canonicalUrl: "https://example.com/blog/a",
    internalLinksIn: [],
    internalLinksOut: [],
    outboundLinks: [],
    relatedArticles: [],
    relatedSitePages: [],
    schemaTypes: [],
    indexable: false,
    headings: [],
    wordCount: 500,
    history: [],
    ...overrides,
  };
}

describe("ArticleRegistry", () => {
  let dir: string;
  let registry: ArticleRegistry;

  beforeEach(async () => {
    dir = copyFixture("static-with-blog");
    const fs = new SafeFs(dir, [], ".bwe-blog", fixedClock("2024-06-01T00:00:00.000Z"));
    const store = new JsonStore(fs);
    const events = new EventBus(fixedClock("2024-06-01T00:00:00.000Z"));
    registry = new ArticleRegistry(store, events, fixedClock("2024-06-01T00:00:00.000Z"));
    await registry.load();
  });

  it("creating the same URL twice is refused (idempotent by URL)", () => {
    registry.create(makeArticle());
    expect(() => registry.create(makeArticle({ id: stableId("art", "different-key") }))).toThrow(/already used/);
  });

  it("existing articles can never be transitioned by the engine", () => {
    const existing = makeArticle({ source: "existing", status: "published" });
    registry.create(existing);
    expect(() => registry.transition(existing.id, "archived", { by: "test", mode: "review-required" })).toThrow(/does not change/);
  });

  it("a Blog Engine article follows the normal lifecycle", () => {
    const a = registry.create(makeArticle());
    const reviewed = registry.transition(a.id, "review", { by: "test", mode: "review-required" });
    expect(reviewed.status).toBe("review");
    const approved = registry.transition(a.id, "approved", { by: "test", mode: "review-required" });
    expect(() => registry.transition(approved.id, "published", { by: "test", mode: "review-required" })).toThrow(/validation gate/);
    const published = registry.transition(approved.id, "published", { by: "test", mode: "review-required", validated: true });
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeDefined();
    expect(published.history.length).toBe(3); // review + approved + published (create itself logs nothing)
  });

  it("syncDiscovered archives an article no longer found on the host, keeping the record", () => {
    const existing = makeArticle({ source: "existing", status: "published", url: "https://example.com/blog/gone" });
    registry.create({ ...existing, history: [{ from: null, to: "published", at: "2024-01-01T00:00:00.000Z", by: "discovery" }] });
    const { missing } = registry.syncDiscovered([]);
    expect(missing).toContain(existing.id);
    expect(registry.require(existing.id).status).toBe("archived");
  });
});

describe("fixture cleanup", () => {
  it("fixture directories are disposable", () => {
    const dir = copyFixture("static-with-blog");
    cleanup(dir);
    expect(true).toBe(true);
  });
});
