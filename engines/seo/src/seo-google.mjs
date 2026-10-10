#!/usr/bin/env node
// BWESEO Google workflow — zero dependencies, Node 18+ (global fetch, WebCrypto). Engine 1.7.0.
//
// What can be automated after an approved page reaches production, and what cannot:
//   • Google READINESS      — read-only GETs of the production page, robots.txt and sitemap; maps the
//                             post-publication check to a readiness record. Never "indexed".
//   • Sitemap registration  — the OFFICIAL Search Console API (sitemaps.get / sitemaps.submit), only when
//                             the project has enabled it and credentials exist; idempotent (an already
//                             registered sitemap is reported, never resubmitted).
//   • Discovery / crawl / index evidence — the OFFICIAL URL Inspection API (read-only). "Indexed" is only
//                             ever set from its reported coverage state.
//   • Performance           — the OFFICIAL Search Analytics API (read-only). Zero data is valid data.
// What is NEVER done here: simulating the "Request Indexing" button (a manual, optional accelerator);
// using Google's Indexing API for ordinary pages (it is only for JobPosting / BroadcastEvent content);
// submitting anything that is not a production URL; storing or printing credentials.
//
// Nothing in this file names any business: the property, sitemap and hosts come from the project's own
// seo/seo-config.json. Credentials are referenced by NAME only (analytics.searchConsole.credentialsSource,
// e.g. "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON") and read from the process environment / the host's secret
// store at call time — never from a file in the project, never logged, never sent to a browser.
//
// CLI (from the project root):
//   node seo/tools/seo-google.mjs api-status            what is configured (booleans only — no values)
//   node seo/tools/seo-google.mjs readiness <page id>   Google readiness of a production page (read-only GETs)
//   node seo/tools/seo-google.mjs sitemap [--submit]    reconcile the sitemap (dry run unless --submit)
//   node seo/tools/seo-google.mjs inspect <page id>     discovery / crawl / index evidence (URL Inspection API)
//   node seo/tools/seo-google.mjs performance <page id> [--days 28]
// Every command prints JSON and changes no project file; /BWESEO records the result.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyUrl, environmentsOf } from "./seo-state-core.mjs";

export const GOOGLE_ENGINE_VERSION = "1.7.0";

export const READINESS_STATUSES = ["PASSED", "FAILED", "PENDING", "UNKNOWN"];
export const DISCOVERY_STATUSES = ["DISCOVERED", "PENDING", "UNKNOWN"];
export const CRAWL_STATUSES = ["CRAWLED", "PENDING", "UNKNOWN"];
export const INDEXED_STATUSES = ["INDEXED", "NOT VERIFIED"];

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);

// Secrets hygiene, the credential pointer, the production-only guard and the Search Console API client live in
// gsc-client.mjs (Worker-safe; shared with the scheduled Google index monitor). Re-exported unchanged for existing callers.
import {
  redact,
  parseCredentialsSource,
  searchConsoleApiConfig,
  normalizePropertyType,
  credentialStatus,
  guardProductionTarget,
  siteUrlFor,
  createSearchConsoleClient,
  planSitemapAction,
  reconcileSitemap,
} from "./gsc-client.mjs";
export {
  redact,
  parseCredentialsSource,
  searchConsoleApiConfig,
  normalizePropertyType,
  credentialStatus,
  guardProductionTarget,
  siteUrlFor,
  createSearchConsoleClient,
  planSitemapAction,
  reconcileSitemap,
};


// Google's Indexing API is ONLY for pages with JobPosting or BroadcastEvent (livestream) markup. It must
// not be used to speed up indexing of ordinary pages (services, pricing, articles…). Default: not eligible.
export const INDEXING_API_QUALIFIED_TYPES = ["JobPosting", "BroadcastEvent"];
export function indexingApiEligibility(page) {
  const declared = page?.google?.indexingApi ?? page?.indexingApi ?? null;
  const type = declared?.contentType;
  if (declared?.eligible === true && INDEXING_API_QUALIFIED_TYPES.includes(type))
    return { eligible: true, contentType: type, reason: `qualified content type (${type})` };
  return {
    eligible: false,
    contentType: type ?? null,
    reason:
      "ordinary SEO pages do not qualify for Google's Indexing API (only JobPosting / BroadcastEvent content does) — use the sitemap and normal discovery",
  };
}
export function assertIndexingApiAllowed(page) {
  const e = indexingApiEligibility(page);
  if (!e.eligible) throw new Error(`Indexing API refused for ${page?.url ?? "this page"}: ${e.reason}`);
  return e;
}
// There is deliberately no Indexing-API caller in this engine. A future qualified-content adapter must
// call assertIndexingApiAllowed first; until one is installed even an eligible page is refused.
export async function submitViaIndexingApi(page) {
  assertIndexingApiAllowed(page);
  throw new Error("no qualified-content Indexing API adapter is installed in this engine");
}

// ---------------------------------------------------------------- readiness (from the post-publication check)

