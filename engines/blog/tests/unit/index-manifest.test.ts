import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/config.js";
import { buildBlogSeoIndex, buildDiscoveryFile } from "../../src/core/seo/index-builder.js";
import { validateDiscoveryDocument, validateIndexDocument } from "../../src/core/seo/index-schema.js";
import { SimilarityIndex } from "../../src/core/analyzer/similarity.js";
import type { BlogArticle } from "../../src/core/types.js";

function article(overrides: Partial<BlogArticle> = {}): BlogArticle {
  return {
    id: "art-abc123",
    title: "How to Prevent Cavities",
    slug: "how-to-prevent-cavities",
    url: "https://example.com/blog/how-to-prevent-cavities",
    source: "existing",
    status: "published",
    description: "Practical habits that prevent cavities.",
    primaryTopic: "cavity prevention",
    secondaryTopics: [],
    category: "oral health",
    tags: ["prevention"],
    searchIntent: "informational",
    canonicalUrl: "https://example.com/blog/how-to-prevent-cavities",
    internalLinksIn: [],
    internalLinksOut: [],
    outboundLinks: [],
    relatedArticles: [],
    relatedSitePages: [],
    schemaTypes: ["BlogPosting"],
    indexable: true,
    headings: [],
    wordCount: 650,
    history: [],
    ...overrides,
  };
}

describe("Blog SEO Index manifest generation", () => {
  const config = resolveConfig({ siteUrl: "https://example.com", siteRoot: "/tmp" });
  const sim = new SimilarityIndex([]);

  it("generates a schema-valid public index containing only published articles", () => {
    const idx = buildBlogSeoIndex({ config, articles: [article(), article({ id: "art-draft", status: "draft", url: "https://example.com/blog/draft" })], clusters: [], pages: [], recommendations: [], brokenLinks: [], sim, now: "2024-06-01T00:00:00.000Z", visibility: "public" });
    expect(idx.articles.map((a) => a.id)).toEqual(["art-abc123"]);
    expect(validateIndexDocument(idx)).toEqual([]);
  });

  it("the internal variant includes every status and open opportunities", () => {
    const idx = buildBlogSeoIndex({ config, articles: [article(), article({ id: "art-draft", status: "draft", url: "https://example.com/blog/draft" })], clusters: [], pages: [], recommendations: [], brokenLinks: [], sim, now: "2024-06-01T00:00:00.000Z", visibility: "internal" });
    expect(idx.articles.length).toBe(2);
  });

  it("re-running the build on the same input produces byte-identical output (idempotent)", () => {
    const a = article();
    const i1 = buildBlogSeoIndex({ config, articles: [a], clusters: [], pages: [], recommendations: [], brokenLinks: [], sim, now: "2024-06-01T00:00:00.000Z", visibility: "public" });
    const i2 = buildBlogSeoIndex({ config, articles: [a], clusters: [], pages: [], recommendations: [], brokenLinks: [], sim, now: "2024-06-01T00:00:00.000Z", visibility: "public" });
    expect(JSON.stringify(i1)).toBe(JSON.stringify(i2));
  });

  it("builds a schema-valid discovery document", () => {
    const idx = buildBlogSeoIndex({ config, articles: [article()], clusters: [], pages: [], recommendations: [], brokenLinks: [], sim, now: "2024-06-01T00:00:00.000Z", visibility: "public" });
    const discovery = buildDiscoveryFile(config, idx, "/sitemap.xml", "/blog-sitemap.xml");
    expect(validateDiscoveryDocument(discovery)).toEqual([]);
  });
});
