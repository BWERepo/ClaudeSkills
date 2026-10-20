#!/usr/bin/env node
// BWESEO engine validator — zero dependencies, Node 18+.
//
// Vendored into each project as seo/tools/validate-seo-data.mjs by /BWESEOSetup. The engine copy
// at $BWESEO_ENGINE/src/ is the source of truth; keep ENGINE_VERSION in step
// with docs/ENGINE.md.
//
// Usage:
//   node seo/tools/validate-seo-data.mjs                      validate ./seo/*.json
//   node seo/tools/validate-seo-data.mjs --project <dir>      validate <dir>/seo/*.json
//   node seo/tools/validate-seo-data.mjs --engine <engineDir> [--profile <profile.json>]
//                                                             client-data isolation scan
// Exit code 1 when any error is found. Warnings never fail.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_VERSION = "2026.10.20.03";
// The version of the data files' shape (seo-config.json → schemaVersion). Separate from the engine version:
// the engine changes often; the schema changes only when stored data needs migrating.
export const SCHEMA_VERSION = 1;

export const FACT_STATUSES = ["verified", "unverified", "needs-input", "not-applicable"];
export const PAGE_STATUSES = [
  "idea",
  "planned",
  "approved",
  "draft",
  "review",
  "published",
  "update-needed",
  "rejected",
];
export const PAGE_TYPES = [
  "home",
  "pillar",
  "service",
  "location",
  "industry",
  "pricing",
  "comparison",
  "resource",
  "case-study",
  "portfolio",
  "about",
  "contact",
  "legal",
  "utility",
];
export const INTENTS = [
  "high-commercial",
  "service",
  "local",
  "comparison",
  "problem-solution",
  "informational",
  "navigational",
  "legal",
];
export const PRIORITIES = ["P1", "P2", "P3"];
export const NAVIGATION_PLACEMENTS = [
  "primary",
  "service",
  "resource",
  "footer",
  "sitemap-only",
  "contextual-only",
];
export const INDEXING_REQUEST_STATUSES = ["REQUESTED", "NOT REQUESTED", "REQUEST FAILED", "UNKNOWN"];
// Engine 1.4.0 — the Google lifecycle is separate facts, none of which implies the next.
export const LIVE_URL_TEST_RESULTS = ["not tested", "passed", "failed", "unknown"];
export const INDEXED_STATUSES = ["INDEXED", "NOT VERIFIED"];
export const SEARCH_CONSOLE_CONFIGURED = ["yes", "no", "unknown"];
export const POST_PUBLICATION_RESULTS = ["ready", "action-required", "not-live"];
export const LOCATION_DEPENDENCE = ["local", "regional", "multi-location", "non-local"];
// Engine 1.2.0 — workflow state read by /BWESEO (see docs/methodology/workflow-state.md).
export const QA_RESULTS = ["pass", "fail"];
export const HOLD_SCOPES = ["deploy", "all"];
// Engine 1.3.0 — environments (see docs/methodology/environments.md).
export const STAGING_STATUSES = ["configured", "not-configured", "unknown"];
export const PREVIEW_STATUSES = ["configured", "not-configured"];
export const ISSUE_SEVERITIES = ["critical", "high", "medium", "low"];
export const ISSUE_AREAS = [
  "technical",
  "schema",
  "local",
  "internal-links",
  "content",
  "legal",
  "measurement",
  "environment",
];
export const ISSUE_STATUSES = ["open", "approved", "fixed", "verified", "deferred", "wont-fix"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STALE_DAYS = 180;
// Statuses for pages that are being (or have been) built — they need a full plan.
const BUILD_STATUSES = new Set(["approved", "draft", "review"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const daysSince = (date, today) => (Date.parse(today) - Date.parse(date)) / 86_400_000;
// Local date, not UTC, so an evening run doesn't treat tomorrow as today.
const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function result() {
  return { errors: [], warnings: [] };
}

function merge(into, from) {
  into.errors.push(...from.errors);
  into.warnings.push(...from.warnings);
  return into;
}

// Any object carrying a `status` key is a provenance-bearing node (a Fact, an offering, a
// claim, a competitor…). Walk the whole profile and hold every one to the same rule.
function checkProvenance(node, path, r, today) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkProvenance(v, `${path}[${i}]`, r, today));
    return;
  }
  if (!isObj(node)) return;
  if ("status" in node) {
    if (!FACT_STATUSES.includes(node.status)) {
      r.errors.push(`${path}.status "${node.status}" is not one of ${FACT_STATUSES.join(", ")}`);
    } else if (node.status === "verified") {
      if (!isStr(node.source)) r.errors.push(`${path} is verified but has no source`);
      if (!DATE_RE.test(node.verifiedOn ?? "")) {
        r.errors.push(`${path} is verified but verifiedOn is not YYYY-MM-DD`);
      } else if (daysSince(node.verifiedOn, today) > STALE_DAYS) {
        r.warnings.push(
          `${path} was verified ${node.verifiedOn} (over ${STALE_DAYS} days ago) — re-verify before using it on a new page`,
        );
      }
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "value") continue; // a fact's value may itself be an object with a "status"-free shape
    checkProvenance(v, `${path}.${k}`, r, today);
  }
}

function requireFact(obj, key, path, r) {
  const f = obj?.[key];
  if (!isObj(f) || !("value" in f) || !("status" in f)) {
    r.errors.push(`${path}.${key} must be a Fact { value, status, source, verifiedOn }`);
  }
}

