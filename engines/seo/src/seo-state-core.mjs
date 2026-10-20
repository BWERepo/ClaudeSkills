// BWESEO workflow state — the pure core. No imports at all, so it runs anywhere: Node (the
// /BWESEO CLI in seo-state.mjs), a Cloudflare Worker or a browser (e.g. an admin status card).
//
// Given the evidence about a project (see collectEvidence in seo-state.mjs for its shape), it works
// out where the project and every page are in the lifecycle and picks ONE recommended next action
// (evaluateState), renders the plain-language dashboard (formatDashboard / formatDetails), and can
// run the read-only live checks against the production site with any fetch (probeLive). It never
// changes anything. Every name, URL and date comes from the evidence — nothing about any business
// is hard-coded.
//
// Vendored into each project as seo/tools/seo-state-core.mjs (with its seo-state-core.d.mts
// types). The source of truth is $BWESEO_ENGINE/src/; the rules it implements
// are documented in docs/methodology/workflow-state.md.

// Kept in step with ENGINE_VERSION in validate-seo-data.mjs (a test checks it).
export const STATE_VERSION = "2026.10.19.01";

// Status of one lifecycle step, for the project or for one page.
export const S = {
  COMPLETE: "COMPLETE",
  IN_PROGRESS: "IN PROGRESS",
  BLOCKED: "BLOCKED",
  READY: "READY",
  NOT_STARTED: "NOT STARTED",
  WAITING_FOR_DATA: "WAITING FOR DATA",
  NEEDS_APPROVAL: "NEEDS HUMAN APPROVAL",
  NEEDS_MANUAL_ACTION: "NEEDS MANUAL ACTION",
  ON_HOLD: "ON HOLD",
  WAITING: "WAITING", // an earlier step isn't finished yet
  UNKNOWN: "UNKNOWN", // no record, and nothing to infer it from
  NOT_APPLICABLE: "NOT APPLICABLE",
};

const LABEL = {
  [S.COMPLETE]: "✓ Complete",
  [S.IN_PROGRESS]: "In progress",
  [S.BLOCKED]: "✗ Blocked",
  [S.READY]: "Ready",
  [S.NOT_STARTED]: "Not started",
  [S.WAITING_FOR_DATA]: "Waiting for data",
  [S.NEEDS_APPROVAL]: "Needs your approval",
  [S.NEEDS_MANUAL_ACTION]: "Needs action from you",
  [S.ON_HOLD]: "⏸ On hold",
  [S.WAITING]: "Waiting",
  [S.UNKNOWN]: "Not recorded",
  [S.NOT_APPLICABLE]: "— Not applicable",
};
export const STATUS_LABEL = LABEL;

const STALE_DAYS = 180;
const REVIEWS = [
  ["review7", 7],
  ["review30", 30],
  ["review90", 90],
];
const PRIORITY_ORDER = { P1: 1, P2: 2, P3: 3 };
const OPPORTUNITY_STATUSES = new Set([
  "idea",
  "planned",
  "approved",
  "draft",
  "review",
  "rejected",
]);
const CANDIDATE_STATUSES = new Set(["idea", "planned", "update-needed"]);
// Which specialized skill fixes a site issue in each audit area. Areas without a skill (content,
// legal, measurement) are fixed through the project's normal change process after approval.
const ISSUE_SKILLS = {
  technical: "BWESEOTechnical",
  schema: "BWESEOSchema",
  local: "BWESEOLocal",
  "internal-links": "BWESEOInternalLinks",
};
const OUTSTANDING_ISSUE = new Set(["open", "approved"]);
const USER_AGENT = "BWESEO-seo-state/1.3 (read-only SEO status check)";

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// Local date, not UTC, so an evening run doesn't treat tomorrow as today.
export function localToday(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function pageName(p) {
  if (isStr(p?.name)) return p.name.trim();
  const title = String(p?.title ?? "")
    .split(/\s+[|–—]\s+|\s+-\s+/)[0]
    .trim();
  if (title) return title;
  const topic = String(p?.topic ?? "")
    .split(/\s+[—–]\s+|:\s/)[0]
    .trim();
  return topic || p?.id || "(unnamed page)";
}

// ---------------------------------------------------------------- source-file paths

// File paths mentioned in an inventory entry's free-text `source`
// ("src/routes/a.tsx → src/lib/b.ts:10-40 + templates/c.php").
const SOURCE_FILE_RE =
  /(?:[\w@$.[\]-]+\/)*[\w@$.[\]-]+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|astro|php|html?|mdx?|json|liquid|twig|njk|hbs|erb|py|rb)\b/g;

