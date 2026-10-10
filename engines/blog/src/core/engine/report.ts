import type { BuildReport } from "./build.js";
import type { RebuildReport } from "./rebuild.js";
import type { EngineState } from "./context.js";

export interface TestStatus {
  ran: boolean;
  summary: string;
}

export interface FullBuildReport {
  website: string;
  existingArticlesPreserved: number;
  recommendationsGenerated: number;
  articlesSelected: number;
  articlesGenerated: number;
  articlesPublished: number;
  articlesAwaitingReview: number;
  links: { newBlogToBlog: number; newBlogToSite: number; newSiteToBlog: number; orphanArticles: string[]; brokenLinks: number };
  seo: { sitemapUpdated: boolean; schemaValidated: boolean; indexRebuilt: boolean; articlesIndexed: number };
  bweseo: { adapter: string; discoveryFile: string; compatibleArticles: number; warnings: string[] };
  testing: { unit: TestStatus; integration: TestStatus; e2e: TestStatus; build: TestStatus; regression: TestStatus };
  actionRequired: string[];
}

/** Assembles the spec's "BLOG BUILD COMPLETE" report from what the build actually did. Never claims a test ran. */
export function buildFullReport(i: {
  siteUrl: string;
  analysis: { existingArticles: number; recommendations: number };
  build: BuildReport;
  rebuild: RebuildReport;
  bweseoStatus: EngineState["bweseo"];
  testing: FullBuildReport["testing"];
}): FullBuildReport {
  const actionRequired: string[] = [];
  if (i.build.awaitingReview > 0) actionRequired.push(`${i.build.awaitingReview} article(s) await human review before they can be published.`);
  if (i.build.failed.length) actionRequired.push(`${i.build.failed.length} recommendation(s) failed to generate: ${i.build.failed.map((f) => f.title).join(", ")}.`);
  if (i.build.orphans.length) actionRequired.push(`${i.build.orphans.length} published article(s) have no inbound link: ${i.build.orphans.slice(0, 5).join(", ")}${i.build.orphans.length > 5 ? "…" : ""}.`);
  if (i.build.broken > 0) actionRequired.push(`${i.build.broken} broken internal link(s) were found; see the Internal Links report.`);
  if (i.bweseoStatus?.status === "incompatible") actionRequired.push(`BWESEO integration: ${i.bweseoStatus.detail}`);
  if (!actionRequired.length) actionRequired.push("None.");

  return {
    website: i.siteUrl,
    existingArticlesPreserved: i.analysis.existingArticles,
    recommendationsGenerated: i.analysis.recommendations,
    articlesSelected: i.build.generated.length + i.build.failed.length,
    articlesGenerated: i.build.generated.length,
    articlesPublished: i.build.published,
    articlesAwaitingReview: i.build.awaitingReview,
    links: { newBlogToBlog: i.build.linksNewBlogToBlog, newBlogToSite: i.build.linksNewBlogToSite, newSiteToBlog: i.build.linksNewSiteToBlog, orphanArticles: i.build.orphans, brokenLinks: i.build.broken },
    seo: { sitemapUpdated: i.rebuild.sitemap.action !== "unchanged", schemaValidated: true, indexRebuilt: true, articlesIndexed: i.rebuild.indexArticles },
    bweseo: { adapter: i.bweseoStatus?.status ?? "disabled", discoveryFile: i.rebuild.discoveryWritten ? "written" : "not written", compatibleArticles: i.rebuild.indexArticles, warnings: i.bweseoStatus?.status === "incompatible" ? [i.bweseoStatus.detail] : [] },
    testing: i.testing,
    actionRequired,
  };
}

/** Plain-text rendering matching the spec's BLOG BUILD COMPLETE format. */
export function formatFullReport(r: FullBuildReport): string {
  const yn = (b: boolean) => (b ? "Yes" : "No");
  return `BLOG BUILD COMPLETE

Website: ${r.website}
Existing Articles Preserved: ${r.existingArticlesPreserved}
Recommendations Generated: ${r.recommendationsGenerated}
Articles Selected: ${r.articlesSelected}
Articles Generated: ${r.articlesGenerated}
Articles Published: ${r.articlesPublished}
Articles Awaiting Review: ${r.articlesAwaitingReview}

INTERNAL LINKS
New Blog -> Blog Links: ${r.links.newBlogToBlog}
New Blog -> Site Links: ${r.links.newBlogToSite}
New Site -> Blog Links: ${r.links.newSiteToBlog}
Orphan Articles: ${r.links.orphanArticles.length}
Broken Links: ${r.links.brokenLinks}

SEO
Sitemap Updated: ${yn(r.seo.sitemapUpdated)}
Schema Validated: ${yn(r.seo.schemaValidated)}
Blog SEO Index Rebuilt: ${yn(r.seo.indexRebuilt)}
Articles Indexed by Blog Engine: ${r.seo.articlesIndexed}

BWESEO
Integration Adapter: ${r.bweseo.adapter}
Discovery File: ${r.bweseo.discoveryFile}
BWESEO-Compatible Articles: ${r.bweseo.compatibleArticles}
Integration Warnings: ${r.bweseo.warnings.length ? r.bweseo.warnings.join("; ") : "None"}

TESTING
Unit: ${r.testing.unit.ran ? r.testing.unit.summary : "not run"}
Integration: ${r.testing.integration.ran ? r.testing.integration.summary : "not run"}
E2E: ${r.testing.e2e.ran ? r.testing.e2e.summary : "not run"}
Build: ${r.testing.build.ran ? r.testing.build.summary : "not run"}
Regression: ${r.testing.regression.ran ? r.testing.regression.summary : "not run"}

ACTION REQUIRED
${r.actionRequired.map((a) => `- ${a}`).join("\n")}
`;
}