export function validateProfile(profile, { today = todayIso() } = {}) {
  const r = result();
  if (!isObj(profile)) {
    r.errors.push("business-profile.json is not a JSON object");
    return r;
  }
  if (profile.schemaVersion !== 1) r.errors.push("profile.schemaVersion must be 1");
  if (!ID_RE.test(profile.profileId ?? "")) r.errors.push("profile.profileId must be kebab-case");
  if (!DATE_RE.test(profile.lastReviewed ?? ""))
    r.errors.push("profile.lastReviewed must be YYYY-MM-DD");

  for (const section of [
    "identity",
    "markets",
    "offerings",
    "customers",
    "positioning",
    "contact",
    "trust",
    "claims",
  ]) {
    if (!isObj(profile[section])) r.errors.push(`profile.${section} is required (object)`);
  }
  for (const list of ["competitors", "doNotPromote", "openQuestions"]) {
    if (!Array.isArray(profile[list])) r.errors.push(`profile.${list} is required (array)`);
  }
  if (r.errors.length) return r;

  for (const k of ["businessName", "website", "industry", "businessType", "description"]) {
    requireFact(profile.identity, k, "identity", r);
  }
  requireFact(profile.markets, "locationDependence", "markets", r);
  const dep = profile.markets.locationDependence?.value;
  if (dep !== undefined && !LOCATION_DEPENDENCE.includes(dep)) {
    r.errors.push(
      `markets.locationDependence.value must be one of ${LOCATION_DEPENDENCE.join(", ")}`,
    );
  }
  requireFact(profile.positioning, "primaryConversion", "positioning", r);

  for (const kind of ["services", "products"]) {
    const list = profile.offerings[kind];
    if (!Array.isArray(list)) {
      r.errors.push(`offerings.${kind} must be an array`);
      continue;
    }
    const seen = new Set();
    list.forEach((o, i) => {
      if (!ID_RE.test(o?.id ?? "")) r.errors.push(`offerings.${kind}[${i}].id must be kebab-case`);
      else if (seen.has(o.id)) r.errors.push(`offerings.${kind}: duplicate id "${o.id}"`);
      seen.add(o?.id);
      if (!isStr(o?.name)) r.errors.push(`offerings.${kind}[${i}].name is required`);
      if (!("status" in (o ?? {}))) r.errors.push(`offerings.${kind}[${i}] needs a status`);
    });
  }

  const claims = profile.claims;
  if (!Array.isArray(claims.verified) || !Array.isArray(claims.prohibited)) {
    r.errors.push("claims.verified and claims.prohibited must be arrays");
  } else {
    const ids = new Set();
    claims.verified.forEach((c, i) => {
      if (!ID_RE.test(c?.id ?? "")) r.errors.push(`claims.verified[${i}].id must be kebab-case`);
      else if (ids.has(c.id)) r.errors.push(`claims.verified: duplicate id "${c.id}"`);
      ids.add(c?.id);
      if (!isStr(c?.text)) r.errors.push(`claims.verified[${i}].text is required`);
      if (c?.status !== "verified") {
        r.errors.push(
          `claims.verified[${i}] ("${c?.id}") must have status "verified" — move unproven claims to openQuestions`,
        );
      }
    });
    claims.prohibited.forEach((c, i) => {
      if (!isStr(c?.text) || !isStr(c?.reason)) {
        r.errors.push(`claims.prohibited[${i}] needs text and reason`);
      }
    });
  }

  profile.openQuestions.forEach((q, i) => {
    if (!ID_RE.test(q?.id ?? "") || !isStr(q?.question)) {
      r.errors.push(`openQuestions[${i}] needs a kebab-case id and a question`);
    }
    if (q?.answeredOn != null && !DATE_RE.test(q.answeredOn)) {
      r.errors.push(`openQuestions[${i}].answeredOn must be YYYY-MM-DD`);
    }
  });

  checkProvenance(profile, "profile", r, today);

  const needsInput = JSON.stringify(profile).match(/"status":\s*"needs-input"/g)?.length ?? 0;
  if (needsInput)
    r.warnings.push(`${needsInput} profile fact(s) are needs-input — see openQuestions`);
  return r;
}