const READINESS_ITEMS = [
  ["productionResponse", "Production URL responds", "LIVE PAGE", "available"],
  ["https", "HTTPS", "LIVE PAGE", "https"],
  ["indexable", "Indexable (no accidental noindex)", "INDEXING", "noindex"],
  ["robots", "robots.txt allows crawling", "INDEXING", "robots"],
  ["canonical", "Canonical correct (HTTPS, production)", "INDEXING", "canonical"],
  ["noStagingLinks", "No staging links", "ENVIRONMENT", "links"],
  ["noStagingSchema", "No staging URLs in structured data", "ENVIRONMENT", "schema"],
  ["noStagingSocial", "No staging URLs in social metadata", "ENVIRONMENT", "social"],
  ["noStagingContent", "No staging references in the page", "ENVIRONMENT", "contamination"],
  ["sitemapAvailable", "Sitemap reachable", "SITEMAP", "available"],
  ["sitemapValid", "Sitemap well-formed", "SITEMAP", "valid"],
  ["sitemapIncluded", "Sitemap includes the production URL", "SITEMAP", "included"],
  ["sitemapProductionOnly", "Sitemap has no staging URLs", "SITEMAP", "no-staging"],
  ["sitemapLastmod", "Sitemap lastmod is reasonable", "SITEMAP", "lastmod"],
  ["internalLinks", "Internal links present", "INTERNAL LINKS", "incoming"],
  ["notOrphan", "Not orphaned", "INTERNAL LINKS", "orphan"],
  ["title", "Title", "ON-PAGE SEO", "title"],
  ["description", "Meta description", "ON-PAGE SEO", "description"],
  ["h1", "H1", "ON-PAGE SEO", "h1"],
  ["structuredData", "Structured data valid where present", "ON-PAGE SEO", "schema"],
  ["stagingHidden", "Staging stays hidden from search engines", "ENVIRONMENT", "staging-hidden"],
];

// Turn a checkPublication() result into the durable GOOGLE READINESS record. PASSED means only "the
// page appears technically ready for Google" — never that Google has discovered, crawled or indexed it.
export function googleReadinessFromCheck(result, { checkedAt = today() } = {}) {
  const source = "post-publication check (production, read-only)";
  if (result?.unavailable)
    return {
      status: "UNKNOWN",
      checkedAt,
      source,
      note: "the production check could not reach the site (a live-site health problem, not a readiness failure) — run it again",
      items: [],
    };
  const byKey = new Map((result?.checks ?? []).map((c) => [`${c.section}/${c.id}`, c]));
  const items = READINESS_ITEMS.map(([id, label, section, cid]) => {
    const c = byKey.get(`${section}/${cid}`);
    return {
      id,
      label,
      status: !c ? "skip" : c.status === "pass" ? "pass" : c.status === "warn" ? "warn" : c.status === "fail" ? "fail" : "skip",
      ...(c && c.status !== "pass" && c.status !== "skip" && isStr(c.detail) ? { detail: c.detail.slice(0, 300) } : {}),
    };
  });
  const failures = items.filter((i) => i.status === "fail");
  const warnings = items.filter((i) => i.status === "warn");
  const live = result?.live === true;
  return {
    status: !live ? "FAILED" : failures.length ? "FAILED" : "PASSED",
    checkedAt,
    source,
    items,
    ...(failures.length ? { failures: failures.map((f) => f.label) } : {}),
    ...(warnings.length ? { warnings: warnings.map((w) => w.label) } : {}),
    ...(!live ? { note: "the production URL was not found (see the post-publication report)" } : {}),
  };
}

// ---------------------------------------------------------------- Search Console API client

// ---------------------------------------------------------------- discovery / crawl / index evidence

// Map a URL Inspection result to separate discovery / crawl / index facts. "Indexed" ONLY when Google's
// own verdict says the URL is on Google. Nothing else — HTTP 200, the sitemap, a passed live test, a
// Request Indexing click, being discovered or crawled — ever counts.
export function interpretInspection(api, { at = today() } = {}) {
  const r = api?.inspectionResult?.indexStatusResult;
  const source = "search-console-api:url-inspection";
  if (!r)
    return {
      discovered: { status: "UNKNOWN", source },
      crawled: { status: "UNKNOWN", source },
      indexed: { status: "NOT VERIFIED", lastCheckedOn: at, source, note: "the inspection returned no index status" },
    };
  const coverage = String(r.coverageState ?? "");
  const lastCrawl = isStr(r.lastCrawlTime) ? r.lastCrawlTime : null;
  const onGoogle = r.verdict === "PASS" && /indexed/i.test(coverage) && !/not indexed|currently not indexed/i.test(coverage);
  const unknown = /unknown to google/i.test(coverage);
  const discoveredOnly = /discovered\s*[-–]\s*currently not indexed/i.test(coverage);
  const crawledNotIndexed = /crawled\s*[-–]\s*currently not indexed/i.test(coverage);
  const evidence = `${coverage}${lastCrawl ? `; last crawl ${lastCrawl}` : ""}`.slice(0, 200);
  const discovered = unknown
    ? { status: "PENDING", source, note: coverage }
    : { status: "DISCOVERED", at, source, evidence };
  const crawled = discoveredOnly || unknown || (!lastCrawl && !onGoogle && !crawledNotIndexed)
    ? { status: "PENDING", source, note: coverage || "no crawl recorded yet" }
    : { status: "CRAWLED", at: lastCrawl ? lastCrawl.slice(0, 10) : at, source, evidence };
  const indexed = onGoogle
    ? { status: "INDEXED", verifiedOn: at, evidence, source }
    : { status: "NOT VERIFIED", lastCheckedOn: at, source, note: coverage || "not indexed yet" };
  return { discovered, crawled, indexed, ...(r.robotsTxtState === "DISALLOWED" ? { problem: "robots.txt blocks Google" } : {}) };
}

