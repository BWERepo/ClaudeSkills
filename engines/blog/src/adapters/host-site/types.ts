import type { SiteArchitecture } from "../../core/types.js";
import type { Progress } from "../../core/progress.js";
import type { FrontmatterFormat } from "../../core/content/markdown.js";

/** One page as the host serves it (or as its content source describes it). Untrusted input. */
export interface RawPage {
  /** Absolute URL on the canonical site origin. */
  url: string;
  /** Rendered HTML. For Markdown-only sources this is the rendered body wrapped in a minimal document. */
  html: string;
  kind: "html" | "markdown";
  /** Source file relative to the site root, or a CMS/database record reference. */
  sourceFile?: string;
  recordId?: string;
  frontmatter?: Record<string, unknown>;
  frontmatterFormat?: FrontmatterFormat;
  frontmatterErrors?: string[];
  markdownBody?: string;
  lastModified?: string;
  /** HTTP status when crawled. */
  status?: number;
}

export interface UrlCheck {
  url: string;
  status: number | "unknown";
  /** Redirect target, when the host redirects. */
  location?: string;
}

/** The host page used as the visual template for engine-rendered pages (static/HTML hosts). */
export interface HostTemplate {
  sourceFile: string;
  /** Full HTML with two placeholders: <!--BWE:HEAD--> inside <head>, <!--BWE:MAIN--> where page content goes. */
  html: string;
}

/**
 * A host-site adapter tells the engine what the website is and what it contains. Adapters read; they never
 * modify the host. Writing goes through ContentStorage and SafeFs.
 */
export interface HostSiteAdapter {
  readonly name: string;
  detectArchitecture(): Promise<SiteArchitecture>;
  listPages(progress?: Progress): Promise<RawPage[]>;
  /** Resolve an internal URL: 200, 404, or a redirect. "unknown" when the adapter cannot tell. */
  checkUrl(url: string): Promise<UrlCheck>;
  getTemplate?(preferPath?: string): Promise<HostTemplate | undefined>;
  readRobots?(): Promise<string | undefined>;
  /** Forget cached discovery so the next read sees files the engine just wrote. */
  invalidate?(): void;
}
