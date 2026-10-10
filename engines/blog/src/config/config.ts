import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { EngineError } from "../core/errors.js";

/**
 * Engine configuration. Everything site-specific comes from here or from discovery; nothing is hard-coded.
 * Only `siteUrl` is required when it cannot be discovered (e.g. from an existing sitemap or canonical tag).
 */
export interface BlogEngineConfig {
  /** Canonical production origin, e.g. "https://www.example.com". */
  siteUrl: string;
  /** Site name for schema publisher and titles. Discovered from og:site_name or the home <title> when omitted. */
  siteName?: string;
  /** Root of the host website checkout (file-system adapters). Defaults to the config file's directory. */
  siteRoot: string;
  /** Where the engine keeps its own state (registry, drafts, backups, reports). Relative to siteRoot. */
  dataDir: string;

  blogPath: string;
  maxRecommendations: number;
  approvalRequired: boolean;
  preserveExistingContent: boolean;
  enableInternalLinking: boolean;
  enableSchema: boolean;
  enableBlogIndex: boolean;
  blogIndexPath: string;
  /** "public" writes the index into the site's public output; "internal" keeps it only in dataDir. */
  blogIndexVisibility: "public" | "internal";

  bweSeoIntegration: {
    enabled: boolean;
    discoveryPath: string;
    /** BWESEO's page registry inside the host project (BWESEO convention: seo/content-inventory.json). */
    inventoryPath: string;
    /** Write blog entries into the BWESEO inventory. Off by default: the adapter only reports what it would change. */
    syncInventory: boolean;
  };

  host: {
    /** "auto" detects; or force a file-system adapter flavour, or "http" to crawl a running site. */
    adapter: "auto" | "static-html" | "markdown" | "http";
    /** Directory that holds built/served HTML (e.g. dist, out, public, _site). Discovered when omitted. */
    outputDir?: string;
    /** Directory of existing Markdown/MDX articles. Discovered when omitted. */
    contentDir?: string;
    /** For the http adapter: maximum pages to crawl. */
    maxPages: number;
    /** URL path prefixes never treated as content (admin, cart, account...). */
    excludePaths: string[];
    /** Hosts that are staging/preview and must never appear in published links. */
    stagingHosts: string[];
  };

  storage: {
    /** "auto" writes Markdown when the site keeps articles as Markdown, otherwise rendered HTML pages. */
    format: "auto" | "markdown" | "html";
    /** Override the directory new articles are written to (relative to siteRoot). */
    articlesDir?: string;
    /** HTML file layout for static sites: "/blog/slug/index.html" or "/blog/slug.html". Discovered when omitted. */
    htmlLayout?: "directory" | "file";
    /** Page used as the visual template for generated pages (static HTML sites). Discovered when omitted. */
    templatePage?: string;
    /** Directory served as-is at the site root (public/, static/, or the HTML root). Discovered when omitted. */
    publicDir?: string;
  };

  sitemap: {
    enabled: boolean;
    /** "auto" adapts to the site: separate blog sitemap + index entry when the site has an index, etc. */
    mode: "auto" | "single" | "split";
    blogSitemapPath: string;
  };

  linking: {
    thresholds: { excellent: number; strong: number; optional: number };
    /** Minimum score applied automatically. Suggestions between `optional` and this stay suggestions. */
    autoApplyMin: number;
    maxLinksPerArticle: number;
    maxLinksPerTarget: number;
    /** Allow the engine to add blog links into existing informational site pages (never protected page types). */
    allowSiteToBlogEdits: boolean;
  };

  generation: {
    provider: AIProviderConfig;
    /** Optional second provider used only to propose additional recommendation ideas. Off by default. */
    useProviderForIdeas: boolean;
    /** Drafts from the offline deterministic provider are scaffolds; they are blocked from publication unless this is true (tests/demos). */
    publishDeterministicDrafts: boolean;
    language: string;
    /** Disclaimers for YMYL topics; matched by keyword. */
    ymylDisclaimer: string;
  };

  authors: {
    default?: string;
    /** Schema.org type for the default author. */
    defaultType: "Person" | "Organization";
  };

  schema: {
    articleType: "BlogPosting" | "Article";
    publisherLogo?: string;
    breadcrumbs: boolean;
  };

  categories: {
    /** Minimum published articles before a category page is created. */
    minArticlesForPage: number;
  };

  refresh: {
    reviewIntervalDays: number;
  };

  admin: {
    port: number;
    host: string;
    /** Name of the environment variable holding the admin token. The token itself never lives in config. */
    tokenEnv: string;
  };
}

