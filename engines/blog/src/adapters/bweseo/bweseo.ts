import type { BlogSeoIndex, IndexArticle } from "../../core/seo/index-builder.js";
import { slugify } from "../../core/util/slug.js";
import { sha256 } from "../../core/util/hash.js";

/**
 * Isolated adapter between the Blog SEO Index and the BWE SEO Engine (BWESEO).
 *
 * BWESEO (inspected at engine 1.10.0) keeps each website's page registry in `seo/content-inventory.json`
 * (schemaVersion 1): pages[] with kebab-case `id`, path `url`, a fixed `type` enum, `topic`, `status`,
 * `indexable`, and optional relationship fields (`relatedPages`, `linksFrom`, `canonicalUrl`, `publishedOn`,
 * `lastModifiedOn`, `source`, `parent`). It has no blog/article page type and no blog index reader, so instead of
 * a second standard this adapter writes blog articles INTO that registry, using its own fields, as type "resource".
 * Blog-specific facts ride in a `blogEngine` extension object, which BWESEO's validator ignores.
 *
 * Ownership rules: the adapter only edits entries it created (`blogEngine.managed === true`). An entry BWESEO
 * already had for the same URL keeps every one of its fields; only its `blogEngine` block is refreshed.
 * Nothing is ever deleted. Pages BWESEO is driving through its own workflow are never re-statused.
 */

export const BWESEO_INVENTORY_SCHEMA_VERSION = 1;
export const BWESEO_COMPAT_ENGINE = "1.10.0";

// Mirrors BWESEO 1.10.0 src/validate-seo-data.mjs (PAGE_TYPES, PAGE_STATUSES, INTENTS).
const PAGE_TYPES = ["home", "pillar", "service", "location", "industry", "pricing", "comparison", "resource", "case-study", "portfolio", "about", "contact", "legal", "utility"];
const PAGE_STATUSES = ["idea", "planned", "approved", "draft", "review", "published", "update-needed", "rejected"];
const INTENTS = ["high-commercial", "service", "local", "comparison", "problem-solution", "informational", "navigational", "legal"];
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BwseoPage {
  id: string;
  url: string;
  type: string;
  topic: string;
  status: string;
  indexable: boolean;
  title?: string;
  primaryIntent?: string | null;
  parent?: string | null;
  relatedPages?: string[];
  linksFrom?: string[];
  canonicalUrl?: string;
  publishedOn?: string | null;
  lastModifiedOn?: string | null;
  created?: string | null;
  source?: string;
  notes?: string;
  blogEngine?: BlogEngineExtension;
  [k: string]: unknown;
}

export interface BlogEngineExtension {
  managed: boolean;
  articleId: string;
  source: "existing" | "blog-engine";
  status: string;
  category?: string;
  tags?: string[];
  clusterId?: string;
  pillarArticle?: string;
  orphan: boolean;
  linkCount: { in: number; out: number };
  wordCount: number;
  contentHash?: string;
  metadataHash?: string;
  refreshRecommended: boolean;
  indexedAt: string;
  indexSchemaVersion: string;
}

export interface BwseoInventory {
  $schema?: string;
  schemaVersion: number;
  projectId: string;
  updated?: string;
  pages: BwseoPage[];
  [k: string]: unknown;
}

const INTENT_MAP: Record<string, string | null> = {
  informational: "informational",
  commercial: "comparison",
  transactional: "high-commercial",
  navigational: "navigational",
  mixed: "informational",
};

/** BWESEO's build statuses need a full page plan (cta, parent, cannibalization); in-progress blog work maps to "planned". */
function statusFor(a: IndexArticle): string | undefined {
  switch (a.status) {
    case "published":
      return "published";
    case "rejected":
      return "rejected";
    case "archived":
    case "recommended":
      return undefined;
    default:
      return "planned";
  }
}

const day = (iso?: string) => (iso && DATE_RE.test(iso.slice(0, 10)) ? iso.slice(0, 10) : null);
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

