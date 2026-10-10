import { restrictInternalLinks, type GenerationContext } from "../generator/generator.js";
import { generateArticle } from "../generator/generator.js";
import { applyLinksToMarkdown, planLinks } from "../linking/linker.js";
import { approvalModeOf } from "../workflow/workflow.js";
import { runValidationGate, type GateContext } from "../validation/gate.js";
import type { BlogArticle, LinkSuggestion, Recommendation, ValidationResult } from "../types.js";
import { EngineError } from "../errors.js";
import { isoNow } from "../util/time.js";
import { urlKey } from "../util/url.js";
import { renderMarkdown } from "../content/markdown.js";
import { renderArticlePage } from "../render/render.js";
import type { EngineContext } from "./context.js";
import { linkCheckContext, loadWorld, renderContext, resolveStorage, type World } from "./site.js";
import { rebuildIndex } from "./rebuild.js";

export interface SelectResult {
  selected: string[];
  alreadySelected: string[];
}

/** Human selects recommendations to create. Max 50 per the config; selecting more is refused, never truncated silently. */
export async function selectRecommendations(ctx: EngineContext, ids: string[], by: string): Promise<SelectResult> {
  const recs = await ctx.readRecommendations();
  const byId = new Map(recs.map((r) => [r.id, r]));
  const alreadySelected = recs.filter((r) => r.status === "selected").map((r) => r.id);
  const toSelect = ids.filter((id) => !alreadySelected.includes(id));
  if (alreadySelected.length + toSelect.length > ctx.config.maxRecommendations) {
    throw new EngineError("LIMIT_EXCEEDED", `selecting these would exceed the configured limit of ${ctx.config.maxRecommendations} recommendations`);
  }
  const now = isoNow(ctx.clock);
  const selected: string[] = [];
  for (const id of toSelect) {
    const r = byId.get(id);
    if (!r) throw new EngineError("NOT_FOUND", `no recommendation ${id}`);
    if (r.status !== "recommended") throw new EngineError("INVALID_TRANSITION", `"${r.title}" is ${r.status}, not recommended`);
    r.status = "selected";
    r.updatedAt = now;
    r.editedBy = by;
    selected.push(id);
  }
  await ctx.writeRecommendations(recs);
  return { selected, alreadySelected };
}

export async function rejectRecommendations(ctx: EngineContext, ids: string[], by: string, note?: string): Promise<string[]> {
  const recs = await ctx.readRecommendations();
  const now = isoNow(ctx.clock);
  const rejected: string[] = [];
  for (const r of recs) {
    if (!ids.includes(r.id)) continue;
    if (r.status === "created") throw new EngineError("INVALID_TRANSITION", `"${r.title}" already has an article; reject or archive the article instead`);
    r.status = "rejected";
    r.updatedAt = now;
    r.editedBy = by;
    if (note) r.notes = note;
    rejected.push(r.id);
  }
  await ctx.writeRecommendations(recs);
  return rejected;
}

/** Free-text edits to a recommendation before generation (title, topic, category, tags, notes). */
export async function editRecommendation(ctx: EngineContext, id: string, patch: Partial<Pick<Recommendation, "title" | "primaryTopic" | "suggestedCategory" | "suggestedTags" | "notes">>, by: string): Promise<Recommendation> {
  const recs = await ctx.readRecommendations();
  const r = recs.find((x) => x.id === id);
  if (!r) throw new EngineError("NOT_FOUND", `no recommendation ${id}`);
  Object.assign(r, patch, { updatedAt: isoNow(ctx.clock), editedBy: by });
  await ctx.writeRecommendations(recs);
  return r;
}

export interface GenerateReport {
  recommendationId: string;
  articleId: string;
  title: string;
  url: string;
  status: BlogArticle["status"];
  issues: ValidationResult["issues"];
  linksApplied: number;
}

export interface BuildReport {
  generated: GenerateReport[];
  failed: { recommendationId: string; title: string; error: string }[];
  linksNewBlogToBlog: number;
  linksNewBlogToSite: number;
  linksNewSiteToBlog: number;
  orphans: string[];
  broken: number;
  published: number;
  awaitingReview: number;
}