export function validateConfig(config) {
  const r = result();
  if (!isObj(config)) {
    r.errors.push("seo-config.json is not a JSON object");
    return r;
  }
  if (config.schemaVersion !== SCHEMA_VERSION) r.errors.push(`config.schemaVersion must be ${SCHEMA_VERSION}`);
  if (!ID_RE.test(config.projectId ?? "")) r.errors.push("config.projectId must be kebab-case");
  if (!/^https:\/\/[^/]+$/.test(config.website ?? "")) {
    r.errors.push("config.website must be an https origin with no trailing slash");
  }
  if (
    !isObj(config.repo) ||
    (!isStr(config.repo.gitRemote) && !isStr(config.repo.rootFolderName))
  ) {
    r.errors.push("config.repo needs gitRemote or rootFolderName (used by the project guard)");
  }
  if (!isObj(config.engine) || !isStr(config.engine.version)) {
    r.errors.push("config.engine.version is required");
  } else if (config.engine.version !== ENGINE_VERSION) {
    r.warnings.push(
      `config.engine.version ${config.engine.version} differs from validator ${ENGINE_VERSION} — run the engine upgrade steps`,
    );
  }
  if (!isStr(config.adapter)) r.errors.push("config.adapter is required");
  if (!isObj(config.stack)) r.errors.push("config.stack is required (object)");
  if (!isObj(config.workflows) || !isStr(config.workflows.build) || !isStr(config.workflows.test)) {
    r.errors.push("config.workflows.build and .test are required");
  }
  if (!isObj(config.conversion) || !isStr(config.conversion.primary)) {
    r.errors.push("config.conversion.primary is required");
  }
  if (
    !isObj(config.paths) ||
    !isStr(config.paths.businessProfile) ||
    !isStr(config.paths.contentInventory) ||
    !isStr(config.paths.docs)
  ) {
    r.errors.push("config.paths.businessProfile, .contentInventory and .docs are required");
  }
  // Engine 1.1.0: what /BWESEOPublish needs to find the live site's sitemap/robots/staging hosts.
  const pub = config.publication;
  if (pub == null) {
    r.warnings.push(
      "config.publication is missing — /BWESEOPublish will fall back to /sitemap.xml and /robots.txt on the production origin",
    );
  } else if (!isObj(pub)) {
    r.errors.push("config.publication must be an object");
  } else {
    for (const k of ["sitemapUrl", "robotsUrl"]) {
      if (pub[k] != null && !/^https:\/\//.test(pub[k]))
        r.errors.push(`config.publication.${k} must be an https URL`);
    }
    if (pub.stagingHosts != null && !Array.isArray(pub.stagingHosts)) {
      r.errors.push("config.publication.stagingHosts must be an array of host names");
    }
    if (pub.indexNow?.keyUrl != null && !/^https:\/\//.test(pub.indexNow.keyUrl)) {
      r.errors.push("config.publication.indexNow.keyUrl must be an https URL");
    }
  }
  checkEnvironments(config, r);
  const sm = config.analytics?.searchConsole?.sitemapSubmission;
  if (sm != null && !["verified", "not verified"].includes(sm)) {
    r.errors.push(
      'config.analytics.searchConsole.sitemapSubmission must be "verified" or "not verified"',
    );
  }
  checkSearchConsoleSite(config.analytics?.searchConsole, r);
  return r;
}

// Engine 1.9.0: Google Index Monitoring configuration. Site configuration only — never credentials.
function checkIndexMonitor(m, at, r) {
  if (m == null) return;
  const p = `${at}.indexMonitor`;
  if (!isObj(m)) return void r.errors.push(`${p} must be an object`);
  if (m.enabled != null && typeof m.enabled !== "boolean") r.errors.push(`${p}.enabled must be true or false`);
  if (m.staleAfterDays != null && !(Number.isInteger(m.staleAfterDays) && m.staleAfterDays > 0)) r.errors.push(`${p}.staleAfterDays must be a positive integer`);
  if (m.thresholds != null) {
    if (!isObj(m.thresholds)) r.errors.push(`${p}.thresholds must be an object`);
    else for (const [k, val] of Object.entries(m.thresholds)) if (!(typeof val === "number" && val >= 0) && !isObj(val)) r.errors.push(`${p}.thresholds.${k} must be a non-negative number`);
  }
  for (const k of Object.keys(m)) if (/token|secret|password|private|refresh|client_email|service_?account|credential/i.test(k)) r.errors.push(`${p}.${k}: never store credentials in the project — the key lives in the host's secret store`);
  const s = m.snapshot;
  if (s != null) {
    if (!isObj(s)) return void r.errors.push(`${p}.snapshot must be an object`);
    if (s.source != null && !["cloudflare-kv", "file"].includes(s.source)) r.errors.push(`${p}.snapshot.source must be cloudflare-kv or file`);
    if (s.kvNamespaceId != null && !/^[0-9a-f]{32}$/.test(s.kvNamespaceId)) r.errors.push(`${p}.snapshot.kvNamespaceId must be a 32-character Cloudflare KV namespace id`);
  }
  if (m.enabled === true && !isObj(s)) r.warnings.push(`${p}.enabled is true but snapshot is not configured — /BWESEO can't read the monitor's state`);
}

// Engine 1.10.0: Keyword Performance configuration. Site configuration only - never credentials (those stay on the Search Console
// block as a NAME). The data itself comes from the site's own Search Console; nothing here searches Google.
function checkKeywordPerformance(m, at, r) {
  if (m == null) return;
  const p = `${at}.keywordPerformance`;
  if (!isObj(m)) return void r.errors.push(`${p} must be an object`);
  if (m.enabled != null && typeof m.enabled !== "boolean") r.errors.push(`${p}.enabled must be true or false`);
  if (m.staleAfterDays != null && !(Number.isInteger(m.staleAfterDays) && m.staleAfterDays > 0)) r.errors.push(`${p}.staleAfterDays must be a positive integer`);
  if (m.defaultRange != null && !["7d", "28d", "3m"].includes(m.defaultRange)) r.errors.push(`${p}.defaultRange must be 7d, 28d or 3m`);
  if (m.thresholds != null) {
    if (!isObj(m.thresholds)) r.errors.push(`${p}.thresholds must be an object`);
    else for (const [k, val] of Object.entries(m.thresholds)) if (!(typeof val === "number" && val >= 0)) r.errors.push(`${p}.thresholds.${k} must be a non-negative number`);
  }
  for (const k of Object.keys(m)) if (/token|secret|password|private|refresh|client_email|service_?account|credential/i.test(k)) r.errors.push(`${p}.${k}: never store credentials in the project - the key lives in the host's secret store`);
}

// Engine 1.4.0: the site-level Search Console record. `configured: yes` needs a property and a
// verification date; a verification token or other secret is never stored in the project.
function checkSearchConsoleSite(sc, r) {
  if (sc == null) return;
  const at = "config.analytics.searchConsole";
  if (sc.configured != null && !SEARCH_CONSOLE_CONFIGURED.includes(sc.configured))
    r.errors.push(`${at}.configured must be ${SEARCH_CONSOLE_CONFIGURED.join(" / ")}`);
  if (sc.configured === "yes" && !(isStr(sc.verifiedProperty) && DATE_RE.test(sc.verifiedOn ?? "")))
    r.errors.push(`${at}.configured is yes but verifiedProperty / verifiedOn are missing (record only what was verified)`);
  for (const k of Object.keys(sc))
    if (k !== "credentialsSource" && /token|secret|password|txt|private|refresh|client_email|service_?account/i.test(k))
      r.errors.push(`${at}.${k}: never store verification tokens, credentials or secrets in the project`);
  // Engine 1.7.0: the Search Console API is optional. Credentials are referenced by NAME only.
  if (sc.enabled != null && typeof sc.enabled !== "boolean") r.errors.push(`${at}.enabled must be true or false`);
  if (sc.credentialsSource != null && !/^(env|secret):[A-Z][A-Z0-9_]{2,63}$/.test(sc.credentialsSource))
    r.errors.push(`${at}.credentialsSource must be a NAME such as "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" — never the credential itself`);
  if (sc.enabled === true && sc.credentialsSource == null)
    r.warnings.push(`${at}.enabled is true but credentialsSource is not set — the API steps will stay manual`);
  if (sc.requestIndexing != null && !["optional", "recommended"].includes(sc.requestIndexing))
    r.errors.push(`${at}.requestIndexing must be "optional" or "recommended"`);
  if (sc.statusCheckDays != null && !(Number.isInteger(sc.statusCheckDays) && sc.statusCheckDays > 0))
    r.errors.push(`${at}.statusCheckDays must be a positive integer`);
  if (sc.propertyType != null && !["Domain", "URL-prefix", "domain", "url-prefix", "unknown"].includes(sc.propertyType))
    r.errors.push(`${at}.propertyType must be domain / url-prefix / unknown`);
  checkIndexMonitor(sc.indexMonitor, at, r);
  checkKeywordPerformance(sc.keywordPerformance, at, r);
  const sm = sc.sitemap;
  if (sm == null) return;
  if (!isObj(sm)) return void r.errors.push(`${at}.sitemap must be an object`);
  if (sm.submitted != null && !["yes", "no", "unknown"].includes(sm.submitted))
    r.errors.push(`${at}.sitemap.submitted must be yes / no / unknown`);
  for (const d of ["verifiedOn", "lastRead", "submissionAt"])
    if (sm[d] != null && !DATE_RE.test(sm[d])) r.errors.push(`${at}.sitemap.${d} must be YYYY-MM-DD`);
  if (sm.submissionMethod != null && !["api", "manual", "unknown"].includes(sm.submissionMethod))
    r.errors.push(`${at}.sitemap.submissionMethod must be api / manual / unknown`);
  if (sm.submitted === "yes" && /^success/i.test(sm.status ?? "") && !DATE_RE.test(sm.verifiedOn ?? ""))
    r.errors.push(`${at}.sitemap: a verified sitemap needs verifiedOn`);
}

// Engine 1.3.0: where production, staging, preview and local are. Nothing may be guessed — a
// project without a staging site says so (status "not-configured") rather than leaving it out.
const HOST_RE = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const hostOfOrigin = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
function checkEnvironments(config, r) {
  const env = config.environments;
  if (env == null) {
    r.warnings.push(
      "config.environments is missing — /BWESEO can't tell production from staging; run /BWESEOSetup to record them",
    );
    return;
  }
  if (!isObj(env)) {
    r.errors.push("config.environments must be an object");
    return;
  }
  // Engine 1.6.0: where the live check runs. The host serving the site must not fetch its own zone.
  const hc = env.health;
  if (hc != null) {
    if (!isObj(hc)) r.errors.push("config.environments.health must be an object");
    else {
      if (hc.strategy != null && !["browser", "server", "off"].includes(hc.strategy))
        r.errors.push('config.environments.health.strategy must be "browser", "server" or "off"');
      if (hc.endpoint != null && !/^\/[^\s]*$/.test(hc.endpoint))
        r.errors.push('config.environments.health.endpoint must be a path starting with "/" (e.g. "/" or "/healthz")');
    }
  }
  const hostsOf = (at, v) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((h) => !isStr(h) || !HOST_RE.test(h.toLowerCase()))) {
      r.errors.push(`${at} must be an array of host names (no https://, no path)`);
      return [];
    }
    return v.map((h) => h.toLowerCase());
  };
  const legacy = ["production", "staging"].filter((k) => typeof env[k] === "string");
  if (legacy.length || env.stagingBlockedFromIndexing != null) {
    r.warnings.push(
      "config.environments uses the pre-1.3.0 format (plain URL strings / stagingBlockedFromIndexing) — move to production { url, hosts } and staging { status, url, hosts, indexProtection }",
    );
  }
  const prod = typeof env.production === "string" ? { url: env.production } : env.production;
  let prodHosts = [];
  if (!isObj(prod)) {
    r.errors.push("config.environments.production is required: { url, hosts }");
  } else {
    if (!/^https:\/\/[^/]+$/.test(prod.url ?? "")) {
      r.errors.push(
        "config.environments.production.url must be an https origin with no trailing slash",
      );
    } else if (isStr(config.website) && prod.url !== config.website) {
      r.errors.push(
        `config.environments.production.url (${prod.url}) differs from config.website (${config.website})`,
      );
    }
    prodHosts = [
      hostOfOrigin(prod.url),
      ...hostsOf("config.environments.production.hosts", prod.hosts),
    ];
  }
  const stg = typeof env.staging === "string" ? { url: env.staging } : env.staging;
  let stgHosts = [];
  if (stg == null) {
    r.warnings.push(
      'config.environments.staging is missing — record { "status": "not-configured" } if this site has no staging, so nobody has to guess',
    );
  } else if (!isObj(stg)) {
    r.errors.push("config.environments.staging must be an object");
  } else {
    if (stg.status != null && !STAGING_STATUSES.includes(stg.status)) {
      r.errors.push(
        `config.environments.staging.status must be one of ${STAGING_STATUSES.join(", ")}`,
      );
    }
    if (isStr(stg.url) && !/^https?:\/\/[^/]+$/.test(stg.url)) {
      r.errors.push("config.environments.staging.url must be an origin with no trailing slash");
    }
    stgHosts = [
      ...(isStr(stg.url) ? [hostOfOrigin(stg.url)] : []),
      ...hostsOf("config.environments.staging.hosts", stg.hosts),
    ];
    if (stg.status === "configured" && !isStr(stg.url)) {
      r.errors.push("config.environments.staging: status configured needs its url");
    }
    if (stg.status === "not-configured" && (isStr(stg.url) || stgHosts.length)) {
      r.errors.push(
        "config.environments.staging: status not-configured can't also name a url or hosts",
      );
    }
  }
  stgHosts.push(...hostsOf("config.publication.stagingHosts", config.publication?.stagingHosts));
  const both = stgHosts.filter((h) => h && prodHosts.includes(h));
  if (both.length) {
    r.errors.push(
      `config.environments: ${[...new Set(both)].join(", ")} is listed as both production and staging`,
    );
  }
  const pv = env.preview;
  if (pv != null) {
    if (!isObj(pv)) r.errors.push("config.environments.preview must be an object");
    else {
      if (pv.status != null && !PREVIEW_STATUSES.includes(pv.status)) {
        r.errors.push(
          `config.environments.preview.status must be one of ${PREVIEW_STATUSES.join(", ")}`,
        );
      }
      const pats = hostsOf("config.environments.preview.hostPatterns", pv.hostPatterns);
      if (pv.status === "configured" && !pats.length) {
        r.errors.push("config.environments.preview: status configured needs hostPatterns");
      }
      const clash = pats.filter((p) =>
        prodHosts.some((h) => h === p || (p.startsWith("*.") && h.endsWith(p.slice(1)))),
      );
      if (clash.length) {
        r.errors.push(
          `config.environments.preview.hostPatterns ${clash.join(", ")} would match production`,
        );
      }
    }
  }
}

