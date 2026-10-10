#!/usr/bin/env node
// BWESEO post-publication checker — zero dependencies, Node 18+ (global fetch).
//
// Environment-aware (engine 1.3.0). The URL's environment comes from seo-config.json →
// environments and decides what is checked:
//   PRODUCTION  the full post-publication check — live/HTTPS/redirects, indexability (noindex,
//               robots.txt, canonical, duplicates, rendering, metadata, JSON-LD), sitemap, inbound
//               links, environment leakage (staging/preview/local URLs in links, schema, social
//               metadata, sitemap or anywhere in the HTML), Search Console / other engines.
//   STAGING / PREVIEW / UNKNOWN host
//               a technical test of the page with SEARCH ENGINE INDEXING ACTIONS: DISABLED — it
//               loads, links work, SEO basics, the environment is hidden from search engines, the
//               canonical can't make staging the preferred URL. Never any indexing step.
//   LOCAL       not applicable: a local page isn't available to search engines.
// READ-ONLY: it only sends GET requests. It never logs in, submits URLs, requests indexing or
// changes anything. Every site-specific value comes from the current project's
// seo/seo-config.json and seo/content-inventory.json — nothing is hard-coded.
//
// Usage (from the project root):
//   node seo/tools/post-publish-check.mjs --id <inventory-id> [--env production|staging]
//       [--expect "<text>"]... [--published-on YYYY-MM-DD] [--out report.json] [--max-pages 150]
//   node seo/tools/post-publish-check.mjs --url https://example.com/page ...   (no inventory)
// Exit codes: 0 ready / staging check passed · 1 action required / staging problems · 2 page not
// live (or not on staging) · 3 usage/config error · 4 not applicable (local).
//
// Vendored into each project by /BWESEOSetup; the source of truth is
// $BWESEO_ENGINE/src/post-publish-check.mjs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENV,
  classifyUrl,
  environmentsOf,
  findEnvironmentLeaks,
  indexProtection,
  robotsBlocksAll,
} from "./seo-state-core.mjs";
import { runPageChecks } from "./seo-page-checks.mjs";

export const CHECKER_VERSION = "1.4.0";
export const NOT_LIVE_MESSAGE = "PAGE NOT LIVE — INDEXING STEPS CANNOT YET BE COMPLETED.";
// Engine 1.4.1: a 5xx / 429 / timeout / network failure means the check could not see the site.
// That is a health failure — not evidence the page is unpublished — so it is reported apart.
export const UNAVAILABLE_MESSAGE =
  "PRODUCTION CHECK UNAVAILABLE — the site could not be reached, so nothing can be concluded about this page.";
export const READY = "READY FOR SEARCH ENGINE DISCOVERY";
export const ACTION_REQUIRED = "ACTION REQUIRED BEFORE INDEXING";
export const SITEMAP_SUBMISSION_UNVERIFIED = "SITEMAP SUBMISSION STATUS — VERIFY IN SEARCH CONSOLE";
export const NOT_APPLICABLE = "POST-PUBLICATION CHECK NOT APPLICABLE";
export const INDEXING_DISABLED = "SEARCH ENGINE INDEXING ACTIONS: DISABLED";
export const STAGING_PASSED = "STAGING CHECK PASSED";
export const STAGING_PROBLEMS = "STAGING CHECK FOUND PROBLEMS";
export const NOT_ON_STAGING = "PAGE NOT FOUND ON STAGING";
export const CRITICAL = "CRITICAL SEO ERROR";
const USER_AGENT = "BWESEO-post-publish-check/1.4 (read-only SEO verification)";
const REQUEST_STATUSES = ["REQUESTED", "NOT REQUESTED", "UNKNOWN"];

// ---------------------------------------------------------------- text / HTML helpers

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function textOf(html) {
  return decodeEntities(
    String(html ?? "")
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAttrs(tag) {
  const attrs = {};
  const re = /([^\s=/>"']+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const inner = String(tag)
    .replace(/^<\s*[a-z0-9-]+/i, "")
    .replace(/\/?>$/, "");
  let m;
  while ((m = re.exec(inner)))
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  return attrs;
}

export function extractHead(html) {
  const src = String(html ?? "");
  const metas = [...src.matchAll(/<meta\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
  const links = [...src.matchAll(/<link\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
  const meta = (key) =>
    metas
      .filter((a) => (a.name ?? a.property ?? "").toLowerCase() === key)
      .map((a) => a.content ?? "");
  const titleMatch = src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const jsonLd = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => /application\/ld\+json/i.test(parseAttrs(`<script ${m[1]}>`).type ?? ""))
    .map((m) => {
      try {
        const data = JSON.parse(m[2]);
        const nodes = Array.isArray(data) ? data : (data?.["@graph"] ?? [data]);
        const types = nodes.flatMap((n) => [].concat(n?.["@type"] ?? [])).map(String);
        return { ok: true, types, raw: m[2].trim() };
      } catch (e) {
        return { ok: false, types: [], error: e.message, raw: m[2].trim().slice(0, 200) };
      }
    });
  return {
    title: titleMatch ? textOf(titleMatch[1]) : null,
    metaDescription: meta("description")[0] ?? null,
    robots: [...meta("robots"), ...meta("googlebot")],
    canonicals: links
      .filter((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))
      .map((l) => l.href ?? ""),
    ogUrl: meta("og:url")[0] ?? null,
    ogImage: meta("og:image")[0] ?? null,
    ogImageWidth: meta("og:image:width")[0] ?? null,
    ogImageHeight: meta("og:image:height")[0] ?? null,
    // Every meta tag whose value is an absolute URL (og:url, og:image, twitter:image…), for the
    // environment-leakage check.
    absoluteMeta: metas
      .filter((a) => /^(https?:)?\/\//i.test(a.content ?? ""))
      .map((a) => ({ key: a.property ?? a.name ?? "meta", value: a.content })),
    h1s: [...src.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => textOf(m[1])),
    jsonLd,
    googleVerification: meta("google-site-verification").length > 0,
    bingVerification: meta("msvalidate.01").length > 0,
  };
}

// Every <a href> with its anchor text and where it sits (nav / footer / body).
export function extractLinks(html, pageUrl) {
  const src = String(html ?? "");
  const ranges = (tag) =>
    [...src.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"))].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
  const nav = ranges("nav");
  const footer = ranges("footer");
  const inside = (rs, i) => rs.some(([a, b]) => i >= a && i < b);
  const out = [];
  for (const m of src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(`<a ${m[1]}>`);
    if (!attrs.href) continue;
    let href;
    try {
      href = new URL(attrs.href, pageUrl).toString();
    } catch {
      continue;
    }
    const imgAlts = [...m[2].matchAll(/<img\b[^>]*>/gi)]
      .map((i) => parseAttrs(i[0]).alt)
      .filter(Boolean);
    const text = textOf(m[2]) || attrs["aria-label"] || imgAlts.join(" ") || attrs.title || "";
    out.push({
      href,
      text,
      location: inside(nav, m.index) ? "nav" : inside(footer, m.index) ? "footer" : "body",
    });
  }
  return out;
}

// ---------------------------------------------------------------- robots.txt

export function parseRobots(txt) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(txt ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current)
      current.rules.push({ type: key, path: value });
  }
  return { groups, sitemaps };
}

function ruleMatches(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    "^" +
      body
        .split("*")
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchored ? "$" : ""),
  );
  return re.test(path);
}

// Google's rules: a crawler obeys only its most specific matching group (else "*"); within it the
// longest matching rule wins and Allow wins a tie. No matching rule = allowed.
export function robotsAllows(robots, agent, path) {
  const ua = agent.toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const a of g.agents) {
      if (a !== "*" && ua.startsWith(a) && a.length > bestLen) {
        best = [g];
        bestLen = a.length;
      } else if (a !== "*" && ua.startsWith(a) && a.length === bestLen) best.push(g);
    }
  }
  const groups = best ?? robots.groups.filter((g) => g.agents.includes("*"));
  let winner = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, path)) continue;
    const len = rule.path.length;
    if (
      !winner ||
      len > winner.path.length ||
      (len === winner.path.length && rule.type === "allow")
    )
      winner = rule;
  }
  return {
    allowed: !winner || winner.type === "allow",
    rule: winner ? `${winner.type}: ${winner.path}` : null,
    group: best ? best[0].agents.join(", ") : groups.length ? "*" : "(no group)",
  };
}