/**
 * Phase 2: generate only the selected recommendations, link them in, and move each as far as the approval
 * mode allows. Mode A (review-required) stops at "draft"/"review"; Mode B runs the gate and publishes.
 * Always finishes by rebuilding the index, sitemap and discovery file so everything stays consistent.
 */
export async function generateSelected(ctx: EngineContext, recommendationIds: string[], by: string): Promise<BuildReport> {
  const { config } = ctx;
  const pr = ctx.progress("generate");
  const mode = approvalModeOf(config.approvalRequired);
  const recs = await ctx.readRecommendations();
  const targets = recs.filter((r) => recommendationIds.includes(r.id));
  const missing = recommendationIds.filter((id) => !targets.some((r) => r.id === id));
  if (missing.length) throw new EngineError("NOT_FOUND", `no recommendation(s): ${missing.join(", ")}`);
  for (const r of targets) if (r.status !== "selected") throw new EngineError("INVALID_TRANSITION", `"${r.title}" must be selected before it can be generated (it is ${r.status})`);

  let world = await loadWorld(ctx);
  const generated: GenerateReport[] = [];
  const failed: BuildReport["failed"] = [];

  pr.start("generate", `Generating ${targets.length} article(s)`);
  for (const rec of targets) {
    try {
      rec.status = "selected"; // stays selected until the article exists; registry.create below advances it
      const genCtx: GenerationContext = { config, profile: world.profile, pages: world.pages, articles: world.articles, provider: ctx.provider, clock: ctx.clock };
      const result = await generateArticle(rec, genCtx);
      const article = ctx.registry.create({ ...result.article, status: "generating" });
      await ctx.writeDraft(article.id, result.markdown);
      rec.status = "created";
      rec.updatedAt = isoNow(ctx.clock);

      // Stays "generating" (not yet "draft") until the gate below decides where it lands: straight to
      // "published" in Mode B, or "review" in Mode A. Both are valid edges directly from "generating".
      world = { ...world, articles: ctx.registry.list() };
      generated.push({ recommendationId: rec.id, articleId: article.id, title: article.title, url: article.url, status: article.status, issues: result.issues, linksApplied: 0 });
      pr.tick("generate", `Generated "${article.title}"`, generated.length, targets.length);
    } catch (e) {
      failed.push({ recommendationId: rec.id, title: rec.title, error: (e as Error).message });
      pr.warn("generate", `"${rec.title}": ${(e as Error).message}`);
    }
  }
  await ctx.writeRecommendations(recs);
  pr.done("generate", `${generated.length} generated, ${failed.length} failed`);

  // Link the newly generated drafts into the graph (blog<->blog, blog<->site) before the gate runs.
  pr.start("link", "Planning internal links for the new articles");
  world = await loadWorld(ctx);
  const editable = new Set(generated.map((g) => g.articleId));
  const suggestions = planLinks({ config, sim: world.sim, pages: world.pages, articles: world.articles, editable, content: world.text });
  let blogToBlog = 0;
  let blogToSite = 0;
  let siteToBlog = 0;
  for (const g of generated) {
    const md = (await ctx.readDraft(g.articleId)) ?? "";
    const mine = suggestions.filter((s) => urlKey(s.fromUrl) === urlKey(world.articles.find((a) => a.id === g.articleId)!.url) && s.status === "suggested");
    const { markdown, applied } = applyLinksToMarkdown(md, mine);
    if (applied.length) await ctx.writeDraft(g.articleId, markdown);
    g.linksApplied = applied.length;
    for (const a of applied) {
      if (a.direction === "blog-to-blog") blogToBlog++;
      else if (a.direction === "blog-to-site") blogToSite++;
      else siteToBlog++;
    }
  }
  await persistLinkState(ctx, suggestions);
  pr.done("link", `${blogToBlog + blogToSite} link(s) added from new articles`);

  // Move each article as far as the approval mode allows.
  pr.start("review", "Running the validation gate");
  world = await loadWorld(ctx);
  const storageInfo = await resolveStorage(ctx, world.analysis, world.articles, world.pages);
  const render = await renderContext(ctx, world);
  const linkCtx = linkCheckContext(ctx, world.pages, world.articles);
  for (const g of generated) {
    const article = ctx.registry.require(g.articleId);
    const markdown = (await ctx.readDraft(g.articleId)) ?? "";
    const gateCtx: GateContext = { config, siteName: world.siteName, blogTitle: world.blogTitle, articles: world.articles, pages: world.pages, sim: world.sim, markdown, linkCheck: linkCtx, now: isoNow(ctx.clock) };
    const result = await runValidationGate(article, gateCtx);
    ctx.registry.update(article.id, { validation: result });
    g.issues = result.issues;
    if (mode === "approved-selection-publishes" && result.passed) {
      const html = renderMarkdown(markdown);
      const published = ctx.registry.transition(article.id, "published", { by, mode, validated: true, note: "auto-approved (Mode B)" });
      const pageHtml = renderArticlePage(published, html, render, { related: [] });
      const { ref, hash } = await storageInfo.storage.publish({ article: published, markdown, pageHtml });
      ctx.registry.update(article.id, { storage: ref, writtenHash: hash });
      g.status = "published";
    } else {
      ctx.registry.transition(article.id, "draft", { by: "system", mode, note: "generated; awaiting human review" });
      g.status = "draft";
    }
  }
  pr.done("review");
  await ctx.flush();

  const rebuild = await rebuildIndex(ctx, { regenerateContent: false });
  const published = generated.filter((g) => g.status === "published").length;
  return {
    generated,
    failed,
    linksNewBlogToBlog: blogToBlog,
    linksNewBlogToSite: blogToSite,
    linksNewSiteToBlog: siteToBlog,
    orphans: rebuild.orphans,
    broken: rebuild.brokenLinks,
    published,
    awaitingReview: generated.length - published,
  };
}