export function validateInventory(inventory, { today = todayIso() } = {}) {
  const r = result();
  if (!isObj(inventory) || !Array.isArray(inventory.pages)) {
    r.errors.push("content-inventory.json needs a pages array");
    return r;
  }
  if (inventory.schemaVersion !== 1) r.errors.push("inventory.schemaVersion must be 1");
  if (inventory.keywordDecisions !== undefined) {
    if (!Array.isArray(inventory.keywordDecisions)) r.errors.push("inventory.keywordDecisions must be an array");
    else inventory.keywordDecisions.forEach((d, i) => {
      if (!isObj(d) || !isStr(d.query) || !["ignore", "monitor", "investigate"].includes(d.decision)) r.errors.push(`keywordDecisions[${i}] needs a query and a decision of ignore, monitor or investigate`);
    });
  }
  const ids = new Set();
  const urls = new Map();
  const titles = new Map();
  inventory.pages.forEach((p, i) => {
    const at = `pages[${i}]${p?.id ? ` (${p.id})` : ""}`;
    if (!ID_RE.test(p?.id ?? "")) r.errors.push(`${at}.id must be kebab-case`);
    else if (ids.has(p.id)) r.errors.push(`${at}: duplicate id`);
    ids.add(p?.id);
    if (!isStr(p?.url) || !p.url.startsWith("/"))
      r.errors.push(`${at}.url must be a site path starting with "/"`);
    if (!PAGE_TYPES.includes(p?.type))
      r.errors.push(`${at}.type "${p?.type}" is not one of ${PAGE_TYPES.join(", ")}`);
    if (!PAGE_STATUSES.includes(p?.status))
      r.errors.push(`${at}.status "${p?.status}" is not one of ${PAGE_STATUSES.join(", ")}`);
    if (typeof p?.indexable !== "boolean") r.errors.push(`${at}.indexable must be true/false`);
    if (!isStr(p?.topic)) r.errors.push(`${at}.topic is required`);
    if (p?.primaryIntent != null && !INTENTS.includes(p.primaryIntent)) {
      r.errors.push(`${at}.primaryIntent "${p.primaryIntent}" is not one of ${INTENTS.join(", ")}`);
    }
    if (p?.priority != null && !PRIORITIES.includes(p.priority)) {
      r.errors.push(`${at}.priority must be P1, P2, P3 or null`);
    }
    for (const d of ["created", "lastReviewed", "approvedOn"]) {
      if (p?.[d] != null && !DATE_RE.test(p[d]))
        r.errors.push(`${at}.${d} must be YYYY-MM-DD or null`);
    }

    // Engine 1.10.0: the keyword -> target page registry lives on the page. ONE primary, any number of secondary.
    if (p?.keywords !== undefined) {
      const k = p.keywords;
      if (!isObj(k)) r.errors.push(`${at}.keywords must be an object { primary, secondary[] }`);
      else {
        if (k.primary != null && !isStr(k.primary)) r.errors.push(`${at}.keywords.primary must be ONE non-empty string (a page has exactly one primary keyword)`);
        if (k.secondary != null && !(Array.isArray(k.secondary) && k.secondary.every(isStr))) r.errors.push(`${at}.keywords.secondary must be an array of non-empty strings`);
        if (k.searchIntent != null && !isStr(k.searchIntent)) r.errors.push(`${at}.keywords.searchIntent must be a string`);
        if (k.addedOn != null && !DATE_RE.test(k.addedOn)) r.errors.push(`${at}.keywords.addedOn must be YYYY-MM-DD`);
      }
    }
    if (p?.status !== "rejected" && isStr(p?.url)) {
      if (urls.has(p.url)) r.errors.push(`${at}: url ${p.url} is also used by ${urls.get(p.url)}`);
      urls.set(p.url, p.id);
    }
    if (p?.status === "published" && p?.indexable) {
      if (!isStr(p.title)) r.errors.push(`${at}: a published indexable page needs its title`);
      else {
        const t = p.title.trim().toLowerCase();
        if (titles.has(t))
          r.errors.push(`${at}: title duplicates ${titles.get(t)} — duplicate titles cannibalize`);
        titles.set(t, p.id);
      }
      if (p.lastReviewed && daysSince(p.lastReviewed, today) > STALE_DAYS) {
        r.warnings.push(`${at} last reviewed ${p.lastReviewed} — due for a refresh check`);
      }
    }
    if (BUILD_STATUSES.has(p?.status)) {
      if (!p.primaryIntent) r.errors.push(`${at}: ${p.status} pages need primaryIntent`);
      if (!isStr(p.cta)) r.errors.push(`${at}: ${p.status} pages need a cta`);
      if (p.type !== "home" && !isStr(p.parent))
        r.errors.push(`${at}: ${p.status} pages need a parent`);
      if (!isObj(p.cannibalization) || !isStr(p.cannibalization.decision)) {
        r.errors.push(`${at}: ${p.status} pages need cannibalization.decision`);
      }
      if (
        p.status === "approved" &&
        (!DATE_RE.test(p.approvedOn ?? "") || p.approvedBy !== "user")
      ) {
        r.errors.push(
          `${at}: approved pages need approvedOn and approvedBy "user" (only the user approves pages)`,
        );
      }
    }
    checkPublication(p, at, r);
    checkWorkflow(p, at, r);
  });
  checkIssues(inventory.issues, r);
  return r;
}