export function sourceFiles(source) {
  const out = [];
  for (const m of String(source ?? "").matchAll(SOURCE_FILE_RE)) {
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

// ---------------------------------------------------------------- page text

// Visible text of an HTML page, for checking that a page's verifyText is on it. A small local copy
// of post-publish-check.mjs's textOf, because this core imports nothing.
const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
};
export function pageText(html) {
  return String(html ?? "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const pathOf = (u) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return u;
  }
};
const squash = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const lower = (s) =>
  String(s ?? "")
    .toLowerCase()
    .trim();
const uniq = (a) => [...new Set(a)];
const hostOfUrl = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const trimOrigin = (u) => String(u ?? "").replace(/\/+$/, "");

// ---------------------------------------------------------------- environments

// Where a URL lives. Only PRODUCTION is ever for search engines; STAGING and PREVIEW are for testing,
// LOCAL is this machine, UNKNOWN is any host the project's config doesn't name.
export const ENV = {
  LOCAL: "LOCAL",
  STAGING: "STAGING",
  PREVIEW: "PREVIEW",
  PRODUCTION: "PRODUCTION",
  UNKNOWN: "UNKNOWN",
};

// Hard rule: search-engine indexing actions (Search Console "Request Indexing", sitemap submission,
// IndexNow, Bing URL submission, anything else) are only ever for PRODUCTION URLs.
export const indexingAllowed = (environment) => environment === ENV.PRODUCTION;

// A host pattern is an exact host name, or "*.example.com" for any subdomain of example.com.
export function hostMatches(host, pattern) {
  const h = lower(host);
  const p = lower(pattern);
  if (!h || !p) return false;
  if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

// Hosts that are never public, whatever the project: this machine, private networks and the
// reserved development names.
export function isLocalHost(host) {
  const h = lower(host).replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".test") ||
    h.endsWith(".local") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

// The project's environments, from seo-config.json → environments (engine 1.3.0):
//   production: { url, hosts[] }                     hosts = every host that serves production
//   staging:    { status, url, hosts[], indexProtection }   status "configured" | "not-configured"
//   preview:    { status, hostPatterns[] }
//   local:      { urls[], run }
// Older configs (production/staging as plain URL strings, publication.stagingHosts) still read.
// Nothing is assumed: no staging entry means staging is "unknown", not invented.
export function environmentsOf(config) {
  const env = config?.environments ?? {};
  const asObj = (v) => (typeof v === "string" ? { url: v } : v && typeof v === "object" ? v : null);
  const prod = asObj(env.production);
  const productionUrl = trimOrigin(prod?.url ?? config?.website ?? "");
  const productionHosts = uniq(
    [hostOfUrl(productionUrl), ...(prod?.hosts ?? [])].map(lower).filter(Boolean),
  );
  const stg = asObj(env.staging);
  const stagingUrl = trimOrigin(stg?.url ?? "");
  const stagingHosts = uniq(
    [hostOfUrl(stagingUrl), ...(stg?.hosts ?? []), ...(config?.publication?.stagingHosts ?? [])]
      .map(lower)
      .filter(Boolean),
  );
  const stagingStatus =
    stg?.status ??
    (stagingHosts.length ? "configured" : env.staging === null ? "not-configured" : "unknown");
  const pv = asObj(env.preview);
  const hostPatterns = uniq((pv?.hostPatterns ?? []).map(lower).filter(Boolean));
  return {
    production: productionUrl ? { url: productionUrl, hosts: productionHosts } : null,
    staging: {
      status: stagingStatus === "configured" && !stagingHosts.length ? "unknown" : stagingStatus,
      url: stagingUrl || (stagingHosts[0] ? `https://${stagingHosts[0]}` : null),
      hosts: stagingHosts,
      indexProtection: stg?.indexProtection ?? null,
    },
    preview: {
      status: pv?.status ?? (hostPatterns.length ? "configured" : "not-configured"),
      hostPatterns,
    },
    local: { urls: env.local?.urls ?? [], run: env.local?.run ?? null },
  };
}

export function classifyHost(host, config) {
  const h = lower(host);
  if (!h) return ENV.UNKNOWN;
  if (isLocalHost(h)) return ENV.LOCAL;
  const e = environmentsOf(config);
  if (e.staging.hosts.some((s) => hostMatches(h, s))) return ENV.STAGING;
  if (e.preview.hostPatterns.some((p) => hostMatches(h, p))) return ENV.PREVIEW;
  if (e.production?.hosts.some((p) => hostMatches(h, p))) return ENV.PRODUCTION;
  return ENV.UNKNOWN;
}

export const classifyUrl = (url, config) => classifyHost(hostOfUrl(url), config);

export function productionOrigin(config) {
  return environmentsOf(config).production?.url ?? "";
}

// Every reference to a non-production host in a piece of text — HTML, JSON-LD, a sitemap: absolute
// URLs on a staging, preview or local host, plus bare mentions of the configured staging hosts.
// Used to catch staging or development URLs leaking into production output.
export function findEnvironmentLeaks(text, config) {
  const src = String(text ?? "");
  const out = [];
  const seen = new Set();
  const push = (environment, host, ref) => {
    const key = `${environment}|${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ environment, host, ref });
  };
  for (const m of src.matchAll(
    /\b(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(?::\d+)?[^\s"'<>)\\]*/gi,
  )) {
    const env = classifyHost(m[1], config);
    if (env === ENV.STAGING || env === ENV.PREVIEW || env === ENV.LOCAL)
      push(env, lower(m[1]), m[0]);
  }
  for (const h of environmentsOf(config).staging.hosts) {
    if (out.some((l) => l.host === h)) continue;
    if (lower(src).includes(h)) push(ENV.STAGING, h, h);
  }
  return out;
}

// The robots signals a response carries: the X-Robots-Tag header and <meta name="robots"|"googlebot">.
export function robotsSignals(html, headerValue) {
  const metas = [...String(html ?? "").matchAll(/<meta\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /\bname\s*=\s*["']?(robots|googlebot)\b/i.test(t))
    .map((t) => t.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i))
    .map((m) => (m ? (m[1] ?? m[2] ?? "") : ""));
  const header = String(headerValue ?? "");
  const noindex = [header, ...metas].some((v) => /\b(noindex|none)\b/i.test(v));
  return { header: header || null, meta: metas, noindex };
}

// Does robots.txt tell every crawler ("User-agent: *") to stay out of the whole site?
export function robotsBlocksAll(txt) {
  let agents = [];
  let inRules = false;
  let blocks = false;
  for (const raw of String(txt ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(m[2].trim());
    } else if (key === "disallow" || key === "allow") {
      inRules = true;
      if (agents.includes("*") && key === "disallow" && m[2].trim() === "/") blocks = true;
      if (agents.includes("*") && key === "allow" && m[2].trim() === "/") return false;
    }
  }
  return blocks;
}

// How well a non-production environment is hidden from search engines. "strong": every response
// says noindex (header or meta) or needs a sign-in; "weak": only robots.txt — which stops polite
// crawlers fetching but can't stop a linked URL being listed; "none": nothing.
export function indexProtection(page, robots) {
  if (!page || page.error) return { level: "unknown", detail: "the site could not be reached" };
  if (page.status === 401 || page.status === 403)
    return { level: "strong", detail: "sign-in required" };
  const how = [];
  if (/\b(noindex|none)\b/i.test(page.robots?.header ?? "")) how.push("X-Robots-Tag noindex");
  if ((page.robots?.meta ?? []).some((v) => /\b(noindex|none)\b/i.test(v)))
    how.push("noindex meta tag");
  const blocked = robots?.blocksAll === true;
  if (how.length)
    return {
      level: "strong",
      detail: [...how, blocked && "robots.txt Disallow: /"].filter(Boolean).join(" + "),
    };
  if (blocked)
    return {
      level: "weak",
      detail: "robots.txt Disallow: / only — pages still say index, no noindex",
    };
  return { level: "none", detail: "no noindex, no robots.txt block, no sign-in" };
}

// ---------------------------------------------------------------- live checks (read-only GETs)

async function probe(
  fetchImpl,
  url,
  { verifyText = null, readRobots = false, plain = false } = {},
  timeoutMs = 8000,
) {
  const started = Date.now();
  const checkedAt = new Date(started).toISOString();
  try {
    const signal =
      typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
    // A browser may not set a User-Agent, and a custom header on a cross-origin request would
    // trigger a CORS preflight — `plain` sends none.
    const res = await fetchImpl(url, {
      redirect: "follow",
      ...(plain ? {} : { headers: { "user-agent": USER_AGENT, accept: "text/html" } }),
      signal,
    });
    const finalUrl = res.url || url;
    const ok = res.status >= 200 && res.status < 300;
    let hasVerifyText = null;
    let robots = null;
    if (ok && (isStr(verifyText) || readRobots)) {
      const html = await res.text();
      if (isStr(verifyText)) hasVerifyText = squash(pageText(html)).includes(squash(verifyText));
      if (readRobots) robots = robotsSignals(html, res.headers?.get?.("x-robots-tag"));
    } else {
      if (readRobots) robots = robotsSignals("", res.headers?.get?.("x-robots-tag"));
      // Not awaited: releasing an unread body must never be able to stall a health check (cancelling one branch of
      // a tee'd/cloned stream only settles when the other branch is released too).
      void res.body?.cancel?.().catch(() => {});
    }
    return {
      url,
      status: res.status,
      finalUrl,
      redirected: pathOf(finalUrl) !== pathOf(url),
      hasVerifyText,
      checkedAt,
      ms: Date.now() - started,
      ...(robots ? { robots } : {}),
    };
  } catch (e) {
    return {
      url,
      error: e?.name === "TimeoutError" ? "timed out" : String(e?.message ?? e),
      checkedAt,
      ms: Date.now() - started,
    };
  }
}

// What a probe result means (engine 1.4.1). A live check that fails is a HEALTH problem, never a
// change to a page's recorded lifecycle:
//   ok          2xx at the same path
//   redirected  2xx, but the path changed (the destination is what was evaluated — fetch follows it)
//   missing     404 / 410 — strong evidence the page is gone: a content conflict to investigate
//   unavailable 5xx (incl. Cloudflare 520–524), 429, timeouts, DNS/network errors, 401/403/other 4xx —
//               the checker could not see the page; says nothing about whether it is published
export function classifyProbe(r) {
  if (!r) return null;
  if (r.error) return "unavailable";
  if (r.status >= 200 && r.status < 300) return r.redirected ? "redirected" : "ok";
  if (r.status === 404 || r.status === 410) return "missing";
  return "unavailable";
}

const HEALTH_SOURCE = "BWESEO state engine — server-side HTTP probe";
const BROWSER_SOURCE = "BWESEO state engine — probe run by the admin's browser";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One retry after a short pause for transient failures only (never for a clean 404).
async function probeRetry(fetchImpl, url, opts, timeoutMs, retryDelayMs) {
  let r = await probe(fetchImpl, url, opts, timeoutMs);
  if (classifyProbe(r) === "unavailable") {
    if (retryDelayMs > 0) await sleep(retryDelayMs);
    r = { ...(await probe(fetchImpl, url, opts, timeoutMs)), retried: true };
  }
  return r;
}

const describeProbe = (r) =>
  r?.error ? `${r.error}` : r?.status ? `HTTP ${r.status}` : "no response";

async function probeRobotsTxt(fetchImpl, origin, timeoutMs, plain = false) {
  try {
    const signal =
      typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetchImpl(`${origin}/robots.txt`, {
      ...(plain ? {} : { headers: { "user-agent": USER_AGENT } }),
      signal,
    });
    const text = res.status === 200 ? await res.text() : "";
    if (res.status !== 200) void res.body?.cancel?.().catch(() => {});
    return { status: res.status, blocksAll: res.status === 200 ? robotsBlocksAll(text) : false };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

const pageUrl = (p, origin) => p.productionUrl ?? (origin ? origin + p.url : p.url);

// Production: built-but-unpublished pages (have they been deployed?) and pages the inventory says
// are live (has one disappeared?). Staging: built pages and engine-published pages (is this
// version on staging? is a "published" page really only on staging?).
const probeOnProduction = (p) =>
  ["review", "published", "update-needed"].includes(p.status) && isStr(p.url);
const probeOnStaging = (p) =>
  isStr(p.url) && (p.status === "review" || (p.status === "published" && p.approvedBy === "user"));

async function inPool(items, concurrency, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// ---------------------------------------------------------------- health-check strategy
// WHERE the live check runs matters. A Worker (or any edge function) that fetches a hostname on its
// OWN zone does not reach the public site: without the `global_fetch_strictly_public` flag the request
// is sent to the zone's origin — bypassing Workers — and a Worker behind a Custom Domain has no origin,
// so it can come back as a 522 that says nothing about the site (Cloudflare docs; workerd #787). Other
// hosts have their own variants of the same trap. So the engine never assumes the host running the
// check can fetch its own site. Strategy, in seo-config.json → environments.health:
//   "browser" (default) — the admin's browser runs the probes (a same-origin request, the exact path a
//                         visitor uses); the host never fetches itself. Cross-origin targets are not
//                         readable from a browser and are reported as "not checked", never as failed.
//   "server"            — the host fetches the URLs, but ONLY targets that are not on its own zone
//                         (`selfFetchRisk`); anything that is, is skipped ("not checked"), never failed.
//   "off"               — no live checks from the card (records only).
// The CLI (/BWESEO in Claude Code) always probes from the developer's machine, which is never the
// site's own host, so it is unaffected. `endpoint` optionally names a lightweight health URL (default
// "/") that is probed instead of the home page.
export const HEALTH_STRATEGIES = ["browser", "server", "off"];
export function healthConfig(config) {
  const h = config?.environments?.health ?? {};
  return {
    strategy: HEALTH_STRATEGIES.includes(h.strategy) ? h.strategy : "browser",
    endpoint: typeof h.endpoint === "string" && /^\/[^\s]*$/.test(h.endpoint) ? h.endpoint : "/",
  };
}

const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.za", "com.br",
  "co.jp", "co.in", "com.mx", "com.sg", "com.hk", "co.kr",
]);
// The registrable domain (a Cloudflare zone is normally exactly this). A heuristic: the label list is
// short and hosts on unusual public suffixes should be listed in environments[].hosts.
export function registrableDomain(host) {
  const parts = String(host ?? "").toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(last2) ? parts.slice(-3).join(".") : last2;
}

// Would fetching `targetUrl` from `servingHost` be a same-zone request from the site's own host?
// True when it is the same host, one of the project's own configured hosts, or on the same
// registrable domain. Pure and provider-independent.
export function selfFetchRisk(targetUrl, servingHost, config) {
  const target = hostOfUrl(targetUrl);
  const serving = lower(String(servingHost ?? "").replace(/:\d+$/, ""));
  if (!target || !serving) return false;
  if (target === serving) return true;
  const envs = environmentsOf(config);
  const own = new Set([...(envs.production?.hosts ?? []), ...(envs.staging?.hosts ?? [])].map(lower));
  if (own.has(serving) && own.has(target)) return true;
  return registrableDomain(target) === registrableDomain(serving);
}

// The minimum a browser needs to run the probes — no profile, no notes, only URLs and statuses.
export function buildProbeInput(config, inventory) {
  const pick = (p) => ({
    id: p.id,
    url: p.url,
    status: p.status,
    approvedBy: p.approvedBy,
    productionUrl: p.productionUrl,
    verifyText: p.verifyText,
  });
  return {
    config: {
      website: config?.website,
      environments: config?.environments,
      publication: { stagingHosts: config?.publication?.stagingHosts },
    },
    inventory: { pages: (inventory?.pages ?? []).map(pick) },
    healthConfig: healthConfig(config),
  };
}

// A probe result reported by a browser is untrusted input: keep only the fields the engine reads,
// with their types checked, for origins and pages the project actually has. Nothing else passes.
export function sanitizeLiveCheck(input, config, inventory) {
  const bad = { checked: false, reason: "the browser's probe result was not usable" };
  if (!input || typeof input !== "object") return bad;
  const envs = environmentsOf(config);
  const ids = new Set((inventory?.pages ?? []).map((p) => p.id));
  const str = (v, n = 300) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const iso = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? v : undefined);
  const probeOf = (p, origin) => {
    if (!p || typeof p !== "object") return null;
    const url = str(p.url);
    if (!url || !url.startsWith(origin)) return null;
    const out = { url, checkedAt: iso(p.checkedAt) };
    if (Number.isInteger(p.status) && p.status >= 100 && p.status <= 599) out.status = p.status;
    if (typeof p.error === "string") out.error = str(p.error, 200);
    if (out.status === undefined && out.error === undefined) return null;
    if (typeof p.finalUrl === "string" && p.finalUrl.startsWith(origin)) out.finalUrl = str(p.finalUrl);
    out.redirected = p.redirected === true;
    out.hasVerifyText = typeof p.hasVerifyText === "boolean" ? p.hasVerifyText : null;
    if (Number.isFinite(p.ms)) out.ms = Math.max(0, Math.min(600000, Math.round(p.ms)));
    if (p.retried === true) out.retried = true;
    if (p.robots && typeof p.robots === "object")
      out.robots = {
        header: str(p.robots.header, 200) ?? null,
        meta: Array.isArray(p.robots.meta) ? p.robots.meta.slice(0, 5).map((m) => str(m, 200) ?? "") : [],
        noindex: p.robots.noindex === true,
      };
    return out;
  };
  const oneSide = (side, origin) => {
    if (!side || typeof side !== "object" || !origin) return null;
    const home = probeOf(side.homeProbe, origin);
    const pages = {};
    for (const [id, p] of Object.entries(side.pages ?? {})) {
      const clean = ids.has(id) ? probeOf(p, origin) : null;
      if (clean) pages[id] = clean;
    }
    const robots =
      side.robots && typeof side.robots === "object"
        ? Number.isInteger(side.robots.status)
          ? { status: side.robots.status, blocksAll: side.robots.blocksAll === true }
          : { error: str(side.robots.error, 200) }
        : undefined;
    return { home, pages, robots, reason: str(side.reason, 300), checked: side.checked === true, skipped: side.skipped === true };
  };
  const prod = oneSide(input, envs.production?.url);
  if (!prod) return bad;
  const result = {
    checked: prod.checked && !!prod.home,
    origin: envs.production.url,
    source: BROWSER_SOURCE,
    pages: prod.pages,
  };
  if (prod.home) result.homeProbe = prod.home;
  if (result.checked) result.production = { home: prod.home, robots: prod.robots };
  else result.reason = prod.reason ?? "the production site was not checked";
  if (prod.skipped) result.skipped = true;
  const hp = input.productionHealth;
  if (hp && typeof hp === "object" && ["ok", "degraded", "unavailable"].includes(hp.status)) {
    result.productionHealth = {
      status: hp.status,
      detail: str(hp.detail, 300) ?? "",
      ...(Number.isInteger(hp.failed) ? { failed: hp.failed } : {}),
      ...(hp.breaker === true ? { breaker: true } : {}),
    };
  }
  const st = input.staging;
  const stagingOrigin = envs.staging?.url;
  if (st && stagingOrigin) {
    const s2 = oneSide(st, stagingOrigin);
    result.staging = s2
      ? {
          checked: s2.checked && !!s2.home,
          origin: stagingOrigin,
          ...(s2.home ? { homeProbe: s2.home } : {}),
          pages: s2.pages,
          ...(s2.home && s2.checked ? { home: s2.home, robots: s2.robots } : { reason: s2.reason ?? "staging was not checked" }),
          ...(s2.skipped ? { skipped: true } : {}),
        }
      : { checked: false, reason: "staging was not checked" };
  } else result.staging = { checked: false, reason: "staging was not checked" };
  return result;
}

export async function probeLive(
  config,
  inventory,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
    concurrency = 6,
    retryDelayMs = 400,
    // Set by a host that serves the site itself (an edge function / Worker): targets on its own zone
    // are skipped, never fetched (see "health-check strategy" above).
    servingHost = null,
    // Set by a browser: only this origin is readable; anything else is skipped, never failed.
    browser = null,
  } = {},
) {
  const envs = environmentsOf(config);
  const origin = envs.production?.url ?? "";
  if (!/^https?:\/\//.test(origin))
    return { checked: false, reason: "no production URL in seo-config.json" };
  if (typeof fetchImpl !== "function") return { checked: false, reason: "no fetch available" };
  const all = inventory?.pages ?? [];
  const { endpoint } = healthConfig(config);
  const plain = !!browser;
  const source = browser ? BROWSER_SOURCE : HEALTH_SOURCE;

  // Why a target must not be fetched from here (null = fine).
  const skipReason = (target, label) => {
    if (browser) {
      let o = "";
      try {
        o = new URL(target).origin;
      } catch {
        /* keep empty */
      }
      return o === browser.readableOrigin
        ? null
        : `${label} is on another origin, so a browser cannot read its status — run /BWESEO in Claude Code to check it`;
    }
    if (servingHost && selfFetchRisk(target, servingHost, config))
      return `not checked from here: this host and ${label} share a zone, and a host fetching its own zone doesn't reach the public site (it can return a false 522) — use the browser check or /BWESEO in Claude Code`;
    return null;
  };

  // Production: the health endpoint / home page first. If it can't be checked even after a retry (5xx,
  // timeout, network), everything else would fail the same way — stop there (circuit breaker) instead
  // of sending dozens of requests and reporting dozens of false "missing" pages. That is a health
  // failure, recorded separately; it says nothing about any page's lifecycle.
  let result;
  const prodSkip = skipReason(origin, "the production site");
  if (prodSkip) {
    result = { checked: false, reason: prodSkip, origin, source, pages: {}, skipped: true };
  } else {
    const home = await probeRetry(fetchImpl, `${origin}${endpoint}`, { readRobots: endpoint === "/", plain }, timeoutMs, retryDelayMs);
    if (classifyProbe(home) === "unavailable") {
      result = {
        checked: false,
        reason: `the production site could not be checked (${describeProbe(home)}${home.retried ? ", after a retry" : ""})`,
        origin,
        source,
        homeProbe: home,
        pages: {},
        productionHealth: {
          status: "unavailable",
          detail: `${describeProbe(home)} on the health check${home.retried ? " after a retry" : ""}`,
          code: home.status ?? null,
          breaker: true,
        },
      };
    } else {
      // Only a not-yet-published page needs its body read (is this version deployed?); for the rest
      // the status code is enough, which keeps the check cheap.
      const pages = {};
      await inPool(all.filter(probeOnProduction), concurrency, async (p) => {
        const verify = p.status === "review" ? p.verifyText : null;
        pages[p.id] = await probeRetry(fetchImpl, pageUrl(p, origin), { verifyText: verify, plain }, timeoutMs, retryDelayMs);
      });
      const robots = await probeRobotsTxt(fetchImpl, origin, timeoutMs, plain);
      const failed = Object.values(pages).filter((r) => classifyProbe(r) === "unavailable").length;
      result = {
        checked: true,
        origin,
        source,
        homeProbe: home,
        pages,
        production: { home, robots },
        productionHealth: failed
          ? {
              status: "degraded",
              detail: `${failed} of ${Object.keys(pages).length} pages could not be checked`,
              failed,
            }
          : { status: "ok", detail: describeProbe(home) },
      };
    }
  }

  // Staging, when the project has one (same rules: a failed check is a health problem only).
  if (envs.staging.status === "configured" && /^https?:\/\//.test(envs.staging.url ?? "")) {
    const sOrigin = envs.staging.url;
    const stgSkip = skipReason(sOrigin, "the staging site");
    if (stgSkip) {
      result.staging = { checked: false, reason: stgSkip, origin: sOrigin, skipped: true };
    } else {
      const sHome = await probeRetry(fetchImpl, `${sOrigin}${endpoint}`, { readRobots: endpoint === "/", plain }, timeoutMs, retryDelayMs);
      if (classifyProbe(sHome) === "unavailable") {
        result.staging = {
          checked: false,
          reason: `the staging site could not be checked (${describeProbe(sHome)})`,
          origin: sOrigin,
          homeProbe: sHome,
          health: { status: "unavailable", detail: describeProbe(sHome) },
        };
      } else {
        const sPages = {};
        await inPool(all.filter(probeOnStaging), concurrency, async (p) => {
          sPages[p.id] = await probeRetry(fetchImpl, sOrigin + p.url, { verifyText: p.verifyText, readRobots: true, plain }, timeoutMs, retryDelayMs);
        });
        const sRobots = await probeRobotsTxt(fetchImpl, sOrigin, timeoutMs, plain);
        result.staging = {
          checked: true,
          origin: sOrigin,
          homeProbe: sHome,
          pages: sPages,
          home: sHome,
          robots: sRobots,
          health: { status: "ok", detail: describeProbe(sHome) },
        };
      }
    }
  } else {
    result.staging = { checked: false, reason: `staging is ${envs.staging.status}` };
  }
  return result;
}

// ---------------------------------------------------------------- plain-language actions

// Every recommendation says, in plain words, WHAT we are doing, WHY it matters and WHAT HAPPENS
// NEXT. `actor` separates what Claude can do from what only the user can do.
function action(kind, rank, c = {}) {
  const n = c.name ?? "";
  const T = {
    install: {
      headline: "Install the BWESEO engine.",
      what: "Installing the reusable BWESEO engine into this project (tools, schemas, generic docs) and creating empty data folders. Nothing customer-specific is copied.",
      why: "BWESEO is not installed in this project yet. Installing the engine is a separate step from setting up this customer's SEO profile.",
      next: "Run /BWESEOInstall --dry-run first to see exactly what would happen, then /BWESEOInstall. After that, /BWESEOSetup builds this customer's own profile.",
    },
    setup: {
      headline: c.installed ? "Engine installed — project setup is next." : "Set up the business SEO profile.",
      what: "Setting up the SEO system for this website: a profile of verified facts about the business, the SEO settings for this site, and a list of its pages.",
      why: "Everything later is built on facts about the business. Without them we could target searches it doesn't serve, or make claims it can't back up.",
      next: "Claude confirms the business and website with you first. Afterwards, run /BWESEO again and it will point you to the next step (the site audit).",
    },
    "setup-incomplete": {
      headline: "Finish setting up SEO for this business.",
      what: `Finishing SEO setup — ${c.detail}.`,
      why: "The status can't be worked out until the SEO files exist and can be read.",
      next: "Setup runs in update mode: nothing that already exists is overwritten.",
    },
    "guard-mismatch": {
      headline: "Stop — these SEO files belong to a different project.",
      what: "Nothing. This folder's seo/seo-config.json names a different website project.",
      why: `${c.detail} Mixing one business's SEO data with another's would put the wrong facts on a website.`,
      next: "Open the right project, or correct seo/seo-config.json → repo, then run /BWESEO again.",
    },
    "fix-data": {
      headline: "Fix the errors in the SEO data files.",
      what: "Correcting errors the SEO validator found in seo/*.json.",
      why: "The status can't be trusted while the SEO records contain errors.",
      next: "Claude fixes what it can from the project's own files and asks you only for facts it can't verify. Then the status is checked again.",
    },
    "answer-question": {
      headline:
        c.questions?.length > 1
          ? "Answer the questions that are holding things up."
          : "Answer one question that is holding things up.",
      what: "Getting an answer only you can give.",
      why: `${c.blocked} can't go ahead without it — the SEO system never guesses facts about the business.`,
      next: "Claude records your answer in the business profile and carries on from there.",
    },
    audit: {
      headline: "Run the SEO audit.",
      what: "Checking the whole website for SEO problems. This is read-only: nothing on the site changes.",
      why: "It shows what already works, what's broken and what to fix first, before anything new is added.",
      next: "Next comes finding the searches that could bring this business customers.",
    },
    "re-audit": {
      headline: "Refresh the SEO audit.",
      what: "Re-running the read-only SEO audit.",
      why: `The last audit is from ${c.date}. Sites change, and fixes may have landed since then.`,
      next: "The new findings replace the old ones, and the fix list is re-ordered.",
    },
    opportunities: {
      headline: "Find the searches that could bring customers.",
      what: "Working out which searches could bring this business a qualified customer, for services it really offers.",
      why: "New pages should answer what real customers look for, not just collect traffic.",
      next: "The best ideas become a short, prioritized plan for you to approve.",
    },
    "content-plan": {
      headline: "Turn the opportunities into a page plan.",
      what: "Building the page map and a prioritized roadmap from the opportunities found.",
      why: "A plan stops us building pages that compete with each other or that nobody needs.",
      next: "You'll get the top few pages to choose from. Nothing is built until you pick one.",
    },
    "approve-page": {
      headline: `Choose the next page: ${n}?`,
      what: `Deciding which roadmap page to work on next. The top one is ${n}.`,
      why: `It's the highest-priority item left on the roadmap (${c.priority}). ${c.topic ?? ""}`.trim(),
      next: "When you approve one page, Claude builds only that page and checks it. Nothing is published without your go-ahead.",
    },
    "create-page": {
      headline: `Build the approved ${n} page.`,
      what: `Building ${n} in the site's existing design, using only verified facts about the business.`,
      why: `You approved it on ${c.date}; it's the next step towards a page that brings in customers.`,
      next: "Then the page goes through SEO QA before you decide whether to publish it.",
    },
    "continue-page": {
      headline: `Finish building ${n}.`,
      what: `Finishing the ${n} page, which is partly built.`,
      why: "Half-built pages help nobody, and finishing is quicker than starting something new.",
      next: "Then the page goes through SEO QA.",
    },
    qa: {
      headline: `Run SEO QA for ${n}.`,
      what: `Checking the new ${n} page before publishing it.`,
      why: "This makes sure Google can understand the page, and that we didn't accidentally create broken links, duplicate content, bad metadata or indexing problems.",
      next: c.staged
        ? "If QA passes, it goes to staging for testing and review before you decide about production."
        : "If QA passes, the page is ready for your approval and deployment.",
    },
    "qa-fix": {
      headline: `Fix what SEO QA found on ${n}.`,
      what: `Fixing the problems SEO QA found on ${n}, then checking it again.`,
      why: `QA failed on ${c.date}. A page shouldn't go live with known problems.`,
      next: c.staged
        ? "Once QA passes, it goes to staging for testing and review before you decide about production."
        : "Once QA passes, the page is ready for your approval and deployment.",
    },
    "qa-rerun": {
      headline: `Re-run SEO QA for ${n} — it changed after QA.`,
      what: `Checking ${n} again.`,
      why: `It passed QA on ${c.date}, but its files changed afterwards${c.modifiedOn ? ` (last change ${c.modifiedOn})` : ""}. QA only counts for the version it checked.`,
      next: c.staged
        ? "If it still passes, it goes to staging (again) for testing and review before production."
        : "If it still passes, the page is ready for your approval and deployment.",
    },
    "approve-deploy": {
      headline: `Decide whether to deploy ${n} to production.`,
      what: `Deciding whether ${n} goes live on the real website, where customers and search engines see it.`,
      why: `${c.staged ? `You approved it on staging on ${c.date}.` : `It passed SEO QA on ${c.date}; this project has no staging site, so production is the next step.`} Deploying is your decision — an approval of the page is not permission to deploy it.${c.safety ? ` Production safety: ${c.safety}.` : ""}`,
      next: `When you say go, it's deployed through this project's normal release process${c.deploy ? ` (${c.deploy})` : ""}. Then /BWESEOPublish checks it on production on its own — staging checks don't count for production — and only after that can Google be asked to look at it.`,
    },
    "deploy-staging": {
      headline: `Deploy ${n} to staging.`,
      what: `Putting ${n} on the staging site${c.stagingUrl ? ` (${c.stagingUrl})` : ""} so it can be tested before anything goes live.`,
      why: "Staging is for testing and is hidden from search engines; production is what customers and Google see. The page passed SEO QA, so testing it on staging is next.",
      next: "Then Claude runs the staging review, and you look at the page there before deciding about production.",
    },
    "staging-review": {
      headline: `Run the staging review for ${n}.`,
      what: `Checking ${n} on staging (${c.stagingUrl}): the page loads, its links and call-to-action work, the SEO basics and content are right, and staging stays hidden from search engines.`,
      why: `${c.stale ? `It changed after its last staging review (${c.date}). ` : ""}It's the last check before you look at the page yourself. ENVIRONMENT: STAGING — SEARCH ENGINE INDEXING ACTIONS: DISABLED; this environment is for testing only.`,
      next: "If it passes, you review the page on staging and decide whether it goes to production.",
    },
    "staging-fix": {
      headline: `Fix what the staging review found on ${n}.`,
      what: `Fixing the problems the staging review found on ${n} (${c.date}).`,
      why: "A page shouldn't go to production with problems already seen on staging.",
      next: "Then it's redeployed to staging and reviewed again.",
    },
    "approve-staging": {
      headline: `STAGING REVIEW PASSED — review ${n} on staging.`,
      what: `${n} is ready for your review on staging: ${c.stagingUrl}`,
      why: `Claude's technical, SEO, content and environment checks passed on ${c.date}. The visual checks need your eyes.`,
      next: "PRODUCTION DEPLOYMENT REQUIRES YOUR APPROVAL. Tell me it's approved, or what to change. Approving the page doesn't deploy it — production goes out only when you say go.",
    },
    "production-not-indexable": {
      headline: "CRITICAL: the live website is telling search engines to stay away.",
      what: "Finding and fixing what makes production non-indexable.",
      why: `${c.detail}. Every public page on production should be indexable; a staging-only setting may have reached production.`,
      next: "The fix goes through your normal approval and release process; afterwards the post-publication check confirms production is indexable again.",
    },
    "staging-exposed": {
      headline: "Staging isn't hidden from search engines.",
      what: "Deciding how to keep the staging site out of search results.",
      why: `${c.stagingUrl} ${c.detail}. Staging is a copy of the site for testing; if it's indexed it competes with the real site.`,
      next: "Claude proposes the protection that fits this site (a noindex header, a sign-in, or both) for your approval, then it goes through the normal release process.",
    },
    "strengthen-staging": {
      headline: "Decide whether to strengthen staging's protection from search engines.",
      what: "Deciding whether to add a noindex signal to staging.",
      why: `Staging (${c.stagingUrl}) relies on robots.txt only: ${c.detail}. robots.txt stops polite crawlers fetching pages, but a staging URL linked from anywhere can still be listed.`,
      next: "If you approve, Claude adds a noindex header for the staging host (production untouched) through the normal change, test and release process.",
    },
    "resume-hold": {
      headline: `${n} is on hold — say go when you're ready.`,
      what: `Nothing, for now. You paused ${n} on ${c.date}${c.reason ? ` (${c.reason})` : ""}.`,
      why: "A paused page stays exactly where it is until you say otherwise.",
      next: "Say go and it continues from its next step.",
    },
    "publish-check": {
      headline: `Check ${n} on the live website.`,
      what: `Checking the ${n} page on the live website.`,
      why: "It's on production now. Before Google is asked to look at it, we confirm it's really live, can be indexed, is in the sitemap and is linked from other pages.",
      next: "You'll get the exact Search Console step to do, if any, and the page's review dates.",
    },
    "fix-publication": {
      headline: `Fix what the post-publication check found on ${n}.`,
      what: `Fixing the problems the post-publication check found on ${n} (${c.date}), then checking again.`,
      why: "Until they're fixed, Google may not index the page, or may index the wrong version.",
      next: "Site changes still go through your normal approval and release process; then /BWESEOPublish runs again.",
    },
    "request-indexing": {
      headline: `Ask Google to look at ${n}.`,
      what: `Asking Google to look at the new ${n} page.`,
      why: "Google finds new pages on its own eventually. Asking directly through Search Console usually speeds that up.",
      next: "Tell me when it's done (or that you'd rather not) and I'll record it. Then the page waits for its first review.",
    },
    "export-search-console": {
      headline: `Export Search Console data for the ${n} ${c.days}-day review.`,
      what: `Getting Google's data about ${n} for its ${c.days}-day review.`,
      why: `The review was due on ${c.date}. Claude can't read Search Console directly — it works from the export you save.`,
      next: "Run /BWESEO again after saving it, and the review can go ahead.",
    },
    "sc-review": {
      headline: `Run the ${c.days}-day review for ${n}.`,
      what: `Reviewing how ${n} is doing in Google (${c.days}-day review).`,
      why: `The review was due on ${c.date}${c.skipped ? ` (the ${c.skipped}-day review was missed; this one covers it)` : ""}.`,
      next: "The review decides whether to leave the page alone, improve it, or look at something else. Nothing on the page changes without your approval.",
    },
    "schedule-monitoring": {
      headline: `Set up monitoring for ${n}.`,
      what: `Re-running the post-publication check for ${n} so its 7/30/90-day reviews are scheduled.`,
      why: "It's live, but no review dates were recorded, so nobody would know when to check how it's doing.",
      next: "The check records the review dates and any Search Console step to do.",
    },
    "investigate-health": {
      headline: c.repeated ? "Investigate production availability." : "Re-check production availability.",
      what: c.repeated
        ? "Finding out why the live-site check keeps failing. Read-only diagnosis: nothing is redeployed or changed."
        : "Running the live-site check again, and looking at hosting / DNS status if it fails again. Read-only.",
      why: `${c.detail}. This is a live-site HEALTH observation. It does not undo anything the SEO records show as done: production, the post-publication check and the Search Console steps stay complete, and nothing needs to be redeployed, re-checked by QA or re-requested.${c.lastSuccess ? ` The last successful check was ${c.lastSuccess}.` : ""}`,
      next: "If the checks keep failing, look at the hosting / CDN status, DNS and the site itself. Only verified evidence of a rollback or removal changes the recorded lifecycle.",
    },
    "production-reversed": {
      headline: `${n} was taken off production (${c.reversalKind}, verified ${c.date}) — decide what to do.`,
      what: `Deciding whether ${n} should go back to production.`,
      why: `The records show a verified ${c.reversalKind} on ${c.date}${c.evidence ? ` (${c.evidence})` : ""}. It had been live${c.publishedOn ? ` since ${c.publishedOn}` : ""}; that history is kept.`,
      next: "If you want it live again it goes back through your normal approval and release process, then /BWESEOPublish verifies it from scratch.",
    },
    "conflict-not-live": {
      headline: c.moved
        ? `${n} now redirects somewhere else — investigate.`
        : `PRODUCTION PAGE MISSING — ${n} needs investigating.`,
      what: `Finding out why ${n} ${c.moved ? "no longer answers at its own address" : "is missing from the live website"}. Read-only: nothing is changed or republished.`,
      why: `The SEO records say it went live${c.publishedOn ? ` on ${c.publishedOn}` : ""}, but ${c.url} ${c.detail}${c.onStaging ? " (it is still served on staging, which doesn't count as published)" : ""}. Its recorded history is left as it is — this is a production-health / content conflict, not proof it was never published.`,
      next: "Once the cause is known (rollback, routing, cache, or a removed page), the fix goes through your normal approval and release process. It is only republished if the evidence shows that is required.",
    },
    "conflict-live-before-qa": {
      headline: `${n} is live but never passed SEO QA.`,
      what: `Running SEO QA on ${n}, which is already on the live website.`,
      why: `It's live at ${c.url}, but ${c.detail}. Problems on a live page cost visitors and rankings.`,
      next: "If QA passes, the post-publication check follows. If not, you'll get the exact fixes to approve.",
    },
    "conflict-missing-source": {
      headline: `${n}'s files are missing.`,
      what: `Finding and restoring the files for ${n}.`,
      why: `The SEO records say it's built, but ${c.detail} can't be found.`,
      next: "Once the page is back (or the record corrected), it goes through SEO QA.",
    },
    "fix-issue": {
      headline: `Fix: ${c.title}.`,
      what: `Fixing a problem the site audit found: ${c.title}.`,
      why: `It's a ${c.severity}-priority problem${c.pages ? ` affecting ${c.pages}` : ""}, and you've approved the fix.`,
      next: "The fix goes through the project's normal change, test and release process.",
    },
    "approve-issue": {
      headline: `Decide whether to fix: ${c.title}.`,
      what: `Deciding whether to fix a problem the site audit found: ${c.title}.`,
      why: `It's a ${c.severity}-priority problem${c.pages ? ` affecting ${c.pages}` : ""}. Changes to the site need your approval.`,
      next: "If you approve, Claude shows the exact change first, then it goes through the normal change, test and release process. If not, it can be marked as deferred so it stops coming up.",
    },
    "refresh-page": {
      headline: `Improve ${n}.`,
      what: `Working out exactly what to improve on ${n}.`,
      why: `${c.trigger}: ${c.evidence}`,
      next: "You'll get a specific list of changes to approve before anything on the live page changes.",
    },
    "refresh-check": {
      headline: "Check the pages that haven't been reviewed in a while.",
      what: `Checking ${c.count} page(s) that haven't been reviewed in over ${STALE_DAYS} days for outdated facts, prices and links.`,
      why: "Out-of-date pages quietly lose trust with visitors and with Google.",
      next: "You'll get a short refresh list. Nothing changes without your approval.",
    },
    "reverify-profile": {
      headline: "Re-check the business facts.",
      what: "Re-confirming the facts in the business profile.",
      why: `They were last reviewed on ${c.date}. Prices, services and contact details change, and pages must match.`,
      next: "Claude shows what it could verify and asks only about what it couldn't.",
    },
    "setup-search-console": {
      headline: c.unknown
        ? "Confirm whether Google Search Console is set up for this website."
        : "Set up Google Search Console for this website.",
      what: "Making sure this website has a verified Search Console property, owned by the website owner's Google account.",
      why: "Search Console is how Google is asked to look at new pages and how we see whether they're indexed. It's set up once per website, not once per page.",
      next: "Once you tell me it's set up, it's recorded for the whole site and never asked again. Then the Live URL Test is next.",
    },
    "live-url-test": {
      headline: `Run Google's Live URL Test on ${n}.`,
      what: `Asking Google whether it can reach and index the live ${n} page.`,
      why: "The test shows whether Google can fetch the page and whether anything blocks indexing, before Request Indexing is used.",
      next: "Tell me exactly what Google reports. If it passes, requesting indexing is next.",
    },
    "fix-live-url-test": {
      headline: `Fix what Google's Live URL Test found on ${n}, then test again.`,
      what: `Google's Live URL Test did not pass for ${n}.`,
      why: "A page Google can't fetch or index can't rank, and requesting indexing before it passes wastes the request.",
      next: "Tell me what Google reported; fixes to the site still go through your normal approval and release process. Then the test is run again.",
    },
    "verify-indexing": {
      headline: `Check whether Google has indexed ${n}.`,
      what: `Checking Google's own report of whether ${n} is in its index.`,
      why: `Requesting indexing, a passed test and a successful sitemap don't show the page is indexed — only Search Console's URL Inspection does. The ${c.days}-day review (${c.date}) is due.`,
      next: "I'll record exactly what you report. Once it's indexed, the page moves into monitoring.",
    },
    "google-readiness": {
      headline: `Run the Google readiness check for ${n}.`,
      what: `Checking, read-only on the live page, that Google can technically find and index ${n}: indexable, canonical, robots.txt, sitemap membership, internal links and no staging leaks.`,
      why: "Passing means the page appears technically ready for Google. It does not mean Google has discovered, crawled or indexed it — those are tracked separately afterwards.",
      next: "The result is recorded once. The sitemap and Google's discovery, crawling and indexing are then tracked without further manual steps.",
    },
    "fix-google-readiness": {
      headline: `Fix what the Google readiness check found on ${n}.`,
      what: `Fixing the problems that stop ${n} being ready for Google${c.failures?.length ? `: ${c.failures.join("; ")}` : ""}.`,
      why: "Until they are fixed, Google may not be able to discover or index the page, or may index the wrong version.",
      next: "Site changes still go through your normal approval and release process; then the readiness check runs again.",
    },
    "reconcile-sitemap": {
      headline: "Register the sitemap with Google Search Console.",
      what: "Using the official Search Console API to check whether Google already has the site's sitemap, and submitting it only if it doesn't.",
      why: "The sitemap is how Google hears about every page. It is registered once per website, not once per page — and an already-registered sitemap is never resubmitted.",
      next: "If it is already registered nothing is sent (\"Sitemap already registered with Google Search Console\"). The result is recorded once for the whole site.",
    },
    "check-google-status": {
      headline: `Check Google's discovery, crawl and index status for ${n}.`,
      what: `Asking Search Console's URL Inspection API (read-only) what Google has done with ${n}: ${c.stage ?? "discovery, crawling and indexing"}.`,
      why: "Only Google's own report can show whether a page has been discovered, crawled or indexed. Publishing, the sitemap and a passed test never do.",
      next: "Each stage is recorded separately with its evidence; the page moves into performance monitoring only once Google reports it as indexed.",
    },
    "verify-sitemap": {
      headline: "Confirm the sitemap in Search Console.",
      what: "Confirming Google has this site's sitemap.",
      why: `The sitemap is how Google hears about every page, including new ones. It's checked once per website; a Success status doesn't mean any one page is indexed.${c.apiHint ? ` (This step can be automated once the Search Console API is set up: ${c.apiHint}.)` : ""}`,
      next: "Tell me what you see and I'll record it, so this doesn't come up again.",
    },
    wait: c.awaitingIndexing
      ? {
          headline: `Waiting for Google — ${n} is not yet verified as indexed.`,
          what: "Nothing — the indexing request is in and Google decides when to index it.",
          why: `${n} was published ${c.days ?? "a few"} day(s) ago${c.requestedOn ? ` and indexing was requested on ${c.requestedOn}` : ""}. Where Google is now: ${c.stage ?? "not yet verified"}. Publishing, the sitemap, discovery, crawling and a request are each separate from being indexed, and Google can take days or weeks.`,
          next: `Next check: ${c.date}${c.review ? ` (${c.review}-day review)` : ""}. Then you'll be asked to look at the page in Search Console. Nothing needs re-requesting.`,
        }
      : {
      headline: "No SEO change is needed right now.",
      what: "Nothing — waiting for Google's data.",
      why: `${n} was published ${c.days} day(s) ago and is waiting for useful Search Console data. Changing it now would only muddy the results.`,
      next: `Next planned review: ${c.date} (${c.review}-day review for ${n}).`,
    },
    "pull-index-snapshot": {
      headline: c.stale ? "Refresh the Google indexing snapshot." : "Fetch the Google indexing status for this site.",
      what: c.stale ? `Pulling the latest Google index monitoring data. The last pull is ${c.ageDays} days old.` : "Pulling the site's Google index monitoring data (read-only) so /BWESEO can say which production URLs Google has indexed.",
      why: "The site monitors Google itself on a schedule. /BWESEO only reads the result, and cannot give advice about indexing without it.",
      next: "The data is saved locally (not committed) and this status is shown again with the real numbers.",
    },
    "connect-search-console": {
      headline: "Connect Google Search Console.",
      what: `The index monitor cannot read Google's data: ${c.detail}.`,
      why: "Only Search Console can say whether Google has indexed a page. Until it is connected, indexing is unknown - nothing is being guessed.",
      next: "Follow the site's docs/google-search-console-setup.md (service account, Search Console permission, secret). Then refresh the monitor (the site's admin screen or its next scheduled run).",
    },
    "register-sitemap": {
      headline: "Submit the sitemap to Google.",
      what: "Registering the site's sitemap in Search Console. It is a one-time action; a registered sitemap is never resubmitted.",
      why: "The sitemap is the main way Google learns about new pages.",
      next: "Use the site's own SUBMIT SITEMAP action if it has one, or Search Console > Sitemaps.",
    },
    "repair-sitemap": {
      headline: "Repair sitemap generation.",
      what: `${c.count} published, indexable page(s) are missing from the sitemap.`,
      why: "A page that is not in the sitemap is harder for Google to find. The sitemap should be generated from the same list as the pages themselves.",
      next: "Claude finds why those pages are left out and proposes the fix; the change needs your approval.",
    },
    "investigate-indexing": {
      headline: c.count === 1 ? "Investigate 1 URL Google has not indexed." : `Investigate ${c.count} URLs Google has not indexed.`,
      what: "Reviewing the affected pages for content quality, canonicalization, duplication and internal-linking issues, using only what Google actually reported (listed below).",
      why: "These are diagnostic checks, not guarantees about Google's ranking behaviour. Google chooses what to index; the evidence shows where to look.",
      next: "Claude reads each page's Google status (seo-google-index.mjs investigate / explain) and reports likely causes with evidence. Nothing changes without your approval.",
    },
    "review-impressions": {
      headline: `Review ${c.count} indexed page(s) that receive no impressions.`,
      what: "Reviewing query targeting, SERP competition, titles/descriptions and content usefulness for pages that are indexed but not shown in search.",
      why: "Indexed does not mean visible. Zero impressions is not an indexing problem; it points at how well the page answers real searches.",
      next: "Diagnostic only - no promises about rankings.",
    },
    "register-keywords": {
      headline: "Register the keywords each page should rank for.",
      what: "Recording, for each published page, ONE primary keyword and any secondary keywords in seo/content-inventory.json (pages[].keywords). Nothing is created or changed on the website.",
      why: "Until a page has a target keyword, Search Console data cannot be matched to what the page is for, so we cannot tell whether Google shows the right page.",
      next: "Claude proposes the keywords from the verified profile and the page content; you approve them (/BWESEOSearchConsole keywords add).",
    },
    "pull-keyword-performance": {
      headline: c.stale ? "Refresh the keyword performance data." : "Fetch the keyword performance for this site.",
      what: c.stale ? `Pulling the latest Search Console keyword data. The last pull is ${c.ageDays} days old.` : "Pulling the site's own Search Console keyword data (read-only) so /BWESEO can say which page Google shows for each target keyword.",
      why: "Keyword advice must come from what Google actually reports for this site. This is the site's own Search Console data, not a Google search.",
      next: "The data is saved locally (not committed) and this status is shown again with the real numbers.",
    },
    "fix-keyword-pages": {
      headline: "Resolve indexing and discovery problems on target pages.",
      what: `${c.count} target page(s) have a problem that stops them being found or indexed (noindex, blocked, canonical elsewhere, error, or a Google-reported indexing problem).`,
      why: "A page that cannot be indexed cannot appear for its keyword, whatever its content.",
      next: "Claude shows each problem with its evidence (/BWESEOSearchConsole keywords investigate) and proposes the fix; changes need your approval.",
    },
    "review-target-mismatch": {
      headline: "Review keywords where Google shows a different page, or several pages.",
      what: `${c.count} keyword(s) show another page than the one intended, or several competing pages. Search intent, titles/H1s, overlapping content, canonical tags and internal links are reviewed.`,
      why: "Google appears to associate another page with the search. Nothing is changed automatically - overlapping pages are sometimes legitimate - so the cause is worked out first.",
      next: "Claude compares the pages and recommends a change (never an automatic URL, canonical or deletion).",
    },
    "improve-keyword-snippets": {
      headline: "Improve search-result presentation for pages shown often but rarely clicked.",
      what: `${c.count} keyword(s) are shown frequently and near the top, yet few people click. Titles and descriptions are compared with the queries people actually used.`,
      why: "When the position is already good, the title and description are what decide the click.",
      next: "Claude proposes new titles/descriptions with the reasoning; you approve.",
    },
    "improve-keyword-relevance": {
      headline: "Improve relevance and internal links for pages Google shows but not near the top.",
      what: `${c.count} keyword(s) have impressions but a weak average position. Page usefulness, topical coverage and internal links are reviewed against the search intent.`,
      why: "Google already shows these pages, so small relevance gains can move them up.",
      next: "Claude recommends specific changes with the evidence (/BWESEOSearchConsole keywords analyze).",
    },
    "review-keyword-targeting": {
      headline: `Review keyword targeting for ${c.count} indexed page(s) with no impressions.`,
      what: "Checking whether the keyword has real demand, matches the page's intent, and how the page is linked.",
      why: "Indexed does not mean visible, and zero impressions is not a failure by itself: page age, demand and competition all matter.",
      next: "Diagnostic only - no promises about rankings.",
    },
    "protect-keyword-performance": {
      headline: "Protect what is working and look for related keywords.",
      what: `${c.count} keyword(s) are performing well. Avoid unnecessary rewrites of those pages; review discovered queries for related opportunities.`,
      why: "Strong pages are easy to damage with changes that do not need to be made.",
      next: "/BWESEOSearchConsole keywords discovered lists what Google shows the site for that is not registered yet.",
    },
    idle: {
      headline: "No SEO change is needed right now.",
      what: "Nothing is due.",
      why: "Everything on the roadmap is done, waiting on you, or parked.",
      next: "When you're ready for more pages, /BWESEOOpportunities looks for the next set of searches worth targeting.",
    },
  }[kind];
  return { kind, rank, actor: "claude", approval: null, ...T, ...c };
}

// ---------------------------------------------------------------- evaluate

const byPlan = (a, b) =>
  (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
  (a.roadmapOrder ?? 1e9) - (b.roadmapOrder ?? 1e9) ||
  a.index - b.index;

function guardCheck(config, repo = {}) {
  const want = config.repo ?? {};
  if (isStr(want.gitRemote) && isStr(repo.remote)) {
    return repo.remote.toLowerCase().includes(want.gitRemote.toLowerCase())
      ? { ok: true }
      : {
          ok: false,
          detail: `seo-config.json expects the repo "${want.gitRemote}", but this folder's git remote is ${repo.remote}.`,
        };
  }
  if (isStr(want.rootFolderName) && isStr(repo.folderName)) {
    return want.rootFolderName.toLowerCase() === repo.folderName.toLowerCase()
      ? { ok: true }
      : {
          ok: false,
          detail: `seo-config.json expects the folder "${want.rootFolderName}", but this is "${repo.folderName}".`,
        };
  }
  return { ok: true };
}

function blockRef(ref, p) {
  const n = String(ref)
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*$/, "")
    .trim()
    .replace(/\s+/g, "-");
  return n === p.id || n === p.url || n === p.url.replace(/^\//, "").toLowerCase();
}

function monitoring(p, today) {
  const m = p.postPublication?.monitoring ?? {};
  const done = m.completed ?? {};
  const scheduled = REVIEWS.some(([k]) => isDate(m[k]));
  const due = REVIEWS.filter(([k]) => isDate(m[k]) && m[k] <= today && !done[k]);
  const upcoming = REVIEWS.find(([k]) => isDate(m[k]) && m[k] > today && !done[k]);
  return {
    scheduled,
    complete: scheduled && REVIEWS.every(([k]) => done[k] || !isDate(m[k])),
    due: due.length ? { key: due.at(-1)[0], days: due.at(-1)[1], date: m[due.at(-1)[0]] } : null,
    skipped: due.length > 1 ? due.at(-2)[1] : null,
    next: upcoming ? { key: upcoming[0], days: upcoming[1], date: m[upcoming[0]] } : null,
  };
}

// Site-level Search Console state (engine 1.4.0): one property and one sitemap per website, shared
// by every page. Read from config.analytics.searchConsole; the legacy `sitemapSubmission` flag still
// counts when no `sitemap` object is recorded. Never inferred from anything else.
export function searchConsoleSite(config) {
  const sc = config?.analytics?.searchConsole ?? {};
  const sm = sc.sitemap ?? {};
  const configured = ["yes", "no"].includes(sc.configured) ? sc.configured : "unknown";
  const applicable = config?.publication?.usesSitemap !== false;
  const verified = sc.sitemap
    ? sm.submitted === "yes" && /^success/i.test(sm.status ?? "") && isDate(sm.verifiedOn)
    : sc.sitemapSubmission === "verified";
  return {
    configured,
    propertyType: isStr(sc.propertyType) ? sc.propertyType : null,
    property: isStr(sc.verifiedProperty) ? sc.verifiedProperty : isStr(sc.property) ? sc.property : null,
    method: isStr(sc.verificationMethod) ? sc.verificationMethod : null,
    verifiedOn: isDate(sc.verifiedOn) ? sc.verifiedOn : null,
    sitemap: {
      applicable,
      verified: applicable && verified,
      url: isStr(sm.url) ? sm.url : (config?.publication?.sitemapUrl ?? null),
      status: isStr(sm.status) ? sm.status : null,
      verifiedOn: isDate(sm.verifiedOn) ? sm.verifiedOn : (sc.sitemapSubmissionVerifiedOn ?? null),
      lastRead: isDate(sm.lastRead) ? sm.lastRead : null,
      discoveredPages: Number.isInteger(sm.discoveredPages) ? sm.discoveredPages : null,
      submissionMethod: ["api", "manual"].includes(sm.submissionMethod) ? sm.submissionMethod : null,
      submissionAt: isDate(sm.submissionAt) ? sm.submissionAt : null,
    },
  };
}

// ---------------------------------------------------------------- installation state (engine 1.7.0)
// Is the BWESEO engine installed in this project (by /BWESEOInstall)? `ev.install` is gathered by the
// host: { receipt: { engineVersion, schemaVersion, … } | null, integrity, latestKnown }. A project that
// has SEO records but no receipt was set up before installation receipts existed ("legacy").
export function installOf(evInstall, config) {
  const r = evInstall?.receipt ?? null;
  if (r)
    return {
      status: "installed",
      engineVersion: r.engineVersion ?? null,
      schemaVersion: r.schemaVersion ?? null,
      adapter: r.adapter ?? null,
      integrity: ["verified", "modified", "missing"].includes(evInstall?.integrity) ? evInstall.integrity : "unknown",
      updateAvailable: isStr(evInstall?.latestKnown) && isStr(r.engineVersion) && cmpSemver(evInstall.latestKnown, r.engineVersion) > 0 ? evInstall.latestKnown : null,
    };
  if (config)
    return { status: "legacy", engineVersion: config.engine?.version ?? null, schemaVersion: config.schemaVersion ?? null, adapter: config.adapter ?? null, integrity: "unknown", updateAvailable: null };
  return { status: "not-installed", engineVersion: null, schemaVersion: null, adapter: null, integrity: "unknown", updateAvailable: null };
}
function cmpSemver(a, b) {
  const x = String(a).split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// ---------------------------------------------------------------- Google workflow state (engine 1.7.0)
// Distinct facts, never one boolean: readiness (is the page technically ready?) → sitemap included →
// [site] Search Console property + sitemap registered → Google DISCOVERED → CRAWLED → INDEXED →
// monitoring. None implies the next: published ≠ discovered ≠ crawled ≠ indexed ≠ ranking well ≠
// business conversions. A later stage is only ever set from its own evidence (a date and a source).
export const READINESS_STATUSES = ["PASSED", "FAILED", "PENDING", "UNKNOWN"];
export const DISCOVERY_STATUSES = ["DISCOVERED", "PENDING", "UNKNOWN"];
export const CRAWL_STATUSES = ["CRAWLED", "PENDING", "UNKNOWN"];
const POINTER = /^(env|secret):[A-Z][A-Z0-9_]{2,63}$/;

// The Search Console API integration, from the project's config. A POINTER to where the credential
// lives (never the credential) and booleans — safe to show anywhere. `evApi.available` is supplied by
// a host that can see its own environment (the CLI); the card does not know it.
export function googleApiOf(config, evApi = null) {
  const sc = config?.analytics?.searchConsole ?? {};
  const enabled = sc.enabled === true;
  const pointer = typeof sc.credentialsSource === "string" && POINTER.test(sc.credentialsSource) ? sc.credentialsSource : null;
  const availability = !enabled
    ? "disabled"
    : !pointer
      ? "not-configured"
      : evApi?.available === true
        ? "available"
        : evApi?.available === false
          ? "missing"
          : "unknown";
  return {
    enabled,
    credentialsSource: pointer,
    availability,
    usable: enabled && !!pointer && availability !== "missing",
    reason: !enabled
      ? "the Search Console API integration is not enabled — the Google steps that need it stay manual"
      : !pointer
        ? "no valid credentialsSource (a NAME such as env:BWESEO_GSC_SERVICE_ACCOUNT_JSON) is configured"
        : availability === "missing"
          ? "the credential named by credentialsSource is not set in this environment"
          : null,
    requestIndexing: sc.requestIndexing === "recommended" ? "recommended" : "optional",
    statusCheckDays: Number.isInteger(sc.statusCheckDays) && sc.statusCheckDays > 0 ? sc.statusCheckDays : 7,
  };
}

const normPropertyType = (v) => {
  const t = String(v ?? "").toLowerCase();
  return t === "domain" ? "domain" : /url|prefix/.test(t) ? "url-prefix" : "unknown";
};

// SITE-LEVEL Google facts (shared by every page): property, sitemap registration, API, guardrails.
export function googleSiteSummary(config, evApi = null) {
  const site = searchConsoleSite(config);
  const sm = config?.analytics?.searchConsole?.sitemap ?? {};
  const api = googleApiOf(config, evApi);
  return {
    searchConsole: {
      configured: site.configured,
      property: site.property,
      propertyType: normPropertyType(site.propertyType),
      verificationMethod: site.method,
      verifiedAt: site.verifiedOn,
    },
    sitemap: {
      applicable: site.sitemap.applicable,
      url: site.sitemap.url,
      submitted: ["yes", "no"].includes(sm.submitted) ? sm.submitted : site.sitemap.verified ? "yes" : "unknown",
      submissionMethod: ["api", "manual"].includes(sm.submissionMethod) ? sm.submissionMethod : "unknown",
      submissionAt: isDate(sm.submissionAt) ? sm.submissionAt : null,
      lastVerifiedAt: site.sitemap.verifiedOn,
      lastReadAt: site.sitemap.lastRead,
      status: /^success/i.test(site.sitemap.status ?? "") ? "success" : /error/i.test(site.sitemap.status ?? "") ? "error" : "unknown",
      discoveredUrlCount: site.sitemap.discoveredPages,
      registered: site.sitemap.verified,
    },
    api: { enabled: api.enabled, credentialsSource: api.credentialsSource, availability: api.availability, usable: api.usable, reason: api.reason },
    requestIndexing: api.requestIndexing,
    // Guardrail: Google's Indexing API is only for JobPosting / BroadcastEvent content — never for
    // ordinary SEO pages, however much faster it might seem.
    indexingApi: { ordinaryPagesEligible: false },
  };
}

// ---------------------------------------------------------------- Google index monitoring (engine 1.9.0)
// The site's scheduled monitor (index-monitor*.mjs, run by the site's own scheduler) answers: which production URLs does
// Google know about, which are indexed, which have problems, which need attention? /BWESEO reads its SNAPSHOT
// (seo/data/google-index/snapshot.json, pulled with the developer's own login) - it never calls Google itself for this and
// holds no secret. SEO / Google-indexing health is reported separately from WEBSITE health: nothing here ever touches
// state.liveHealth, a conflict or a deployment recommendation.
export function indexMonitorOf(config) {
  const m = config?.analytics?.searchConsole?.indexMonitor;
  const declared = !!m && typeof m === "object";
  return {
    declared,
    enabled: declared && m.enabled === true,
    staleAfterDays: Number.isInteger(m?.staleAfterDays) && m.staleAfterDays > 0 ? m.staleAfterDays : 3,
    snapshot: declared && m.snapshot && typeof m.snapshot === "object" ? m.snapshot : null,
  };
}

const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const sitemapWord = (sm, notIn) => {
  if (!sm) return { label: "Unknown", ok: null };
  if (sm.status === "NOT_SUBMITTED") return { label: "Not registered with Google — attention required", ok: false };
  if (sm.status === "ERRORS" || sm.status === "UNAVAILABLE") return { label: "Attention required", ok: false };
  if (notIn > 0) return { label: "Attention required — " + notIn + " published page(s) missing from the sitemap", ok: false };
  if (sm.status === "PENDING") return { label: "Registered — Google is still processing it", ok: true };
  return { label: "Healthy", ok: true };
};

// Display model for the dashboard and the actions. snap is { pulledAt, summary } or null.
export function googleIndexOf(config, snap, today = localToday()) {
  const mon = indexMonitorOf(config);
  if (!mon.declared) return { applicable: false };
  const s = snap?.summary ?? null;
  const ageDays = snap?.pulledAt ? (dayOf(snap.pulledAt) ? daysBetween(dayOf(snap.pulledAt), today) : null) : null;
  const base = { applicable: true, enabled: mon.enabled, staleAfterDays: mon.staleAfterDays, pulledAt: snap?.pulledAt ?? null, ageDays, stale: ageDays != null && ageDays > mon.staleAfterDays, hasSnapshot: !!s };
  if (!s) return { ...base, searchConsole: mon.enabled ? "Unknown — no monitoring data pulled yet" : "Not enabled", searchConsoleConnected: false, sitemap: "Unknown", rate: null, counts: null, investigate: [] };
  const sc = s.searchConsole ?? {};
  const connected = sc.connected === true ? "Connected" : sc.status === "NOT_CONFIGURED" ? "Not connected — the Search Console credential is not configured" : sc.connected === false ? "Not connected — " + (sc.lastErrorKind ?? "error") : "Unknown";
  const sm = sitemapWord(s.sitemap, s.notInSitemap ?? 0);
  const counts = {
    productionUrls: s.productionUrls ?? 0, indexed: s.indexed ?? 0, receivingImpressions: s.receivingImpressions ?? 0,
    crawledNotIndexed: s.crawledNotIndexed ?? 0, discoveredNotIndexed: s.discoveredNotIndexed ?? 0, notDiscovered: s.notDiscovered ?? 0,
    blocked: s.blocked ?? 0, canonicalProblems: s.canonicalProblems ?? 0, errors: s.errors ?? 0, notYetChecked: s.notYetChecked ?? 0,
    unavailable: s.unavailable ?? 0, needAttention: s.needAttention ?? 0, notInSitemap: s.notInSitemap ?? 0, indexedNoImpressions: s.indexedNoImpressions ?? 0,
  };
  return {
    ...base,
    searchConsole: connected,
    searchConsoleConnected: sc.connected === true,
    sitemap: sm.label,
    sitemapOk: sm.ok,
    sitemapStatus: s.sitemap?.status ?? null,
    counts,
    rate: s.indexingRate ?? { indexed: counts.indexed, of: counts.productionUrls }, // a plain ratio, deliberately not a score
    lastGoogleCheckAt: s.lastGoogleCheckAt ?? null,
    stagingProtection: s.stagingProtection ?? null,
    timings: s.timings ?? null,
    openAlerts: s.openAlerts ?? 0,
    investigate: Array.isArray(s.attention) ? s.attention : [],
  };
}

// ---------------------------------------------------------------- Keyword performance (engine 1.10.0)
// Which page is meant to rank for each keyword, does Google show it, and how is it doing - from the site's OWN Search Console data.
// Like the index monitor, /BWESEO reads a SNAPSHOT summary pulled with the developer's own login (seo/data/keyword-performance/summary.json);
// it never calls Google itself here and holds no secret. Not a SERP tracker: nothing searches Google.
export function keywordPerformanceOf(config, inventory, snap, today = localToday()) {
  const kp = config?.analytics?.searchConsole?.keywordPerformance;
  const declared = !!kp && typeof kp === "object";
  const enabled = declared && kp.enabled === true;
  const staleAfterDays = Number.isInteger(kp?.staleAfterDays) && kp.staleAfterDays > 0 ? kp.staleAfterDays : 7;
  const pages = (inventory?.pages ?? []).filter((p) => p.status !== "rejected");
  const secondaryOf = (p) => (Array.isArray(p.keywords?.secondary) ? p.keywords.secondary.filter(isStr) : []);
  const withKeywords = pages.filter((p) => p.keywords && typeof p.keywords === "object" && (isStr(p.keywords.primary) || secondaryOf(p).length));
  const published = pages.filter((p) => p.status === "published" || p.status === "update-needed");
  const keywordCount = withKeywords.reduce((n, p) => n + (isStr(p.keywords.primary) ? 1 : 0) + secondaryOf(p).length, 0);
  const s = snap?.summary ?? null;
  const ageDays = snap?.pulledAt ? (dayOf(snap.pulledAt) ? daysBetween(dayOf(snap.pulledAt), today) : null) : null;
  return {
    applicable: declared, enabled, staleAfterDays, keywordCount, pagesWithKeywords: withKeywords.length, publishedPages: published.length,
    unregisteredPublished: published.filter((p) => !withKeywords.includes(p)).length,
    pulledAt: snap?.pulledAt ?? null, ageDays, stale: ageDays != null && ageDays > staleAfterDays, hasSnapshot: !!s, summary: s,
    range: s?.range?.label ?? null,
  };
}

export function keywordSummaryLine(k) {
  const s = k.summary;
  if (!s) return k.keywordCount + " keyword(s) registered - no performance data pulled yet";
  const p = s.byPriority ?? {};
  const parts = [s.keywords + " keyword(s)", (s.withImpressions ?? 0) + " with Google impressions"];
  if (p["FIX NOW"]) parts.push(p["FIX NOW"] + " to fix now");
  if (p["HIGH OPPORTUNITY"]) parts.push(p["HIGH OPPORTUNITY"] + " high opportunity");
  if (s.mismatches) parts.push(s.mismatches + " where Google shows another page");
  if (s.cannibalization) parts.push(s.cannibalization + " with competing pages");
  if (s.indexingUnknown) parts.push(s.indexingUnknown + " indexing unconfirmed");
  if (p["INSUFFICIENT DATA"]) parts.push(p["INSUFFICIENT DATA"] + " too new to judge");
  if (s.discovered) parts.push(s.discovered + " new Google queries");
  return parts.join(" · ");
}

export function indexSummaryLine(g) {
  const c = g.counts;
  if (!c) return "no monitoring data yet";
  const parts = [c.productionUrls + " production URLs", c.indexed + " indexed"];
  if (c.crawledNotIndexed) parts.push(c.crawledNotIndexed + " crawled — not indexed");
  if (c.discoveredNotIndexed) parts.push(c.discoveredNotIndexed + " discovered — not indexed");
  if (c.notDiscovered) parts.push(c.notDiscovered + " not discovered");
  if (c.blocked) parts.push(c.blocked + " blocked");
  if (c.canonicalProblems) parts.push(c.canonicalProblems + " canonical/duplicate");
  if (c.errors) parts.push(c.errors + " fetch errors");
  if (c.notYetChecked) parts.push(c.notYetChecked + " not checked yet");
  return parts.join(" · ");
}

const evidenceLines = (g, limit = 12) =>
  g.investigate.slice(0, limit).map((i) => {
    const crawl = i.lastCrawl ? "last Google crawl " + String(i.lastCrawl).slice(0, 10) : "no Google crawl reported";
    return i.path + " - Google says \"" + (i.googleStatus ?? i.state) + "\"; " + crawl + "; checked " + String(i.lastCheckedAt ?? "-").slice(0, 10) + (i.reason ? ". " + i.reason : "");
  });

// PAGE-LEVEL Google facts, normalized from postPublication.google (+ legacy fields). Anything without
// its evidence (a date and a source) is UNKNOWN — a later stage is never inferred from an earlier one.
function googleOf(p, pp) {
  const g = pp?.google ?? {};
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);
  const list = (v) => (Array.isArray(v) ? v.filter(isStr).slice(0, 20) : []);
  const r = g.readiness ?? {};
  const rOk = r.status === "PASSED" || r.status === "FAILED" ? isDate(r.checkedAt) && isStr(r.source) : true;
  const readiness = {
    status: rOk ? oneOf(r.status, READINESS_STATUSES, "UNKNOWN") : "UNKNOWN",
    checkedAt: isDate(r.checkedAt) ? r.checkedAt : null,
    source: isStr(r.source) ? r.source : null,
    failures: list(r.failures),
    warnings: list(r.warnings),
    items: Array.isArray(r.items) ? r.items.filter((i) => i && isStr(i.id)).slice(0, 40) : [],
    note: isStr(r.note) ? r.note : null,
  };
  const evid = (o, ok, done) => {
    const good = o?.status === done && isDate(o?.at) && isStr(o?.source);
    return {
      status: good ? done : oneOf(o?.status, ok, "UNKNOWN") === done ? "UNKNOWN" : oneOf(o?.status, ok, "UNKNOWN"),
      at: isDate(o?.at) ? o.at : null,
      source: isStr(o?.source) ? o.source : null,
      evidence: isStr(o?.evidence) ? o.evidence : null,
      note: isStr(o?.note) ? o.note : null,
    };
  };
  const sm = g.sitemap ?? {};
  const fromItems = readiness.status === "PASSED" && readiness.items.find((i) => i.id === "sitemapIncluded")?.status === "pass";
  const included =
    ["yes", "no"].includes(sm.included) && (sm.included === "no" || isDate(sm.verifiedAt))
      ? { status: sm.included, verifiedAt: isDate(sm.verifiedAt) ? sm.verifiedAt : null, lastmod: isStr(sm.lastmod) ? sm.lastmod : null, source: isStr(sm.source) ? sm.source : null }
      : fromItems
        ? { status: "yes", verifiedAt: readiness.checkedAt, lastmod: null, source: readiness.source }
        : pp?.sitemapStatus === "included" && isDate(pp?.checkedOn)
          ? { status: "yes", verifiedAt: pp.checkedOn, lastmod: null, source: "post-publication check" }
          : { status: "unknown", verifiedAt: null, lastmod: null, source: null };
  const pf = g.performance;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const performance =
    pf && typeof pf === "object" && isDate(pf.checkedAt)
      ? {
          checkedAt: pf.checkedAt,
          windowDays: Number.isInteger(pf.windowDays) ? pf.windowDays : null,
          source: isStr(pf.source) ? pf.source : null,
          impressions: n(pf.impressions),
          clicks: n(pf.clicks),
          ctr: n(pf.ctr),
          position: Number.isFinite(Number(pf.position)) ? Number(pf.position) : null,
          hasData: n(pf.impressions) > 0 || n(pf.clicks) > 0,
          queries: (Array.isArray(pf.queries) ? pf.queries : []).slice(0, 10).map((q) => ({ query: String(q?.query ?? "").slice(0, 120), clicks: n(q?.clicks), impressions: n(q?.impressions) })),
          conversions: pf.conversions && typeof pf.conversions === "object" ? { qualifiedLeads: n(pf.conversions.qualifiedLeads), prototypeRequests: n(pf.conversions.prototypeRequests), source: isStr(pf.conversions.source) ? pf.conversions.source : null } : null,
        }
      : null;
  return {
    readiness,
    sitemapIncluded: included,
    discovered: evid(g.discovered, DISCOVERY_STATUSES, "DISCOVERED"),
    crawled: evid(g.crawled, CRAWL_STATUSES, "CRAWLED"),
    performance,
    lastCheckedOn: isDate(g.lastCheckedOn) ? g.lastCheckedOn : null,
    indexingApiEligible: false, // ordinary pages never qualify; see docs (Indexing API guardrail)
  };
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function indexingOutstanding(p) {
  const sc = p.postPublication?.searchConsole ?? {};
  if (sc.indexingRequest === "REQUESTED") return false;
  if (sc.indexingRequest === "REQUEST FAILED") return true;
  if (isStr(sc.requestSource)) return false; // the owner decided not to — recorded, not nagged
  return !p.postPublication?.monitoring?.completed?.review7;
}

function historyOf(p, src) {
  const pp = p.postPublication ?? {};
  const m = pp.monitoring ?? {};
  const h = {
    proposed: p.proposedOn ?? null,
    approved: p.approvedOn ?? null,
    created: p.created ?? null,
    lastModified: p.lastModifiedOn ?? (src?.modifiedOn ? `${src.modifiedOn} (file date)` : null),
    lastQa: p.qa?.date ? `${p.qa.date} (${p.qa.result})` : null,
    published: p.publishedOn ?? null,
    postPublicationCheck: pp.checkedOn ? `${pp.checkedOn} (${pp.result})` : null,
    indexingRequest: pp.searchConsole?.indexingRequest
      ? `${pp.searchConsole.indexingRequest}${pp.searchConsole.requestedOn ? ` ${pp.searchConsole.requestedOn}` : ""}`
      : null,
    reviews: Object.fromEntries(
      REVIEWS.filter(([k]) => isDate(m[k])).map(([k]) => [
        k,
        m.completed?.[k] ? `done ${m.completed[k]}` : `due ${m[k]}`,
      ]),
    ),
    lastRefresh: p.lastRefreshedOn ?? null,
    nextReview: p.nextReview ?? null,
  };
  if (!Object.keys(h.reviews).length) delete h.reviews;
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v != null));
}

const row = (key, label, status, detail = null) => ({ key, label, status, detail });

// ================================================================ LIVE SITE HEALTH
// Two independent models (engine 1.5.0):
//   LIFECYCLE  — durable, historical milestones a page has completed (created, QA, production,
//                Search Console steps …). Recorded facts; reversed ONLY by verified evidence of a
//                deliberate state-changing event (`production.reversal`), never by a failed request.
//   HEALTH     — what the checker observed just now: can it reach the site? A current observation.
// A failed availability check never reverses a completed milestone. Health is provider-independent
// (HTTP/DNS/timeout classes); provider-specific hints (e.g. CDN 52x codes) are details only.
export const LIVE_HEALTH_LABEL = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  UNAVAILABLE: "Unavailable",
  CHECK_FAILED: "Health check unavailable",
  UNKNOWN: "Not checked",
};
export const LIVE_HEALTH_MARKS = {
  HEALTHY: "✓",
  DEGRADED: "⚠",
  UNAVAILABLE: "✗",
  CHECK_FAILED: "⚠",
  UNKNOWN: "?",
};
export const HEALTH_ESCALATE_AFTER = 3; // consecutive failed checks before CHECK_FAILED → UNAVAILABLE

// What kind of observation was this? ok / redirected / page-missing / access-restricted /
// rate-limited / server-error / edge-error / client-error, or (no response) timeout / dns /
// connection / unknown.
export function healthCategory(obs) {
  if (!obs) return null;
  if (obs.error) {
    const m = String(obs.error);
    if (/timeout|timed out|aborted/i.test(m)) return "timeout";
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(m)) return "dns";
    if (/ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|fetch failed|network|socket|tls|certificate/i.test(m))
      return "connection";
    return "unknown";
  }
  const c = obs.status;
  if (c >= 200 && c < 300) return obs.redirected ? "redirected" : "ok";
  if (c >= 300 && c < 400) return "ok";
  if (c === 404 || c === 410) return "page-missing";
  if (c === 401 || c === 403) return "access-restricted";
  if (c === 429) return "rate-limited";
  if (c >= 520 && c <= 527) return "edge-error";
  if (c >= 500) return "server-error";
  return "client-error";
}