async function persistLinkState(ctx: EngineContext, suggestions: LinkSuggestion[]): Promise<void> {
  const cur = await ctx.readLinks();
  const byId = new Map(cur.suggestions.map((s) => [s.id, s]));
  for (const s of suggestions) byId.set(s.id, s);
  await ctx.writeLinks({ ...cur, suggestions: [...byId.values()] });
}

/** Approve a drafted/reviewed article (Mode A). Does not publish by itself. */
export async function approveArticle(ctx: EngineContext, id: string, by: string): Promise<BlogArticle> {
  const mode = approvalModeOf(ctx.config.approvalRequired);
  const a = ctx.registry.transition(id, "approved", { by, mode });
  await ctx.flush();
  return a;
}

export async function requestChanges(ctx: EngineContext, id: string, by: string, note: string): Promise<BlogArticle> {
  const mode = approvalModeOf(ctx.config.approvalRequired);
  const a = ctx.registry.transition(id, "draft", { by, mode, note });
  await ctx.flush();
  return a;
}

/** Edit a draft's Markdown (the human review step). Re-runs quality checks but does not transition status. */
export async function saveDraft(ctx: EngineContext, id: string, markdown: string): Promise<void> {
  const article = ctx.registry.require(id);
  if (article.source !== "blog-engine") throw new EngineError("INVALID_TRANSITION", "only Blog Engine articles have an editable draft");
  await ctx.writeDraft(id, markdown);
  ctx.registry.update(id, { contentHash: undefined, lastModifiedAt: isoNow(ctx.clock) });
  await ctx.flush();
}

