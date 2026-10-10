import path from "node:path";
import type { OwnedFiles } from "../../core/store/owned.js";
import type { BlogArticle, StorageRef } from "../../core/types.js";
import type { SafeFs } from "../../core/util/safe-fs.js";
import { writeOwnedFile, type ContentStorage, type PublishInput } from "./types.js";

/**
 * Writes published articles as complete HTML pages (in the host's own template) into the served HTML directory.
 * Used for static/plain HTML sites. Also writes the blog home and category pages the engine owns.
 */
export class HtmlStorage implements ContentStorage {
  readonly name = "html" as const;
  readonly rendersListings = true;

  constructor(
    private readonly fs: SafeFs,
    private readonly owned: OwnedFiles,
    private readonly outputDir: string,
    private readonly layout: "directory" | "file",
  ) {}

  private fileFor(routePath: string, forceDirectory = false): string {
    const clean = routePath.replace(/^\/+|\/+$/g, "");
    const rel = this.layout === "file" && !forceDirectory ? `${clean}.html` : path.posix.join(clean, "index.html");
    return this.outputDir === "." ? rel : path.posix.join(this.outputDir, rel);
  }

  locate(a: BlogArticle): string {
    if (a.storage?.adapter === "html" && a.storage.path) return a.storage.path;
    return this.fileFor(new URL(a.url).pathname);
  }

  async publish({ article, pageHtml }: PublishInput): Promise<{ ref: StorageRef; hash: string }> {
    const rel = this.locate(article);
    const hash = await writeOwnedFile(this.fs, this.owned, rel, pageHtml, `publish ${article.slug}`);
    return { ref: { adapter: "html", path: rel }, hash };
  }

  async unpublish(a: BlogArticle): Promise<void> {
    const rel = this.locate(a);
    if (!this.fs.exists(rel)) return;
    await this.fs.move(rel, path.posix.join(this.fs.dataRoot, "archive", rel), `unpublish ${a.slug}`);
    this.owned.release(rel);
  }

  /** Listing pages are always directory-style (/blog/, /blog/page/2/, /blog/category/x/). */
  async writePage(routePath: string, html: string): Promise<{ path: string; written: boolean }> {
    const rel = this.fileFor(routePath, true);
    if (this.fs.exists(rel) && !this.owned.owns(rel)) return { path: rel, written: false };
    await writeOwnedFile(this.fs, this.owned, rel, html, `listing ${routePath}`);
    return { path: rel, written: true };
  }
}