const WHAT = (obs, cat) =>
  cat === "timeout"
    ? "the check timed out"
    : cat === "dns"
      ? "DNS lookup failed"
      : cat === "connection"
        ? "connection failed"
        : obs.error
          ? "the check failed"
          : `HTTP ${obs.status}`;
const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function healthFor(env, obs, ctx, prev) {
  const Env = capital(env);
  const base = {
    environment: env,
    url: ctx.url ?? null,
    source: ctx.source ?? HEALTH_SOURCE,
    httpStatus: null,
    checkedAt: null,
    responseTimeMs: null,
    errorType: null,
    errorMessage: null,
    consecutiveFailures: prev?.consecutiveFailures ?? 0,
    lastSuccessfulCheck: prev?.lastSuccess?.checkedAt ?? null,
    lastSuccessfulHttpStatus: prev?.lastSuccess?.httpStatus ?? null,
    providerHint: null,
  };
  if (!obs)
    return {
      ...base,
      status: "UNKNOWN",
      severity: "info",
      message: `${Env} not checked${ctx.reason ? ` — ${ctx.reason}` : ""}`,
    };
  const cat = healthCategory(obs);
  const seen = {
    ...base,
    httpStatus: obs.status ?? null,
    checkedAt: obs.checkedAt ?? null,
    responseTimeMs: obs.ms ?? null,
    errorType: cat === "ok" || cat === "redirected" ? null : cat,
    errorMessage: obs.error ?? null,
    providerHint: cat === "edge-error" ? "CDN / edge-provider error (origin unreachable or timing out)" : null,
  };
  if (cat === "ok" || cat === "redirected") {
    const ok = {
      ...seen,
      consecutiveFailures: 0,
      lastSuccessfulCheck: obs.checkedAt ?? base.lastSuccessfulCheck,
      lastSuccessfulHttpStatus: obs.status ?? base.lastSuccessfulHttpStatus,
    };
    const notes = [];
    if (ctx.pagesFailed) notes.push(`${ctx.pagesFailed} of ${ctx.pagesTotal} pages could not be checked (they keep their recorded status)`);
    if (ctx.pagesMissing) notes.push(`${ctx.pagesMissing} page(s) returned HTTP 404/410 — investigation required (a content problem, not a health failure)`);
    return ctx.pagesFailed
      ? { ...ok, status: "DEGRADED", severity: "warning", message: `${Env} partly checked — ${notes.join("; ")}` }
      : {
          ...ok,
          status: "HEALTHY",
          severity: "info",
          message: `${Env} healthy — HTTP ${obs.status}${notes.length ? `; ${notes.join("; ")}` : ""}`,
        };
  }
  const failures = (prev?.consecutiveFailures ?? 0) + 1;
  const withFail = { ...seen, consecutiveFailures: failures };
  if (cat === "page-missing")
    return {
      ...withFail,
      status: "DEGRADED",
      severity: "warning",
      message: `${Env} returned HTTP ${obs.status} on the home page — investigation required`,
    };
  if (cat === "access-restricted")
    return {
      ...withFail,
      status: "CHECK_FAILED",
      severity: "warning",
      message: `${Env} check restricted — HTTP ${obs.status} (the checker may be blocked; that is not proof the site is down)`,
    };
  if (cat === "rate-limited")
    return {
      ...withFail,
      status: "CHECK_FAILED",
      severity: "warning",
      message: `${Env} check rate-limited — HTTP 429`,
    };
  const what = WHAT(obs, cat);
  return failures >= HEALTH_ESCALATE_AFTER
    ? {
        ...withFail,
        status: "UNAVAILABLE",
        severity: "critical",
        message: `${Env} appears unavailable — investigation recommended (${what}; ${failures} consecutive failed checks)`,
      }
    : {
        ...withFail,
        status: "CHECK_FAILED",
        severity: "warning",
        message: `${Env} health check temporarily unavailable — ${what}${failures > 1 ? ` (${failures} consecutive failed checks)` : ""}`,
      };
}