// Workflow-state fields (engine 1.2.0). All optional; when present they must be well-formed,
// because /BWESEO decides the next step from them.
function checkWorkflow(p, at, r) {
  if (p?.name != null && !isStr(p.name)) r.errors.push(`${at}.name must be a non-empty string`);
  if (p?.roadmapOrder != null && !Number.isFinite(p.roadmapOrder)) {
    r.errors.push(`${at}.roadmapOrder must be a number`);
  }
  for (const d of ["proposedOn", "lastModifiedOn", "lastRefreshedOn"]) {
    if (p?.[d] != null && !DATE_RE.test(p[d]))
      r.errors.push(`${at}.${d} must be YYYY-MM-DD or null`);
  }
  if (p?.blockedBy != null) {
    if (!Array.isArray(p.blockedBy) || p.blockedBy.some((id) => !ID_RE.test(id ?? ""))) {
      r.errors.push(`${at}.blockedBy must be an array of openQuestions ids`);
    }
  }
  const qa = p?.qa;
  if (qa != null) {
    if (!isObj(qa)) r.errors.push(`${at}.qa must be an object`);
    else {
      if (!QA_RESULTS.includes(qa.result)) r.errors.push(`${at}.qa.result must be pass or fail`);
      if (!DATE_RE.test(qa.date ?? "")) r.errors.push(`${at}.qa.date must be YYYY-MM-DD`);
      if (qa.sourceHash != null && !/^[0-9a-f]{8,64}$/.test(qa.sourceHash)) {
        r.errors.push(`${at}.qa.sourceHash must be the hex hash printed by seo-state.mjs --hash`);
      }
    }
  }
  // Engine 1.3.0: the page's staging record — deployed, reviewed, approved by the owner.
  const st = p?.staging;
  if (st != null) {
    if (!isObj(st)) r.errors.push(`${at}.staging must be an object`);
    else {
      if (st.deployedOn != null && !DATE_RE.test(st.deployedOn))
        r.errors.push(`${at}.staging.deployedOn must be YYYY-MM-DD`);
      const rv = st.review;
      if (rv != null) {
        if (!isObj(rv) || !QA_RESULTS.includes(rv.result) || !DATE_RE.test(rv.date ?? "")) {
          r.errors.push(`${at}.staging.review needs result (pass or fail) and date (YYYY-MM-DD)`);
        } else if (rv.sourceHash != null && !/^[0-9a-f]{8,64}$/.test(rv.sourceHash)) {
          r.errors.push(
            `${at}.staging.review.sourceHash must be the hex hash printed by seo-state.mjs --hash`,
          );
        }
      }
      const ap = st.approval;
      if (ap != null) {
        if (!isObj(ap) || !DATE_RE.test(ap.approvedOn ?? "") || !isStr(ap.source)) {
          r.errors.push(
            `${at}.staging.approval needs approvedOn (YYYY-MM-DD) and source — only the owner approves a page on staging`,
          );
        } else if (rv?.result !== "pass") {
          r.errors.push(`${at}.staging.approval recorded without a passed staging review`);
        } else if (ap.sourceHash != null && !/^[0-9a-f]{8,64}$/.test(ap.sourceHash)) {
          r.errors.push(
            `${at}.staging.approval.sourceHash must be the hex hash printed by seo-state.mjs --hash`,
          );
        }
      }
    }
  }
  const hold = p?.hold;
  if (hold != null) {
    if (!isObj(hold) || !DATE_RE.test(hold.since ?? "") || !isStr(hold.source)) {
      r.errors.push(
        `${at}.hold needs since (YYYY-MM-DD) and source (only the owner puts a page on hold)`,
      );
    } else if (hold.scope != null && !HOLD_SCOPES.includes(hold.scope)) {
      r.errors.push(`${at}.hold.scope must be one of ${HOLD_SCOPES.join(", ")}`);
    }
  }
  const rf = p?.refresh;
  if (rf != null) {
    if (!isObj(rf) || !isStr(rf.trigger) || !isStr(rf.evidence)) {
      r.errors.push(
        `${at}.refresh needs trigger and evidence (a refresh is only recommended on evidence)`,
      );
    } else {
      for (const d of ["flaggedOn", "resolvedOn"]) {
        if (rf[d] != null && !DATE_RE.test(rf[d]))
          r.errors.push(`${at}.refresh.${d} must be YYYY-MM-DD`);
      }
    }
  }
  const done = p?.postPublication?.monitoring?.completed;
  if (done != null) {
    if (!isObj(done)) r.errors.push(`${at}.postPublication.monitoring.completed must be an object`);
    else {
      for (const [k, v] of Object.entries(done)) {
        if (!["review7", "review30", "review90"].includes(k)) {
          r.errors.push(
            `${at}.postPublication.monitoring.completed.${k} is not a review (review7/30/90)`,
          );
        } else if (v != null && !DATE_RE.test(v)) {
          r.errors.push(
            `${at}.postPublication.monitoring.completed.${k} must be YYYY-MM-DD or null`,
          );
        }
      }
    }
  }
}