export interface AIProviderConfig {
  /** "deterministic" is offline and test-safe; "anthropic", "openai" and "openai-compatible" call real APIs. */
  id: "deterministic" | "anthropic" | "openai" | "openai-compatible";
  model?: string;
  /** Name of the environment variable that holds the API key. Never the key itself. */
  apiKeyEnv?: string;
  /** Base URL for openai-compatible (local) providers. */
  baseUrl?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export const DEFAULT_CONFIG: Omit<BlogEngineConfig, "siteUrl" | "siteRoot"> = {
  dataDir: ".bwe-blog",
  blogPath: "/blog",
  maxRecommendations: 50,
  approvalRequired: true,
  preserveExistingContent: true,
  enableInternalLinking: true,
  enableSchema: true,
  enableBlogIndex: true,
  blogIndexPath: "/blog-seo-index.json",
  blogIndexVisibility: "public",
  bweSeoIntegration: {
    enabled: true,
    discoveryPath: "/.well-known/bwe-blog.json",
    inventoryPath: "seo/content-inventory.json",
    syncInventory: false,
  },
  host: {
    adapter: "auto",
    maxPages: 500,
    excludePaths: ["/admin", "/wp-admin", "/cart", "/checkout", "/account", "/login", "/search", "/api/"],
    stagingHosts: [],
  },
  storage: { format: "auto" },
  sitemap: { enabled: true, mode: "auto", blogSitemapPath: "/blog-sitemap.xml" },
  linking: {
    thresholds: { excellent: 90, strong: 75, optional: 60 },
    autoApplyMin: 75,
    maxLinksPerArticle: 8,
    maxLinksPerTarget: 1,
    allowSiteToBlogEdits: false,
  },
  generation: {
    provider: { id: "deterministic" },
    useProviderForIdeas: false,
    publishDeterministicDrafts: false,
    language: "en",
    ymylDisclaimer:
      "This article is general information, not professional advice. Rules, prices and figures change; check current details with a qualified professional or the official source before acting.",
  },
  authors: { defaultType: "Organization" },
  schema: { articleType: "BlogPosting", breadcrumbs: true },
  categories: { minArticlesForPage: 3 },
  refresh: { reviewIntervalDays: 365 },
  admin: { port: 4777, host: "127.0.0.1", tokenEnv: "BWE_BLOG_ADMIN_TOKEN" },
};

export type BlogEngineConfigInput = Partial<Omit<BlogEngineConfig, "bweSeoIntegration" | "host" | "storage" | "sitemap" | "linking" | "generation" | "authors" | "schema" | "categories" | "refresh" | "admin">> & {
  bweSeoIntegration?: Partial<BlogEngineConfig["bweSeoIntegration"]>;
  host?: Partial<BlogEngineConfig["host"]>;
  storage?: Partial<BlogEngineConfig["storage"]>;
  sitemap?: Partial<BlogEngineConfig["sitemap"]>;
  linking?: Partial<Omit<BlogEngineConfig["linking"], "thresholds">> & { thresholds?: Partial<BlogEngineConfig["linking"]["thresholds"]> };
  generation?: Partial<Omit<BlogEngineConfig["generation"], "provider">> & { provider?: Partial<AIProviderConfig> };
  authors?: Partial<BlogEngineConfig["authors"]>;
  schema?: Partial<BlogEngineConfig["schema"]>;
  categories?: Partial<BlogEngineConfig["categories"]>;
  refresh?: Partial<BlogEngineConfig["refresh"]>;
  admin?: Partial<BlogEngineConfig["admin"]>;
};

export const CONFIG_FILE_NAMES = ["bwe-blog.config.json", "bwe-blog.config.yaml", "bwe-blog.config.yml"];

/** Merge input over defaults and validate. Throws EngineError("CONFIG_INVALID") with every problem listed. */
export function resolveConfig(input: BlogEngineConfigInput, opts: { siteRoot?: string } = {}): BlogEngineConfig {
  const d = DEFAULT_CONFIG;
  const cfg: BlogEngineConfig = {
    ...d,
    ...stripUndefined(input),
    siteUrl: (input.siteUrl ?? "").replace(/\/+$/, ""),
    siteRoot: path.resolve(input.siteRoot ?? opts.siteRoot ?? process.cwd()),
    bweSeoIntegration: { ...d.bweSeoIntegration, ...stripUndefined(input.bweSeoIntegration ?? {}) },
    host: { ...d.host, ...stripUndefined(input.host ?? {}) },
    storage: { ...d.storage, ...stripUndefined(input.storage ?? {}) },
    sitemap: { ...d.sitemap, ...stripUndefined(input.sitemap ?? {}) },
    linking: {
      ...d.linking,
      ...stripUndefined(input.linking ?? {}),
      thresholds: { ...d.linking.thresholds, ...stripUndefined(input.linking?.thresholds ?? {}) },
    },
    generation: {
      ...d.generation,
      ...stripUndefined(input.generation ?? {}),
      provider: { ...d.generation.provider, ...stripUndefined(input.generation?.provider ?? {}) } as AIProviderConfig,
    },
    authors: { ...d.authors, ...stripUndefined(input.authors ?? {}) },
    schema: { ...d.schema, ...stripUndefined(input.schema ?? {}) },
    categories: { ...d.categories, ...stripUndefined(input.categories ?? {}) },
    refresh: { ...d.refresh, ...stripUndefined(input.refresh ?? {}) },
    admin: { ...d.admin, ...stripUndefined(input.admin ?? {}) },
  };
  cfg.blogPath = normalizeRoutePath(cfg.blogPath);
  const problems = validateConfig(cfg);
  if (problems.length) throw new EngineError("CONFIG_INVALID", `Invalid configuration:\n- ${problems.join("\n- ")}`);
  return cfg;
}

export function validateConfig(cfg: BlogEngineConfig): string[] {
  const p: string[] = [];
  if (cfg.siteUrl) {
    try {
      const u = new URL(cfg.siteUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") p.push("siteUrl must be http(s)");
      if (u.pathname !== "/" && u.pathname !== "") p.push("siteUrl must be an origin without a path");
    } catch {
      p.push(`siteUrl "${cfg.siteUrl}" is not a valid URL`);
    }
  }
  if (!Number.isInteger(cfg.maxRecommendations) || cfg.maxRecommendations < 0 || cfg.maxRecommendations > 50)
    p.push("maxRecommendations must be an integer from 0 to 50");
  for (const k of ["blogIndexPath"] as const) if (!cfg[k].startsWith("/")) p.push(`${k} must start with "/"`);
  if (!cfg.bweSeoIntegration.discoveryPath.startsWith("/")) p.push("bweSeoIntegration.discoveryPath must start with \"/\"");
  if (!cfg.sitemap.blogSitemapPath.startsWith("/")) p.push("sitemap.blogSitemapPath must start with \"/\"");
  if (isUnsafeRelative(cfg.dataDir)) p.push("dataDir must be a relative path inside siteRoot");
  if (cfg.storage.publicDir && isUnsafeRelative(cfg.storage.publicDir)) p.push("storage.publicDir must be a relative path inside siteRoot");
  if (cfg.storage.articlesDir && isUnsafeRelative(cfg.storage.articlesDir)) p.push("storage.articlesDir must be a relative path inside siteRoot");
  if (cfg.host.outputDir && isUnsafeRelative(cfg.host.outputDir)) p.push("host.outputDir must be a relative path inside siteRoot");
  if (cfg.host.contentDir && isUnsafeRelative(cfg.host.contentDir)) p.push("host.contentDir must be a relative path inside siteRoot");
  if (isUnsafeRelative(cfg.bweSeoIntegration.inventoryPath)) p.push("bweSeoIntegration.inventoryPath must be a relative path inside siteRoot");
  const t = cfg.linking.thresholds;
  if (!(t.excellent > t.strong && t.strong > t.optional && t.optional >= 0 && t.excellent <= 100))
    p.push("linking.thresholds must satisfy 100 >= excellent > strong > optional >= 0");
  if (cfg.linking.autoApplyMin < t.optional) p.push("linking.autoApplyMin must be >= linking.thresholds.optional");
  if (cfg.linking.maxLinksPerArticle < 0 || cfg.linking.maxLinksPerArticle > 25) p.push("linking.maxLinksPerArticle must be 0..25");
  const prov = cfg.generation.provider;
  if (!["deterministic", "anthropic", "openai", "openai-compatible"].includes(prov.id)) p.push(`generation.provider.id "${prov.id}" is not supported`);
  if (prov.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(prov.apiKeyEnv))
    p.push("generation.provider.apiKeyEnv must be an environment variable NAME (the key itself never goes in config)");
  if (looksLikeSecret(JSON.stringify(cfg))) p.push("configuration appears to contain a secret value; store secrets in environment variables and reference them by name");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(cfg.admin.tokenEnv)) p.push("admin.tokenEnv must be an environment variable name");
  return p;
}

function isUnsafeRelative(p: string): boolean {
  if (path.isAbsolute(p)) return true;
  const n = path.normalize(p);
  return n === ".." || n.startsWith(`..${path.sep}`) || n.startsWith("../");
}

export function looksLikeSecret(text: string): boolean {
  return /(sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})/.test(text);
}

export function normalizeRoutePath(p: string): string {
  let r = p.trim() || "/blog";
  if (!r.startsWith("/")) r = `/${r}`;
  if (r.length > 1) r = r.replace(/\/+$/, "");
  return r;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Load bwe-blog.config.(json|yaml) from a directory or an explicit file. */
export async function loadConfigFile(target: string): Promise<BlogEngineConfig> {
  let file = target;
  if (!/\.(json|ya?ml)$/.test(target)) {
    const found = CONFIG_FILE_NAMES.map((n) => path.join(target, n)).find((f) => existsSync(f));
    if (!found) {
      return resolveConfig({}, { siteRoot: target });
    }
    file = found;
  }
  const raw = await readFile(file, "utf8");
  let input: BlogEngineConfigInput;
  try {
    input = file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  } catch (e) {
    throw new EngineError("CONFIG_INVALID", `Could not parse ${path.basename(file)}: ${(e as Error).message}`);
  }
  const dir = path.dirname(path.resolve(file));
  return resolveConfig({ ...input, siteRoot: input.siteRoot ? path.resolve(dir, input.siteRoot) : dir });
}