// ---------------------------------------------------------------- performance

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Summarize Search Analytics rows. Zero rows is a valid, honest result ("no data yet"), never an error.
export function summarizePerformance(response, { windowDays = 28, at = today(), queryRows = null } = {}) {
  const rows = Array.isArray(response?.rows) ? response.rows : [];
  const impressions = rows.reduce((a, r) => a + num(r.impressions), 0);
  const clicks = rows.reduce((a, r) => a + num(r.clicks), 0);
  const position = impressions
    ? rows.reduce((a, r) => a + num(r.position) * num(r.impressions), 0) / impressions
    : null;
  const top = (Array.isArray(queryRows?.rows) ? queryRows.rows : [])
    .map((r) => ({ query: String(r.keys?.[0] ?? "").slice(0, 120), clicks: num(r.clicks), impressions: num(r.impressions) }))
    .filter((q) => q.query)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  return {
    checkedAt: at,
    source: "search-console-api:search-analytics",
    windowDays,
    hasData: impressions > 0 || clicks > 0,
    impressions,
    clicks,
    ctr: impressions ? clicks / impressions : 0,
    position: position == null ? null : Math.round(position * 10) / 10,
    queries: top,
  };
}

// ---------------------------------------------------------------- CLI

async function cli(argv) {
  const [cmd, arg] = argv;
  const flag = (n) => argv.includes(n);
  const project = resolve(process.cwd());
  const read = (f) => JSON.parse(readFileSync(join(project, f), "utf8"));
  if (!existsSync(join(project, "seo", "seo-config.json"))) {
    console.error("Run this from a project root that has seo/seo-config.json");
    return 3;
  }
  const config = read("seo/seo-config.json");
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  const page = () => {
    const p = read("seo/content-inventory.json").pages.find((x) => x.id === arg);
    if (!p) throw new Error(`No inventory entry "${arg}"`);
    return p;
  };
  if (cmd === "api-status") {
    const s = credentialStatus(config, process.env);
    out({ enabled: s.enabled, credentialsSource: s.credentialsSource, available: s.available, reason: s.reason, property: s.property, propertyType: s.propertyType, sitemapUrl: s.sitemapUrl });
    return 0;
  }
  if (cmd === "readiness") {
    const { checkPublication } = await import("./post-publish-check.mjs");
    const p = page();
    const result = await checkPublication({ fetchImpl: globalThis.fetch, config, page: p, today: today(), publishedOn: p.publishedOn });
    out(googleReadinessFromCheck(result));
    return 0;
  }
  const client = createSearchConsoleClient({ config, env: process.env });
  if (cmd === "sitemap") {
    out(await reconcileSitemap({ client, config, dryRun: !flag("--submit"), force: flag("--force") }));
    return 0;
  }
  if (cmd === "inspect") {
    const p = page();
    const url = p.canonicalUrl && p.canonicalUrl !== "unknown" ? p.canonicalUrl : `${environmentsOf(config).production.url}${p.url}`;
    guardProductionTarget(url, config, "URL inspection");
    const r = await client.inspectUrl(url);
    out(r.ok ? interpretInspection(r.data) : r);
    return 0;
  }
  if (cmd === "performance") {
    const p = page();
    const days = Number(argv[argv.indexOf("--days") + 1]) || 28;
    const url = `${environmentsOf(config).production.url}${p.url}`;
    guardProductionTarget(url, config, "Performance query");
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const f = (d) => d.toISOString().slice(0, 10);
    const filter = [{ filters: [{ dimension: "page", operator: "equals", expression: url }] }];
    const pageRes = await client.searchAnalytics({ startDate: f(start), endDate: f(end), dimensions: ["page"], dimensionFilterGroups: filter });
    if (!pageRes.ok) return out(pageRes), 0;
    const qRes = await client.searchAnalytics({ startDate: f(start), endDate: f(end), dimensions: ["query"], dimensionFilterGroups: filter, rowLimit: 25 });
    out(summarizePerformance(pageRes.data, { windowDays: days, queryRows: qRes.ok ? qRes.data : null }));
    return 0;
  }
  console.error("Usage: seo-google.mjs api-status | readiness <id> | sitemap [--submit] | inspect <id> | performance <id> [--days N]");
  return 3;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(redact(e?.message ?? e));
      process.exit(3);
    },
  );
}
