import type { BlogEngineConfig, BlogEngineConfigInput } from "../../config/config.js";
import { resolveConfig } from "../../config/config.js";
import type { BlogArticle, Recommendation } from "../types.js";
import { EngineContext, type EngineOptions } from "./context.js";
import { runAnalysis, type AnalysisReport } from "./analyze.js";
import {
  approveArticle,
  archiveArticle,
  editRecommendation,
  generateSelected,
  publishArticle,
  regenerateArticle,
  rejectRecommendations,
  requestChanges,
  saveDraft,
  selectRecommendations,
  unpublishArticle,
  type BuildReport,
} from "./build.js";
import { rebuildIndex, type RebuildReport } from "./rebuild.js";
import { buildBlogSeoIndex } from "../seo/index-builder.js";
import { syncBweseo } from "./bweseo-sync.js";
import { buildFullReport, formatFullReport, type FullBuildReport, type TestStatus } from "./report.js";
import { loadWorld } from "./site.js";
import { ENGINE_VERSION } from "../../version.js";
import { conductorStatus, type ConductorStatus } from "../conductor/conductor.js";

const NOT_RUN: TestStatus = { ran: false, summary: "not run as part of this operation" };

/**
 * The public facade: one object the CLI and admin server call into. It owns nothing the modules under
 * `core/engine` don't already own; it only sequences them and keeps the `EngineContext` alive between calls.
 */
export class BlogEngine {
  readonly version = ENGINE_VERSION;
  private ctx: EngineContext;
  private initialized = false;

  constructor(
    readonly config: BlogEngineConfig,
    opts: EngineOptions = {},
  ) {
    this.ctx = new EngineContext(config, opts);
  }

  static async create(input: BlogEngineConfigInput, opts: EngineOptions = {}): Promise<BlogEngine> {
    const engine = new BlogEngine(resolveConfig(input), opts);
    await engine.ready();
    return engine;
  }

  async ready(): Promise<this> {
    if (!this.initialized) {
      await this.ctx.init();
      this.initialized = true;
    }
    return this;
  }

  /** Direct access for callers that need a module this facade doesn't wrap (e.g. tests, the admin server). */
  get context(): EngineContext {
    return this.ctx;
  }

  // ---- Phase 1: analyze -------------------------------------------------------------------------------------
  analyze(): Promise<AnalysisReport> {
    return runAnalysis(this.ctx);
  }

  reanalyze(): Promise<AnalysisReport> {
    this.ctx.host.invalidate?.();
    return runAnalysis(this.ctx, { reanalyze: true });
  }

  recommendations(): Promise<Recommendation[]> {
    return this.ctx.readRecommendations();
  }

  // ---- Selection and generation ------------------------------------------------------------------------------
  select(ids: string[], by = "admin"): ReturnType<typeof selectRecommendations> {
    return selectRecommendations(this.ctx, ids, by);
  }
  reject(ids: string[], by = "admin", note?: string): Promise<string[]> {
    return rejectRecommendations(this.ctx, ids, by, note);
  }
  editRecommendation(id: string, patch: Parameters<typeof editRecommendation>[2], by = "admin"): ReturnType<typeof editRecommendation> {
    return editRecommendation(this.ctx, id, patch, by);
  }

  /** Phase 2: generate only the selected recommendations, link, validate, and (per approval mode) publish. */
  async generate(recommendationIds: string[], by = "admin"): Promise<BuildReport> {
    return generateSelected(this.ctx, recommendationIds, by);
  }

  regenerate(articleId: string, by = "admin"): ReturnType<typeof regenerateArticle> {
    return regenerateArticle(this.ctx, articleId, by);
  }
  saveDraft(articleId: string, markdown: string): Promise<void> {
    return saveDraft(this.ctx, articleId, markdown);
  }
  approve(articleId: string, by = "admin"): Promise<BlogArticle> {
    return approveArticle(this.ctx, articleId, by);
  }
  requestChanges(articleId: string, note: string, by = "admin"): Promise<BlogArticle> {
    return requestChanges(this.ctx, articleId, by, note);
  }
  publish(articleId: string, by = "admin"): ReturnType<typeof publishArticle> {
    return publishArticle(this.ctx, articleId, by);
  }
  unpublish(articleId: string, by = "admin"): Promise<BlogArticle> {
    return unpublishArticle(this.ctx, articleId, by);
  }
  archive(articleId: string, by = "admin"): Promise<BlogArticle> {
    return archiveArticle(this.ctx, articleId, by);
  }

  articles(): BlogArticle[] {
    return this.ctx.registry.list();
  }
  article(id: string): BlogArticle | undefined {
    return this.ctx.registry.get(id);
  }

  // ---- Index / SEO --------------------------------------------------------------------------------------------
  rebuildIndex(): Promise<RebuildReport> {
    return rebuildIndex(this.ctx, { regenerateContent: false });
  }

  async links() {
    return this.ctx.readLinks();
  }

  async clusters() {
    return this.ctx.readClusters();
  }

  /** The full build report covering the whole pipeline, for the CLI/admin "generate" action. */
  async buildAndReport(recommendationIds: string[], by = "admin", testing: Partial<FullBuildReport["testing"]> = {}): Promise<{ report: FullBuildReport; text: string }> {
    const stored = await this.ctx.readAnalysis();
    if (!stored) throw new Error("the website has not been analyzed yet; run Analyze first");
    const recs = await this.ctx.readRecommendations();
    const analysisCounts = { existingArticles: this.ctx.registry.list((a) => a.source === "existing").length, recommendations: recs.filter((r) => r.status === "recommended").length };
    const build = await this.generate(recommendationIds, by);
    const rebuild = await this.rebuildIndex();
    const world = await loadWorld(this.ctx);
    const index = buildBlogSeoIndex({ config: this.config, articles: world.articles, clusters: world.clusters, pages: world.pages, recommendations: world.recommendations, brokenLinks: [], sim: world.sim, now: new Date().toISOString(), visibility: "internal" });
    const bweseoStatus = await syncBweseo(this.ctx, index);
    await this.ctx.patchState({ bweseo: bweseoStatus });
    const report = buildFullReport({
      siteUrl: this.config.siteUrl,
      analysis: analysisCounts,
      build,
      rebuild,
      bweseoStatus,
      testing: { unit: NOT_RUN, integration: NOT_RUN, e2e: NOT_RUN, build: NOT_RUN, regression: NOT_RUN, ...testing },
    });
    return { report, text: formatFullReport(report) };
  }

  async bweseoStatus() {
    const world = await loadWorld(this.ctx);
    const index = buildBlogSeoIndex({ config: this.config, articles: world.articles, clusters: world.clusters, pages: world.pages, recommendations: world.recommendations, brokenLinks: [], sim: world.sim, now: new Date().toISOString(), visibility: "internal" });
    return syncBweseo(this.ctx, index);
  }

  async state() {
    return this.ctx.readState();
  }

  /** What has been done so far and the single next recommended action, derived from existing engine state. */
  conductorStatus(): Promise<ConductorStatus> {
    return conductorStatus(this.ctx);
  }
}