// history = { production?: { consecutiveFailures, lastSuccess: { checkedAt, httpStatus }, lastCheck },
//             staging?: … } — read from seo/data/live-health.json when present (see nextHealthHistory).
export function liveHealthOf(live, history = null) {
  const pages = Object.values(live?.pages ?? {});
  const production = healthFor(
    "production",
    live?.homeProbe ?? null,
    {
      url: live?.origin,
      source: live?.source,
      reason: live?.reason,
      pagesTotal: pages.length,
      pagesFailed: live?.productionHealth?.failed ?? 0,
      pagesMissing: pages.filter((r) => classifyProbe(r) === "missing").length,
    },
    history?.production,
  );
  const staging = healthFor(
    "staging",
    live?.staging?.homeProbe ?? null,
    { url: live?.staging?.origin, source: live?.source, reason: live?.staging?.reason },
    history?.staging,
  );
  return { production, staging };
}

// The history to persist after this check (the CLI's --record-health writes it to
// seo/data/live-health.json). Only an actual observation is recorded; nothing is invented.
export function nextHealthHistory(liveHealth, prev = null) {
  const one = (h, p) =>
    h?.checkedAt
      ? {
          consecutiveFailures: h.consecutiveFailures,
          lastCheck: { status: h.status, httpStatus: h.httpStatus, checkedAt: h.checkedAt },
          lastSuccess:
            h.status === "HEALTHY" || h.status === "DEGRADED"
              ? { checkedAt: h.checkedAt, httpStatus: h.httpStatus }
              : (p?.lastSuccess ?? null),
        }
      : (p ?? null);
  return {
    production: one(liveHealth?.production, prev?.production),
    staging: one(liveHealth?.staging, prev?.staging),
  };
}