// Site-wide findings from the audits (engine 1.2.0): what /BWESEO routes to the technical,
// schema, local and internal-link skills.
function checkIssues(issues, r) {
  if (issues == null) return;
  if (!Array.isArray(issues)) {
    r.errors.push("inventory.issues must be an array");
    return;
  }
  const ids = new Set();
  issues.forEach((is, i) => {
    const at = `issues[${i}]${is?.id ? ` (${is.id})` : ""}`;
    if (!ID_RE.test(is?.id ?? "")) r.errors.push(`${at}.id must be kebab-case`);
    else if (ids.has(is.id)) r.errors.push(`${at}: duplicate id`);
    ids.add(is?.id);
    if (!isStr(is?.title)) r.errors.push(`${at}.title is required`);
    if (!ISSUE_SEVERITIES.includes(is?.severity)) {
      r.errors.push(`${at}.severity must be one of ${ISSUE_SEVERITIES.join(", ")}`);
    }
    if (!ISSUE_AREAS.includes(is?.area))
      r.errors.push(`${at}.area must be one of ${ISSUE_AREAS.join(", ")}`);
    if (!ISSUE_STATUSES.includes(is?.status)) {
      r.errors.push(`${at}.status must be one of ${ISSUE_STATUSES.join(", ")}`);
    }
    if (
      is?.pages != null &&
      (!Array.isArray(is.pages) || is.pages.some((u) => !String(u).startsWith("/")))
    ) {
      r.errors.push(`${at}.pages must be an array of site paths`);
    }
    for (const d of ["foundOn", "fixedOn", "verifiedOn"]) {
      if (is?.[d] != null && !DATE_RE.test(is[d])) r.errors.push(`${at}.${d} must be YYYY-MM-DD`);
    }
    if (["fixed", "verified"].includes(is?.status) && !DATE_RE.test(is?.fixedOn ?? "")) {
      r.errors.push(`${at}: a ${is.status} issue needs fixedOn`);
    }
    if (is?.status === "verified" && !DATE_RE.test(is?.verifiedOn ?? "")) {
      r.errors.push(`${at}: a verified issue needs verifiedOn (the date it was confirmed live)`);
    }
  });
}