// ---------------------------------------------------------------- sitemap / URL helpers

export function parseSitemap(xml) {
  const src = String(xml ?? "");
  const kind = /<sitemapindex\b/i.test(src) ? "index" : /<urlset\b/i.test(src) ? "urlset" : "unknown";
  const locs = [...src.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) =>
    decodeEntities(m[1]).trim(),
  );
  // Engine 1.7.0: each entry with its lastmod, and whether the file is structurally sound.
  const entries = [...src.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({
    loc: decodeEntities(m[2].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1] ?? "").trim(),
    lastmod: (m[2].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1] ?? "").trim() || null,
  }));
  const count = (re) => (src.match(re) ?? []).length;
  const unbalanced =
    count(/<url\b/gi) !== count(/<\/url>/gi) ||
    count(/<sitemap\b/gi) !== count(/<\/sitemap>/gi) ||
    count(/<loc>/gi) !== count(/<\/loc>/gi);
  return {
    kind,
    locs,
    entries,
    malformed: kind === "unknown" || unbalanced || (locs.length === 0 && src.trim() !== ""),
  };
}

const stripWww = (h) => h.toLowerCase().replace(/^www\./, "");
const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

// Same page, ignoring protocol, www/apex, trailing slash, query and hash.
export function samePage(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return (
      stripWww(x.hostname) === stripWww(y.hostname) &&
      trimSlash(x.pathname) === trimSlash(y.pathname)
    );
  } catch {
    return false;
  }
}

export function variantsOf(url) {
  const u = new URL(url);
  const out = [];
  const http = new URL(u);
  http.protocol = "http:";
  out.push({ kind: "http", url: http.toString() });
  const slash = new URL(u);
  slash.pathname =
    u.pathname.endsWith("/") && u.pathname.length > 1
      ? u.pathname.replace(/\/+$/, "")
      : `${u.pathname}/`;
  if (u.pathname !== "/") out.push({ kind: "trailing-slash", url: slash.toString() });
  const www = new URL(u);
  www.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
  out.push({ kind: "www", url: www.toString() });
  return out;
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- fetching

async function get(fetchImpl, url, { follow = true, maxHops = 10 } = {}) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
      });
    } catch (e) {
      return { chain, final: null, error: e.message };
    }
    const location = res.headers.get("location");
    chain.push({ url: current, status: res.status, location });
    if (res.status >= 300 && res.status < 400 && location && follow) {
      current = new URL(location, current).toString();
      continue;
    }
    const text = await res.text().catch(() => "");
    return { chain, final: { url: current, status: res.status, headers: res.headers, text } };
  }
  return { chain, final: null, error: "too many redirects" };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- the check