export function evaluateState(ev, opts = {}) {
  const today = opts.today ?? ev.today ?? localToday();
  const config = ev.config ?? null;
  const profile = ev.profile ?? null;
  const inventory = ev.inventory ?? null;
  const state = {
    version: STATE_VERSION,
    today,
    business: profile?.identity?.businessName?.value || config?.projectId || null,
    website: config?.website ?? null,
    liveCheck: ev.live?.checked
      ? "checked"
      : `not checked${ev.live?.reason ? ` — ${ev.live.reason}` : ""}`,
    stages: [],
    pages: [],
    issues: [],
    blockers: [],
    conflicts: [],
    warnings: [],
    actions: [],
    recommendation: null,
    alsoForYou: [],
    focusPageId: null,
    environment: null,
  };
  const add = (a) => {
    state.actions.push(a);
    return a;
  };

  // ---- installation, setup and guard
  state.install = installOf(ev.install, config);
  if (!config) {
    if (state.install.status === "not-installed") {
      // A brand-new project: the engine itself comes first. Installing is separate from onboarding.
      state.stages.push(row("install", "BWESEO engine", S.NOT_STARTED, "not installed"));
      add(action("install", 5, { skill: "BWESEOInstall", row: "install", approval: "setup" }));
      return finish(state);
    }
    state.stages.push(
      row("install", "BWESEO engine", S.COMPLETE, `v${state.install.engineVersion}, schema ${state.install.schemaVersion}`),
    );
    state.stages.push(row("setup", "SEO setup", S.NOT_STARTED));
    add(action("setup", 10, { skill: "BWESEOSetup", row: "setup", approval: "setup", installed: true }));
    return finish(state);
  }
  const guard = guardCheck(config, ev.repo);
  if (!guard.ok) {
    state.stages.push(row("setup", "SEO setup", S.BLOCKED, "wrong project"));
    add(action("guard-mismatch", 0, { actor: "user", detail: guard.detail, row: "setup" }));
    return finish(state);
  }
  if (!profile || !inventory) {
    const missing = [!profile && "business profile", !inventory && "content inventory"].filter(
      Boolean,
    );
    const detail = ev.parseErrors?.length
      ? `a file couldn't be read (${ev.parseErrors[0]})`
      : `missing: ${missing.join(", ")}`;
    state.stages.push(row("setup", "SEO setup", S.IN_PROGRESS, detail));
    add(action("setup-incomplete", 12, { skill: "BWESEOSetup", detail, row: "setup" }));
    return finish(state);
  }

  const errors = ev.validation?.errors ?? [];
  state.warnings.push(...(ev.validation?.warnings ?? []));
  if (config.engine?.version && config.engine.version !== STATE_VERSION) {
    state.warnings.push(
      `project is on engine ${config.engine.version}; these tools are ${STATE_VERSION}`,
    );
  }
  if (errors.length)
    add(action("fix-data", 20, { errors: errors.slice(0, 8), errorCount: errors.length }));

  const origin = productionOrigin(config);
  const pages = inventory.pages.map((p, index) => ({ ...p, index }));

  // ---- environments: where production and staging are, and whether each behaves as it must —
  // production indexable, staging hidden from search engines. Only production ever gets
  // search-engine indexing actions.
  const envs = environmentsOf(config);
  const stagingOn = envs.staging.status === "configured";
  state.liveHealth = liveHealthOf(ev.live, ev.healthHistory);
  state.google = googleSiteSummary(config, ev.googleApi);
  state.googleIndex = googleIndexOf(config, ev.googleIndex ?? null, today);
  state.keywords = keywordPerformanceOf(config, inventory, ev.keywordPerformance ?? null, today);
  const liveProd = ev.live?.checked ? (ev.live.production ?? null) : null;
  const liveStg = ev.live?.staging?.checked ? ev.live.staging : null;
  const prodHome = liveProd?.home;
  const prodIndexable =
    !prodHome || prodHome.error
      ? { ok: null, detail: "not checked" }
      : prodHome.status >= 400
        ? // A missing or broken page is reported by the page checks; this check is about noindex
          // and robots.txt — a staging-only setting reaching production.
          { ok: null, detail: `not checked — the home page returns HTTP ${prodHome.status}` }
        : prodHome.robots?.noindex
          ? {
              ok: false,
              detail: `the home page says noindex (${[prodHome.robots.header, ...prodHome.robots.meta].filter(Boolean).join(" | ")})`,
            }
          : liveProd.robots?.blocksAll
            ? {
                ok: false,
                detail: "robots.txt blocks the whole site (User-agent: * / Disallow: /)",
              }
            : { ok: true, detail: "indexable — home page and robots.txt checked" };
  const envIssue = (inventory.issues ?? []).find(
    (i) => i.area === "environment" && i.status !== "verified",
  );
  const protection = !stagingOn
    ? { level: "not-applicable", detail: `staging is ${envs.staging.status}` }
    : !liveStg
      ? { level: "unknown", detail: ev.live?.staging?.reason ?? "not checked" }
      : {
          ...indexProtection(liveStg.home, liveStg.robots),
          fixPending: envIssue?.status === "fixed",
        };
  state.environment = {
    current: null,
    production: envs.production
      ? {
          url: envs.production.url,
          hosts: envs.production.hosts,
          checked: !!liveProd,
          indexable: prodIndexable,
        }
      : null,
    staging: {
      status: envs.staging.status,
      url: envs.staging.url,
      hosts: envs.staging.hosts,
      checked: !!liveStg,
      protection,
    },
    preview: { status: envs.preview.status, hostPatterns: envs.preview.hostPatterns },
  };
  if (prodIndexable.ok === false) {
    state.conflicts.push(
      `CRITICAL SEO ERROR — production is not indexable: ${prodIndexable.detail}`,
    );
    add(
      action("production-not-indexable", 90, {
        skill: "BWESEOTechnical",
        approval: "change",
        detail: prodIndexable.detail,
      }),
    );
  }
  // A production HEALTH problem is investigated as health: never a redeploy, never a repeat of a
  // completed lifecycle step. First failure → re-check; repeated failures → investigate.
  const ph = state.liveHealth.production;
  if (
    ["CHECK_FAILED", "UNAVAILABLE"].includes(ph.status) &&
    (inventory.pages ?? []).some((p) => ["published", "update-needed"].includes(p.status))
  ) {
    add(
      action("investigate-health", ph.status === "UNAVAILABLE" ? 95 : 130, {
        skill: "BWESEOTechnical",
        detail: ph.message,
        repeated: ph.status === "UNAVAILABLE",
        failures: ph.consecutiveFailures,
        httpStatus: ph.httpStatus,
        lastSuccess: ph.lastSuccessfulCheck,
      }),
    );
  }
  // An environment issue in the inventory (open, approved, fixed-awaiting-deploy, deferred…)
  // already carries this decision; only without one does the live finding become an action.
  if (stagingOn && liveStg && !envIssue) {
    const c = {
      actor: "user",
      approval: "change",
      skill: "BWESEOTechnical",
      stagingUrl: envs.staging.url,
      detail: protection.detail,
    };
    if (protection.level === "none") {
      state.conflicts.push(
        `Staging (${envs.staging.url}) is not hidden from search engines: ${protection.detail}`,
      );
      add(action("staging-exposed", 140, c));
    } else if (protection.level === "weak") {
      add(action("strengthen-staging", 420, c));
    }
  }
  // Google indexing (separate from website health: these never become conflicts and never mention a redeploy).
  const gi = state.googleIndex;
  if (gi.applicable && gi.enabled) {
    if (!gi.hasSnapshot) add(action("pull-index-snapshot", 285, { skill: "BWESEOSearchConsole", args: "index pull", stale: false }));
    else {
      const c = gi.counts;
      if (gi.stale) add(action("pull-index-snapshot", 610, { skill: "BWESEOSearchConsole", args: "index pull", stale: true, ageDays: gi.ageDays }));
      if (!gi.searchConsoleConnected && gi.searchConsole.startsWith("Not connected"))
        add(action("connect-search-console", 280, { actor: "user", manual: true, detail: gi.searchConsole.replace(/^Not connected — /, ""), skill: null, command: "docs/google-search-console-setup.md" }));
      else if (gi.sitemapStatus === "NOT_SUBMITTED") add(action("register-sitemap", 281, { actor: "user", manual: true, skill: null, command: "Search Console > Sitemaps (or the site's own SUBMIT SITEMAP action)" }));
      if (c.notInSitemap > 0) add(action("repair-sitemap", 282, { count: c.notInSitemap, approval: "change", skill: "BWESEOTechnical" }));
      // Only pages the monitor flags (past the grace periods) - a page published yesterday is not a problem yet.
      const problems = c.needAttention;
      if (problems > 0) add(action("investigate-indexing", 288, { count: problems, evidence: evidenceLines(gi), skill: "BWESEOSearchConsole", args: "index investigate" }));
      if (c.indexedNoImpressions > 0) add(action("review-impressions", 480, { count: c.indexedNoImpressions, skill: "BWESEOSearchConsole", args: "index impressions" }));
    }
  }
  // Keyword performance (engine 1.10.0): the next useful action from what Google actually reports for each target keyword.
  // Separate from website health and from indexing health; never a conflict, never a redeploy.
  const kw = state.keywords;
  if (kw.applicable && kw.enabled) {
    const sm = kw.summary;
    if (kw.keywordCount === 0 && kw.publishedPages > 0) add(action("register-keywords", 470, { count: kw.unregisteredPublished, skill: "BWESEOSearchConsole", args: "keywords add", approval: "change" }));
    else if (kw.keywordCount > 0 && !kw.hasSnapshot) add(action("pull-keyword-performance", 286, { skill: "BWESEOSearchConsole", args: "keywords pull", stale: false }));
    else if (kw.hasSnapshot) {
      if (kw.stale) add(action("pull-keyword-performance", 611, { skill: "BWESEOSearchConsole", args: "keywords pull", stale: true, ageDays: kw.ageDays }));
      const p = sm.byPriority ?? {};
      const problems = Math.max(p["FIX NOW"] ?? 0, sm.notIndexed ?? 0);
      if (problems > 0) add(action("fix-keyword-pages", 289, { count: problems, skill: "BWESEOSearchConsole", args: "keywords investigate" }));
      const wrong = (sm.mismatches ?? 0) + (sm.cannibalization ?? 0);
      if (wrong > 0) add(action("review-target-mismatch", 292, { count: wrong, skill: "BWESEOSearchConsole", args: "keywords analyze" }));
      if ((sm.lowCtr ?? 0) > 0) add(action("improve-keyword-snippets", 483, { count: sm.lowCtr, skill: "BWESEOSearchConsole", args: "keywords analyze", approval: "change" }));
      const weak = Math.max(sm.nearPageOne ?? 0, (p.IMPROVE ?? 0) - wrong);
      if (weak > 0) add(action("improve-keyword-relevance", 484, { count: weak, skill: "BWESEOSearchConsole", args: "keywords analyze", approval: "change" }));
      if ((sm.indexedNoImpressions ?? 0) > 0) add(action("review-keyword-targeting", 486, { count: sm.indexedNoImpressions, skill: "BWESEOSearchConsole", args: "keywords analyze" }));
      if ((p.HEALTHY ?? 0) > 0) add(action("protect-keyword-performance", 740, { count: p.HEALTHY, skill: "BWESEOSearchConsole", args: "keywords discovered" }));
    }
  }
  const openQs = (profile.openQuestions ?? []).filter((q) => !q.answeredOn);
  const qById = new Map(openQs.map((q) => [q.id, q]));

  // ---- project stages
  const blockingQs = openQs.filter((q) => q.blocking === true);
  const optionalQs = openQs.length - blockingQs.length;
  const profileStale =
    isDate(profile.lastReviewed) && daysBetween(profile.lastReviewed, today) > STALE_DAYS;
  state.stages.push(
    row(
      "profile",
      "Business profile",
      blockingQs.length ? S.BLOCKED : S.COMPLETE,
      blockingQs.length
        ? `${blockingQs.length} question${blockingQs.length === 1 ? " needs" : "s need"} your answer`
        : [
            optionalQs && `${optionalQs} optional question${optionalQs === 1 ? "" : "s"} open`,
            profileStale && `last reviewed ${profile.lastReviewed}`,
          ]
            .filter(Boolean)
            .join("; ") || null,
    ),
  );
  if (blockingQs.length) {
    add(
      action("answer-question", 30, {
        actor: "user",
        questions: blockingQs.map((q) => ({ id: q.id, question: q.question })),
        blocked: "The SEO work",
      }),
    );
  }
  if (profileStale) {
    add(
      action("reverify-profile", 760, {
        skill: "BWESEOSetup",
        date: profile.lastReviewed,
        row: "profile",
      }),
    );
  }

  const docs = ev.docs ?? {};
  const audited = docs.baseline?.exists && docs.baseline.hasContent;
  const auditStale = audited && daysBetween(docs.baseline.updated, today) > STALE_DAYS;
  state.stages.push(
    row(
      "audit",
      "Site audit",
      audited ? S.COMPLETE : S.NOT_STARTED,
      audited ? `${docs.baseline.updated}${auditStale ? " — due for a fresh audit" : ""}` : null,
    ),
  );
  if (!audited) add(action("audit", 40, { skill: "BWESEOAudit", row: "audit" }));
  else if (auditStale)
    add(
      action("re-audit", 750, { skill: "BWESEOAudit", date: docs.baseline.updated, row: "audit" }),
    );

  const hasOpportunities = pages.some(
    (p) => OPPORTUNITY_STATUSES.has(p.status) || p.priority || p.approvedBy === "user",
  );
  state.stages.push(
    row(
      "opportunities",
      "Opportunity analysis",
      hasOpportunities ? S.COMPLETE : audited ? S.NOT_STARTED : S.WAITING,
    ),
  );
  if (audited && !hasOpportunities)
    add(action("opportunities", 50, { skill: "BWESEOOpportunities", row: "opportunities" }));

  const planned = docs.roadmap?.exists && docs.roadmap.hasContent;
  state.stages.push(
    row(
      "roadmap",
      "Content roadmap",
      planned ? S.COMPLETE : hasOpportunities ? S.NOT_STARTED : S.WAITING,
    ),
  );
  if (hasOpportunities && !planned)
    add(action("content-plan", 60, { skill: "BWESEOContentPlan", row: "roadmap" }));
  if (planned && !hasOpportunities) {
    state.warnings.push(
      "the roadmap document exists, but the inventory has no planned pages — the two disagree",
    );
  }

  // ---- pages
  const waiting = [];
  const staleForRefresh = [];
  for (const p of pages) {
    if (p.status === "rejected") continue;
    const src = ev.sources?.[p.id] ?? null;
    const live = ev.live?.checked ? (ev.live.pages?.[p.id] ?? null) : null;
    const stg = liveStg ? (liveStg.pages?.[p.id] ?? null) : null;
    const name = pageName(p);
    const url = pageUrl(p, origin);
    const ps = {
      id: p.id,
      name,
      url: p.url,
      status: p.status,
      priority: p.priority ?? null,
      roadmapOrder: p.roadmapOrder ?? null,
      index: p.index,
      summary: null,
      rows: null,
      blockers: [],
      staleBlockers: [],
      history: historyOf(p, src),
      hold: p.hold ?? null,
    };
    state.pages.push(ps);
    const base = {
      pageId: p.id,
      name,
      url,
      priority: p.priority ?? null,
      roadmapOrder: p.roadmapOrder,
      index: p.index,
      staged: stagingOn,
    };

    // Blockers: open questions this page waits on — only while work on it is still ahead (a
    // built or live page isn't held up by them). A blockedBy id that is no longer an open
    // question has been answered — treat it as resolved, but say so (the record is stale).
    const workAhead = ["idea", "planned", "approved", "draft", "update-needed"].includes(p.status);
    for (const id of workAhead ? (p.blockedBy ?? []) : []) {
      if (qById.has(id)) ps.blockers.push(qById.get(id));
      else ps.staleBlockers.push(id);
    }
    for (const q of workAhead ? openQs : []) {
      if (!ps.blockers.includes(q) && (q.blocks ?? []).some((b) => blockRef(b, p)))
        ps.blockers.push(q);
    }
    if (ps.staleBlockers.length) {
      state.warnings.push(
        `${name}: blockedBy ${ps.staleBlockers.join(", ")} is no longer an open question — treated as resolved`,
      );
    }
    const blocked = ps.blockers.length > 0;
    if (blocked)
      state.blockers.push({ pageId: p.id, name, questions: ps.blockers.map((q) => q.question) });
    const holdAll = p.hold?.scope === "all";
    const holdDeploy = p.hold && !holdAll;
    const holdAction = () =>
      add(
        action("resume-hold", 850, {
          ...base,
          actor: "user",
          approval: "resume",
          date: p.hold.since,
          reason: p.hold.reason,
        }),
      );

    // Refresh evidence recorded by /BWESEORefresh or a Search Console review.
    if (
      ["published", "update-needed"].includes(p.status) &&
      isStr(p.refresh?.trigger) &&
      isStr(p.refresh?.evidence) &&
      !p.refresh.resolvedOn
    ) {
      add(
        action("refresh-page", 450, {
          ...base,
          skill: "BWESEORefresh",
          args: p.id,
          approval: "change",
          trigger: p.refresh.trigger,
          evidence: p.refresh.evidence,
        }),
      );
      ps.summary = "Live — improvement recommended";
    }

    // Is it on production? Only a live check can say.
    // The ONLY thing that reverses a completed Production milestone: verified evidence of a
    // deliberate state-changing event, recorded as `production.reversal` (a rollback, a removal, a
    // reverted deployment). A failed request never does. The history is kept, not rewritten.
    const reversal = p.production?.reversal ?? null;
    const reversed = !!reversal && isDate(reversal.date) && isStr(reversal.source);
    // A failed check (5xx, timeout, network) is a health problem only: it never counts as
    // "missing" and never touches the lifecycle. Only 404/410 (or a redirect to another page)
    // is a conflict, and even then the recorded history stays as it is.
    const liveKind = classifyProbe(live);
    const liveOk = liveKind === "ok";
    const liveGone = liveKind === "missing" || liveKind === "redirected";
    const liveDetail =
      liveKind === "redirected"
        ? `redirects to ${pathOf(live.finalUrl)}`
        : live?.status
          ? `returns HTTP ${live.status}`
          : "";
    if (liveKind === "unavailable") ps.liveCheck = { kind: "unavailable", detail: describeProbe(live) };
    else if (liveGone) ps.liveCheck = { kind: liveKind, detail: liveDetail };
    else if (ev.live?.productionHealth?.status === "unavailable")
      ps.liveCheck = { kind: "unavailable", detail: ev.live.productionHealth.detail };

    // On staging? Only a live check of the staging site can say; a page's own verifyText proves
    // it's this version, not an older one.
    const stagingOk = stg && !stg.error && stg.status >= 200 && stg.status < 300 && !stg.redirected;
    const onStaging = stagingOk && (isStr(p.verifyText) ? stg.hasVerifyText === true : true);

    if (["published", "update-needed"].includes(p.status) && liveGone && !reversed) {
      state.conflicts.push(
        onStaging
          ? `PRODUCTION PAGE ${liveKind === "redirected" ? "MOVED" : "MISSING"} — ${name}: ${url} ${liveDetail} (still served on staging; recorded lifecycle unchanged — investigate)`
          : `PRODUCTION PAGE ${liveKind === "redirected" ? "MOVED" : "MISSING"} — ${name}: the inventory says it's live, but ${url} ${liveDetail} (recorded lifecycle unchanged — investigate)`,
      );
      // Investigation, never a republish: /BWESEOPublish is only recommended when independent
      // lifecycle evidence says publication is actually required (no post-publication record).
      add(
        action("conflict-not-live", 100, {
          ...base,
          skill: "BWESEOTechnical",
          detail: liveDetail,
          onStaging,
          moved: liveKind === "redirected",
          publishedOn: p.publishedOn,
          row: "deployment",
        }),
      );
    }

    if (
      ["idea", "planned"].includes(p.status) ||
      (p.status === "update-needed" && !p.postPublication)
    ) {
      if (!ps.summary) {
        ps.summary = blocked
          ? "Blocked — needs an answer from you"
          : p.status === "update-needed"
            ? p.priority
              ? "Existing page — improvement planned"
              : "Existing page — improvement recommended"
            : p.status === "planned"
              ? "Planned"
              : "Idea";
      }
      if (
        p.status === "update-needed" &&
        isDate(p.lastReviewed) &&
        daysBetween(p.lastReviewed, today) > STALE_DAYS
      ) {
        staleForRefresh.push(p);
      }
      continue;
    }

    if (p.status === "published" && !p.postPublication && p.approvedBy !== "user") {
      ps.summary ??= "Live";
      if (isDate(p.lastReviewed) && daysBetween(p.lastReviewed, today) > STALE_DAYS) {
        staleForRefresh.push(p);
        ps.summary = "Live — due for a refresh check";
      }
      continue;
    }

    // From here on: a page moving through (or past) the engine's build pipeline.
    const qa = p.qa ?? null;
    const qaStale =
      qa?.result === "pass" &&
      ((isStr(qa.sourceHash) && src?.hash && qa.sourceHash !== src.hash) ||
        (!isStr(qa.sourceHash) && src?.modifiedOn && isDate(qa.date) && src.modifiedOn > qa.date));
    const qaPassed = qa?.result === "pass" && !qaStale;
    const built = ["review", "published", "update-needed"].includes(p.status);
    const deployed =
      !reversed &&
      (["published", "update-needed"].includes(p.status) ||
        (p.status === "review" &&
          liveOk &&
          (isStr(p.verifyText) ? live.hasVerifyText === true : false)));
    const pp = p.postPublication ?? null;
    const mon = monitoring(p, today);

    // Staging: deployed (a live check, else a recorded deployment or review), reviewed, approved
    // by the owner. Each record carries the page version it saw (sourceHash), so a later edit
    // sends the page back through QA and staging rather than riding an old approval.
    const staleFor = (rec, date) =>
      !!rec &&
      ((isStr(rec.sourceHash) && src?.hash && rec.sourceHash !== src.hash) ||
        (!isStr(rec.sourceHash) && src?.modifiedOn && isDate(date) && src.modifiedOn > date));
    const sr = p.staging?.review ?? null;
    const srStale = sr?.result === "pass" && staleFor(sr, sr.date);
    const srPassed = sr?.result === "pass" && !srStale;
    const sa = p.staging?.approval ?? null;
    const saValid = !!sa && isDate(sa.approvedOn) && srPassed && !staleFor(sa, sa.approvedOn);
    const stagingDeployed = liveStg ? onStaging : isDate(p.staging?.deployedOn) || !!sr;
    const environmentNow = deployed
      ? ENV.PRODUCTION
      : stagingOn && stagingDeployed
        ? ENV.STAGING
        : ENV.LOCAL;
    ps.environment = environmentNow;
    ps.stagingUrl = stagingOn && envs.staging.url ? envs.staging.url + p.url : null;

    const rows = [];
    rows.push(
      row(
        "approval",
        "Approval",
        p.approvedOn ? S.COMPLETE : S.UNKNOWN,
        p.approvedOn ? `approved ${p.approvedOn}` : null,
      ),
    );
    rows.push(
      row(
        "creation",
        "Page creation",
        built
          ? S.COMPLETE
          : p.status === "draft"
            ? S.IN_PROGRESS
            : holdAll
              ? S.ON_HOLD
              : blocked
                ? S.BLOCKED
                : S.READY,
      ),
    );
    rows.push(
      row(
        "qa",
        "SEO QA",
        !built
          ? S.WAITING
          : qaPassed
            ? S.COMPLETE
            : qaStale
              ? S.READY
              : qa?.result === "fail"
                ? S.BLOCKED
                : deployed && !qa
                  ? S.UNKNOWN
                  : S.NOT_STARTED,
        qaPassed
          ? `passed ${qa.date}`
          : qaStale
            ? `passed ${qa.date}, but the page changed since`
            : qa?.result === "fail"
              ? `failed ${qa.date} — fixes needed`
              : null,
      ),
    );
    if (stagingOn) {
      rows.push(
        row(
          "stagingDeploy",
          "Staging deployment",
          stagingDeployed
            ? S.COMPLETE
            : deployed || !liveStg
              ? S.UNKNOWN
              : qaPassed
                ? S.READY
                : S.WAITING,
          stagingDeployed
            ? liveStg
              ? "on staging now"
              : "recorded"
            : !liveStg && !deployed
              ? "staging not checked live"
              : null,
        ),
      );
      rows.push(
        row(
          "stagingReview",
          "Staging review",
          srPassed
            ? S.COMPLETE
            : sr?.result === "fail"
              ? S.BLOCKED
              : srStale
                ? S.READY
                : deployed
                  ? S.UNKNOWN
                  : stagingDeployed && qaPassed
                    ? S.NOT_STARTED
                    : S.WAITING,
          srPassed
            ? `passed ${sr.date}`
            : sr?.result === "fail"
              ? `failed ${sr.date} — fixes needed`
              : srStale
                ? `passed ${sr.date}, but the page changed since`
                : null,
        ),
      );
      rows.push(
        row(
          "stagingApproval",
          "Your staging approval",
          saValid ? S.COMPLETE : deployed ? S.UNKNOWN : srPassed ? S.NEEDS_APPROVAL : S.WAITING,
          saValid
            ? `approved ${sa.approvedOn}`
            : srPassed && !deployed
              ? "look at it on staging"
              : null,
        ),
      );
    }
    const readyForProduction = stagingOn ? saValid : qaPassed;
    rows.push(
      row(
        "deployment",
        "Production deployment",
        reversed
          ? S.BLOCKED
          : deployed
          ? S.COMPLETE
          : holdDeploy || holdAll
            ? S.ON_HOLD
            : readyForProduction
              ? S.NEEDS_APPROVAL
              : S.WAITING,
        reversed
          ? `${reversal.kind ?? "reversed"} on ${reversal.date} (verified: ${reversal.source})${p.publishedOn ? ` — it had been live since ${p.publishedOn}` : ""}`
          : deployed
          ? `${p.publishedOn ? `live since ${p.publishedOn}` : "live on production"}${
              ps.liveCheck?.kind === "unavailable"
                ? ` — live check failed (${ps.liveCheck.detail}); recorded status kept`
                : ps.liveCheck
                  ? ` — but production now ${ps.liveCheck.detail} (investigate; history kept)`
                  : ""
            }`
          : p.hold
            ? `paused by you on ${p.hold.since}`
            : environmentNow === ENV.STAGING
              ? "not on production yet"
              : null,
      ),
    );
    rows.push(
      row(
        "postPublication",
        "Post-publication",
        !deployed
          ? S.WAITING
          : !pp || pp.result === "not-live"
            ? S.READY
            : pp.result === "ready"
              ? S.COMPLETE
              : S.BLOCKED,
        pp?.result === "ready"
          ? `checked ${pp.checkedOn}`
          : pp?.result === "action-required"
            ? `action required (${pp.checkedOn})`
            : null,
      ),
    );
    // ---- GOOGLE (engine 1.7.0). Production only. Independent facts — none implies the next:
    // readiness → sitemap included → [site] property + sitemap registered → discovered → crawled →
    // indexed → monitoring. The manual Live URL test and Request Indexing are OPTIONAL accelerators.
    // Only a recorded `indexed` verification (Google's own evidence) ever completes "indexed".
    const sc = pp?.searchConsole ?? {};
    const g = googleOf(p, pp);
    const site = searchConsoleSite(config);
    const api = googleApiOf(config, ev.googleApi);
    const gscOn = deployed && pp?.result === "ready";
    const gscOff = !deployed
      ? environmentNow === ENV.STAGING
        ? "disabled on staging"
        : "disabled until it's on production"
      : null;
    const recommended = api.requestIndexing === "recommended";
    const requested = sc.indexingRequest === "REQUESTED";
    const declined =
      sc.indexingRequest === "NOT REQUESTED" && isStr(sc.requestSource) && !requested;
    const ut = sc.liveUrlTest ?? {};
    const utResult = ["passed", "failed", "not tested"].includes(ut.result) ? ut.result : "unknown";
    const setupDone = site.configured === "yes";
    const readinessOk = g.readiness.status === "PASSED";
    const readinessBad = g.readiness.status === "FAILED";
    const inSitemap = g.sitemapIncluded.status;
    const sitemapPageOk = !site.sitemap.applicable || inSitemap === "yes";
    const registeredOk = !site.sitemap.applicable || site.sitemap.verified;
    const liveUrlNeeded =
      recommended && gscOn && readinessOk && setupDone && utResult !== "passed" && !requested && !declined;
    const needsIndexing =
      recommended &&
      gscOn &&
      setupDone &&
      indexingOutstanding(p) &&
      (utResult === "passed" || utResult === "unknown");
    const requestDone = requested || declined;
    const idx = sc.indexed ?? {};
    const indexedOk = idx.status === "INDEXED" && isDate(idx.verifiedOn);
    const sitemapNeeded =
      gscOn && setupDone && readinessOk && sitemapPageOk && site.sitemap.applicable && !site.sitemap.verified;
    const googleStepsDone =
      readinessOk && sitemapPageOk && setupDone && registeredOk && (!recommended || requestDone);
    const lastChecked = [g.lastCheckedOn, idx.lastCheckedOn, idx.verifiedOn].filter(isDate).sort().at(-1) ?? null;
    const statusCheckDue =
      gscOn && googleStepsDone && !indexedOk && (!lastChecked || daysBetween(lastChecked, today) >= api.statusCheckDays);
    const idxDue =
      gscOn &&
      googleStepsDone &&
      !indexedOk &&
      mon.due &&
      !(lastChecked && lastChecked >= mon.due.date);
    const stage = !g.discovered.status.startsWith("DISC")
      ? "not yet discovered by Google"
      : g.crawled.status !== "CRAWLED"
        ? "discovered by Google, not yet crawled"
        : "crawled by Google, not yet indexed";
    const cite = (o) => `${o.at}${o.source ? ` — ${o.source.replace(/^search-console-api:/, "Search Console API: ")}` : ""}`;
    rows.push(
      row(
        "googleReadiness",
        "Google readiness",
        !gscOn ? S.WAITING : readinessOk ? S.COMPLETE : readinessBad ? S.BLOCKED : S.READY,
        !deployed
          ? gscOff
          : pp?.result !== "ready"
            ? null
            : readinessOk
              ? `passed ${g.readiness.checkedAt}${g.readiness.warnings.length ? ` (${g.readiness.warnings.length} warning${g.readiness.warnings.length > 1 ? "s" : ""})` : ""} — technically ready, not the same as indexed`
              : readinessBad
                ? `failed${g.readiness.failures.length ? ` — ${g.readiness.failures.join("; ")}` : ""}`
                : "not run yet",
      ),
    );
    rows.push(
      row(
        "sitemapIncluded",
        "Sitemap includes this page",
        !site.sitemap.applicable
          ? S.NOT_APPLICABLE
          : !gscOn
            ? S.WAITING
            : inSitemap === "yes"
              ? S.COMPLETE
              : inSitemap === "no"
                ? S.BLOCKED
                : S.WAITING,
        !site.sitemap.applicable
          ? "site has no sitemap"
          : !deployed
            ? gscOff
            : inSitemap === "yes"
              ? `verified ${g.sitemapIncluded.verifiedAt}`
              : inSitemap === "no"
                ? "not in the sitemap"
                : gscOn
                  ? "not recorded"
                  : null,
      ),
    );
    rows.push(
      row(
        "scSetup",
        "Search Console setup",
        !gscOn ? S.WAITING : setupDone ? S.COMPLETE : S.NEEDS_MANUAL_ACTION,
        !gscOn
          ? gscOff
          : setupDone
            ? [
                site.propertyType && `${site.propertyType} property`,
                site.property,
                site.method && `via ${site.method}`,
                site.verifiedOn && `verified ${site.verifiedOn}`,
              ]
                .filter(Boolean)
                .join(", ") || "configured"
            : site.configured === "no"
              ? "not set up"
              : "not recorded — confirm",
      ),
    );
    rows.push(
      row(
        "sitemap",
        "Sitemap registered with Google",
        !site.sitemap.applicable
          ? S.NOT_APPLICABLE
          : !gscOn
            ? S.WAITING
            : site.sitemap.verified
              ? S.COMPLETE
              : sitemapNeeded
                ? api.usable
                  ? S.READY
                  : S.NEEDS_MANUAL_ACTION
                : S.WAITING,
        !site.sitemap.applicable
          ? "site has no sitemap"
          : !gscOn
            ? gscOff
            : site.sitemap.verified
              ? [
                  site.sitemap.status ?? "registered",
                  site.sitemap.verifiedOn && `checked ${site.sitemap.verifiedOn}`,
                  site.sitemap.submissionMethod && `submitted by ${site.sitemap.submissionMethod}`,
                  site.sitemap.lastRead && `last read ${site.sitemap.lastRead}`,
                  site.sitemap.discoveredPages != null && `${site.sitemap.discoveredPages} pages reported (site-wide, not proof of this page)`,
                ]
                  .filter(Boolean)
                  .join(", ")
              : sitemapNeeded
                ? api.usable
                  ? "register it through the Search Console API"
                  : "confirm in Search Console"
                : null,
      ),
    );
    rows.push(
      row(
        "liveUrlTest",
        "Live URL test (optional)",
        !gscOn
          ? S.WAITING
          : utResult === "passed"
            ? S.COMPLETE
            : utResult === "failed"
              ? S.BLOCKED
              : liveUrlNeeded
                ? S.NEEDS_MANUAL_ACTION
                : S.NOT_APPLICABLE,
        !gscOn
          ? gscOff
          : utResult === "passed"
            ? `passed ${ut.testedOn ?? ""}`.trim()
            : utResult === "failed"
              ? `failed ${ut.testedOn ?? ""} — fix, then test again`.replace("  ", " ")
              : liveUrlNeeded
                ? "test the live URL"
                : "optional — manual diagnostic, not required",
      ),
    );
    rows.push(
      row(
        "indexingRequest",
        "Indexing requested (optional)",
        !gscOn
          ? S.WAITING
          : requested
            ? S.COMPLETE
            : recommended && sc.indexingRequest === "REQUEST FAILED"
              ? S.BLOCKED
              : needsIndexing
                ? S.NEEDS_MANUAL_ACTION
                : S.NOT_APPLICABLE,
        !gscOn
          ? gscOff
          : requested
            ? `requested ${sc.requestedOn} (manual accelerator)`
            : declined
              ? "not requested (your decision)"
              : sc.indexingRequest === "REQUEST FAILED"
                ? "last attempt failed — optional"
                : needsIndexing
                  ? "request indexing"
                  : "optional accelerator — not required",
      ),
    );
    rows.push(
      row(
        "googleDiscovered",
        "Google discovered",
        !gscOn
          ? S.WAITING
          : g.discovered.status === "DISCOVERED"
            ? S.COMPLETE
            : googleStepsDone
              ? S.WAITING_FOR_DATA
              : S.WAITING,
        !gscOn
          ? gscOff
          : g.discovered.status === "DISCOVERED"
            ? `discovered ${cite(g.discovered)}`
            : googleStepsDone
              ? "not yet evidenced — waiting for Google"
              : null,
      ),
    );
    rows.push(
      row(
        "googleCrawled",
        "Google crawled",
        !gscOn
          ? S.WAITING
          : g.crawled.status === "CRAWLED"
            ? S.COMPLETE
            : googleStepsDone
              ? S.WAITING_FOR_DATA
              : S.WAITING,
        !gscOn
          ? gscOff
          : g.crawled.status === "CRAWLED"
            ? `crawled ${cite(g.crawled)}`
            : googleStepsDone
              ? "not yet evidenced — waiting for Google"
              : null,
      ),
    );
    rows.push(
      row(
        "indexed",
        "Google indexed",
        !gscOn
          ? S.WAITING
          : indexedOk
            ? S.COMPLETE
            : statusCheckDue && api.usable
              ? S.READY
              : idxDue && !api.usable
                ? S.NEEDS_MANUAL_ACTION
                : googleStepsDone
                  ? S.WAITING_FOR_DATA
                  : S.WAITING,
        !gscOn
          ? gscOff
          : indexedOk
            ? `indexed — verified ${idx.verifiedOn}${isStr(idx.source) ? ` (${idx.source.replace(/^search-console-api:/, "Search Console API: ")})` : ""}`
            : statusCheckDue && api.usable
              ? "check Google's status through the API"
              : idxDue && !api.usable
                ? "check the page in Search Console"
                : googleStepsDone
                  ? `pending — ${stage}; no evidence of indexing yet`
                  : "not verified",
      ),
    );
    const scAccess = config.analytics?.searchConsole?.access;
    const exportReady = (date) =>
      scAccess === "connector" || api.usable || (ev.searchConsoleExports ?? []).some((d) => d >= date);
    const perfText = !g.performance
      ? null
      : g.performance.hasData
        ? `${g.performance.impressions} impressions, ${g.performance.clicks} clicks${g.performance.windowDays ? ` (last ${g.performance.windowDays} days)` : ""}`
        : "No Search Console performance data yet.";
    rows.push(
      row(
        "monitoring",
        "Monitoring",
        pp?.result !== "ready" || !indexedOk
          ? S.WAITING
          : !mon.scheduled
            ? S.NOT_STARTED
            : mon.due
              ? exportReady(mon.due.date)
                ? S.READY
                : S.NEEDS_MANUAL_ACTION
              : mon.next
                ? S.WAITING_FOR_DATA
                : mon.complete
                  ? S.COMPLETE
                  : S.UNKNOWN,
        pp?.result !== "ready"
          ? null
          : !indexedOk
            ? "starts once Google has indexed it"
            : [
                !mon.scheduled
                  ? "no review dates recorded"
                  : mon.due
                    ? `${mon.due.days}-day review due since ${mon.due.date}`
                    : mon.next
                      ? `next review ${mon.next.date} (${mon.next.days}-day)`
                      : mon.complete
                        ? "all reviews done"
                        : null,
                perfText ?? (mon.scheduled ? "No Search Console performance data yet." : null),
              ]
                .filter(Boolean)
                .join("; ") || null,
      ),
    );
    ps.rows = rows;
    // LIFECYCLE STATE: durable milestones with the date each was completed (from the records only —
    // nothing is invented). Independent of live health. `reversed` appears only with a verified
    // reversal; the milestone's completion is kept as history.
    const doneOn = {
      approval: p.approvedOn,
      creation: p.created,
      qa: qa?.date,
      stagingDeploy: p.staging?.deployedOn,
      stagingReview: sr?.date,
      stagingApproval: sa?.approvedOn,
      deployment: p.publishedOn,
      postPublication: pp?.checkedOn,
      googleReadiness: g.readiness.checkedAt,
      sitemapIncluded: g.sitemapIncluded.verifiedAt,
      scSetup: site.verifiedOn,
      liveUrlTest: ut.testedOn,
      indexingRequest: sc.requestedOn,
      sitemap: site.sitemap.verifiedOn,
      googleDiscovered: g.discovered.at,
      googleCrawled: g.crawled.at,
      indexed: idx.verifiedOn,
    };
    // PAGE-LEVEL Google view for the card: each stage separately, with its evidence and source.
    ps.google = {
      readiness: g.readiness,
      sitemapIncluded: g.sitemapIncluded,
      discovered: g.discovered,
      crawled: g.crawled,
      indexed: indexedOk
        ? { status: "INDEXED", verifiedOn: idx.verifiedOn, evidence: idx.evidence ?? null, source: idx.source ?? null }
        : { status: "NOT VERIFIED", lastCheckedOn: idx.lastCheckedOn ?? null },
      requestIndexing: {
        state: requested
          ? "REQUESTED"
          : declined
            ? "NOT_APPLICABLE"
            : sc.indexingRequest === "REQUEST FAILED"
              ? "REQUEST_FAILED"
              : sc.indexingRequest === "NOT REQUESTED"
                ? "NOT_REQUESTED"
                : "UNKNOWN",
        requestedAt: sc.requestedOn ?? null,
        source: requested ? "manual" : null,
        optional: !recommended,
      },
      performance: g.performance,
      lastCheckedOn: lastChecked,
      indexingApiEligible: g.indexingApiEligible,
    };
    ps.lifecycle = rows.map((r) => ({
      key: r.key,
      label: r.label,
      completed: r.status === S.COMPLETE || (r.key === "deployment" && reversed && !!p.publishedOn),
      completedAt: isDate(doneOn[r.key]) ? doneOn[r.key] : null,
      ...(r.key === "deployment" && reversed
        ? { reversed: { kind: reversal.kind ?? "reversed", on: reversal.date, source: reversal.source, evidence: reversal.evidence ?? null } }
        : {}),
    }));

    // ---- the page's own next action (only its most urgent one)
    const missingAll = src && src.files.length && !src.hash;
    if (reversed) {
      ps.summary ??= `Production ${reversal.kind ?? "reversal"} verified ${reversal.date} — your decision`;
      add(
        action("production-reversed", 105, {
          ...base,
          actor: "user",
          approval: "change",
          reversalKind: reversal.kind ?? "reversed",
          date: reversal.date,
          evidence: reversal.evidence,
          publishedOn: p.publishedOn,
          row: "deployment",
        }),
      );
    } else if (holdAll) {
      ps.summary ??= "On hold (paused by you)";
      holdAction();
    } else if (p.status === "approved" || p.status === "draft") {
      if (blocked) {
        ps.summary ??= "Blocked — needs an answer from you";
        add(
          action("answer-question", 265, {
            ...base,
            actor: "user",
            questions: ps.blockers.map((q) => ({ id: q.id, question: q.question })),
            blocked: `The ${name} page`,
          }),
        );
      } else if (p.status === "approved") {
        ps.summary ??= "Approved — ready to build";
        add(
          action("create-page", 270, {
            ...base,
            skill: "BWESEOCreatePage",
            args: p.id,
            date: p.approvedOn,
            row: "creation",
          }),
        );
      } else {
        ps.summary ??= "Being built";
        add(
          action("continue-page", 260, {
            ...base,
            skill: "BWESEOCreatePage",
            args: p.id,
            row: "creation",
          }),
        );
      }
    } else if (p.status === "review" && missingAll) {
      ps.summary ??= "Built — but its files are missing";
      state.conflicts.push(
        `${name}: the inventory says it's built, but ${src.missing.join(", ")} can't be found`,
      );
      add(
        action("conflict-missing-source", 110, {
          ...base,
          skill: "BWESEOCreatePage",
          args: p.id,
          detail: src.missing.join(", "),
          row: "creation",
        }),
      );
    } else if (p.status === "review" && deployed && !qaPassed) {
      ps.summary ??= "Live on production — but QA hasn't passed";
      const detail = qaStale
        ? "it changed after QA passed"
        : qa?.result === "fail"
          ? "its last QA failed"
          : "it has no QA record";
      state.conflicts.push(`${name}: live at ${url}, but ${detail}`);
      add(
        action("conflict-live-before-qa", 110, {
          ...base,
          skill: "BWESEOQA",
          args: p.id,
          detail,
          row: "qa",
        }),
      );
    } else if (p.status === "review" && deployed) {
      ps.summary ??= "Live on production — post-publication check next";
      if (stagingOn && !saValid) {
        state.conflicts.push(
          `${name}: live on production before its staging review and your staging approval`,
        );
      }
      add(
        action("publish-check", pp?.result === "not-live" ? 205 : 200, {
          ...base,
          skill: "BWESEOPublish",
          args: p.id,
          row: "postPublication",
        }),
      );
    } else if (p.status === "review") {
      if (qa?.result === "fail") {
        ps.summary ??= "Built — QA failed, fixes needed";
        add(
          action("qa-fix", 230, {
            ...base,
            skill: "BWESEOQA",
            args: p.id,
            date: qa.date,
            row: "qa",
          }),
        );
      } else if (qaStale) {
        ps.summary ??= "Changed since QA — needs a re-check";
        add(
          action("qa-rerun", 235, {
            ...base,
            skill: "BWESEOQA",
            args: p.id,
            date: qa.date,
            modifiedOn: src?.modifiedOn,
            row: "qa",
          }),
        );
      } else if (!qa) {
        ps.summary ??= "Built — SEO QA next";
        add(action("qa", 240, { ...base, skill: "BWESEOQA", args: p.id, row: "qa" }));
      } else if (stagingOn && !stagingDeployed) {
        ps.summary ??= "QA passed — deploy to staging next";
        add(
          action("deploy-staging", 245, {
            ...base,
            approval: "staging-deploy",
            command: config.workflows?.deployStaging ?? null,
            stagingUrl: ps.stagingUrl,
            row: "stagingDeploy",
          }),
        );
      } else if (stagingOn && sr?.result === "fail") {
        ps.summary ??= "On staging — the staging review found problems";
        add(
          action("staging-fix", 242, {
            ...base,
            skill: "BWESEOQA",
            args: `${p.id} staging`,
            date: sr.date,
            row: "stagingReview",
          }),
        );
      } else if (stagingOn && !srPassed) {
        ps.summary ??= "On staging — staging review next";
        add(
          action("staging-review", 247, {
            ...base,
            skill: "BWESEOQA",
            args: `${p.id} staging`,
            stagingUrl: ps.stagingUrl,
            stale: srStale,
            date: sr?.date,
            row: "stagingReview",
          }),
        );
      } else if (stagingOn && !saValid) {
        ps.summary ??= "Staging review passed — waiting for your review";
        add(
          action("approve-staging", 250, {
            ...base,
            actor: "user",
            approval: "staging",
            stagingUrl: ps.stagingUrl,
            date: sr.date,
            stepsTitle: "WHAT TO CHECK ON STAGING",
            steps: [
              `Open ${ps.stagingUrl} on a computer and on a phone.`,
              "Check the layout: spacing, nothing cut off or overflowing sideways, images load, navigation and footer work.",
              "Check the call-to-action is easy to see and goes to the right place.",
              "Check the business details, services, places and prices are right, with no placeholder or test text.",
              "Tell me: approved, or what to change.",
            ],
            row: "stagingApproval",
          }),
        );
      } else if (holdDeploy) {
        ps.summary ??= stagingOn
          ? "Approved on staging — production on hold (paused by you)"
          : "QA passed — on hold (paused by you)";
        holdAction();
      } else {
        ps.summary ??= stagingOn
          ? "Approved on staging — ready for production when you say go"
          : "QA passed — waiting for your go-ahead to publish";
        const safety = [
          prodIndexable.ok === true
            ? "production is indexable now (home page and robots.txt checked)"
            : prodIndexable.ok === false
              ? `PRODUCTION IS NOT INDEXABLE — ${prodIndexable.detail}`
              : "production indexability wasn't checked",
          stagingOn && !["unknown", "not-applicable"].includes(protection.level)
            ? `staging protection is ${protection.level}`
            : null,
        ]
          .filter(Boolean)
          .join("; ");
        add(
          action("approve-deploy", stagingOn ? 252 : 250, {
            ...base,
            actor: "user",
            approval: "deploy",
            staged: stagingOn,
            date: stagingOn ? sa.approvedOn : qa.date,
            deploy: config.workflows?.deployProduction,
            safety,
            row: "deployment",
          }),
        );
      }
    } else if (deployed) {
      // Published through the engine (or an approved improvement that is live).
      if (!pp) {
        ps.summary ??= "Live — post-publication check next";
        add(
          action("publish-check", 200, {
            ...base,
            skill: "BWESEOPublish",
            args: p.id,
            row: "postPublication",
          }),
        );
      } else if (pp.result === "action-required") {
        ps.summary ??= "Live — post-publication problems to fix";
        add(
          action("fix-publication", 210, {
            ...base,
            skill: "BWESEOPublish",
            args: p.id,
            date: pp.checkedOn,
            report: pp.report,
            row: "postPublication",
          }),
        );
      } else if (pp.result === "not-live") {
        ps.summary ??= "Marked live, but the last check found it missing";
        add(
          action("publish-check", 205, {
            ...base,
            skill: "BWESEOPublish",
            args: p.id,
            row: "postPublication",
          }),
        );
      } else if (gscOn && !readinessOk) {
        // The page reached production; before anything is sent to Google, is it technically ready?
        if (readinessBad) {
          ps.summary ??= "Live — Google readiness found problems";
          add(
            action("fix-google-readiness", 209, {
              ...base,
              skill: "BWESEOPublish",
              args: p.id,
              failures: g.readiness.failures,
              date: g.readiness.checkedAt,
              row: "googleReadiness",
            }),
          );
        } else {
          ps.summary ??= "Live — Google readiness check next";
          add(
            action("google-readiness", 214, {
              ...base,
              skill: "BWESEOPublish",
              args: p.id,
              row: "googleReadiness",
            }),
          );
        }
      } else if (gscOn && site.sitemap.applicable && inSitemap === "no") {
        ps.summary ??= "Live — the page is not in the sitemap";
        add(
          action("fix-google-readiness", 210, {
            ...base,
            skill: "BWESEOPublish",
            args: p.id,
            failures: ["the production URL is not in the sitemap"],
            date: g.sitemapIncluded.verifiedAt,
            row: "sitemapIncluded",
          }),
        );
      } else if (gscOn && !setupDone) {
        ps.summary ??= "Live — Search Console setup needed";
        add(
          action("setup-search-console", 216, {
            ...base,
            actor: "user",
            manual: true,
            row: "scSetup",
            unknown: site.configured === "unknown",
            steps: [
              "Open Google Search Console (search.google.com/search-console) with the Google account that owns this website.",
              `Add a property for this website${origin ? ` (${origin})` : ""} — a Domain property is preferred; a URL-prefix property also works.`,
              "Verify ownership (DNS record for a Domain property; an HTML tag or file for a URL-prefix property). Never paste the verification code into chat or the project files.",
              "The property should belong to the website owner's own Google account. If an agency or consultant helps manage the site, give them access under Settings → Users and permissions rather than owning it.",
            ],
            after: "Tell me the property type, the method you used and today's date, or that it was already set up, so it's recorded once for the whole site.",
          }),
        );
      } else if (liveUrlNeeded) {
        ps.summary ??= utResult === "failed" ? "Live — Live URL Test failed" : "Live — run the Live URL Test";
        const target = p.canonicalUrl && p.canonicalUrl !== "unknown" ? p.canonicalUrl : url;
        add(
          action(utResult === "failed" ? "fix-live-url-test" : "live-url-test", 218, {
            ...base,
            actor: "user",
            manual: true,
            row: "liveUrlTest",
            steps: [
              "Open Google Search Console and select this website's property.",
              `Paste this URL into the search bar at the top (URL Inspection): ${target}`,
              "Click Test Live URL and wait for the result.",
              "Note whether it says the URL is available to Google and whether the page can be indexed.",
            ],
            after: "Tell me exactly what Google reported, so it's recorded.",
          }),
        );
      } else if (needsIndexing) {
        ps.summary ??= "Live — you asked to request indexing";
        const property = config.analytics?.searchConsole?.property;
        add(
          action("request-indexing", 220, {
            ...base,
            actor: "user",
            manual: true,
            row: "indexingRequest",
            retry: sc.indexingRequest === "REQUEST FAILED",
            steps: [
              "Open Google Search Console.",
              `Select this website's property${isStr(site.property ?? property) ? ` (${site.property ?? property})` : ""}.`,
              `Inspect this URL: ${p.canonicalUrl && p.canonicalUrl !== "unknown" ? p.canonicalUrl : url}`,
              "If the live test is successful, click Request Indexing.",
            ],
            after: "Afterwards, tell me it was requested so the project status can be updated.",
          }),
        );
      } else if (sitemapNeeded) {
        ps.summary ??= "Live — register the sitemap with Google";
        if (api.usable) {
          add(
            action("reconcile-sitemap", 222, {
              ...base,
              skill: "BWESEOSearchConsole",
              args: "sitemap",
              url: site.sitemap.url ?? `${origin}/sitemap.xml`,
              row: "sitemap",
            }),
          );
        } else {
          add(
            action("verify-sitemap", 222, {
              ...base,
              actor: "user",
              manual: true,
              row: "sitemap",
              apiHint: api.reason,
              steps: [
                "Open Google Search Console → Sitemaps.",
                `Check that ${site.sitemap.url ?? `${origin}/sitemap.xml`} is listed. If it isn't, add it under "Add a new sitemap".`,
                'Note its status (it should say "Success"), the last-read date and how many pages were discovered.',
              ],
              after: "Tell me what you see, so it can be recorded once for the whole site.",
            }),
          );
        }
      } else if (!mon.scheduled) {
        ps.summary ??= "Live — monitoring not scheduled";
        add(
          action("schedule-monitoring", 290, {
            ...base,
            skill: "BWESEOPublish",
            args: p.id,
            row: "monitoring",
          }),
        );
      } else if (!indexedOk && api.usable && statusCheckDue) {
        // Automated where the official API allows it: read-only URL Inspection evidence.
        ps.summary ??= "Live — checking Google's discovery / crawl / index status";
        add(
          action("check-google-status", 293, {
            ...base,
            skill: "BWESEOSearchConsole",
            args: p.id,
            lastChecked,
            stage,
            row: "indexed",
          }),
        );
      } else if (!indexedOk && !api.usable && idxDue) {
        ps.summary ??= "Live — check whether Google has indexed it";
        add(
          action("verify-indexing", 295, {
            ...base,
            actor: "user",
            manual: true,
            days: mon.due.days,
            date: mon.due.date,
            row: "indexed",
            steps: [
              "Open Google Search Console and select this website's property.",
              `Inspect this URL (URL Inspection): ${p.canonicalUrl && p.canonicalUrl !== "unknown" ? p.canonicalUrl : url}`,
              'Read the result at the top: "URL is on Google" means it is indexed; "URL is not on Google" (with a reason such as "Discovered – currently not indexed") means it is not yet.',
            ],
            after: "Tell me exactly what it says. If it isn't indexed yet, I'll record that and check again at the next review.",
          }),
        );
      } else if (!indexedOk) {
        ps.summary ??= "Live — monitoring Google discovery and indexing";
        const next = mon.next ?? null;
        waiting.push({
          ...base,
          date:
            next?.date ??
            (lastChecked ? addDays(lastChecked, api.statusCheckDays) : addDays(today, api.statusCheckDays)),
          review: next?.days ?? null,
          days: p.publishedOn ? daysBetween(p.publishedOn, today) : null,
          awaitingIndexing: true,
          requestedOn: sc.requestedOn ?? null,
          stage,
        });
      } else if (mon.due) {
        ps.summary ??= `Live — ${mon.due.days}-day review due`;
        const dataDir = config.analytics?.searchConsole?.dataDir ?? "seo/data/search-console";
        if (exportReady(mon.due.date)) {
          add(
            action("sc-review", 300, {
              ...base,
              skill: "BWESEOSearchConsole",
              args: p.id,
              days: mon.due.days,
              date: mon.due.date,
              skipped: mon.skipped,
              viaApi: api.usable,
              row: "monitoring",
            }),
          );
        } else {
          add(
            action("export-search-console", 305, {
              ...base,
              actor: "user",
              manual: true,
              days: mon.due.days,
              date: mon.due.date,
              row: "monitoring",
              steps: [
                "Open Google Search Console → Performance → Search results.",
                "Set the date range to the last 3 months.",
                "Click Export → Download CSV (the Queries and Pages tables are included).",
                `Save the file(s) in this project under ${dataDir}/${today}/.`,
              ],
              after: "Then run /BWESEO again.",
            }),
          );
        }
      } else if (mon.next) {
        ps.summary ??= `Live — waiting for data (next review ${mon.next.date})`;
        waiting.push({
          ...base,
          date: mon.next.date,
          review: mon.next.days,
          days: p.publishedOn ? daysBetween(p.publishedOn, today) : null,
        });
      } else {
        ps.summary ??= "Live — monitoring complete";
        if (isDate(p.lastReviewed) && daysBetween(p.lastReviewed, today) > STALE_DAYS)
          staleForRefresh.push(p);
      }
    }
  }

  // ---- roadmap: the next page (or improvement) waiting for the owner's approval.
  // Entries sharing a roadmapOrder are one roadmap item and are approved together.
  const candidates = pages
    .filter(
      (p) =>
        CANDIDATE_STATUSES.has(p.status) &&
        ["P1", "P2"].includes(p.priority) &&
        !p.approvedOn &&
        p.hold?.scope !== "all",
    )
    .sort(byPlan);
  const groups = [];
  for (const p of candidates) {
    const last = groups.at(-1);
    if (last && p.roadmapOrder != null && last[0].roadmapOrder === p.roadmapOrder) last.push(p);
    else groups.push([p]);
  }
  const isBlocked = (g) => g.some((p) => state.pages.find((x) => x.id === p.id)?.blockers.length);
  const unblocked = groups.filter((g) => !isBlocked(g));
  const describe = (g) => ({
    ids: g.map((p) => p.id),
    name: g.map(pageName).join(" + "),
    priority: g[0].priority,
    urls: g.map((p) => p.url),
    topic: g
      .map((p) => p.topic)
      .filter(Boolean)
      .join(" / "),
  });
  const roadmapRow = state.stages.find((r) => r.key === "roadmap");
  if (planned && groups.length) {
    roadmapRow.detail = `${groups.length} item${groups.length === 1 ? "" : "s"} not yet approved`;
  }
  if (planned && unblocked.length) {
    const top = describe(unblocked[0]);
    add(
      action("approve-page", top.priority === "P1" ? 500 : 550, {
        actor: "user",
        approval: "page",
        pageIds: top.ids,
        name: top.name,
        priority: top.priority,
        topic: top.topic ? `It covers: ${top.topic}.` : null,
        options: unblocked.slice(0, 5).map(describe),
        priorityRank: PRIORITY_ORDER[top.priority],
        roadmapOrder: unblocked[0][0].roadmapOrder,
        index: unblocked[0][0].index,
      }),
    );
    for (const id of top.ids) {
      const ps = state.pages.find((x) => x.id === id);
      if (ps) ps.summary = "Next on the roadmap — needs your approval";
    }
  } else if (planned && groups.length) {
    const g = groups[0];
    const qs = [...new Set(g.flatMap((p) => state.pages.find((x) => x.id === p.id).blockers))];
    add(
      action("answer-question", 520, {
        actor: "user",
        questions: qs.map((q) => ({ id: q.id, question: q.question })),
        blocked: `The next roadmap item (${describe(g).name})`,
        pageIds: g.map((p) => p.id),
      }),
    );
  }

  // ---- site issues found by the audit (stored in the inventory's `issues` list)
  for (const [i, is] of (inventory.issues ?? []).entries()) {
    const pagesText = (is.pages ?? []).length
      ? is.pages.length > 3
        ? `${is.pages.length} pages`
        : is.pages.join(", ")
      : null;
    state.issues.push({
      id: is.id,
      title: is.title,
      severity: is.severity,
      area: is.area,
      status: is.status,
      pages: is.pages ?? [],
    });
    if (!OUTSTANDING_ISSUE.has(is.status) || is.severity === "low") continue;
    const urgent = is.blocking === true || is.severity === "critical";
    const rank = urgent ? 150 : is.severity === "high" ? 400 : 600;
    const common = {
      issueId: is.id,
      title: is.title,
      severity: is.severity,
      pages: pagesText,
      skill: ISSUE_SKILLS[is.area] ?? null,
      args: ISSUE_SKILLS[is.area] ? is.id : undefined,
      index: i,
      row: "issues",
    };
    if (is.status === "approved" || is.needsApproval === false)
      add(action("fix-issue", rank - 5, common));
    else add(action("approve-issue", rank, { ...common, actor: "user", approval: "change" }));
  }

  // ---- maintenance, then waiting
  if (staleForRefresh.length) {
    add(
      action("refresh-check", 700, {
        skill: "BWESEORefresh",
        count: staleForRefresh.length,
        pageIds: staleForRefresh.map((p) => p.id),
      }),
    );
  }
  if (waiting.length) {
    const w = [...waiting].sort((a, b) => a.date.localeCompare(b.date))[0];
    add(action("wait", 900, { ...w, actor: "nobody" }));
  }
  add(action("idle", 950, { actor: "nobody", skill: null }));
  return finish(state);
}