// Post-publication rules (engine 1.1.0). A page built through the engine (approvedBy "user") is
// only "published" once /BWESEOPublish has verified it live on production; the Search Console
// indexing-request status may only say REQUESTED with a date and a source.
const REVERSAL_KINDS = ["rollback", "removed", "reverted"];
// Engine 1.7.0 — the page-level Google workflow (postPublication.google). Each stage needs its OWN
// evidence (a date and a source); a later stage is never inferred from an earlier one.
const READINESS_STATUSES = ["PASSED", "FAILED", "PENDING", "UNKNOWN"];
const DISCOVERY_STATUSES = ["DISCOVERED", "PENDING", "UNKNOWN"];
const CRAWL_STATUSES = ["CRAWLED", "PENDING", "UNKNOWN"];
const INDEXING_API_TYPES = ["JobPosting", "BroadcastEvent"];
function checkGoogleState(g, at, r) {
  if (g == null) return;
  if (!isObj(g)) return void r.errors.push(`${at}.postPublication.google must be an object`);
  const here = `${at}.postPublication.google`;
  const rd = g.readiness;
  if (rd != null) {
    if (!READINESS_STATUSES.includes(rd.status)) r.errors.push(`${here}.readiness.status must be ${READINESS_STATUSES.join(" / ")}`);
    else if ((rd.status === "PASSED" || rd.status === "FAILED") && !(DATE_RE.test(rd.checkedAt ?? "") && isStr(rd.source)))
      r.errors.push(`${here}.readiness ${rd.status} needs checkedAt and source`);
    if (rd.items != null && !Array.isArray(rd.items)) r.errors.push(`${here}.readiness.items must be an array`);
  }
  const sm = g.sitemap;
  if (sm != null) {
    if (!["yes", "no", "unknown"].includes(sm.included)) r.errors.push(`${here}.sitemap.included must be yes / no / unknown`);
    else if (sm.included === "yes" && !(DATE_RE.test(sm.verifiedAt ?? "") && isStr(sm.source)))
      r.errors.push(`${here}.sitemap.included yes needs verifiedAt and source`);
  }
  for (const [k, ok, done] of [["discovered", DISCOVERY_STATUSES, "DISCOVERED"], ["crawled", CRAWL_STATUSES, "CRAWLED"]]) {
    const o = g[k];
    if (o == null) continue;
    if (!ok.includes(o.status)) r.errors.push(`${here}.${k}.status must be ${ok.join(" / ")}`);
    else if (o.status === done && !(DATE_RE.test(o.at ?? "") && isStr(o.source)))
      r.errors.push(`${here}.${k} ${done} needs at and source — a later Google stage is never inferred from an earlier one`);
  }
  if (g.lastCheckedOn != null && !DATE_RE.test(g.lastCheckedOn)) r.errors.push(`${here}.lastCheckedOn must be YYYY-MM-DD`);
  const pf = g.performance;
  if (pf != null) {
    if (!DATE_RE.test(pf.checkedAt ?? "")) r.errors.push(`${here}.performance.checkedAt must be YYYY-MM-DD`);
    for (const k of ["impressions", "clicks", "ctr"])
      if (pf[k] != null && !(Number.isFinite(pf[k]) && pf[k] >= 0)) r.errors.push(`${here}.performance.${k} must be a number >= 0 (zero is valid — do not invent data)`);
  }
  const ia = g.indexingApi;
  if (ia != null && ia.eligible === true && !INDEXING_API_TYPES.includes(ia.contentType))
    r.errors.push(`${here}.indexingApi.eligible is true but contentType is not one Google's Indexing API supports (${INDEXING_API_TYPES.join(", ")}) — ordinary pages are never eligible`);
}
function checkPublication(p, at, r) {
  // Engine 1.5.0: the ONLY thing that reverses a Production milestone is verified evidence of a
  // deliberate event — never a failed request. It needs a kind, a date, a source and evidence.
  const rv = p?.production?.reversal;
  if (rv != null) {
    if (!isObj(rv)) r.errors.push(`${at}.production.reversal must be an object`);
    else {
      if (!REVERSAL_KINDS.includes(rv.kind))
        r.errors.push(`${at}.production.reversal.kind must be one of ${REVERSAL_KINDS.join(", ")}`);
      if (!DATE_RE.test(rv.date ?? ""))
        r.errors.push(`${at}.production.reversal.date must be YYYY-MM-DD`);
      if (!isStr(rv.source) || !isStr(rv.evidence))
        r.errors.push(
          `${at}.production.reversal needs source and evidence — a failed HTTP request is never evidence that production was reversed`,
        );
    }
  }
  if (p?.navigation != null) {
    const nav = [].concat(p.navigation.placement ?? p.navigation);
    for (const n of nav) {
      if (!NAVIGATION_PLACEMENTS.includes(n)) {
        r.errors.push(`${at}.navigation "${n}" is not one of ${NAVIGATION_PLACEMENTS.join(", ")}`);
      }
    }
  }
  for (const d of ["publishedOn", "nextReview"]) {
    if (p?.[d] != null && !DATE_RE.test(p[d]))
      r.errors.push(`${at}.${d} must be YYYY-MM-DD or null`);
  }
  const pp = p?.postPublication;
  if (pp != null) {
    if (!isObj(pp)) {
      r.errors.push(`${at}.postPublication must be an object`);
      return;
    }
    if (!DATE_RE.test(pp.checkedOn ?? ""))
      r.errors.push(`${at}.postPublication.checkedOn must be YYYY-MM-DD`);
    if (!POST_PUBLICATION_RESULTS.includes(pp.result)) {
      r.errors.push(
        `${at}.postPublication.result must be one of ${POST_PUBLICATION_RESULTS.join(", ")}`,
      );
    }
    checkGoogleState(pp.google, at, r);
    const sc = pp.searchConsole;
    if (sc != null) {
      if (!INDEXING_REQUEST_STATUSES.includes(sc.indexingRequest)) {
        r.errors.push(
          `${at}.postPublication.searchConsole.indexingRequest must be ${INDEXING_REQUEST_STATUSES.join(" / ")}`,
        );
      } else if (
        sc.indexingRequest === "REQUESTED" &&
        (!DATE_RE.test(sc.requestedOn ?? "") || !isStr(sc.requestSource))
      ) {
        r.errors.push(
          `${at}: indexingRequest REQUESTED needs requestedOn and requestSource (verified information only — never because the checklist recommends it)`,
        );
      }
      const ut = sc.liveUrlTest;
      if (ut != null) {
        if (!LIVE_URL_TEST_RESULTS.includes(ut.result))
          r.errors.push(`${at}.postPublication.searchConsole.liveUrlTest.result must be ${LIVE_URL_TEST_RESULTS.join(" / ")}`);
        else if (ut.result !== "not tested" && ut.result !== "unknown" && !DATE_RE.test(ut.testedOn ?? ""))
          r.errors.push(`${at}: a recorded Live URL Test result needs testedOn`);
      }
      const ix = sc.indexed;
      if (ix != null) {
        if (!INDEXED_STATUSES.includes(ix.status))
          r.errors.push(`${at}.postPublication.searchConsole.indexed.status must be ${INDEXED_STATUSES.join(" / ")}`);
        else if (ix.status === "INDEXED" && !(DATE_RE.test(ix.verifiedOn ?? "") && isStr(ix.evidence) && isStr(ix.source)))
          r.errors.push(`${at}: indexed INDEXED needs verifiedOn, evidence and source — a request, a passed test or a sitemap is never evidence`);
      }
    }
  }
  if (p?.status === "published" && p?.approvedBy === "user") {
    if (!pp) {
      r.errors.push(
        `${at}: published through the engine but no post-publication check recorded — run /BWESEOPublish`,
      );
    } else if (pp.result === "not-live") {
      r.errors.push(
        `${at}: marked published but the last post-publication check found it NOT LIVE`,
      );
    } else if (!DATE_RE.test(p.publishedOn ?? "")) {
      r.errors.push(`${at}: published pages need publishedOn (the monitoring baseline)`);
    }
  }
}

// Every indexable path the site actually serves must have an inventory entry, so a new public
// page can't slip in without the SEO system knowing about it.
export function checkInventoryCoverage(inventory, livePaths) {
  const r = result();
  const known = new Set((inventory?.pages ?? []).map((p) => p.url));
  for (const path of livePaths) {
    if (!known.has(path))
      r.errors.push(`public page ${path} has no entry in content-inventory.json`);
  }
  return r;
}

