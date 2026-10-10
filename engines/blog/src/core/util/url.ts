/**
 * URL normalization. One URL has exactly one canonical key in the engine, so the registry, the link graph,
 * the sitemap and the Blog SEO Index never disagree about whether two URLs are the same page.
 */

export interface NormalizedLink {
  /** Absolute URL (or the raw href when malformed). */
  url: string;
  internal: boolean;
  /** Path for internal URLs, e.g. "/blog/post". */
  path?: string;
  kind: "page" | "anchor" | "mailto" | "tel" | "javascript" | "data" | "other-scheme" | "malformed";
  problems: string[];
}

const DEFAULT_STAGING_PATTERNS = [
  /(^|\.)staging\./i,
  /^staging-/i,
  /(^|\.)stage\./i,
  /(^|\.)dev\./i,
  /(^|\.)preview\./i,
  /(^|\.)test\./i,
  /\.vercel\.app$/i,
  /\.netlify\.app$/i,
  /\.pages\.dev$/i,
  /\.herokuapp\.com$/i,
  /\.onrender\.com$/i,
  /\.fly\.dev$/i,
  /\.web\.app$/i,
  /\.firebaseapp\.com$/i,
  /\.workers\.dev$/i,
  /\.ngrok(-free)?\.(io|app)$/i,
];

export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function isStagingHost(host: string, extra: string[] = [], productionHost?: string): boolean {
  const h = host.toLowerCase();
  if (productionHost && h === productionHost.toLowerCase()) return false;
  if (extra.some((e) => h === e.toLowerCase() || h.endsWith(`.${e.toLowerCase()}`))) return true;
  return DEFAULT_STAGING_PATTERNS.some((re) => re.test(h));
}

export function siteOrigin(siteUrl: string): string {
  return new URL(siteUrl).origin;
}

/** Hosts considered "the same site": exact host plus the www/non-www twin. */
export function sameSiteHost(a: string, b: string): boolean {
  const s = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return s(a) === s(b);
}

/**
 * Resolve an href found on `pageUrl` and classify it relative to the site.
 * Never throws; malformed input is reported in `problems`.
 */
export function normalizeLink(href: string, pageUrl: string, siteUrl: string, stagingHosts: string[] = []): NormalizedLink {
  const raw = (href ?? "").trim();
  const problems: string[] = [];
  if (!raw) return { url: raw, internal: false, kind: "malformed", problems: ["empty href"] };
  const lower = raw.toLowerCase();
  if (lower.startsWith("#")) return { url: raw, internal: true, kind: "anchor", problems };
  if (lower.startsWith("mailto:")) return { url: raw, internal: false, kind: "mailto", problems };
  if (lower.startsWith("tel:")) return { url: raw, internal: false, kind: "tel", problems };
  if (lower.startsWith("javascript:")) return { url: raw, internal: false, kind: "javascript", problems: ["javascript: URL"] };
  if (lower.startsWith("data:")) return { url: raw, internal: false, kind: "data", problems };
  if (/\s/.test(raw.replace(/%20/g, "")) && !/^https?:\/\//i.test(raw)) problems.push("whitespace in URL");
  if (/^https?:\/[^/]/i.test(raw) || /^https?:\/\/\//i.test(raw) || /^htps?:|^http:\/\/https?:/i.test(raw)) {
    return { url: raw, internal: false, kind: "malformed", problems: ["malformed scheme or slashes"] };
  }
  let u: URL;
  try {
    u = new URL(raw, pageUrl);
  } catch {
    return { url: raw, internal: false, kind: "malformed", problems: ["unparseable URL"] };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { url: u.href, internal: false, kind: "other-scheme", problems };
  const site = new URL(siteUrl);
  const host = u.host;
  const internalByHost = sameSiteHost(u.hostname, site.hostname);
  const local = isLocalHost(u.hostname);
  const staging = !internalByHost && !local && isStagingHost(u.hostname, stagingHosts, site.hostname);
  if (local) problems.push(`localhost URL (${host})`);
  if (staging) problems.push(`staging/preview host (${host})`);
  if (internalByHost && u.protocol !== site.protocol) problems.push(`wrong protocol (${u.protocol.replace(":", "")} on a ${site.protocol.replace(":", "")} site)`);
  if (/\/\/+/.test(u.pathname)) problems.push("repeated slashes in path");
  const internal = internalByHost || local || staging;
  if (!internal) return { url: u.href, internal: false, kind: "page", problems };
  // Rewrite onto the canonical origin so the graph uses one key per page.
  const abs = new URL(u.pathname + u.search, site.origin);
  return { url: abs.href, internal: true, path: decodeSafe(abs.pathname), kind: "page", problems };
}

function decodeSafe(p: string): string {
  try {
    return decodeURI(p);
  } catch {
    return p;
  }
}

/**
 * Canonical key for comparing URLs: origin-less path, lowercase, no trailing slash (except root),
 * no index.html, no query/hash. "/Blog/Post/" and "/blog/post/index.html" share a key.
 */
export function urlKey(url: string, siteUrl?: string): string {
  let p: string;
  try {
    p = new URL(url, siteUrl ?? "https://x.invalid").pathname;
  } catch {
    p = url;
  }
  p = decodeSafe(p).toLowerCase().replace(/\/index\.html?$/, "/").replace(/\.html?$/, "");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

/** Absolute URL on the site origin for a route path. */
export function absoluteUrl(siteUrl: string, routePath: string): string {
  return new URL(routePath, siteOrigin(siteUrl) + "/").href;
}

/** Join route segments into a clean path ("/blog" + "my-post" -> "/blog/my-post"). */
export function joinRoute(...parts: string[]): string {
  const joined = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `/${joined}`;
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/** True when `p` is `prefix` or below it ("/blog" contains "/blog/x" but not "/blogger"). */
export function isUnderPath(p: string, prefix: string): boolean {
  if (prefix === "/") return true;
  const a = p.toLowerCase().replace(/\/+$/, "");
  const b = prefix.toLowerCase().replace(/\/+$/, "");
  return a === b || a.startsWith(`${b}/`);
}