function finish(state) {
  const order = (a) =>
    a.rank * 1e6 +
    (a.priorityRank ?? PRIORITY_ORDER[a.priority] ?? 9) * 1e5 +
    Math.min(a.roadmapOrder ?? 9999, 9999) * 10 +
    Math.min(a.index ?? 0, 9);
  state.actions.sort((a, b) => order(a) - order(b));
  const rec = state.actions[0] ?? null;
  if (rec?.skill && !rec.command) rec.command = `/${rec.skill}${rec.args ? ` ${rec.args}` : ""}`;
  state.recommendation = rec;
  state.alsoForYou = state.actions
    .slice(1)
    .filter((a) => a.actor === "user" && a.rank < 900)
    .filter(
      (a, i, all) =>
        all.findIndex(
          (b) => b.kind === a.kind && b.pageId === a.pageId && b.issueId === a.issueId,
        ) === i,
    )
    .slice(0, 3);

  // The page the dashboard shows in detail: the recommendation's page, else the page furthest
  // along the pipeline.
  const stage = { review: 1, draft: 2, approved: 3, published: 4, "update-needed": 5 };
  const inFlight = state.pages
    .filter((p) => p.rows && p.id)
    .sort((a, b) => (stage[a.status] ?? 9) - (stage[b.status] ?? 9) || a.index - b.index);
  state.focusPageId =
    (rec?.pageId && state.pages.find((p) => p.id === rec.pageId && p.rows)?.id) ??
    inFlight[0]?.id ??
    null;
  const focus = state.pages.find((p) => p.id === state.focusPageId);
  // The environment the dashboard reports: where the page in focus is right now.
  if (state.environment) state.environment.current = focus?.environment ?? null;
  for (const r of [...state.stages, ...(focus?.rows ?? [])]) r.next = false;
  if (rec?.row && rec.row !== "issues") {
    const target = (
      rec.pageId && rec.pageId === state.focusPageId ? focus.rows : state.stages
    ).find((r) => r.key === rec.row);
    if (target) target.next = true;
  }
  return state;
}

