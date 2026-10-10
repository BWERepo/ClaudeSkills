import path from "node:path";
import { stringifyFrontmatter, type FrontmatterFormat } from "../../core/content/markdown.js";
import type { OwnedFiles } from "../../core/store/owned.js";
import type { BlogArticle, StorageRef } from "../../core/types.js";
import type { SafeFs } from "../../core/util/safe-fs.js";
import { writeOwnedFile, type ContentStorage, type PublishInput } from "./types.js";

export interface MarkdownConventions {
  dir: string;
  extension: ".md" | ".mdx";
  datePrefixedFilenames: boolean;
  format: FrontmatterFormat;
  keys: {
    date: string;
    updated?: string;
    description: string;
    tags?: string;
    category?: string;
    categoryAsList: boolean;
    author?: string;
    image?: string;
    canonical?: string;
  };
}

/** Learn frontmatter conventions from the site's existing posts so new posts look like the old ones. */
export function learnConventions(dir: string, existingKeys: string[], files: string[], framework: string): MarkdownConventions {
  const has = (...k: string[]) => k.find((x) => existingKeys.includes(x));
  const mdx = files.filter((f) => f.endsWith(".mdx")).length > files.length / 2;
  return {
    dir,
    extension: mdx ? ".mdx" : ".md",
    datePrefixedFilenames: framework === "Jekyll" || files.some((f) => /\/\d{4}-\d{2}-\d{2}-[^/]+$/.test(f)),
    format: framework === "Hugo" && !existingKeys.length ? "toml" : "yaml",
    keys: {
      date: has("pubDate", "date", "publishedAt", "published_at", "publishDate") ?? (framework === "Astro" ? "pubDate" : "date"),
      ...(has("updatedDate", "lastmod", "updated", "modified", "updatedAt") ? { updated: has("updatedDate", "lastmod", "updated", "modified", "updatedAt")! } : {}),
      description: has("description", "excerpt", "summary") ?? "description",
      ...(has("tags") || !existingKeys.length ? { tags: "tags" } : {}),
      ...(has("categories", "category") || !existingKeys.length ? { category: has("categories", "category") ?? "category" } : {}),
      categoryAsList: !!has("categories"),
      ...(has("author", "authors") ? { author: has("author", "authors")! } : {}),
      ...(has("image", "heroImage", "cover", "coverImage") ? { image: has("image", "heroImage", "cover", "coverImage")! } : {}),
      ...(has("canonical", "canonicalURL", "canonical_url") ? { canonical: has("canonical", "canonicalURL", "canonical_url")! } : {}),
    },
  };
}

/** Writes published articles as Markdown/MDX files into the host's content collection. */
export class MarkdownStorage implements ContentStorage {
  readonly name = "markdown" as const;
  readonly rendersListings = false;

  constructor(
    private readonly fs: SafeFs,
    private readonly owned: OwnedFiles,
    private readonly conv: MarkdownConventions,
  ) {}

  locate(a: BlogArticle): string {
    if (a.storage?.path && a.storage.adapter === "markdown") return a.storage.path;
    const datePart = this.conv.datePrefixedFilenames ? `${(a.publishedAt ?? new Date().toISOString()).slice(0, 10)}-` : "";
    return path.posix.join(this.conv.dir, `${datePart}${a.slug}${this.conv.extension}`);
  }

  frontmatter(a: BlogArticle): Record<string, unknown> {
    const k = this.conv.keys;
    const fm: Record<string, unknown> = { title: a.title, [k.description]: a.description, [k.date]: (a.publishedAt ?? "").slice(0, 10) || undefined };
    if (k.updated && a.modifiedAt) fm[k.updated] = a.modifiedAt.slice(0, 10);
    if (k.category && a.category) fm[k.category] = k.categoryAsList ? [a.category] : a.category;
    if (k.tags && a.tags.length) fm[k.tags] = a.tags;
    if (k.author && a.author) fm[k.author] = a.author;
    if (k.image && a.image) fm[k.image] = a.image;
    if (k.canonical) fm[k.canonical] = a.canonicalUrl;
    if (this.conv.datePrefixedFilenames || this.locate(a).split("/").pop()!.replace(/\.(md|mdx)$/, "") !== a.slug) fm.slug = a.slug;
    return fm;
  }

  async publish({ article, markdown }: PublishInput): Promise<{ ref: StorageRef; hash: string }> {
    const rel = this.locate(article);
    const doc = stringifyFrontmatter(this.frontmatter(article), markdown, this.conv.format);
    const hash = await writeOwnedFile(this.fs, this.owned, rel, doc, `publish ${article.slug}`);
    return { ref: { adapter: "markdown", path: rel }, hash };
  }

  async unpublish(a: BlogArticle): Promise<void> {
    const rel = this.locate(a);
    if (!this.fs.exists(rel)) return;
    const dest = path.posix.join(this.fs.dataRoot, "archive", rel);
    await this.fs.move(rel, dest, `unpublish ${a.slug}`);
    this.owned.release(rel);
  }
}