export function validateCrossFile(profile, config, inventory) {
  const r = result();
  if (profile?.profileId && config?.projectId && profile.profileId !== config.projectId) {
    r.errors.push(
      `profile.profileId "${profile.profileId}" ≠ config.projectId "${config.projectId}"`,
    );
  }
  if (inventory?.projectId && config?.projectId && inventory.projectId !== config.projectId) {
    r.errors.push(
      `inventory.projectId "${inventory.projectId}" ≠ config.projectId "${config.projectId}"`,
    );
  }
  const site = profile?.identity?.website?.value;
  if (site && config?.website && site.replace(/\/$/, "") !== config.website) {
    r.errors.push(`profile website ${site} ≠ config.website ${config.website}`);
  }
  // Claims ledger: every claim a page cites must be a verified claim in the profile.
  const verifiedClaims = new Set((profile?.claims?.verified ?? []).map((c) => c.id));
  for (const p of inventory?.pages ?? []) {
    for (const id of p.claims ?? []) {
      if (!verifiedClaims.has(id)) {
        r.errors.push(
          `inventory ${p.id} cites claim "${id}", which is not in profile claims.verified`,
        );
      }
    }
  }
  return r;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

// Anything that looks like a Google credential, key or token in a string value (any depth).
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bya29\.[\w.-]{20,}/, "a Google access token"],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/, "a signed token"],
  [/"?(private_key|client_secret|refresh_token)"?\s*[:=]\s*"[^"]{8,}/i, "a credential field"],
  [/\bGOCSPX-[\w-]{10,}/, "an OAuth client secret"],
];
export function findSecret(v) {
  if (typeof v === "string") {
    for (const [re, what] of SECRET_PATTERNS) if (re.test(v)) return what;
    return null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const h = findSecret(x);
      if (h) return h;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (/^(private_key|client_secret|refresh_token|access_token)$/i.test(k) && typeof x === "string" && x.length > 8) return `a "${k}" field`;
      const h = findSecret(x);
      if (h) return h;
    }
  }
  return null;
}

export function validateProject(projectDir, opts = {}) {
  const dir = join(projectDir, "seo");
  const r = result();
  const files = {
    profile: join(dir, "business-profile.json"),
    config: join(dir, "seo-config.json"),
    inventory: join(dir, "content-inventory.json"),
  };
  const data = {};
  for (const [k, f] of Object.entries(files)) {
    if (!existsSync(f)) {
      r.errors.push(`missing ${f}`);
      continue;
    }
    try {
      data[k] = readJson(f);
    } catch (e) {
      r.errors.push(`${f} is not valid JSON: ${e.message}`);
    }
  }
  for (const [k, v] of Object.entries(data)) {
    const hit = findSecret(v);
    if (hit) r.errors.push(`seo/${k === "config" ? "seo-config" : k === "profile" ? "business-profile" : "content-inventory"}.json contains what looks like a credential (${hit}) — credentials never belong in the project; reference them by NAME (credentialsSource)`);
  }
  if (data.profile) merge(r, validateProfile(data.profile, opts));
  if (data.config) merge(r, validateConfig(data.config));
  if (data.inventory) merge(r, validateInventory(data.inventory, opts));
  merge(r, validateCrossFile(data.profile, data.config, data.inventory));
  return { ...r, data };
}

// ---- Engine isolation scan -------------------------------------------------------------------

const SCAN_EXT = new Set([".md", ".json", ".mjs", ".js", ".ts", ".txt"]);
const EMAIL_RE = /[A-Z0-9._%+-]+@([A-Z0-9-]+\.)+[A-Z]{2,}/gi;
const PHONE_RE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const ALLOWED_EMAIL_DOMAINS = /@(example\.(com|org|net)|noreply\.anthropic\.com)$/i;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (SCAN_EXT.has(extname(name))) out.push(p);
  }
  return out;
}

// The allowlist lives in src/. Accept being pointed at the engine folder, the BWESEO
// skill folder above it, or any sibling BWESEO* skill folder.
function findAllowlist(dir) {
  const candidates = [
    join(dir, "config", "isolation-allowlist.json"),
    join(dir, "tools", "isolation-allowlist.json"),
    join(dir, "engine", "tools", "isolation-allowlist.json"),
    join(dir, "..", "BWESEO", "engine", "tools", "isolation-allowlist.json"),
  ];
  return candidates.find((f) => existsSync(f)) ?? null;
}

export function scanEngine(engineDir, { profile = null } = {}) {
  const r = result();
  const allowFile = findAllowlist(engineDir);
  const allowed = allowFile ? (readJson(allowFile).allowedTerms ?? []) : [];
  const forbidden = [];
  if (profile) {
    const id = profile.identity ?? {};
    const c = profile.contact ?? {};
    const host = String(id.website?.value ?? "")
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    for (const term of [id.businessName?.value, host, c.email?.value, c.phone?.value]) {
      if (isStr(term) && !allowed.some((a) => a.toLowerCase() === term.toLowerCase())) {
        forbidden.push(term);
      }
    }
    const digits = String(c.phone?.value ?? "").replace(/\D/g, "");
    if (digits.length >= 10) forbidden.push(digits);
  }
  const self = fileURLToPath(import.meta.url);
  for (const file of walk(engineDir)) {
    if (resolve(file) === resolve(self) || file.endsWith("isolation-allowlist.json")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.match(EMAIL_RE) ?? []) {
      if (!ALLOWED_EMAIL_DOMAINS.test(m))
        r.errors.push(`${file}: email address "${m}" in the engine`);
    }
    for (const m of text.match(PHONE_RE) ?? []) {
      if (!/\b555\b/.test(m)) r.errors.push(`${file}: phone number "${m}" in the engine`);
    }
    const lower = text.toLowerCase();
    const digitsOnly = text.replace(/\D/g, "");
    for (const term of forbidden) {
      const hit = /^\d+$/.test(term)
        ? digitsOnly.includes(term)
        : lower.includes(term.toLowerCase());
      if (hit) r.errors.push(`${file}: contains client data "${term}"`);
    }
  }
  return r;
}

// ---- CLI -----------------------------------------------------------------------------------

function print(r, label) {
  for (const w of r.warnings) console.log(`  warn  ${w}`);
  for (const e of r.errors) console.log(`  ERROR ${e}`);
  console.log(
    `${r.errors.length ? "✗" : "✓"} ${label}: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`,
  );
}

function cli(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  console.log(`BWESEO validator ${ENGINE_VERSION}`);
  if (argv.includes("--engine")) {
    const engineDir = resolve(arg("--engine"));
    const profileFile = arg("--profile");
    const r = scanEngine(engineDir, {
      profile: profileFile ? readJson(resolve(profileFile)) : null,
    });
    print(r, `engine isolation scan (${engineDir})`);
    return r.errors.length ? 1 : 0;
  }
  const projectDir = resolve(arg("--project") ?? process.cwd());
  const r = validateProject(projectDir);
  print(r, `project ${projectDir}`);
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(cli(process.argv.slice(2)));
}