export function toBwseoPage(a: IndexArticle, index: BlogSeoIndex, takenIds: Set<string>): BwseoPage | undefined {
  const status = statusFor(a);
  if (!status) return undefined;
  let id = `blog-${slugify(a.slug || a.title, { maxLength: 60 })}`;
  if (!ID_RE.test(id)) id = `blog-${sha256(a.url).slice(0, 10)}`;
  if (takenIds.has(id)) id = `${id}-${sha256(a.url).slice(0, 6)}`;
  takenIds.add(id);
  const related = [...new Set([...a.relatedSitePages, ...a.relatedArticles].map(pathOf))];
  return {
    id,
    url: pathOf(a.url),
    type: "resource",
    title: a.title,
    topic: a.primaryTopic || a.title,
    primaryIntent: INTENT_MAP[a.searchIntent] ?? null,
    status,
    indexable: a.indexable,
    parent: index.blogRoot.replace(/\/$/, "") || "/",
    relatedPages: related,
    linksFrom: [...new Set(a.internalLinksIn.map(pathOf))],
    canonicalUrl: a.canonicalUrl,
    publishedOn: day(a.publishedAt),
    lastModifiedOn: day(a.modifiedAt),
    created: day(a.publishedAt),
    notes: `Blog article managed by the BWE Blog Engine (${a.source === "existing" ? "pre-existing article" : "created by the Blog Engine"}).`,
    blogEngine: extensionFor(a, index),
  };
}

function extensionFor(a: IndexArticle, index: BlogSeoIndex): BlogEngineExtension {
  return {
    managed: true,
    articleId: a.id,
    source: a.source,
    status: a.status,
    ...(a.category ? { category: a.category } : {}),
    ...(a.tags.length ? { tags: a.tags } : {}),
    ...(a.clusterId ? { clusterId: a.clusterId } : {}),
    ...(a.pillarArticle ? { pillarArticle: pathOf(a.pillarArticle) } : {}),
    orphan: a.orphan,
    linkCount: a.linkCount,
    wordCount: a.wordCount,
    ...(a.contentHash ? { contentHash: a.contentHash } : {}),
    ...(a.metadataHash ? { metadataHash: a.metadataHash } : {}),
    refreshRecommended: a.refreshRecommended,
    indexedAt: index.generatedAt,
    indexSchemaVersion: index.schemaVersion,
  };
}

export interface MergeResult {
  inventory: BwseoInventory;
  added: string[];
  updated: string[];
  linked: string[];
  retired: string[];
  unchanged: number;
  warnings: string[];
}

const BLOG_OWNED_FIELDS = ["title", "topic", "primaryIntent", "indexable", "relatedPages", "linksFrom", "canonicalUrl", "publishedOn", "lastModifiedOn", "source"] as const;

