import type { BlogArticle, StorageRef } from "../../core/types.js";
import type { OwnedFiles } from "../../core/store/owned.js";
import type { SafeFs } from "../../core/util/safe-fs.js";

export interface PublishInput {
  article: BlogArticle;
  markdown: string;
  /** Full page HTML (for HTML storage) rendered in the host's design. */
  pageHtml: string;
}

/**
 * Where published Blog Engine articles live on the host. Drafts never go here: they stay in the engine's data
 * directory, so nothing unapproved becomes public.
 */
export interface ContentStorage {
  readonly name: "markdown" | "html";
  /** Whether this storage also writes the blog home and category pages (static HTML hosts). */
  readonly rendersListings: boolean;
  locate(article: BlogArticle): string;
  publish(input: PublishInput): Promise<{ ref: StorageRef; hash: string }>;
  /** Take an article off the site: the file moves into the engine's archive (never deleted). */
  unpublish(article: BlogArticle): Promise<void>;
  /** Write any engine-owned page (listing pages). Refuses to replace files the engine did not write. */
  writePage?(routePath: string, html: string): Promise<{ path: string; written: boolean }>;
}

/** Create, or replace a file the engine owns and nobody has edited since. Otherwise refuse. */
export async function writeOwnedFile(fs: SafeFs, owned: OwnedFiles, rel: string, content: string, reason: string): Promise<string> {
  const exists = fs.exists(rel);
  const r = await fs.writeText(rel, content, exists && owned.owns(rel) ? { mode: "replace-owned", expectedHash: owned.hashOf(rel)!, reason } : { mode: "create", reason });
  owned.set(rel, r.hash);
  return r.hash;
}
