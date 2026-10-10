import { EngineError } from "../errors.js";
import type { EventBus } from "../events.js";
import { articleMetadataHash } from "../inventory/inventory.js";
import type { ArticleStatus, BlogArticle } from "../types.js";
import { isoNow, type Clock } from "../util/time.js";
import { urlKey } from "../util/url.js";
import { assertTransition, type ApprovalMode } from "../workflow/workflow.js";
import type { JsonStore } from "../store/store.js";

const FILE = "registry.json";

/**
 * The unified article registry: every existing article (source = "existing") and every Blog Engine article
 * (source = "blog-engine"), keyed by a stable id derived from the canonical URL. Idempotent by construction:
 * re-discovering the same URL updates one record, never adds a second.
 */
export class ArticleRegistry {
  private byId = new Map<string, BlogArticle>();
  private loaded = false;

  constructor(
    private readonly store: JsonStore,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async load(): Promise<this> {
    if (this.loaded) return this;
    const list = await this.store.read<BlogArticle[]>(FILE, []);
    this.byId = new Map(list.map((a) => [a.id, a]));
    this.loaded = true;
    return this;
  }

  async save(): Promise<void> {
    await this.store.write(FILE, this.list());
  }

  list(filter?: (a: BlogArticle) => boolean): BlogArticle[] {
    const all = [...this.byId.values()].sort((a, b) => a.url.localeCompare(b.url));
    return filter ? all.filter(filter) : all;
  }

  get(id: string): BlogArticle | undefined {
    return this.byId.get(id);
  }

  require(id: string): BlogArticle {
    const a = this.byId.get(id);
    if (!a) throw new EngineError("NOT_FOUND", `no article ${id}`);
    return a;
  }

  byUrl(url: string): BlogArticle | undefined {
    const k = urlKey(url);
    return this.list().find((a) => urlKey(a.url) === k || urlKey(a.canonicalUrl) === k);
  }

  bySlug(slug: string): BlogArticle[] {
    return this.list((a) => a.slug === slug);
  }

  /**
   * Merge what discovery found on the host. Existing articles are authoritative on the host: their metadata is
   * refreshed from discovery. Blog Engine articles keep their source and workflow state; only observed facts change.
   * Articles previously seen on the host but now missing are kept and marked, never dropped.
   */
  syncDiscovered(found: BlogArticle[]): { discovered: string[]; updated: string[]; missing: string[] } {
    const now = isoNow(this.clock);
    const discovered: string[] = [];
    const updated: string[] = [];
    const seen = new Set<string>();
    for (const f of found) {
      seen.add(f.id);
      const cur = this.byId.get(f.id);
      if (!cur) {
        const rec: BlogArticle = { ...f, lastAnalyzedAt: now, history: [{ from: null, to: f.status, at: now, by: "discovery", note: "found on the website" }] };
        rec.metadataHash = articleMetadataHash(rec);
        this.byId.set(f.id, rec);
        discovered.push(f.id);
        this.events.emit("article.discovered", { url: f.url, source: f.source }, f.id);
        continue;
      }
      const prevContent = cur.contentHash;
      const prevMeta = cur.metadataHash;
      const merged: BlogArticle =
        cur.source === "blog-engine"
          ? {
              ...cur,
              // facts observed on the live/built page
              internalLinksOut: f.internalLinksOut,
              outboundLinks: f.outboundLinks,
              headings: f.headings.length ? f.headings : cur.headings,
              wordCount: f.wordCount || cur.wordCount,
              schemaTypes: f.schemaTypes.length ? f.schemaTypes : cur.schemaTypes,
              ...(f.indexingStatus ? { indexingStatus: f.indexingStatus } : {}),
              lastAnalyzedAt: now,
            }
          : {
              ...cur,
              ...f,
              // engine-managed relationships survive re-discovery
              id: cur.id,
              history: cur.history,
              internalLinksIn: cur.internalLinksIn,
              relatedArticles: cur.relatedArticles,
              relatedSitePages: cur.relatedSitePages,
              ...(cur.clusterId ? { clusterId: cur.clusterId } : {}),
              ...(cur.pillarArticle ? { pillarArticle: cur.pillarArticle } : {}),
              ...(cur.lastReviewedAt ? { lastReviewedAt: cur.lastReviewedAt } : {}),
              ...(cur.orphan !== undefined ? { orphan: cur.orphan } : {}),
              lastAnalyzedAt: now,
            };
      if (cur.source === "existing" && cur.status === "archived" && f.status === "published") {
        merged.history = [...cur.history, { from: "archived", to: "published", at: now, by: "discovery", note: "found on the website again" }];
      }
      merged.metadataHash = articleMetadataHash(merged);
      this.byId.set(f.id, merged);
      if ((cur.source === "existing" && prevContent !== f.contentHash) || prevMeta !== merged.metadataHash) {
        if (prevContent !== f.contentHash) merged.lastModifiedAt = now;
        updated.push(f.id);
        this.events.emit("article.updated", { url: f.url, contentChanged: prevContent !== f.contentHash, metadataChanged: prevMeta !== merged.metadataHash }, f.id);
      }
    }
    const missing: string[] = [];
    for (const a of this.byId.values()) {
      if (seen.has(a.id)) continue;
      const wasOnSite = a.source === "existing" ? a.status === "published" || a.status === "draft" : false;
      if (!wasOnSite) continue;
      a.history = [...a.history, { from: a.status, to: "archived", at: now, by: "discovery", note: "no longer found on the website; record kept" }];
      a.status = "archived";
      a.indexable = false;
      a.metadataHash = articleMetadataHash(a);
      missing.push(a.id);
      this.events.emit("article.deleted", { url: a.url, reason: "not found on the website during discovery" }, a.id);
    }
    return { discovered, updated, missing };
  }

  /** Add a new Blog Engine article. Refuses duplicates by id, URL or slug-under-blog. */
  create(a: BlogArticle): BlogArticle {
    if (this.byId.has(a.id)) throw new EngineError("DUPLICATE", `an article with id ${a.id} already exists`);
    const clash = this.byUrl(a.url);
    if (clash) throw new EngineError("DUPLICATE", `${a.url} is already used by "${clash.title}"`);
    this.byId.set(a.id, a);
    this.events.emit("article.created", { url: a.url, status: a.status }, a.id);
    return a;
  }

  update(id: string, patch: Partial<BlogArticle>): BlogArticle {
    const cur = this.require(id);
    const next: BlogArticle = { ...cur, ...patch, id: cur.id, source: cur.source, history: cur.history };
    next.metadataHash = articleMetadataHash(next);
    this.byId.set(id, next);
    if (next.metadataHash !== cur.metadataHash || next.contentHash !== cur.contentHash) this.events.emit("article.updated", { url: next.url }, id);
    return next;
  }

  transition(id: string, to: ArticleStatus, ctx: { by: string; note?: string; mode: ApprovalMode; validated?: boolean }): BlogArticle {
    const cur = this.require(id);
    if (cur.source === "existing") throw new EngineError("INVALID_TRANSITION", `"${cur.title}" is an existing article; the engine does not change the publication state of content it did not create`);
    assertTransition(cur.status, to, ctx);
    const now = isoNow(this.clock);
    const next: BlogArticle = {
      ...cur,
      status: to,
      history: [...cur.history, { from: cur.status, to, at: now, by: ctx.by, ...(ctx.note ? { note: ctx.note } : {}) }],
    };
    if (to === "published") {
      next.publishedAt ??= now;
      // Modification timestamps are set at generation time and can predate a later publish; a page can
      // never claim it was modified before it was published, so pull them up to the publish date.
      if (next.modifiedAt && next.modifiedAt < next.publishedAt) next.modifiedAt = next.publishedAt;
      if (next.lastModifiedAt && next.lastModifiedAt < next.publishedAt) next.lastModifiedAt = next.publishedAt;
      next.indexable = true;
    }
    if (to !== "published") next.indexable = false;
    next.metadataHash = articleMetadataHash(next);
    this.byId.set(id, next);
    if (to === "published") this.events.emit("article.published", { url: next.url }, id);
    else if (cur.status === "published" && to === "archived") this.events.emit("article.archived", { url: next.url }, id);
    else if (cur.status === "published") this.events.emit("article.unpublished", { url: next.url, status: to }, id);
    else this.events.emit("article.updated", { url: next.url, status: to }, id);
    return next;
  }
}