// ---------------------------------------------------------------- output

const W = 30;
const line = (label, value, indent = "") => {
  const dots = Math.max(2, W - indent.length - label.length);
  return `${indent}${label} ${".".repeat(dots)} ${value}`;
};
const rowValue = (r) => {
  const detail = r.detail ? ` (${r.detail})` : "";
  if (!r.next) return `${LABEL[r.status] ?? r.status}${detail}`;
  const who =
    r.status === S.NEEDS_APPROVAL || r.status === S.NEEDS_MANUAL_ACTION
      ? `: ${LABEL[r.status].toLowerCase()}`
      : "";
  return `→ Next${who}${detail}`;
};

function recommendationLines(rec) {
  const out = ["NEXT RECOMMENDED STEP", rec.headline];
  if (rec.command) out.push(`${rec.skill ? "Recommended skill" : "Command"}: ${rec.command}`);
  out.push(
    rec.actor === "user"
      ? rec.manual
        ? "USER MUST DO THIS (Claude can't)."
        : "YOUR DECISION — nothing happens until you say so."
      : rec.actor === "nobody"
        ? "NOTHING TO DO right now."
        : "CLAUDE CAN DO THIS.",
  );
  out.push("", "WHAT WE ARE DOING", rec.what, "", "WHY IT MATTERS", rec.why);
  if (rec.questions?.length) {
    out.push("", "REQUIRED DECISION");
    rec.questions.forEach((q, i) =>
      out.push(`${rec.questions.length > 1 ? `${i + 1}. ` : ""}${q.question}`),
    );
  }
  if (rec.options?.length > 1) {
    out.push("", "ROADMAP ORDER (pick one)");
    rec.options.forEach((o, i) =>
      out.push(`${i + 1}. ${o.name} (${o.priority}) — ${o.urls.join(", ")}`),
    );
  }
  if (rec.steps?.length) {
    out.push("", rec.stepsTitle ?? "MANUAL ACTION REQUIRED");
    rec.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    if (rec.after) out.push(rec.after);
  }
  if (rec.evidence?.length) {
    out.push("", "WHAT GOOGLE REPORTED");
    rec.evidence.forEach((e) => out.push(`• ${e}`));
  }
  if (rec.errors?.length) {
    out.push("", `ERRORS (${rec.errorCount})`);
    rec.errors.forEach((e) => out.push(`• ${e}`));
  }
  out.push("", "WHAT HAPPENS NEXT", rec.next);
  return out;
}