/** Regenerate a rejected/errored article from its original recommendation. */
export async function regenerateArticle(ctx: EngineContext, id: string, by: string): Promise<GenerateReport> {
  const article = ctx.registry.require(id);
  if (!article.recommendationId) throw new EngineError("BAD_INPUT", "this article has no recommendation to regenerate from");
  const recs = await ctx.readRecommendations();
  const rec = recs.find((r) => r.id === article.recommendationId);
  if (!rec) throw new EngineError("NOT_FOUND", `no recommendation ${article.recommendationId}`);
  ctx.registry.transition(id, "generating", { by, mode: approvalModeOf(ctx.config.approvalRequired) });
  const world = await loadWorld(ctx);
  const genCtx: GenerationContext = { config: ctx.config, profile: world.profile, pages: world.pages, articles: world.articles, provider: ctx.provider, clock: ctx.clock };
  const result = await generateArticle(rec, genCtx);
  await ctx.writeDraft(id, result.markdown);
  const next = ctx.registry.transition(id, "draft", { by, mode: approvalModeOf(ctx.config.approvalRequired), note: "regenerated" });
  ctx.registry.update(id, { title: result.article.title, description: result.article.description, wordCount: result.article.wordCount, headings: result.article.headings, contentHash: result.article.contentHash, generatedBy: result.article.generatedBy });
  await ctx.flush();
  return { recommendationId: rec.id, articleId: id, title: next.title, url: next.url, status: "draft", issues: result.issues, linksApplied: 0 };
}

/** Publish via the gate (Mode A's explicit step, or re-publishing after edits in either mode). */
export async function publishArticle(ctx: EngineContext, id: string, by: string): Promise<{ article: BlogArticle; validation: ValidationResult }> {
  const article = ctx.registry.require(id);
  if (article.source !== "blog-engine") throw new EngineError("INVALID_TRANSITION", `"${article.title}" is an existing article; the engine does not publish content it did not create`);
  const mode = approvalModeOf(ctx.config.approvalRequired);
  const world = await loadWorld(ctx);
  const markdown = (await ctx.readDraft(id)) ?? "";
  const linkCtx = linkCheckContext(ctx, world.pages, world.articles);
  const validation = await runValidationGate(article, { config: ctx.config, siteName: world.siteName, blogTitle: world.blogTitle, articles: world.articles, pages: world.pages, sim: world.sim, markdown, linkCheck: linkCtx, now: isoNow(ctx.clock) });
  ctx.registry.update(id, { validation });
  if (!validation.passed) throw new EngineError("VALIDATION_FAILED", `cannot publish "${article.title}": ${validation.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ")}`);
  const storageInfo = await resolveStorage(ctx, world.analysis, world.articles, world.pages);
  const render = await renderContext(ctx, world);
  const html = renderMarkdown(markdown);
  const published = ctx.registry.transition(id, "published", { by, mode, validated: true });
  const pageHtml = renderArticlePage(published, html, render, { related: world.articles.filter((a) => published.relatedArticles.includes(a.url)).map((a) => ({ url: a.url, title: a.title })) });
  const { ref, hash } = await storageInfo.storage.publish({ article: published, markdown, pageHtml });
  ctx.registry.update(id, { storage: ref, writtenHash: hash });
  await ctx.flush();
  await rebuildIndex(ctx, { regenerateContent: false });
  return { article: ctx.registry.require(id), validation };
}

export async function unpublishArticle(ctx: EngineContext, id: string, by: string, to: "draft" | "review" = "draft"): Promise<BlogArticle> {
  const article = ctx.registry.require(id);
  if (article.source !== "blog-engine") throw new EngineError("INVALID_TRANSITION", `"${article.title}" is an existing article; the engine never changes its publication state`);
  const mode = approvalModeOf(ctx.config.approvalRequired);
  const world = await loadWorld(ctx);
  const storageInfo = await resolveStorage(ctx, world.analysis, world.articles, world.pages);
  await storageInfo.storage.unpublish(article);
  const next = ctx.registry.transition(id, to, { by, mode });
  await ctx.flush();
  await rebuildIndex(ctx, { regenerateContent: false });
  return next;
}

export async function archiveArticle(ctx: EngineContext, id: string, by: string): Promise<BlogArticle> {
  const article = ctx.registry.require(id);
  const mode = approvalModeOf(ctx.config.approvalRequired);
  if (article.status === "published") {
    const world = await loadWorld(ctx);
    const storageInfo = await resolveStorage(ctx, world.analysis, world.articles, world.pages);
    await storageInfo.storage.unpublish(article);
  }
  const next = ctx.registry.transition(id, "archived", { by, mode });
  await ctx.flush();
  await rebuildIndex(ctx, { regenerateContent: false });
  return next;
}

export { restrictInternalLinks };