/** Merge the Blog SEO Index into a BWESEO inventory without disturbing anything BWESEO owns. Pure function. */
export function mergeIntoInventory(existing: BwseoInventory, index: BlogSeoIndex, sourceOf: (a: IndexArticle) => string | undefined): MergeResult {
  const warnings: string[] = [];
  if (existing.schemaVersion !== BWESEO_INVENTORY_SCHEMA_VERSION) {
    throw new Error(`BWESEO inventory schemaVersion ${existing.schemaVersion} is not supported by this adapter (expects ${BWESEO_INVENTORY_SCHEMA_VERSION})`);
  }
  const pages = existing.pages.map((p) => ({ ...p }));
  const byUrl = new Map(pages.map((p, i) => [p.url.replace(/\/+$/, "") || "/", i]));
  const taken = new Set(pages.map((p) => p.id));
  const added: string[] = [];
  const updated: string[] = [];
  const linked: string[] = [];
  const retired: string[] = [];
  let unchanged = 0;
  const seenArticle = new Set<string>();

  for (const a of index.articles) {
    seenArticle.add(a.id);
    const key = pathOf(a.url).replace(/\/+$/, "") || "/";
    const at = byUrl.get(key);
    if (at === undefined) {
      const page = toBwseoPage(a, index, taken);
      if (!page) continue;
      const src = sourceOf(a);
      if (src) page.source = src;
      pages.push(page);
      byUrl.set(key, pages.length - 1);
      added.push(page.id);
      continue;
    }
    const cur = pages[at]!;
    const ext = extensionFor(a, index);
    if (!cur.blogEngine?.managed) {
      // BWESEO already tracks this URL: only attach blog facts.
      if (JSON.stringify(cur.blogEngine) !== JSON.stringify({ ...ext, managed: false })) {
        cur.blogEngine = { ...ext, managed: false };
        linked.push(cur.id);
      } else unchanged++;
      continue;
    }
    const fresh = toBwseoPage(a, index, new Set());
    const before = JSON.stringify(cur);
    if (fresh) {
      for (const f of BLOG_OWNED_FIELDS) {
        const v = f === "source" ? sourceOf(a) ?? cur.source : (fresh as Record<string, unknown>)[f];
        if (v !== undefined) (cur as Record<string, unknown>)[f] = v;
      }
      // Status: only move forward along the blog lifecycle; never override BWESEO's own later stages.
      if (!["published", "update-needed"].includes(cur.status) || fresh.status === "published") cur.status = fresh.status;
    }
    cur.blogEngine = ext;
    if (JSON.stringify(cur) !== before) updated.push(cur.id);
    else unchanged++;
  }

  for (const p of pages) {
    if (p.blogEngine?.managed && !seenArticle.has(p.blogEngine.articleId) && p.blogEngine.status !== "archived") {
      p.blogEngine = { ...p.blogEngine, status: "archived" };
      p.indexable = false;
      retired.push(p.id);
    }
  }

  const inventory: BwseoInventory = { ...existing, pages, updated: index.generatedAt.slice(0, 10) };
  warnings.push(...checkBwseoCompatibility(inventory));
  return { inventory, added, updated, linked, retired, unchanged, warnings };
}

/**
 * The checks BWESEO 1.10.0's validateInventory applies to the fields this adapter writes. Errors here mean
 * BWESEO would reject the inventory, so the adapter refuses to write it.
 */
export function checkBwseoCompatibility(inv: BwseoInventory): string[] {
  const errs: string[] = [];
  if (inv.schemaVersion !== 1) errs.push("schemaVersion must be 1");
  const ids = new Set<string>();
  const urls = new Map<string, string>();
  const titles = new Map<string, string>();
  inv.pages.forEach((p, i) => {
    const at = `pages[${i}] (${p.id})`;
    if (!ID_RE.test(p.id ?? "")) errs.push(`${at}.id must be kebab-case`);
    else if (ids.has(p.id)) errs.push(`${at}: duplicate id`);
    ids.add(p.id);
    if (typeof p.url !== "string" || !p.url.startsWith("/")) errs.push(`${at}.url must start with "/"`);
    if (!PAGE_TYPES.includes(p.type)) errs.push(`${at}.type "${p.type}" is not a BWESEO page type`);
    if (!PAGE_STATUSES.includes(p.status)) errs.push(`${at}.status "${p.status}" is not a BWESEO status`);
    if (typeof p.indexable !== "boolean") errs.push(`${at}.indexable must be boolean`);
    if (typeof p.topic !== "string" || !p.topic.trim()) errs.push(`${at}.topic is required`);
    if (p.primaryIntent != null && !INTENTS.includes(p.primaryIntent)) errs.push(`${at}.primaryIntent is not a BWESEO intent`);
    for (const d of ["publishedOn", "lastModifiedOn", "created"] as const) if (p[d] != null && !DATE_RE.test(String(p[d]))) errs.push(`${at}.${d} must be YYYY-MM-DD`);
    if (p.status !== "rejected" && typeof p.url === "string") {
      if (urls.has(p.url)) errs.push(`${at}: url ${p.url} is also used by ${urls.get(p.url)}`);
      urls.set(p.url, p.id);
    }
    if (p.status === "published" && p.indexable && typeof p.title === "string") {
      const t = p.title.trim().toLowerCase();
      if (titles.has(t)) errs.push(`${at}: title duplicates ${titles.get(t)}`);
      titles.set(t, p.id);
    }
  });
  return errs;
}

/** A fresh inventory for a project that has the Blog Engine but has not set up BWESEO yet. */
export function emptyInventory(projectId: string): BwseoInventory {
  return { schemaVersion: 1, projectId: slugify(projectId), pages: [] };
}