function issueCounts(state) {
  const open = state.issues.filter((i) => OUTSTANDING_ISSUE.has(i.status));
  const bySev = ["critical", "high", "medium", "low"]
    .map((s) => [s, open.filter((i) => i.severity === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s}`);
  const fixed = state.issues.filter((i) => i.status === "fixed").length;
  return {
    open: open.length,
    text: [
      bySev.join(" · ") && `${bySev.join(" · ")} open`,
      fixed && `${fixed} fixed, waiting to go live`,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

const WHERE = {
  [ENV.LOCAL]: "is only in the project files so far (local)",
  [ENV.STAGING]: "is on staging, not on production",
  [ENV.PRODUCTION]: "is live on production",
};
const bareHost = (u) => String(u ?? "").replace(/^https?:\/\//, "");

// The environment block every dashboard starts with, so nobody has to guess which environment is
// being described. Each line: { key, label, value, tone: "ok" | "warn" | "error" | "neutral" }.
export function environmentSummary(state) {
  const e = state.environment;
  if (!e) return [];
  const focus = state.pages.find((p) => p.id === state.focusPageId);
  const out = [];
  // Without live checks the environment comes from the records alone — say so.
  const verified =
    e.production?.checked && (e.staging.status !== "configured" || e.staging.checked || state.liveHealth?.staging.status === "UNKNOWN");
  out.push({
    key: "environment",
    label: "Environment",
    value: e.current
      ? `${e.current}${focus ? ` — ${focus.name} ${WHERE[e.current]}` : ""}${verified ? "" : " (from the records only — the live sites weren't checked)"}`
      : "No page in progress",
    tone: "neutral",
  });
  if (e.production) {
    const ix = e.production.indexable;
    out.push({
      key: "production",
      label: "Production domain",
      value: `${bareHost(e.production.url)}${!e.production.checked ? (["CHECK_FAILED", "UNAVAILABLE"].includes(state.liveHealth?.production.status) ? " (live check failed — indexability unknown)" : " (not checked live)") : ix.ok === true ? " — ✓ indexable" : ix.ok === false ? ` — ✗ NOT INDEXABLE: ${ix.detail}` : ` — indexability ${ix.detail}`}`,
      tone: ix.ok === false ? "error" : ix.ok === true ? "ok" : "neutral",
    });
  } else {
    out.push({
      key: "production",
      label: "Production domain",
      value: "NOT CONFIGURED",
      tone: "error",
    });
  }
  const lh = state.liveHealth?.production;
  if (lh && lh.status !== "UNKNOWN") {
    out.push({
      key: "liveHealth",
      label: "Live site health",
      value: `${LIVE_HEALTH_MARKS[lh.status]} ${lh.message}`,
      tone: lh.severity === "critical" ? "error" : lh.severity === "warning" ? "warn" : "ok",
    });
  }
  const inst = state.install;
  if (inst && inst.status !== "not-installed") {
    const ok = inst.status === "installed" && inst.integrity === "verified";
    out.push({
      key: "engine",
      label: "BWESEO Engine",
      value: `${inst.engineVersion ? `v${inst.engineVersion}` : "version unknown"}${inst.schemaVersion ? ` · Schema ${inst.schemaVersion}` : ""}${
        inst.status === "legacy"
          ? " · installed before install receipts existed (run /BWESEOInstall --verify)"
          : inst.integrity === "verified"
            ? " · Installation verified ✓"
            : inst.integrity === "modified"
              ? " · ⚠ engine files modified locally"
              : inst.integrity === "missing"
                ? " · ⚠ engine files missing"
                : ""
      }${inst.updateAvailable ? ` · Update available (v${inst.updateAvailable})` : ""}`,
      tone: ok && !inst.updateAvailable ? "neutral" : inst.integrity === "modified" || inst.integrity === "missing" ? "warn" : "neutral",
    });
  }
  const st = e.staging;
  if (st.status === "configured") {
    const pr = st.protection;
    const text =
      pr.level === "strong"
        ? ` — ✓ hidden from search engines (${pr.detail})`
        : pr.level === "weak"
          ? ` — ⚠ ${pr.detail}${pr.fixPending ? " (fix waiting to go live)" : ""}`
          : pr.level === "none"
            ? ` — ✗ NOT HIDDEN from search engines (${pr.detail})`
            : " (not checked live)";
    out.push({
      key: "staging",
      label: "Staging domain",
      value: bareHost(st.url) + text,
      tone:
        pr.level === "strong"
          ? "ok"
          : pr.level === "weak"
            ? "warn"
            : pr.level === "none"
              ? "error"
              : "neutral",
    });
  } else {
    out.push({
      key: "staging",
      label: "Staging domain",
      value:
        st.status === "not-configured"
          ? "NOT CONFIGURED — pages go from QA to your production approval"
          : "Not recorded — /BWESEOSetup can check whether this site has one",
      tone: "neutral",
    });
  }
  out.push({
    key: "indexing",
    label: "Indexing actions",
    value:
      e.current === ENV.STAGING
        ? "DISABLED on staging — testing only; never request indexing for a staging URL"
        : e.current === ENV.LOCAL
          ? "Not applicable — the page is local only"
          : "Production URLs only",
    tone: e.current === ENV.STAGING ? "warn" : "neutral",
  });
  return out;
}

// What the short dashboard shows, for any renderer (the CLI text below, or an admin card): the
// page shown step by step, up to six other pages worth a line each (P1s and pages in flight), how
// many more sit on the roadmap, and a one-line summary of open site issues.
export function dashboardSummary(state) {
  const focus = state.pages.find((p) => p.id === state.focusPageId) ?? null;
  const tracked = state.pages
    .filter(
      (p) =>
        p.id !== state.focusPageId &&
        (p.priority === "P1" || (p.rows && p.status !== "update-needed")),
    )
    .sort(byPlan);
  const more = state.pages.filter(
    (p) =>
      p.id !== state.focusPageId &&
      !tracked.includes(p) &&
      ["P2", "P3"].includes(p.priority) &&
      p.status !== "rejected",
  );
  return {
    roadmapComplete: state.stages.some((r) => r.key === "roadmap" && r.status === S.COMPLETE),
    focus,
    otherPages: tracked.slice(0, 6),
    morePages: tracked.length - Math.min(tracked.length, 6) + more.length,
    issues: issueCounts(state).text,
    issuesNext: state.recommendation?.row === "issues",
  };
}

// The current page as one line: Created ✓ → QA ✓ → Staging ✓ → … Each step: ✓ done · ⏸ on hold ·
// ✗ blocked or failed · ▸ the step that's next · … waiting. Built from the page's own rows, so a
// project without staging simply has no staging steps.
const PIPELINE_STEPS = {
  creation: "Created",
  qa: "QA",
  stagingDeploy: "Staging",
  stagingReview: "Staging review",
  stagingApproval: "Human approval",
  deployment: "Production",
  postPublication: "Post-publication check",
  googleReadiness: "Google readiness",
  sitemapIncluded: "Sitemap included",
  scSetup: "Search Console setup",
  sitemap: "Sitemap registered",
  googleDiscovered: "Google discovered",
  googleCrawled: "Google crawled",
  indexed: "Google indexed",
  monitoring: "Monitoring",
};
export function pipelineSummary(state) {
  const focus = state.pages.find((p) => p.id === state.focusPageId);
  if (!focus?.rows) return null;
  const steps = focus.rows
    .filter((r) => PIPELINE_STEPS[r.key])
    .map((r) => ({
      key: r.key,
      label: PIPELINE_STEPS[r.key],
      mark:
        r.status === S.COMPLETE
          ? "✓"
          : r.status === S.NOT_APPLICABLE
            ? "—"
            : r.status === S.ON_HOLD
            ? "⏸"
            : r.status === S.BLOCKED
              ? "✗"
              : r.next
                ? "▸"
                : "…",
    }));
  return steps.length ? { page: focus.name, steps } : null;
}
// The page's whole lifecycle grouped for a timeline display (Admin card): BUILD · STAGING ·
// PUBLISH · GOOGLE · GROW. Each step is complete / pending / attention (needs someone's action, or
// blocked, or on hold) / na. Built from the page's rows, so a project without staging or a sitemap
// simply has no such steps. The display never relies on colour alone: every state has an icon
// character and a word.
const LIFECYCLE_GROUPS = [
  ["build", "Build", [["creation", "Created"], ["qa", "QA"]]],
  [
    "staging",
    "Staging",
    [["stagingDeploy", "Staging"], ["stagingReview", "Staging review"], ["stagingApproval", "Human approval"]],
  ],
  ["publish", "Publish", [["deployment", "Production"], ["postPublication", "Post-publication check"]]],
  [
    "google-readiness",
    "Google readiness",
    [["googleReadiness", "Google readiness"], ["sitemapIncluded", "Sitemap includes this page"]],
  ],
  [
    "google",
    "Google search",
    [
      ["scSetup", "Search Console setup"],
      ["sitemap", "Sitemap registered with Google"],
      ["liveUrlTest", "Live URL test (optional)"],
      ["indexingRequest", "Indexing requested (optional)"],
      ["googleDiscovered", "Google discovered"],
      ["googleCrawled", "Google crawled"],
      ["indexed", "Google indexed"],
    ],
  ],
  ["grow", "Grow", [["monitoring", "Monitoring"]]],
];
// Site-level facts (recorded once for the whole website, inherited by every page) versus page-level
// facts; and the manual accelerators that are never required.
const SITE_LEVEL = new Set(["scSetup", "sitemap"]);
const OPTIONAL_STEPS = new Set(["liveUrlTest", "indexingRequest"]);
export const LIFECYCLE_MARKS = {
  complete: { icon: "✓", word: "Complete" },
  pending: { icon: "○", word: "Pending" },
  attention: { icon: "⚠", word: "Attention needed" },
  na: { icon: "—", word: "Not applicable" },
};
export function lifecycleGroups(pageState) {
  const byKey = new Map((pageState?.rows ?? []).map((r) => [r.key, r]));
  const stateOf = (r) =>
    r.status === S.COMPLETE
      ? "complete"
      : r.status === S.NOT_APPLICABLE
        ? "na"
        : [S.BLOCKED, S.NEEDS_MANUAL_ACTION, S.NEEDS_APPROVAL, S.ON_HOLD].includes(r.status)
          ? "attention"
          : "pending";
  return LIFECYCLE_GROUPS.map(([key, label, steps]) => ({
    key,
    label,
    steps: steps
      .filter(([k]) => byKey.has(k))
      .map(([k, name]) => {
        const r = byKey.get(k);
        const state = stateOf(r);
        return {
          key: k,
          label: name,
          state,
          ...LIFECYCLE_MARKS[state],
          scope: SITE_LEVEL.has(k) ? "site" : "page",
          optional: OPTIONAL_STEPS.has(k),
          detail: r.detail ?? null,
          next: !!r.next,
        };
      }),
  })).filter((g) => g.steps.length);
}
// Three lines: what's done (green), what's on hold (yellow), and everything else — the next step
// (▸), blocked steps and what's waiting (plain). Empty lines are left out.
export function pipelineLines(p) {
  const join = (steps) => steps.map((s) => `${s.label} ${s.mark}`).join(" → ");
  const done = p.steps.filter((s) => s.mark === "✓");
  const hold = p.steps.filter((s) => s.mark === "⏸");
  const rest = p.steps.filter((s) => !["✓", "⏸"].includes(s.mark));
  return [
    done.length && { tone: "done", text: join(done) },
    hold.length && { tone: "hold", text: join(hold) },
    rest.length && { tone: "rest", text: join(rest) },
  ].filter(Boolean);
}
const ANSI = { done: "\u001b[32m", hold: "\u001b[33m", rest: "" };
export const formatPipeline = (p, { color = false } = {}) =>
  pipelineLines(p)
    .map((l) => (color && ANSI[l.tone] ? `${ANSI[l.tone]}${l.text}\u001b[0m` : l.text))
    .join("\n");

export function formatDashboard(state, { color = false } = {}) {
  const out = [`SEO STATUS${state.business ? ` — ${state.business}` : ""}   (${state.today})`];
  for (const l of environmentSummary(state)) out.push(line(l.label, l.value));
  for (const r of state.stages) out.push(line(r.label, rowValue(r)));
  const gi = state.googleIndex;
  if (gi?.applicable) {
    out.push("Google indexing");
    out.push(line("Search Console", gi.searchConsole, "  "));
    out.push(line("Sitemap", gi.sitemap, "  "));
    out.push(line("Indexing", indexSummaryLine(gi), "  "));
    if (gi.rate) out.push(line("Indexing rate", gi.rate.indexed + " / " + gi.rate.of, "  "));
    if (gi.hasSnapshot) out.push(line("Last Google check", String(gi.lastGoogleCheckAt ?? "none").slice(0, 10) + " (data pulled " + String(gi.pulledAt ?? "").slice(0, 10) + (gi.stale ? " — stale" : "") + ")", "  "));
    if (gi.stagingProtection && ["EXPOSED", "PARTIAL"].includes(gi.stagingProtection.status)) out.push(line("WARNING", "staging appears indexable (" + gi.stagingProtection.status + ")", "  "));
  }
  const kwp = state.keywords;
  if (kwp?.applicable && (kwp.keywordCount > 0 || kwp.hasSnapshot)) {
    out.push("Keyword performance");
    out.push(line("Keywords", keywordSummaryLine(kwp), "  "));
    if (kwp.hasSnapshot) out.push(line("Period", (kwp.range ?? "unknown") + " (data pulled " + String(kwp.pulledAt ?? "").slice(0, 10) + (kwp.stale ? " - stale" : "") + ")", "  "));
    if (kwp.unregisteredPublished > 0 && kwp.keywordCount > 0) out.push(line("No keyword yet", kwp.unregisteredPublished + " published page(s)", "  "));
  }
  if (state.recommendation?.kind === "setup") {
    out.push("", "SEO has not been configured for this business.");
  }
  const d = dashboardSummary(state);
  if (d.roadmapComplete) {
    if (d.focus) {
      out.push(line("Current page", `${d.focus.name} (${d.focus.url})`));
      const pipe = pipelineSummary(state);
      if (pipe) for (const l of formatPipeline(pipe, { color }).split("\n")) out.push(`  ${l}`);
      for (const r of d.focus.rows) out.push(line(r.label, rowValue(r), "  "));
    } else {
      out.push(
        line(
          "Current page",
          state.recommendation?.kind === "approve-page"
            ? "→ Next: choose one (see below)"
            : "none in progress",
        ),
      );
    }
    if (d.otherPages.length || d.morePages) out.push("Other pages");
    for (const p of d.otherPages) out.push(line(p.name, p.summary ?? p.status, "  "));
    if (d.morePages) out.push(`  + ${d.morePages} more on the roadmap (say "show details")`);
    if (d.issues) out.push(line("Site issues", `${d.issuesNext ? "→ Next — " : ""}${d.issues}`));
  }
  if (state.conflicts.length) {
    out.push("", "RECORDS DON'T MATCH REALITY");
    state.conflicts.forEach((c) => out.push(`• ${c}`));
  }
  if (state.recommendation) out.push("", ...recommendationLines(state.recommendation));
  if (state.alsoForYou.length) {
    out.push("", "ALSO WAITING ON YOU");
    state.alsoForYou.forEach((a) => out.push(`• ${a.headline}`));
  }
  if (state.website && !/^checked/.test(state.liveCheck))
    out.push("", `(Live production check: ${state.liveCheck}.)`);
  return out.join("\n");
}

// ---------------------------------------------------------------- page-specific assessment
// `/BWESEO <page>`: the same state, focused on ONE page. A reference is an inventory id (`website-redesign`),
// a site path (`/website-redesign`) or an absolute URL on this project's own production or staging hosts.
// Nothing is guessed: an unknown reference, or a URL on some other site, is reported as such.
const normPath = (p) => `/${String(p ?? "").replace(/[?#].*$/, "").replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
export function resolvePageRef(state, ref) {
  const r = String(ref ?? "").trim();
  if (!r) return { error: "no page given" };
  const byId = state.pages.find((p) => p.id === r);
  if (byId) return { page: byId };
  let path = r;
  if (/^https?:\/\//i.test(r)) {
    let u;
    try {
      u = new URL(r);
    } catch {
      return { error: `"${r}" is not a valid URL` };
    }
    const hosts = [...(state.environment?.production?.hosts ?? []), ...(state.environment?.staging?.hosts ?? [])].map((h) => String(h).toLowerCase());
    const host = u.hostname.toLowerCase();
    if (!hosts.includes(host) && !hosts.includes(host.replace(/^www\./, "")))
      return { error: `${u.hostname} is not one of this project's production or staging hosts — nothing is assessed for other sites` };
    path = u.pathname;
  }
  if (!path.startsWith("/") && !/^https?:/i.test(r)) return { error: `no page in this project's SEO inventory matches "${r}"` };
  const hit = state.pages.find((p) => normPath(p.url) === normPath(path));
  return hit ? { page: hit } : { error: `no page in this project's SEO inventory matches "${r}"` };
}

export function assessPage(state, ref) {
  const { page, error } = resolvePageRef(state, ref);
  if (!page) return { ok: false, error, text: `PAGE ASSESSMENT — not found\n${error}\nRun /BWESEO with no argument for the project-wide assessment.` };
  const actions = state.actions.filter((a) => a.pageId === page.id);
  const out = [`PAGE ASSESSMENT — ${page.name} (${page.url})`, ""];
  out.push(`Environment .... ${page.environment ?? "n/a"}${state.environment?.current ? "" : ""}`);
  out.push(`Recorded status  ${page.status}${page.summary ? ` — ${page.summary}` : ""}`);
  if (page.rows?.length) {
    out.push("", "LIFECYCLE (recorded history — independent of live health)");
    for (const r of page.rows)
      out.push(`  ${r.label} ${".".repeat(Math.max(2, 34 - r.label.length))} ${STATUS_LABEL[r.status] ?? r.status}${r.detail ? ` (${r.detail})` : ""}`);
  } else out.push("", "This page is not in the build pipeline (planned, or an existing page).");
  const h = state.liveHealth?.production;
  if (h && h.status !== "UNKNOWN") out.push("", "LIVE SITE HEALTH (current observation)", `  ${LIVE_HEALTH_MARKS[h.status]} ${h.message}`);
  const g = page.google;
  if (g)
    out.push(
      "",
      "GOOGLE (separate stages — none implies the next)",
      `  readiness ${g.readiness.status} · sitemap membership ${g.sitemapIncluded.status} · discovered ${g.discovered.status} · crawled ${g.crawled.status} · indexed ${g.indexed.status}`,
    );
  const next = actions[0] ?? null;
  out.push("", "NEXT STEP FOR THIS PAGE");
  if (next) out.push(`  ${next.headline}`, `  ${next.actor === "user" ? (next.manual ? "USER MUST DO THIS" : "YOUR DECISION") : next.actor === "nobody" ? "NOTHING TO DO right now" : "CLAUDE CAN DO THIS"}${next.command ? ` — ${next.command}` : ""}`);
  else out.push("  Nothing to do for this page right now.");
  const top = state.recommendation;
  if (top && (!next || top.kind !== next.kind)) out.push("", `(The project-wide next step is different: ${top.headline})`);
  return { ok: true, page, actions, text: out.join("\n") };
}

export function formatDetails(state) {
  const out = [formatDashboard(state), "", "=".repeat(60), "FULL SEO STATUS", ""];
  out.push("PAGES");
  for (const p of [...state.pages].sort(byPlan)) {
    out.push(
      `• ${p.name} (${p.url}) — ${p.priority ?? "no priority"} — ${p.summary ?? p.status} [inventory: ${p.status}]`,
    );
    if (p.blockers.length)
      out.push(`    blocked by: ${p.blockers.map((q) => q.question).join(" | ")}`);
    if (p.hold)
      out.push(
        `    on hold since ${p.hold.since}${p.hold.reason ? ` — ${p.hold.reason}` : ""} (scope: ${p.hold.scope ?? "deploy"})`,
      );
    const h = Object.entries(p.history)
      .map(
        ([k, v]) =>
          `${k}: ${
            typeof v === "object"
              ? Object.entries(v)
                  .map(([a, b]) => `${a} ${b}`)
                  .join(", ")
              : v
          }`,
      )
      .join(" · ");
    if (h) out.push(`    ${h}`);
  }
  out.push("", "SITE ISSUES");
  if (!state.issues.length) out.push("None recorded.");
  for (const i of state.issues)
    out.push(
      `• [${i.severity}] ${i.title} — ${i.status}${i.pages.length ? ` (${i.pages.join(", ")})` : ""}`,
    );
  out.push("", "EVERYTHING THAT COULD BE DONE (in priority order)");
  state.actions
    .filter((a) => a.kind !== "idle")
    .forEach((a, i) =>
      out.push(
        `${i + 1}. ${a.headline}${a.command ? ` → ${a.command}` : a.skill ? ` → /${a.skill}${a.args ? ` ${a.args}` : ""}` : ""} [${a.actor === "user" ? "you" : a.actor === "nobody" ? "wait" : "Claude"}]`,
      ),
    );
  if (state.warnings.length) {
    out.push("", "NOTES");
    state.warnings.forEach((w) => out.push(`• ${w}`));
  }
  out.push("", `Live production check: ${state.liveCheck}. Engine tools ${state.version}.`);
  return out.join("\n");
}