function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// The date where the check is run (local time), not UTC — an evening run shouldn't record tomorrow.
export function localToday(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// The reusable page-quality checks (seo-page-checks.mjs): og:url vs canonical, social image size, above-the-fold
// visibility and shared navigation/footer. A page other than the home page is compared with the home page of the
// same site; if that can't be fetched the comparison is skipped, never failed.
async function addPageQualityChecks({ add, section, fetchImpl, html, head, pageUrl }) {
  let isHome = false;
  let homeHtml = null;
  try {
    const u = new URL(pageUrl);
    isHome = u.pathname === "/" || u.pathname === "";
    if (!isHome) {
      const home = await get(fetchImpl, new URL("/", u).toString());
      if (home.final?.status === 200) homeHtml = home.final.text ?? null;
    }
  } catch {
    /* compare with nothing */
  }
  const checks = await runPageChecks({ html, head, pageUrl, homeHtml, isHome, fetchImpl });
  for (const c of checks) add(section, c.id, c.label, c.status, c.detail);
}

export async function checkPublication(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const today = opts.today ?? localToday();
  const page = opts.page ?? {};
  const cfg = opts.config ?? {};
  const envs = environmentsOf(cfg);
  const origin = envs.production?.url ?? "";
  // --env staging checks the page's copy on the configured staging site; the default is production.
  const base =
    opts.environment === "staging"
      ? envs.staging.url
      : opts.environment === "local"
        ? null
        : origin;
  if (opts.environment === "staging" && !base)
    throw new Error(
      `No staging site configured in seo-config.json → environments.staging (status: ${envs.staging.status}).`,
    );
  const url = opts.url ?? (base && page.url ? base + page.url : null);
  if (!url)
    throw new Error(
      "No URL: pass --url, or --id with a project seo-config.json that names the environment's URL.",
    );

  const pub = cfg.publication ?? {};
  const environment = classifyUrl(url, cfg);
  const leakEnvs = [ENV.STAGING, ENV.PREVIEW, ENV.LOCAL];
  const leakOf = (u) => leakEnvs.includes(classifyUrl(u, cfg));
  const stagingHosts = envs.staging.hosts;
  const productionHost = hostOf(origin || url);
  const expects = [...(opts.expect ?? []), ...(page.verifyText ? [page.verifyText] : [])];

  const checks = [];
  const add = (section, id, label, status, detail = "", extra = {}) =>
    checks.push({ section, id, label, status, detail, ...extra });
  const result = {
    checker: CHECKER_VERSION,
    checkedOn: today,
    environment,
    indexingActions: environment === ENV.PRODUCTION ? "enabled" : "disabled",
    page: { id: page.id ?? null, name: page.title ?? null, url },
    checks,
    live: false,
    verdict: null,
    redirectChain: [],
    canonicalUrl: null,
    inboundLinks: [],
    manualActions: [],
    userChecks: [],
    critical: [],
    notes: [],
  };

  // ---- environment gate: only PRODUCTION goes on to the post-publication workflow.
  if (environment === ENV.LOCAL) {
    result.verdict = NOT_APPLICABLE;
    result.notes.push(
      "This page is local and is not available to search engines.",
      "Deploy it (staging first, where the project has one) and check it there.",
    );
    return result;
  }
  if (environment !== ENV.PRODUCTION) {
    return checkNonProduction({
      fetchImpl,
      today,
      page,
      cfg,
      url,
      environment,
      expects,
      result,
      add,
    });
  }

  // ---- 1. live page
  const main = await get(fetchImpl, url);
  result.redirectChain = main.chain;
  const final = main.final;
  const finalUrl = final?.url ?? url;
  const html = final?.text ?? "";
  const head = extractHead(html);
  const bodyText = textOf(html);
  const status = final?.status ?? 0;
  const redirectedElsewhere = final && !samePage(finalUrl, url);
  const titleMatches = !page.title || (head.title ?? "").trim() === page.title.trim();
  const missingExpect = expects.filter((e) => !bodyText.toLowerCase().includes(e.toLowerCase()));
  const available =
    status === 200 && !redirectedElsewhere && titleMatches && missingExpect.length === 0;

  add(
    "LIVE PAGE",
    "available",
    "Page available",
    available ? "pass" : "fail",
    main.error
      ? `request failed: ${main.error}`
      : status !== 200
        ? `HTTP ${status}`
        : redirectedElsewhere
          ? `redirected to ${finalUrl}`
          : !titleMatches
            ? `title is "${head.title}", expected "${page.title}" — a different page was returned`
            : missingExpect.length
              ? `expected content not found: ${missingExpect.map((e) => `"${e}"`).join(", ")}`
              : `HTTP 200${expects.length ? `, expected content present` : ""}`,
  );
  add(
    "LIVE PAGE",
    "https",
    "HTTPS",
    url.startsWith("https://") && finalUrl.startsWith("https://") ? "pass" : "fail",
    finalUrl,
  );
  add(
    "LIVE PAGE",
    "production-url",
    "Correct production URL",
    hostOf(finalUrl) === productionHost && !redirectedElsewhere ? "pass" : "fail",
    finalUrl,
  );

  if (!available && (main.error || status >= 500 || status === 429)) {
    result.unavailable = true;
    result.notes.push(
      `The check could not reach production (${main.error ? main.error : `HTTP ${status}`}). This is a health failure, not evidence that the page is unpublished — the recorded status is unchanged. Try again shortly.`,
    );
    result.verdict = UNAVAILABLE_MESSAGE;
    return result;
  }
  if (!available) {
    if (stagingHosts.length && page.url && status !== 200) {
      for (const h of stagingHosts) {
        const s = await get(fetchImpl, `https://${h}${page.url}`);
        if (s.final?.status === 200) {
          result.notes.push(
            `The page exists on staging (https://${h}${page.url}) but not on production — production status: NOT DEPLOYED. Staging doesn't count as published.`,
          );
          break;
        }
      }
    }
    result.verdict = NOT_LIVE_MESSAGE;
    return result;
  }
  result.live = true;

  // ---- 2. indexing
  const headerRobots = final.headers.get("x-robots-tag") ?? "";
  const noindex = [...head.robots, headerRobots].some((v) => /\b(noindex|none)\b/i.test(v));
  // A staging-only noindex reaching production is the classic environment mistake: checked here on
  // the production response itself, never inferred from staging.
  const intendedPublic = page.indexable !== false;
  add(
    "INDEXING",
    "noindex",
    "No accidental noindex",
    noindex ? "fail" : "pass",
    noindex
      ? `${intendedPublic ? `${CRITICAL}: an intended public production page says noindex — ` : ""}robots directives: ${[...head.robots, headerRobots].filter(Boolean).join(" | ")}`
      : "",
    { critical: noindex && intendedPublic },
  );

  const robotsUrl = pub.robotsUrl ?? `${new URL(finalUrl).origin}/robots.txt`;
  const robotsRes = await get(fetchImpl, robotsUrl);
  let robots = { groups: [], sitemaps: [] };
  let robotsOk = true;
  let robotsDetail = "";
  const robotsStatus = robotsRes.final?.status ?? 0;
  if (robotsStatus === 200) {
    robots = parseRobots(robotsRes.final.text);
    const path = new URL(finalUrl).pathname;
    const verdicts = ["googlebot", "bingbot", "*"].map((a) => ({
      a,
      ...robotsAllows(robots, a === "*" ? "anybot" : a, path),
    }));
    const blocked = verdicts.filter((v) => !v.allowed);
    robotsOk = blocked.length === 0;
    robotsDetail = robotsOk
      ? "allowed for Googlebot, Bingbot and *"
      : blocked.map((v) => `${v.a} blocked by "${v.rule}"`).join("; ");
  } else if (robotsStatus >= 400 && robotsStatus < 500) {
    robotsDetail = `robots.txt returned ${robotsStatus} — crawlers treat that as allow-all`;
  } else {
    robotsOk = false;
    robotsDetail = `robots.txt unavailable (${robotsStatus || robotsRes.error}) — Google may pause crawling`;
  }
  add(
    "INDEXING",
    "robots",
    "robots.txt allows crawling",
    robotsOk ? "pass" : "fail",
    robotsDetail,
    {
      critical: !robotsOk && robotsStatus === 200,
    },
  );

  const canon = head.canonicals;
  let canonStatus = "pass";
  let canonDetail = canon[0] ?? "";
  let canonCritical = false;
  if (canon.length === 0) [canonStatus, canonDetail] = ["fail", "no canonical tag"];
  else if (canon.length > 1 && new Set(canon).size > 1)
    [canonStatus, canonDetail] = ["fail", `conflicting canonicals: ${canon.join(", ")}`];
  else if (!/^https:\/\//i.test(canon[0]))
    [canonStatus, canonDetail] = ["fail", `canonical is not an absolute HTTPS URL: ${canon[0]}`];
  else if (leakOf(canon[0]))
    [canonStatus, canonDetail, canonCritical] = [
      "fail",
      `${CRITICAL}: the production canonical points to ${classifyUrl(canon[0], cfg).toLowerCase()} — ${canon[0]}`,
      true,
    ];
  else if (hostOf(canon[0]) !== productionHost)
    [canonStatus, canonDetail] = ["fail", `canonical is on another host: ${canon[0]}`];
  else if (!samePage(canon[0], finalUrl))
    [canonStatus, canonDetail] = ["fail", `canonical points to a different page: ${canon[0]}`];
  add("INDEXING", "canonical", "Canonical correct", canonStatus, canonDetail, {
    critical: canonCritical,
  });
  result.canonicalUrl = canonStatus === "pass" ? canon[0] : (canon[0] ?? null);
  const canonicalUrl = canonStatus === "pass" ? canon[0] : finalUrl;

  // Indexable = 200, no auth wall, crawlable HTML, no unmanaged duplicates.
  const indexIssues = [];
  const indexWarnings = [];
  if (/\/(login|signin|sign-in|auth)(\/|$)/i.test(new URL(finalUrl).pathname))
    indexIssues.push("final URL looks like a login page");
  const words = bodyText.split(" ").filter(Boolean).length;
  if (words < 150)
    indexWarnings.push(
      `only ${words} words of text in the server HTML — content may depend on JavaScript`,
    );
  const dupes = [];
  for (const v of variantsOf(canonicalUrl)) {
    const r = await get(fetchImpl, v.url, { follow: false });
    const st = r.chain[0]?.status ?? 0;
    if (st >= 300 && st < 400) {
      const loc = r.chain[0].location ? new URL(r.chain[0].location, v.url).toString() : "";
      if (v.kind === "http" && !loc.startsWith("https://"))
        indexIssues.push("http:// does not redirect to https://");
      continue;
    }
    if (st === 200) {
      const vHead = extractHead(r.final?.text ?? "");
      const canonicalizes = vHead.canonicals.some((c) => c === canonicalUrl);
      if (v.kind === "http") {
        // Serving http:// without a redirect is worth fixing, but when that copy points search
        // engines at the https canonical it can't stop the page being indexed — warn, don't block.
        if (canonicalizes)
          indexWarnings.push(
            "http:// is served (200) instead of redirecting to https:// — its canonical points to the HTTPS URL, so indexing isn't blocked, but an HTTPS redirect should be enabled",
          );
        else
          indexIssues.push(
            "http:// is served without redirecting to https:// and without a canonical to the HTTPS URL",
          );
      } else if (!canonicalizes) {
        dupes.push(`${v.url} returns 200 without canonicalizing to the page`);
      }
    }
  }
  if (dupes.length) indexWarnings.push(`possible duplicates: ${dupes.join("; ")}`);
  add(
    "INDEXING",
    "indexable",
    "Indexable",
    indexIssues.length ? "fail" : indexWarnings.length ? "warn" : "pass",
    [...indexIssues, ...indexWarnings].join("; ") ||
      "HTTP 200, public, content in server HTML, variants redirect",
  );

  // ---- sitemap
  const sitemapUrl =
    pub.sitemapUrl ?? robots.sitemaps[0] ?? `${new URL(finalUrl).origin}/sitemap.xml`;
  let sitemapLocs = [];
  if (pub.usesSitemap === false) {
    add("SITEMAP", "available", "Sitemap available", "skip", "project does not use a sitemap");
    add("SITEMAP", "included", "Page included", "skip", "");
    add("SITEMAP", "no-staging", "No staging URL", "skip", "");
  } else {
    const sm = await get(fetchImpl, sitemapUrl);
    const smOk = sm.final?.status === 200;
    add(
      "SITEMAP",
      "available",
      "Sitemap available",
      smOk ? "pass" : "fail",
      smOk ? sitemapUrl : `${sitemapUrl} → ${sm.final?.status ?? sm.error}`,
    );
    if (smOk) {
      let parsed = parseSitemap(sm.final.text);
      sitemapLocs = parsed.locs;
      let sitemapEntries = parsed.entries;
      if (parsed.kind === "index") {
        const children = await mapLimit(parsed.locs.slice(0, 25), 4, (u) => get(fetchImpl, u));
        const kids = children.filter((c) => c.final?.status === 200).map((c) => parseSitemap(c.final.text));
        sitemapLocs = kids.flatMap((k) => k.locs);
        sitemapEntries = kids.flatMap((k) => k.entries);
      }
      add(
        "SITEMAP",
        "valid",
        "Sitemap well-formed",
        parsed.malformed ? "fail" : sitemapLocs.length > 50000 ? "fail" : "pass",
        parsed.malformed
          ? "the sitemap is malformed (not a urlset / sitemapindex, unbalanced tags or no <loc> entries)"
          : sitemapLocs.length > 50000
            ? "more than 50,000 URLs in one sitemap file"
            : `${parsed.kind}, ${sitemapLocs.length} URL(s)`,
      );
      const exact = sitemapLocs.includes(canonicalUrl);
      const variant = sitemapLocs.filter((l) => l !== canonicalUrl && samePage(l, canonicalUrl));
      add(
        "SITEMAP",
        "included",
        "Page included",
        exact && !variant.length ? "pass" : exact ? "warn" : "fail",
        exact
          ? variant.length
            ? `also listed as ${variant.join(", ")}`
            : canonicalUrl
          : variant.length
            ? `listed only as a non-canonical variant: ${variant.join(", ")}`
            : `${canonicalUrl} is not in the sitemap`,
      );
      const staging = sitemapLocs.filter(leakOf);
      const wrongHost = sitemapLocs.filter(
        (l) => hostOf(l) !== productionHost && !staging.includes(l),
      );
      const insecure = sitemapLocs.filter((l) => !l.startsWith("https://"));
      const seen = new Map();
      const dupLocs = [];
      for (const l of sitemapLocs) {
        const k = (() => {
          try {
            const u = new URL(l);
            return stripWww(u.hostname) + trimSlash(u.pathname);
          } catch {
            return l;
          }
        })();
        if (seen.has(k)) dupLocs.push(l);
        seen.set(k, true);
      }
      const problems = [
        staging.length &&
          `${CRITICAL}: staging/preview/local URLs in the production sitemap: ${staging.slice(0, 3).join(", ")}`,
        wrongHost.length && `other hosts: ${wrongHost.slice(0, 3).join(", ")}`,
        insecure.length && `non-HTTPS: ${insecure.slice(0, 3).join(", ")}`,
      ].filter(Boolean);
      add(
        "SITEMAP",
        "no-staging",
        "No staging, preview or local URLs",
        problems.length ? "fail" : dupLocs.length ? "warn" : "pass",
        problems.join("; ") ||
          (dupLocs.length
            ? `duplicate entries: ${dupLocs.slice(0, 3).join(", ")}`
            : `${sitemapLocs.length} URLs, all HTTPS on ${productionHost}`),
        { critical: staging.length > 0 },
      );
      // lastmod: only judged when the site publishes it; a missing/invalid/future/stale value for this
      // page is flagged, a site that publishes none is left alone.
      {
        const anyLastmod = sitemapEntries.some((e) => e.lastmod);
        const mine = sitemapEntries.find((e) => e.loc === canonicalUrl) ?? null;
        const okDate = mine?.lastmod && !Number.isNaN(Date.parse(mine.lastmod));
        const lm = okDate ? new Date(mine.lastmod).toISOString().slice(0, 10) : null;
        const changed = page.lastModifiedOn ?? page.publishedOn ?? null;
        const future = lm && lm > new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
        const stale = lm && changed && /^\d{4}-\d{2}-\d{2}$/.test(changed) && lm < changed;
        add(
          "SITEMAP",
          "lastmod",
          "Sitemap lastmod reasonable",
          !anyLastmod || !mine
            ? "skip"
            : !mine.lastmod
              ? "warn"
              : !okDate || future
                ? "fail"
                : stale
                  ? "warn"
                  : "pass",
          !anyLastmod
            ? "the sitemap publishes no lastmod dates"
            : !mine
              ? "page not in sitemap"
              : !mine.lastmod
                ? "this page has no lastmod (other pages do)"
                : !okDate
                  ? `invalid lastmod: ${mine.lastmod}`
                  : future
                    ? `lastmod ${lm} is in the future`
                    : stale
                      ? `lastmod ${lm} is older than the page's last change (${changed})`
                      : `lastmod ${lm}`,
        );
      }
    } else {
      add("SITEMAP", "valid", "Sitemap well-formed", "skip", "sitemap not readable");
      add("SITEMAP", "included", "Page included", "fail", "sitemap not readable");
      add("SITEMAP", "no-staging", "No staging URL", "skip", "sitemap not readable");
      add("SITEMAP", "lastmod", "Sitemap lastmod reasonable", "skip", "sitemap not readable");
    }
  }

  // ---- internal links (crawl the sitemap's pages; always include the home page)
  const sources = [...new Set([`${new URL(canonicalUrl).origin}/`, ...sitemapLocs])]
    .filter((u) => !samePage(u, canonicalUrl) && hostOf(u) === productionHost)
    .slice(0, opts.maxPages ?? 150);
  const fetched = await mapLimit(sources, 5, async (u) => ({ u, r: await get(fetchImpl, u) }));
  for (const { u, r } of fetched) {
    if (r.final?.status !== 200) continue;
    for (const l of extractLinks(r.final.text, r.final.url)) {
      if (samePage(l.href, canonicalUrl))
        result.inboundLinks.push({ from: u, text: l.text, location: l.location });
    }
  }
  const fromPages = [...new Set(result.inboundLinks.map((l) => new URL(l.from).pathname))];
  add(
    "INTERNAL LINKS",
    "incoming",
    "Incoming internal links",
    fromPages.length ? "pass" : "fail",
    fromPages.length
      ? `${result.inboundLinks.length} link(s) from ${fromPages.length} page(s)`
      : "no indexable page links to it",
  );
  const outbound = extractLinks(html, finalUrl).filter(
    (l) =>
      hostOf(l.href) === productionHost || stripWww(hostOf(l.href)) === stripWww(productionHost),
  );
  const planned = [...new Set([page.parent, ...(page.linksFrom ?? [])].filter(Boolean))];
  const missingIn = planned.filter((p) => !fromPages.some((f) => trimSlash(f) === trimSlash(p)));
  const related = page.relatedPages ?? [];
  const missingOut = related.filter(
    (r) => !outbound.some((l) => trimSlash(new URL(l.href).pathname) === trimSlash(r)),
  );
  const relStatus =
    !planned.length && !related.length
      ? "warn"
      : missingIn.includes(page.parent) || (related.length && missingOut.length === related.length)
        ? "fail"
        : missingIn.length || missingOut.length
          ? "warn"
          : "pass";
  add(
    "INTERNAL LINKS",
    "related",
    "Related pages connected",
    relStatus,
    !planned.length && !related.length
      ? "no parent/related pages recorded in the inventory to compare against"
      : [
          missingIn.length && `not yet linking to it: ${missingIn.join(", ")}`,
          missingOut.length && `page doesn't link to: ${missingOut.join(", ")}`,
        ]
          .filter(Boolean)
          .join("; ") || "parent and planned pages link to it; it links to its related pages",
  );
  add(
    "INTERNAL LINKS",
    "orphan",
    "Not orphaned",
    fromPages.length ? "pass" : "fail",
    fromPages.length ? "" : "only reachable via the sitemap",
  );
  result.recommendedLinks = missingIn;

  // ---- on-page
  const t = head.title ?? "";
  add(
    "ON-PAGE SEO",
    "title",
    "Title",
    !t ? "fail" : t.length < 15 || t.length > 70 ? "warn" : "pass",
    t ? `${t.length} chars: ${t}` : "missing",
  );
  const d = head.metaDescription ?? "";
  add(
    "ON-PAGE SEO",
    "description",
    "Meta description",
    !d ? "fail" : d.length < 50 || d.length > 170 ? "warn" : "pass",
    d ? `${d.length} chars` : "missing",
  );
  add(
    "ON-PAGE SEO",
    "h1",
    "H1",
    head.h1s.length === 1 ? "pass" : head.h1s.length === 0 ? "fail" : "warn",
    head.h1s.length === 1
      ? head.h1s[0]
      : head.h1s.length
        ? `${head.h1s.length} H1s: ${head.h1s.join(" | ")}`
        : "no H1",
  );
  await addPageQualityChecks({ add, section: "ON-PAGE SEO", fetchImpl, html, head, pageUrl: finalUrl });
  const invalid = head.jsonLd.filter((j) => !j.ok);
  const reviewTypes = head.jsonLd
    .flatMap((j) => j.types)
    .filter((ty) => /^(Review|AggregateRating)$/i.test(ty));
  add(
    "ON-PAGE SEO",
    "schema",
    "Structured data where applicable",
    !head.jsonLd.length ? "skip" : invalid.length ? "fail" : reviewTypes.length ? "warn" : "pass",
    !head.jsonLd.length
      ? "none on the page"
      : invalid.length
        ? `invalid JSON-LD: ${invalid.map((j) => j.error).join("; ")}`
        : `${head.jsonLd.flatMap((j) => j.types).join(", ")}${reviewTypes.length ? " — verify review/rating markup is real" : ""}`,
  );

  // ---- environment leakage: staging, preview or local/dev URLs in production output
  const envLinks = extractLinks(html, finalUrl).filter((l) => leakOf(l.href));
  add(
    "ENVIRONMENT",
    "links",
    "Links stay on production",
    envLinks.length ? "fail" : "pass",
    envLinks.length
      ? `links to non-production hosts: ${envLinks
          .slice(0, 5)
          .map((l) => `${l.href} ("${l.text}", ${l.location})`)
          .join("; ")}`
      : "no links to staging, preview or local hosts",
  );
  const schemaLeaks = head.jsonLd.flatMap((j) => findEnvironmentLeaks(j.raw, cfg));
  add(
    "ENVIRONMENT",
    "schema",
    "Structured data has no staging URLs",
    schemaLeaks.length ? "fail" : head.jsonLd.length ? "pass" : "skip",
    schemaLeaks.length
      ? schemaLeaks
          .slice(0, 5)
          .map((l) => `${l.ref} (${l.environment.toLowerCase()})`)
          .join("; ")
      : head.jsonLd.length
        ? "url / @id / logo / image / offers / breadcrumbs all production"
        : "no structured data",
  );
  const socialLeaks = head.absoluteMeta.filter((m) => leakOf(m.value));
  add(
    "ENVIRONMENT",
    "social",
    "Social metadata has no staging URLs",
    socialLeaks.length ? "fail" : "pass",
    socialLeaks.length
      ? socialLeaks.map((m) => `${m.key}: ${m.value}`).join("; ")
      : "og:url, og:image and other absolute metadata URLs are production",
  );
  const counted = new Set([
    ...envLinks.map((l) => l.href),
    ...schemaLeaks.map((l) => l.ref),
    ...socialLeaks.map((m) => m.value),
  ]);
  const otherLeaks = findEnvironmentLeaks(html, cfg).filter(
    (l) => ![...counted].some((c) => c.includes(l.ref) || l.ref.includes(c)),
  );
  add(
    "ENVIRONMENT",
    "contamination",
    "No staging or development references in the page",
    otherLeaks.length ? "fail" : "pass",
    otherLeaks.length
      ? `found: ${otherLeaks
          .slice(0, 5)
          .map((l) => `${l.ref} (${l.environment.toLowerCase()})`)
          .join("; ")}`
      : "no staging, preview, localhost or development hostnames in the HTML",
  );

  // ---- staging stays hidden from search engines (only judged with evidence; unreachable = skipped)
  if (envs.staging.status === "configured" && /^https?:\/\//.test(envs.staging.url ?? "") && opts.checkStaging !== false) {
    const sRobots = await get(fetchImpl, `${envs.staging.url}/robots.txt`);
    const sHome = await get(fetchImpl, `${envs.staging.url}${new URL(finalUrl).pathname}`);
    const blocksAll = sRobots.final?.status === 200 && robotsBlocksAll(sRobots.final.text);
    const noindexHeader = /\b(noindex|none)\b/i.test(sHome.final?.headers?.get?.("x-robots-tag") ?? "");
    const reached = sRobots.final?.status === 200 || sHome.final?.status === 200;
    add(
      "ENVIRONMENT",
      "staging-hidden",
      "Staging stays hidden from search engines",
      !reached ? "skip" : blocksAll || noindexHeader ? "pass" : "fail",
      !reached
        ? "staging could not be reached — not judged"
        : blocksAll && noindexHeader
          ? "robots.txt disallows everything and X-Robots-Tag is noindex"
          : blocksAll
            ? "robots.txt disallows everything"
            : noindexHeader
              ? "X-Robots-Tag is noindex"
              : "staging is not hidden (no robots.txt block and no noindex header)",
    );
  }

  // ---- Search Console / discovery (read from project records; never changed here)
  const sc = cfg.analytics?.searchConsole ?? {};
  const rec = page.postPublication?.searchConsole ?? {};
  const requestStatus = REQUEST_STATUSES.includes(rec.indexingRequest)
    ? rec.indexingRequest
    : "UNKNOWN";
  result.searchConsole = {
    property: sc.property ? "known" : "unknown",
    propertyDetail: sc.property ?? null,
    verificationTagOnPage: head.googleVerification,
    urlInspection:
      rec.urlInspection === "verified" || rec.liveUrlTest?.result === "passed"
        ? "verified"
        : "not verified",
    indexingRequest: requestStatus,
    sitemapSubmission:
      sc.sitemapSubmission === "verified" ||
      (sc.sitemap?.submitted === "yes" && /^success/i.test(sc.sitemap?.status ?? ""))
        ? "verified"
        : "not verified",
  };
  const other = [];
  if (pub.indexNow?.keyUrl) {
    const k = await get(fetchImpl, pub.indexNow.keyUrl);
    const key = pub.indexNow.keyUrl
      .split("/")
      .pop()
      .replace(/\.txt$/, "");
    const ok = k.final?.status === 200 && (k.final.text ?? "").trim() === key;
    other.push(
      `IndexNow key file ${ok ? "resolves on production" : "NOT reachable"}${pub.indexNow.mechanism ? ` — submit via: ${pub.indexNow.mechanism}` : ""}`,
    );
  }
  if (head.bingVerification) other.push("Bing Webmaster Tools verification tag present");
  result.otherEngines = other;

  // ---- verdict, manual actions, monitoring
  const blocking = checks.filter(
    (c) =>
      c.status === "fail" &&
      ["LIVE PAGE", "INDEXING", "SITEMAP", "INTERNAL LINKS", "ENVIRONMENT"].includes(c.section),
  );
  result.verdict = blocking.length ? ACTION_REQUIRED : READY;
  result.critical = checks.filter((c) => c.critical && c.status === "fail");
  if (blocking.length)
    result.manualActions.push(
      `Fix before requesting indexing: ${blocking.map((c) => `${c.label} (${c.detail})`).join("; ")}`,
    );
  if (requestStatus !== "REQUESTED" && !blocking.length) {
    result.manualActions.push({
      title: "GOOGLE SEARCH CONSOLE — MANUAL ACTION REQUIRED",
      steps: [
        "Open Google Search Console.",
        `Select the correct website property${sc.property ? ` (${sc.property})` : ""}.`,
        `Paste the exact production URL into URL Inspection: ${canonicalUrl}`,
        "Run the inspection.",
        "Confirm Google can access the page.",
        "If appropriate, select Request Indexing.",
      ],
    });
  }
  if (result.searchConsole.sitemapSubmission !== "verified")
    result.manualActions.push(SITEMAP_SUBMISSION_UNVERIFIED);

  const publishedOn = opts.publishedOn ?? page.publishedOn ?? today;
  result.monitoring = {
    publishedOn,
    publishedOnSource:
      opts.publishedOn || page.publishedOn
        ? "recorded"
        : "date of this check (deploy date not given)",
    review7: addDays(publishedOn, 7),
    review30: addDays(publishedOn, 30),
    review90: addDays(publishedOn, 90),
  };
  result.inventoryPatch = {
    status: "published",
    publishedOn,
    productionUrl: url,
    canonicalUrl: result.canonicalUrl ?? "unknown",
    lastReviewed: today,
    nextReview: result.monitoring.review7,
    postPublication: {
      checkedOn: today,
      result: blocking.length ? "action-required" : "ready",
      sitemapStatus:
        checks.find((c) => c.id === "included" && c.section === "SITEMAP")?.status === "pass"
          ? "included"
          : pub.usesSitemap === false
            ? "not-applicable"
            : "missing",
      internalLinkStatus: fromPages.length ? "linked" : "orphaned",
      inboundLinks: fromPages.length,
      searchConsole: {
        property: result.searchConsole.property,
        urlInspection: result.searchConsole.urlInspection,
        indexingRequest: requestStatus,
        requestedOn: rec.requestedOn ?? null,
        requestSource: rec.requestSource ?? null,
      },
      monitoring: {
        review7: result.monitoring.review7,
        review30: result.monitoring.review30,
        review90: result.monitoring.review90,
      },
      report: `docs/seo/reports/publish-${page.id ?? "page"}-${today}.md`,
    },
  };
  return result;
}

// ---------------------------------------------------------------- staging / preview / unknown host

// A technical test of the page on a non-production environment. Everything a staging review can
// check with read-only requests — never any search-engine step: no Search Console, no sitemap
// submission, no IndexNow, no inventory "published" patch.
async function checkNonProduction({
  fetchImpl,
  today,
  page,
  cfg,
  url,
  environment,
  expects,
  result,
  add,
}) {
  const envName = environment.toLowerCase();
  result.notes.push(
    `ENVIRONMENT: ${environment}`,
    INDEXING_DISABLED,
    "This environment is for testing only.",
    "Do not request indexing for this URL.",
  );
  if (environment === ENV.STAGING)
    result.notes.push(
      "The page must be deployed to production before Search Console indexing actions are appropriate.",
    );
  if (environment === ENV.UNKNOWN)
    result.notes.push(
      "This host isn't the production site named in seo-config.json (nor its staging or preview) — treated as non-production.",
    );
  const envs = environmentsOf(cfg);
  const prodOrigin = envs.production?.url ?? "";
  const main = await get(fetchImpl, url);
  result.redirectChain = main.chain;
  const final = main.final;
  const finalUrl = final?.url ?? url;
  const html = final?.text ?? "";
  const head = extractHead(html);
  const bodyText = textOf(html);
  const status = final?.status ?? 0;
  const missingExpect = expects.filter((e) => !bodyText.toLowerCase().includes(e.toLowerCase()));
  const available = status === 200 && samePage(finalUrl, url) && missingExpect.length === 0;
  add(
    "PAGE",
    "available",
    "Page loads (this version)",
    available ? "pass" : "fail",
    main.error
      ? `request failed: ${main.error}`
      : status !== 200
        ? `HTTP ${status}`
        : !samePage(finalUrl, url)
          ? `redirected to ${finalUrl}`
          : missingExpect.length
            ? `expected content not found: ${missingExpect.map((e) => `"${e}"`).join(", ")} — an older version may be deployed`
            : `HTTP 200${expects.length ? ", expected content present" : ""}`,
  );
  if (!available) {
    result.verdict = NOT_ON_STAGING;
    return result;
  }
  result.live = true;
  add(
    "ENVIRONMENT",
    "identified",
    "Environment identified",
    "pass",
    `${environment} — ${hostOf(url)}`,
  );

  // Hidden from search engines: header, meta, sign-in, robots.txt.
  const robotsRes = await get(fetchImpl, `${new URL(finalUrl).origin}/robots.txt`);
  const blocksAll = robotsRes.final?.status === 200 && robotsBlocksAll(robotsRes.final.text);
  const protection = indexProtection(
    { status, robots: { header: final.headers.get("x-robots-tag"), meta: head.robots } },
    { blocksAll },
  );
  add(
    "ENVIRONMENT",
    "hidden",
    "Hidden from search engines",
    protection.level === "strong" ? "pass" : protection.level === "weak" ? "warn" : "fail",
    protection.detail,
  );

  // The canonical must never make a non-production URL the preferred one.
  const canon = head.canonicals[0] ?? null;
  const canonEnv = canon ? classifyUrl(canon, cfg) : null;
  add(
    "ENVIRONMENT",
    "canonical",
    "Canonical can't make this environment the preferred URL",
    !canon
      ? "warn"
      : canonEnv === ENV.PRODUCTION && samePage(canon, prodOrigin + new URL(url).pathname)
        ? "pass"
        : canonEnv === environment
          ? "warn"
          : "fail",
    !canon
      ? "no canonical tag — check production's canonical after the deploy"
      : canonEnv === ENV.PRODUCTION
        ? samePage(canon, prodOrigin + new URL(url).pathname)
          ? `points to the production URL (${canon})`
          : `points to a different production page: ${canon}`
        : canonEnv === environment
          ? `points to this ${envName} URL (${canon}) — fine only if it's built from the host; production's canonical is checked after the deploy`
          : `points to ${canon} (${(canonEnv ?? "unknown").toLowerCase()})`,
  );
  const leaks = [
    ...head.jsonLd.flatMap((j) => findEnvironmentLeaks(j.raw, cfg)),
    ...head.absoluteMeta
      .filter((m) => classifyUrl(m.value, cfg) === environment)
      .map((m) => ({ ref: `${m.key}: ${m.value}` })),
  ];
  add(
    "ENVIRONMENT",
    "metadata",
    "Structured data and social metadata point to production",
    leaks.length ? "warn" : "pass",
    leaks.length
      ? `uses this environment's host: ${leaks
          .slice(0, 4)
          .map((l) => l.ref)
          .join("; ")} — must read production after the deploy`
      : "structured data, og:url and images use production URLs",
  );

  // SEO basics.
  const t = head.title ?? "";
  add(
    "SEO",
    "title",
    "Title",
    !t ? "fail" : t.length < 15 || t.length > 70 ? "warn" : "pass",
    t ? `${t.length} chars: ${t}` : "missing",
  );
  const d = head.metaDescription ?? "";
  add(
    "SEO",
    "description",
    "Meta description",
    !d ? "fail" : d.length < 50 || d.length > 170 ? "warn" : "pass",
    d ? `${d.length} chars` : "missing",
  );
  add(
    "SEO",
    "h1",
    "One H1",
    head.h1s.length === 1 ? "pass" : head.h1s.length === 0 ? "fail" : "warn",
    head.h1s.length === 1 ? head.h1s[0] : `${head.h1s.length} H1s`,
  );
  await addPageQualityChecks({ add, section: "SEO", fetchImpl, html, head, pageUrl: finalUrl });
  const h2s = (html.match(/<h2\b/gi) ?? []).length;
  add(
    "SEO",
    "headings",
    "Heading structure",
    h2s ? "pass" : "warn",
    h2s ? `${h2s} H2 section headings` : "no H2 headings under the H1",
  );
  const invalid = head.jsonLd.filter((j) => !j.ok);
  add(
    "SEO",
    "schema",
    "Structured data valid",
    !head.jsonLd.length ? "skip" : invalid.length ? "fail" : "pass",
    !head.jsonLd.length
      ? "none on the page"
      : invalid.length
        ? invalid.map((j) => j.error).join("; ")
        : head.jsonLd.flatMap((j) => j.types).join(", "),
  );
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => parseAttrs(m[0]));
  const noAlt = imgs.filter((a) => a.alt == null);
  add(
    "SEO",
    "alt",
    "Images have alt text",
    noAlt.length ? "warn" : "pass",
    imgs.length ? `${imgs.length - noAlt.length}/${imgs.length} with alt` : "no images",
  );

  // Links on the page work (same-host links fetched; external ones left alone).
  const links = extractLinks(html, finalUrl);
  const sameHost = [
    ...new Set(
      links.filter((l) => hostOf(l.href) === hostOf(finalUrl)).map((l) => l.href.split("#")[0]),
    ),
  ].slice(0, 40);
  const checked = await mapLimit(sameHost, 5, async (u) => ({ u, r: await get(fetchImpl, u) }));
  const broken = checked.filter(({ r }) => (r.final?.status ?? 0) >= 400 || r.error);
  add(
    "LINKS",
    "work",
    "Links on the page work",
    broken.length ? "fail" : "pass",
    broken.length
      ? `broken: ${broken
          .slice(0, 5)
          .map(({ u, r }) => `${new URL(u).pathname} → ${r.final?.status ?? r.error}`)
          .join("; ")}`
      : `${checked.length} same-site link(s) checked`,
  );
  const cta = [
    ...new Map(
      links
        .filter((l) =>
          /contact|quote|book|call|prototype|get started|schedule/i.test(`${l.href} ${l.text}`),
        )
        .map((l) => [`${l.href}|${l.text}`, l]),
    ).values(),
  ];
  add(
    "LINKS",
    "cta",
    "Call-to-action present",
    cta.length ? "pass" : "warn",
    cta.length
      ? cta
          .slice(0, 2)
          .map((l) => `"${l.text}" → ${l.href}`)
          .join("; ")
      : "no call-to-action link found",
  );

  // A staging sitemap is a test artifact: never submitted anywhere.
  const sm = await get(fetchImpl, `${new URL(finalUrl).origin}/sitemap.xml`);
  if (sm.final?.status === 200) {
    const locs = parseSitemap(sm.final.text).locs;
    const listed = locs.some(
      (l) => trimSlash(new URL(l, finalUrl).pathname) === trimSlash(new URL(url).pathname),
    );
    add(
      "SITEMAP",
      "test-artifact",
      "Sitemap (test artifact — never submit it)",
      listed ? "pass" : "warn",
      `${listed ? "lists this page" : "doesn't list this page"}; its URLs are on ${[...new Set(locs.map(hostOf))].slice(0, 3).join(", ") || "no host"} — production's own sitemap is checked after the deploy`,
    );
  } else {
    add(
      "SITEMAP",
      "test-artifact",
      "Sitemap (test artifact — never submit it)",
      "skip",
      `no sitemap on ${envName}`,
    );
  }

  // What only a person can judge.
  result.userChecks.push(
    "Desktop layout: spacing, alignment, nothing overflowing sideways.",
    "Mobile layout: the page reads well on a phone; buttons are easy to tap.",
    "Navigation and footer work; images load (no broken images).",
    "The call-to-action is easy to see and goes to the right place (don't submit real forms on staging).",
    "Content: the right business, services, places and prices; no placeholder, demo or test text; no customer data that shouldn't be public.",
  );
  const fails = result.checks.filter((c) => c.status === "fail");
  result.verdict = fails.length ? STAGING_PROBLEMS : STAGING_PASSED;
  result.stagingReview = { result: fails.length ? "fail" : "pass", date: today, url };
  return result;
}

// ---------------------------------------------------------------- report

const MARK = { pass: "✓", fail: "✗", warn: "⚠", review: "?", skip: "–" };

function formatNonProductionReport(r) {
  if (r.verdict === NOT_APPLICABLE) {
    return [
      NOT_APPLICABLE,
      `Page: ${r.page.name ?? r.page.id ?? "(unnamed)"}`,
      `URL: ${r.page.url}`,
      "ENVIRONMENT: LOCAL",
      ...r.notes,
    ].join("\n");
  }
  const lines = [
    `${r.environment} PUBLICATION CHECK`,
    `Page: ${r.page.name ?? r.page.id ?? "(unnamed)"}`,
    `URL: ${r.page.url}`,
    "",
    ...r.notes,
    "",
  ];
  for (const name of ["PAGE", "ENVIRONMENT", "SEO", "LINKS", "SITEMAP"]) {
    const items = r.checks.filter((c) => c.section === name);
    if (!items.length) continue;
    lines.push(name);
    for (const c of items)
      lines.push(`${MARK[c.status]} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
    lines.push("");
  }
  if (r.userChecks.length) {
    lines.push("NEEDS YOUR CHECK (visual and content — only a person can judge)");
    r.userChecks.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    lines.push("");
  }
  lines.push(`OVERALL STATUS: ${r.verdict}`, "", "WHAT YOU NEED TO DO");
  if (r.verdict === NOT_ON_STAGING)
    lines.push(
      `1. Deploy the current version to ${r.environment.toLowerCase()} through the project's own workflow, then run this check again.`,
    );
  else if (r.verdict === STAGING_PASSED)
    lines.push(
      "1. Look at the page yourself (the list above), then tell Claude whether it's approved for production.",
      "2. Do NOT request indexing or submit anything to a search engine for this URL.",
    );
  else
    lines.push(
      "1. Fix the ✗ items above, redeploy, and run this check again.",
      "2. Do NOT request indexing or submit anything to a search engine for this URL.",
    );
  return lines.join("\n");
}

export function formatReport(r) {
  if (r.environment && r.environment !== ENV.PRODUCTION) return formatNonProductionReport(r);
  const lines = [
    "SEO POST-PUBLICATION CHECK",
    "ENVIRONMENT: PRODUCTION",
    "SEARCH ENGINE INDEXING ACTIONS: ENABLED — only once this check passes",
    `Page: ${r.page.name ?? r.page.id ?? "(unnamed)"}`,
    `Production URL: ${r.page.url}`,
    "",
  ];
  const section = (name) => {
    const items = r.checks.filter((c) => c.section === name);
    if (!items.length) return;
    lines.push(name);
    for (const c of items)
      lines.push(`${MARK[c.status]} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
    lines.push("");
  };
  section("LIVE PAGE");
  if (!r.live && r.unavailable) {
    lines.push(`OVERALL STATUS: ${UNAVAILABLE_MESSAGE}`, "");
    for (const n of r.notes) lines.push(n);
    lines.push("", "WHAT YOU NEED TO DO", "1. Nothing — run this check again when the site is reachable. Nothing was recorded or changed.");
    return lines.join("\n");
  }
  if (!r.live) {
    lines.push(`OVERALL STATUS: ${NOT_LIVE_MESSAGE}`, "");
    for (const n of r.notes) lines.push(n);
    lines.push(
      "",
      "WHAT YOU NEED TO DO",
      "1. Nothing for search engines yet — the page must be deployed to production first (only with your go-ahead). Then run this check again.",
    );
    return lines.join("\n");
  }
  for (const s of ["INDEXING", "SITEMAP", "INTERNAL LINKS", "ON-PAGE SEO", "ENVIRONMENT"])
    section(s);
  if (r.critical?.length) {
    lines.push("CRITICAL SEO ERRORS — fix these before anything else");
    for (const c of r.critical) lines.push(`✗ ${c.label} — ${c.detail}`);
    lines.push("");
  }
  if (r.inboundLinks.length) {
    lines.push("Links to this page:");
    for (const l of r.inboundLinks)
      lines.push(`  ${new URL(l.from).pathname} — "${l.text}" (${l.location})`);
    lines.push("");
  }
  const sc = r.searchConsole;
  lines.push(
    "GOOGLE SEARCH CONSOLE",
    `Property: ${sc.property}${sc.propertyDetail ? ` (${sc.propertyDetail})` : ""}`,
    `URL inspection: ${sc.urlInspection}`,
    `Indexing request: ${sc.indexingRequest.toLowerCase()}`,
    `Sitemap submission: ${sc.sitemapSubmission}`,
    "",
  );
  if (r.otherEngines.length)
    lines.push("OTHER SEARCH ENGINES", ...r.otherEngines.map((o) => `• ${o}`), "");
  lines.push("MANUAL ACTIONS REQUIRED");
  if (!r.manualActions.length) lines.push("None.");
  for (const a of r.manualActions) {
    if (typeof a === "string") lines.push(a);
    else lines.push(a.title, ...a.steps.map((s, i) => `${i + 1}. ${s}`));
  }
  lines.push(
    "",
    "MONITORING",
    `Publication date: ${r.monitoring.publishedOn}${r.monitoring.publishedOnSource === "recorded" ? "" : ` (${r.monitoring.publishedOnSource})`}`,
    `7-day review: ${r.monitoring.review7}`,
    `30-day review: ${r.monitoring.review30}`,
    `90-day review: ${r.monitoring.review90}`,
    "",
  );
  if (r.notes.length) lines.push(...r.notes, "");
  lines.push(`OVERALL STATUS: ${r.verdict}`, "", "WHAT YOU NEED TO DO");
  const todo = [];
  for (const a of r.manualActions) {
    if (typeof a === "string")
      todo.push(
        a === SITEMAP_SUBMISSION_UNVERIFIED
          ? "In Search Console → Sitemaps, confirm the sitemap is listed with status Success (tell Claude what you see)."
          : a,
      );
    else
      todo.push(
        `In Google Search Console, inspect ${r.canonicalUrl ?? r.page.url} and click Request Indexing (then tell Claude the date).`,
      );
  }
  if (!todo.length) lines.push("Nothing — everything that can be checked has been verified.");
  else todo.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  if (todo.length && r.verdict === READY) lines.push("", "Everything else has been verified.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- CLI

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function cli(argv) {
  const values = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
  const one = (name) => values(name)[0];
  const project = resolve(one("--project") ?? process.cwd());
  const cfgFile = join(project, "seo", "seo-config.json");
  const invFile = join(project, "seo", "content-inventory.json");
  const config = existsSync(cfgFile) ? readJson(cfgFile) : {};
  let page = {};
  const id = one("--id");
  const path = one("--path");
  if (id || path) {
    if (!existsSync(invFile)) throw new Error(`No inventory at ${invFile}`);
    const inv = readJson(invFile);
    page = inv.pages.find((p) => (id ? p.id === id : p.url === path));
    if (!page) throw new Error(`No inventory entry for ${id ?? path}`);
  }
  const result = await checkPublication({
    url: one("--url"),
    page,
    config,
    expect: values("--expect"),
    publishedOn: one("--published-on"),
    maxPages: one("--max-pages") ? Number(one("--max-pages")) : undefined,
    environment: one("--env"),
  });
  console.log(formatReport(result));
  const out = one("--out");
  if (out) writeFileSync(resolve(out), JSON.stringify(result, null, 2) + "\n");
  if (argv.includes("--patch") && result.live && result.environment === ENV.PRODUCTION) {
    console.log("\nSuggested inventory update (apply only what is true):");
    console.log(JSON.stringify(result.inventoryPatch, null, 2));
  }
  if (result.verdict === NOT_APPLICABLE) return 4;
  if (result.environment !== ENV.PRODUCTION)
    return !result.live ? 2 : result.verdict === STAGING_PASSED ? 0 : 1;
  return !result.live ? 2 : result.verdict === READY ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`post-publish-check: ${e.message}`);
      process.exit(3);
    },
  );
}
