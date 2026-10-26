// BWESEO regression detection — the pure comparison core (no I/O, no node: imports, so it runs in Node, a Worker or a browser).
//
// It compares a CURRENT observation of a site with the ACCEPTED BASELINE observation and reports unexpected technical changes that
// could damage organic visibility. Everything here is an OBSERVED TECHNICAL STATE from a crawl. It never says a page is, or is not,
// indexed by Google: only Search Console knows that (see docs/methodology/regression-detection.md).
//
// Evidence rules (the contract every check follows):
//   • A check compares only what BOTH observations actually established. A page that was not fetched, timed out, or whose headers were
//     not captured is UNKNOWN for the checks that need that evidence — never a confirmed failure.
//   • Every check answers per subject with one of: detect | clear | unknown | na. `clear` is what lets a finding be marked resolved;
//     `unknown` and `na` never resolve anything.
//   • The first valid run is a baseline, not a comparison: nothing is reported as new.
//
// The findings contract (see FINDING_FIELDS) is what dashboards and issue queues consume; docs/methodology/regression-detection.md
// documents it, the severity rules and the comparison scope.
import { sha256hex } from "./landing-hash.mjs";
import { parseRobots, robotsAllows } from "./web-parse.mjs";

export const REGRESSION_ENGINE_VERSION = "1.0.0";
export const OBSERVATION_FORMAT = "bweseo.regression.observation";
export const BASELINE_FORMAT = "bweseo.regression.baseline";
export const FINDINGS_FORMAT = "bweseo.regression.findings";
export const EXCEPTIONS_FORMAT = "bweseo.regression.exceptions";
export const FORMAT_VERSION = 1; // bump only when a stored shape changes, and add a migration
export const ENVIRONMENTS = ["production", "staging", "local"];
export const INDEXING_STATEMENT = "This is an observed technical state from a crawl, not Google's indexing status; confirm any indexing effect in Search Console.";
export const MIN_ORPHAN_COVERAGE = 0.95;
export const CHAIN_LIMIT = 1; // more than this many redirects before the final page is a chain
export const BROAD_SHARE = 0.1; // a robots rule hitting this share of the baseline's eligible pages (and at least BROAD_MIN pages) counts as broad
export const BROAD_MIN = 5;
const SEVERITIES = ["critical", "high", "medium", "low"];
export const severityRank = (s) => SEVERITIES.indexOf(s);

// ---------------------------------------------------------------- URLs

const SENSITIVE_PARAM = /^(token|key|secret|password|passwd|auth|authorization|sig|signature|session|sessionid|sid|code|apikey|api_key|access_token)$/i;

// The key two observations use to say "this URL". Normalizes only what cannot change which resource it is: scheme/host case, default
// port, fragment and credentials, and query-parameter ORDER. It keeps what can matter: scheme, host (www vs apex), path case, and the
// trailing slash. Credentials-looking query values are redacted so a key never carries a secret. (seo-page-checks.normalizeUrl also
// strips the trailing slash; regression detection must not, because a slash change is a real change.)
export function urlKey(input, base) {
  let u;
  try { u = new URL(String(input).trim(), base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const params = [...u.searchParams.entries()]
    .map(([k, v]) => [k, SENSITIVE_PARAM.test(k) ? "[redacted]" : v])
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? "?" + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
  return `${u.protocol}//${u.host}${u.pathname}${query}`;
}
const pathOf = (key) => { const u = new URL(key); return u.pathname + (u.search || ""); };
const hostOf = (key) => new URL(key).host;
export const originKey = (o) => { const k = urlKey(o); return k ? new URL(k).origin : null; };
const sortedKeys = (xs, base) => [...new Set((xs ?? []).map((x) => urlKey(x, base)).filter(Boolean))].sort();

// ---------------------------------------------------------------- observation shape

// An observation is a plain JSON object:
//   { format, version, id, project:{id}, observedAt, environment:{name, origin}, status:"complete"|"partial"|"failed",
//     scope:{ origin, sitemapUrls[], includePaths[], excludePaths[], robotsAgent, maxPages, seeds[] },
//     config:{ importantPaths[], minOrphanCoverage? },
//     coverage:{ discovered, fetched, failed, truncated, linkGraphComplete },
//     checks:{ robots:{state,httpStatus,fetchedAt,text,reason}, sitemap:{state, documents:[{url,role,state,httpStatus,locs[],reason}]} },
//     pages:{ <urlKey>:{ url,state:"ok"|"unreachable",error,fetchedAt,status,finalUrl,chain[{url,status,location}],redirectLoop,chainExceeded,
//                        metaRobots[]|null, xRobotsTag[]|null, canonicals[]|null, links[]|null } } }
// null means "not captured" (UNKNOWN), an empty array means "captured, none present".

const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const arr = (a) => (Array.isArray(a) ? a : null);

export function normalizeObservation(raw) {
  const o = JSON.parse(JSON.stringify(raw ?? {}));
  const origin = originKey(o.environment?.origin ?? o.scope?.origin);
  if (o.environment) o.environment.origin = origin ?? o.environment.origin;
  o.scope = { includePaths: [], excludePaths: [], sitemapUrls: [], seeds: [], robotsAgent: "Googlebot", ...(o.scope ?? {}) };
  o.scope.origin = origin ?? o.scope.origin;
  o.scope.sitemapUrls = sortedKeys(o.scope.sitemapUrls, origin);
  o.scope.includePaths = [...(o.scope.includePaths ?? [])].sort();
  o.scope.excludePaths = [...(o.scope.excludePaths ?? [])].sort();
  o.config = { importantPaths: ["/"], ...(o.config ?? {}) };
  const pages = {};
  for (const p of Object.values(o.pages ?? {})) {
    const k = urlKey(p?.url, origin);
    if (!k) continue;
    const norm = { ...p, url: k, chain: Array.isArray(p.chain) ? p.chain : [], metaRobots: arr(p.metaRobots), xRobotsTag: arr(p.xRobotsTag), links: arr(p.links) ? sortedKeys(p.links, k) : null };
    norm.canonicals = arr(p.canonicals) ? p.canonicals.map((c) => urlKey(c, k) ?? String(c)) : null;
    norm.finalUrl = p.finalUrl ? urlKey(p.finalUrl, k) ?? p.finalUrl : k;
    pages[k] = norm;
  }
  o.pages = pages;
  const docs = (o.checks?.sitemap?.documents ?? []).map((d) => ({ ...d, url: urlKey(d.url, origin) ?? d.url, locs: arr(d.locs) ? sortedKeys(d.locs, origin) : [] }));
  o.checks = { ...(o.checks ?? {}), sitemap: { ...(o.checks?.sitemap ?? {}), documents: docs } };
  return o;
}

// Is this observation well-formed (purpose "compare") and, for purpose "baseline", complete enough to be trusted as the reference?
export function validateObservation(raw, { purpose = "compare" } = {}) {
  const errors = []; const warnings = [];
  const o = raw ?? {};
  if (o.format !== OBSERVATION_FORMAT) errors.push(`format must be "${OBSERVATION_FORMAT}"`);
  if (o.version !== FORMAT_VERSION) errors.push(`unsupported observation version ${JSON.stringify(o.version)} (this engine reads version ${FORMAT_VERSION}); re-collect or migrate it`);
  if (!isIso(o.observedAt)) errors.push("observedAt must be an ISO-8601 time");
  if (!ENVIRONMENTS.includes(o.environment?.name)) errors.push(`environment.name must be one of ${ENVIRONMENTS.join(", ")}`);
  if (!originKey(o.environment?.origin)) errors.push("environment.origin must be an http(s) origin");
  if (!["complete", "partial", "failed"].includes(o.status)) errors.push('status must be "complete", "partial" or "failed"');
  if (!o.scope || typeof o.scope !== "object") errors.push("scope is required");
  if (!o.coverage || !Number.isFinite(o.coverage.discovered) || !Number.isFinite(o.coverage.fetched)) errors.push("coverage.discovered and coverage.fetched are required numbers");
  if (!o.checks?.robots || !["ok", "unavailable"].includes(o.checks.robots.state)) errors.push('checks.robots.state must be "ok" or "unavailable"');
  if (!o.checks?.sitemap || !["ok", "partial", "unavailable"].includes(o.checks.sitemap.state)) errors.push('checks.sitemap.state must be "ok", "partial" or "unavailable"');
  if (!o.pages || typeof o.pages !== "object") errors.push("pages is required");
  if (errors.length) return { ok: false, usable: false, acceptable: false, errors, warnings };
  if (o.status === "failed") errors.push("the observation failed; there is no evidence to compare");
  if (o.status === "partial") warnings.push("partial observation: only checks with sufficient evidence are compared; the rest are UNKNOWN");
  const usable = errors.length === 0;
  const why = [];
  if (o.status !== "complete") why.push(`status is "${o.status}", not "complete"`);
  if (o.coverage.truncated) why.push("the crawl was truncated before it reached the configured scope");
  if (o.coverage.failed > 0) why.push(`${o.coverage.failed} page(s) could not be fetched`);
  if (o.coverage.fetched < o.coverage.discovered) why.push(`only ${o.coverage.fetched} of ${o.coverage.discovered} discovered URLs were fetched`);
  if (o.checks.robots.state !== "ok") why.push("robots.txt could not be read");
  if (o.checks.sitemap.state !== "ok") why.push("the sitemap could not be read completely");
  if (!Object.keys(o.pages).length) why.push("no pages were observed");
  const acceptable = usable && why.length === 0;
  if (purpose === "baseline" && !acceptable) errors.push(...why.map((w) => `not a complete, valid observation for the configured scope: ${w}`));
  return { ok: errors.length === 0, usable, acceptable, errors, warnings, incomplete: why };
}

// May `obs` be compared with `base`? Never across environments, origins, projects or differing crawl scope.
export function checkCompatibility(base, obs) {
  const reasons = [];
  if (base.environment.name !== obs.environment.name) reasons.push(`environment differs: baseline is ${base.environment.name}, observation is ${obs.environment.name}`);
  if (originKey(base.environment.origin) !== originKey(obs.environment.origin)) reasons.push(`origin differs: baseline ${base.environment.origin}, observation ${obs.environment.origin}`);
  if ((base.project?.id ?? null) !== (obs.project?.id ?? null)) reasons.push(`project differs: baseline ${base.project?.id ?? "(none)"}, observation ${obs.project?.id ?? "(none)"}`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const nb = normalizeObservation(base).scope; const no = normalizeObservation(obs).scope;
  for (const f of ["includePaths", "excludePaths", "sitemapUrls", "robotsAgent"]) if (!same(nb[f], no[f])) reasons.push(`crawl scope differs in ${f}: baseline ${JSON.stringify(nb[f])}, observation ${JSON.stringify(no[f])}`);
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------- page facts

const isRedirectHop = (h) => h.status >= 300 && h.status < 400 && !!h.location;
const hopsOf = (p) => p.chain.filter(isRedirectHop).length;
const looped = (p) => p.redirectLoop === true || p.chainExceeded === true;
const okPage = (p) => p?.state === "ok";
const BOTS = new Set(["googlebot", "google", "bingbot", "googlebot-news"]);
// "noindex" or "none" for a crawler that matters; "otherbot: noindex" does not apply to Google/Bing.
function hasNoindex(values) {
  if (!values) return null;
  return values.some((raw) => String(raw).split(",").some((part) => {
    const m = /^\s*([a-z0-9-]+)\s*:\s*(.*)$/i.exec(part);
    if (m && /^(googlebot|google|bingbot|googlebot-news|otherbot|[a-z0-9-]+bot)$/i.test(m[1]) && !BOTS.has(m[1].toLowerCase())) return false;
    return /\b(noindex|none)\b/i.test(m ? m[2] : part);
  }));
}
const noindexOf = (p) => {
  const meta = hasNoindex(p.metaRobots); const header = hasNoindex(p.xRobotsTag);
  return { meta, header, any: meta === true || header === true ? true : meta === false && header === false ? false : null };
};
const evidenceOf = (p, extra = {}) => ({
  url: p.url, observedAt: p.fetchedAt ?? null, status: p.status ?? null, finalUrl: p.finalUrl ?? null,
  redirects: hopsOf(p), chain: p.chain.slice(0, 6), noindex: { meta: noindexOf(p).meta, header: noindexOf(p).header }, canonicals: p.canonicals, ...extra,
});

// ---------------------------------------------------------------- context

function buildCtx(Braw, Craw) {
  const B = normalizeObservation(Braw); const C = normalizeObservation(Craw);
  const agent = C.scope.robotsAgent || "Googlebot";
  const robots = (o) => (o.checks.robots.state === "ok" ? parseRobots(o.checks.robots.text ?? "") : null);
  const important = new Set((C.config.importantPaths ?? ["/"]).map((p) => urlKey(p, C.environment.origin)).filter(Boolean));
  if (!important.size) important.add(urlKey("/", C.environment.origin));
  const ctx = { B, C, agent, robotsB: robots(B), robotsC: robots(C), important, originHost: new URL(C.environment.origin).host, cache: {} };
  const ratio = C.coverage.discovered > 0 ? C.coverage.fetched / C.coverage.discovered : 0;
  ctx.coverageRatio = ratio;
  return ctx;
}
const blockedBy = (robots, agent, key) => (robots ? robotsAllows(robots, agent, pathOf(key)) : null);

function notEvidence(ctx, k) {
  const p = ctx.C.pages[k];
  if (!p) return { unknown: `not observed in the current crawl (coverage ${(ctx.coverageRatio * 100).toFixed(0)}%)` };
  if (p.state !== "ok") return { unknown: `could not be fetched in the current observation (${p.error ?? "network error or timeout"})` };
  return { p };
}

// A page that was healthy and indexable in the baseline (direct 200, no noindex, canonical self or empty, not blocked by robots).
function eligibleInBaseline(ctx, k) {
  const p = ctx.B.pages[k];
  if (!okPage(p) || looped(p) || hopsOf(p) > 0 || p.status !== 200 || noindexOf(p).any === true) return false;
  if ((p.canonicals ?? []).some((c) => c !== k)) return false;
  const r = blockedBy(ctx.robotsB, ctx.agent, k);
  return !(r && !r.allowed);
}
const directOk = (p) => okPage(p) && !looped(p) && hopsOf(p) === 0 && p.status === 200;
const baselineDirect200 = (ctx, k) => directOk(ctx.B.pages[k]);

// ---------------------------------------------------------------- evaluators
// evaluate(ctx, subject) -> { r:"detect", evidence, previous, limitations?, ...extra } | { r:"clear" } | { r:"unknown", reason } | { r:"na" }
// enumerate(ctx) -> [subject]. A subject is { key, url } | { key, source, target } | { key, rule, group, urls } | { key, site:true }.

const pageSubjects = (pred) => (ctx) => Object.keys(ctx.B.pages).filter((k) => pred(ctx, k)).map((k) => ({ key: k, url: k }));
const prev = (ctx, k, extra) => ({ observedAt: ctx.B.pages[k]?.fetchedAt ?? ctx.B.observedAt, evidence: evidenceOf(ctx.B.pages[k], extra) });

const EVALUATORS = {
  "noindex-added": {
    check: "indexability",
    enumerate: pageSubjects((ctx, k) => baselineDirect200(ctx, k) && noindexOf(ctx.B.pages[k]).any !== true),
    evaluate(ctx, s) {
      const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
      const c = noindexOf(e.p); const b = noindexOf(ctx.B.pages[s.key]);
      if (!directOk(e.p)) return { r: "na" };
      const newly = ["meta", "header"].filter((m) => c[m] === true && b[m] === false);
      const unseenBefore = ["meta", "header"].filter((m) => c[m] === true && b[m] === null);
      if (newly.length) return { r: "detect", via: newly, previous: prev(ctx, s.key), evidence: evidenceOf(e.p, { via: newly }) };
      if (unseenBefore.length) return { r: "unknown", reason: `the baseline did not capture the ${unseenBefore.join("/")} robots directive, so a change cannot be established` };
      if (c.any === false) return { r: "clear" };
      if (c.any === true) return { r: "na" }; // already noindex in the baseline
      return { r: "unknown", reason: "the robots meta tag or X-Robots-Tag header was not captured in the current observation" };
    },
  },
  "robots-restriction": {
    check: "robots",
    enumerate(ctx) {
      if (!ctx.robotsB || !ctx.robotsC) return [{ key: "robots.txt", rule: null, group: null, urls: [] }]; // evidence missing: one UNKNOWN, no findings
      const groups = robotsGroups(ctx);
      return Object.entries(groups).map(([key, g]) => ({ key, rule: g.rule, group: g.group, urls: g.urls }));
    },
    evaluate(ctx, s) {
      if (!ctx.robotsC) return { r: "unknown", reason: "robots.txt could not be read in the current observation" };
      if (!ctx.robotsB) return { r: "unknown", reason: "the baseline has no readable robots.txt to compare with" };
      const g = robotsGroups(ctx)[s.key];
      if (!g) return { r: "clear" };
      return { r: "detect", rule: g.rule, group: g.group, urls: g.urls, previous: { observedAt: ctx.B.checks.robots.fetchedAt ?? ctx.B.observedAt, evidence: { robotsHash: sha256hex(ctx.B.checks.robots.text ?? "").slice(0, 16), allowedUrls: g.urls.length } }, evidence: { observedAt: ctx.C.checks.robots.fetchedAt ?? ctx.C.observedAt, rule: g.rule, group: g.group, blockedUrls: g.urls.length, sampleUrls: g.urls.slice(0, 10), robotsHash: sha256hex(ctx.C.checks.robots.text ?? "").slice(0, 16) } };
    },
  },
  "canonical-missing": {
    check: "canonical",
    enumerate: pageSubjects((ctx, k) => baselineDirect200(ctx, k) && (ctx.B.pages[k].canonicals ?? []).length > 0),
    evaluate: (ctx, s) => canonicalEval(ctx, s, (cs, b) => (cs.length === 0 ? { r: "detect" } : { r: "clear" })),
  },
  "canonical-conflict": {
    check: "canonical",
    enumerate: pageSubjects((ctx, k) => baselineDirect200(ctx, k) && new Set(ctx.B.pages[k].canonicals ?? []).size <= 1),
    evaluate: (ctx, s) => canonicalEval(ctx, s, (cs) => (cs.length > 1 ? { r: "detect" } : { r: "clear" })),
  },
  "canonical-changed": {
    check: "canonical",
    enumerate: pageSubjects((ctx, k) => baselineDirect200(ctx, k) && new Set(ctx.B.pages[k].canonicals ?? []).size === 1),
    evaluate: (ctx, s) => canonicalEval(ctx, s, (cs, b) => (cs.length === 1 ? (cs[0] !== b[0] ? { r: "detect", crossPage: b[0] === s.key && cs[0] !== s.key } : { r: "clear" }) : { r: "na" })),
  },
  "page-error": {
    check: "status",
    enumerate: pageSubjects((ctx, k) => baselineDirect200(ctx, k)),
    evaluate(ctx, s) {
      const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
      const p = e.p;
      if (looped(p) || hopsOf(p) > 0) return p.status >= 400 ? { r: "detect", previous: prev(ctx, s.key), evidence: evidenceOf(p), viaRedirect: true } : { r: "na" };
      return p.status >= 400 ? { r: "detect", previous: prev(ctx, s.key), evidence: evidenceOf(p) } : { r: "clear" };
    },
  },
  "unexpected-redirect": {
    check: "status",
    enumerate: pageSubjects((ctx, k) => baselineDirect200(ctx, k)),
    evaluate(ctx, s) {
      const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
      const p = e.p;
      if (looped(p)) return { r: "na" };
      if (hopsOf(p) === 0) return { r: "clear" };
      const first = p.chain.find(isRedirectHop);
      return { r: "detect", previous: prev(ctx, s.key), evidence: evidenceOf(p, { firstStatus: first.status, target: p.finalUrl, crossHost: hostOf(p.finalUrl) !== hostOf(s.key) }) };
    },
  },
  "redirect-loop": {
    check: "redirects",
    enumerate: pageSubjects((ctx, k) => okPage(ctx.B.pages[k]) && !looped(ctx.B.pages[k])),
    evaluate(ctx, s) {
      const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
      if (!looped(e.p)) return { r: "clear" };
      return { r: "detect", previous: prev(ctx, s.key), evidence: evidenceOf(e.p, { loop: e.p.redirectLoop === true, hopLimitExceeded: e.p.chainExceeded === true }), limitations: e.p.redirectLoop ? [] : ["the redirect chain exceeded the crawler's hop limit; it may be very long rather than a true loop"] };
    },
  },
  "redirect-chain": {
    check: "redirects",
    enumerate: pageSubjects((ctx, k) => okPage(ctx.B.pages[k]) && !looped(ctx.B.pages[k]) && hopsOf(ctx.B.pages[k]) <= CHAIN_LIMIT),
    evaluate(ctx, s) {
      const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
      if (looped(e.p)) return { r: "na" };
      return hopsOf(e.p) > CHAIN_LIMIT ? { r: "detect", previous: prev(ctx, s.key), evidence: evidenceOf(e.p, { hops: hopsOf(e.p) }) } : { r: "clear" };
    },
  },
  "sitemap-removal": {
    check: "sitemap",
    enumerate: (ctx) => baselineSitemapEntries(ctx).filter((k) => eligibleInBaseline(ctx, k)).map((k) => ({ key: k, url: k })),
    evaluate(ctx, s) {
      const sm = ctx.C.checks.sitemap;
      if (sm.state === "unavailable" || !sm.documents.length) return { r: "unknown", reason: "the sitemap could not be read in the current observation" };
      if (sm.documents.some((d) => d.locs.includes(s.key))) return { r: "clear" };
      const bad = sm.documents.filter((d) => d.state !== "ok");
      if (bad.length) return { r: "unknown", reason: `${bad.length} sitemap file(s) could not be read completely (${bad.map((d) => d.url).slice(0, 3).join(", ")}), so the URL may be in one of them` };
      const source = baselineSitemapSource(ctx)[s.key];
      const page = ctx.C.pages[s.key];
      return { r: "detect", previous: { observedAt: ctx.B.checks.sitemap.fetchedAt ?? ctx.B.observedAt, evidence: { listedIn: source ?? null, page: prev(ctx, s.key).evidence } }, evidence: { observedAt: ctx.C.observedAt, listedInAnySitemap: false, sitemapFiles: sm.documents.length, page: page && okPage(page) ? evidenceOf(page) : null } };
    },
  },
  "sitemap-entry-redirected": sitemapEntryType((ctx, p, k) => (looped(p) ? { r: "detect", reason: "redirect loop" } : hopsOf(p) > 0 ? { r: "detect", reason: "redirects" } : { r: "clear" })),
  "sitemap-entry-noncanonical": sitemapEntryType((ctx, p, k) => {
    if (!directOk(p)) return { r: "na" };
    if (p.canonicals === null) return { r: "unknown", reason: "the canonical was not captured in the current observation" };
    const cs = [...new Set(p.canonicals)];
    return cs.length === 1 && cs[0] !== k ? { r: "detect", reason: "canonical points elsewhere" } : { r: "clear" }; // several canonicals are canonical-conflict's business
  }),
  "sitemap-entry-noindex": sitemapEntryType((ctx, p, k) => {
    if (!directOk(p)) return { r: "na" };
    const n = noindexOf(p);
    if (n.any === true) return { r: "detect", reason: "noindex" };
    return n.any === false ? { r: "clear" } : { r: "unknown", reason: "the robots meta tag or X-Robots-Tag header was not captured" };
  }),
  "broken-internal-link": {
    check: "internal-links",
    enumerate(ctx) {
      const out = [];
      for (const [src, p] of Object.entries(ctx.C.pages)) {
        if (!okPage(p) || p.links === null) continue;
        for (const t of p.links) {
          if (hostOf(t) !== ctx.originHost || t === src) continue;
          if (excludedByScope(ctx.C.scope, t)) continue;
          const tp = ctx.C.pages[t];
          if (!okPage(tp) || !(tp.status >= 400)) continue;
          const bs = ctx.B.pages[src]; const bt = ctx.B.pages[t];
          if (okPage(bs) && bs.links?.includes(t) && okPage(bt) && bt.status >= 400) continue; // already broken in the baseline
          out.push({ key: `${src} -> ${t}`, source: src, target: t });
        }
      }
      return out;
    },
    evaluate(ctx, s) {
      const sp = ctx.C.pages[s.source];
      if (!okPage(sp)) return { r: "unknown", reason: "the linking page could not be fetched in the current observation" };
      if (sp.links === null) return { r: "unknown", reason: "links were not captured for the linking page" };
      if (!sp.links.includes(s.target)) return { r: "clear" };
      const tp = ctx.C.pages[s.target];
      if (!tp) return { r: "unknown", reason: "the link target was not observed in the current crawl" };
      if (!okPage(tp)) return { r: "unknown", reason: "the link target could not be fetched in the current observation" };
      if (tp.status >= 400) {
        const bs = ctx.B.pages[s.source]; const bt = ctx.B.pages[s.target];
        return { r: "detect", previous: { observedAt: bt?.fetchedAt ?? ctx.B.observedAt, evidence: { sourceLinkedToTarget: !!bs?.links?.includes(s.target), targetStatus: okPage(bt) ? bt.status : null } }, evidence: { observedAt: tp.fetchedAt ?? ctx.C.observedAt, source: s.source, target: s.target, targetStatus: tp.status, targetFinalUrl: tp.finalUrl } };
      }
      return { r: "clear" };
    },
  },
  "orphaned-page": {
    check: "orphans",
    enumerate: (ctx) => [...ctx.important].filter((k) => inbound(ctx.B, k).length > 0 && okPage(ctx.B.pages[k])).map((k) => ({ key: k, url: k })),
    evaluate(ctx, s) {
      const gate = orphanGate(ctx); if (gate) return { r: "unknown", reason: gate };
      const p = ctx.C.pages[s.key];
      if (!okPage(p) || p.status >= 400) return { r: "na" };
      const inC = inbound(ctx.C, s.key);
      if (inC.length > 0) return { r: "clear" };
      const inB = inbound(ctx.B, s.key);
      return { r: "detect", previous: { observedAt: ctx.B.observedAt, evidence: { inboundLinks: inB.length, sampleLinkingPages: inB.slice(0, 5) } }, evidence: { observedAt: ctx.C.observedAt, inboundLinks: 0, coverage: { ratio: Number(ctx.coverageRatio.toFixed(3)), fetched: ctx.C.coverage.fetched, discovered: ctx.C.coverage.discovered } } };
    },
  },
};

function canonicalEval(ctx, s, decide) {
  const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
  const p = e.p;
  if (!directOk(p)) return { r: "na" };
  if (p.canonicals === null) return { r: "unknown", reason: "the canonical link was not captured in the current observation" };
  const cs = [...new Set(p.canonicals)]; const b = [...new Set(ctx.B.pages[s.key].canonicals ?? [])];
  const d = decide(cs, b);
  if (d.r !== "detect") return d;
  return { ...d, previous: prev(ctx, s.key), evidence: evidenceOf(p, { canonicals: cs, baselineCanonicals: b }) };
}

function sitemapEntryType(decide) {
  return {
    check: "sitemap",
    enumerate: (ctx) => baselineSitemapEntries(ctx).filter((k) => eligibleInBaseline(ctx, k)).map((k) => ({ key: k, url: k })),
    evaluate(ctx, s) {
      const sm = ctx.C.checks.sitemap;
      if (!sm.documents.some((d) => d.locs.includes(s.key))) return { r: "na" }; // removal is the sitemap-removal check's business
      const e = notEvidence(ctx, s.key); if (e.unknown) return { r: "unknown", reason: e.unknown };
      const d = decide(ctx, e.p, s.key);
      if (d.r !== "detect") return d;
      return { ...d, previous: prev(ctx, s.key), evidence: evidenceOf(e.p, { sitemapEntry: true, reason: d.reason, rule: d.rule }) };
    },
  };
}

const baselineSitemapEntries = (ctx) => [...new Set(ctx.B.checks.sitemap.documents.filter((d) => d.state === "ok" && d.role !== "index").flatMap((d) => d.locs))].sort();
const baselineSitemapSource = (ctx) => { const m = {}; for (const d of ctx.B.checks.sitemap.documents) if (d.role !== "index") for (const l of d.locs) m[l] ??= d.url; return m; };
const excludedByScope = (scope, key) => { const p = pathOf(key); return (scope.excludePaths ?? []).some((x) => p.startsWith(x)) || ((scope.includePaths ?? []).length > 0 && !scope.includePaths.some((x) => p.startsWith(x))); };

function inbound(obs, target) {
  const out = [];
  for (const [src, p] of Object.entries(obs.pages)) if (src !== target && okPage(p) && p.links?.includes(target)) out.push(src);
  return out;
}

function orphanGate(ctx) {
  const C = ctx.C; const min = Number(C.config.minOrphanCoverage ?? MIN_ORPHAN_COVERAGE);
  if (C.status !== "complete") return `crawl status is "${C.status}"; orphan detection needs a complete crawl`;
  if (C.coverage.truncated) return "the crawl was truncated; orphan detection needs the whole link graph";
  if (C.coverage.linkGraphComplete !== true) return "internal links were not captured for every page; orphan detection needs the whole link graph";
  if (ctx.coverageRatio < min) return `crawl coverage ${(ctx.coverageRatio * 100).toFixed(0)}% is below the ${(min * 100).toFixed(0)}% needed to conclude a page is orphaned`;
  if (Object.values(C.pages).some((p) => okPage(p) && p.links === null)) return "some fetched pages have no link data; orphan detection needs the whole link graph";
  return null;
}

function robotsGroups(ctx) {
  if (ctx.cache.groups) return ctx.cache.groups;
  const groups = {};
  if (ctx.robotsB && ctx.robotsC) {
    for (const k of Object.keys(ctx.B.pages)) {
      if (!eligibleInBaseline(ctx, k)) continue;
      const after = blockedBy(ctx.robotsC, ctx.agent, k);
      if (after.allowed) continue;
      const gk = `${after.group} | ${after.rule}`;
      (groups[gk] ??= { rule: after.rule, group: after.group, urls: [] }).urls.push(k);
    }
  }
  return (ctx.cache.groups = groups);
}

// ---------------------------------------------------------------- finding catalogue (text and severity rules)

const stripPrefix = (rule) => String(rule ?? "").replace(/^(disallow|allow):\s*/, "");
export const TYPES = {
  "noindex-added": { title: (s) => `Page now carries noindex: ${s.url}`, impact: "Search engines that read this directive will drop the page from results once they recrawl it, so it can lose all organic traffic.", action: "Find what added the noindex (CMS/SEO plugin setting, template, X-Robots-Tag rule on the server or CDN) and remove it if it is not intended; if it is intended, record an approved indexability change.", verify: ["The page's meta robots tag and X-Robots-Tag header no longer contain noindex or none.", "A fresh observation shows the page again as 200 with no noindex."] },
  "robots-restriction": { title: (s) => `robots.txt now blocks pages that were crawlable (${stripPrefix(s.rule) || s.rule})`, impact: "Blocked URLs cannot be crawled; search engines may keep or drop them unpredictably and cannot read their content or noindex rules.", action: "Review the rule in robots.txt and the deploy or CDN setting that changed it; remove or narrow it unless the restriction is intended (then record an approved indexability change per URL).", verify: ["robots.txt no longer disallows the previously crawlable URLs for the configured crawler.", "A fresh observation shows the affected URLs allowed by robots.txt."] },
  "canonical-missing": { title: (s) => `Canonical link tag disappeared: ${s.url}`, impact: "Without a canonical hint, duplicate variants of the page can compete and the preferred URL may change.", action: "Restore the canonical link tag in the page template or head.", verify: ["The page has exactly one canonical link pointing at the intended URL."] },
  "canonical-conflict": { title: (s) => `Conflicting canonical tags: ${s.url}`, impact: "Several different canonical URLs are ignored or resolved unpredictably by search engines.", action: "Remove the extra canonical tags so the page declares exactly one.", verify: ["The page declares one canonical URL only."] },
  "canonical-changed": { title: (s) => `Canonical URL changed: ${s.url}`, impact: "Pointing the canonical at a different URL asks search engines to index that URL instead, which can remove this page from results.", action: "Confirm the new canonical is intended. If not, restore the previous canonical; if it is, record an approved canonical change.", verify: ["The canonical URL equals the intended (previous or approved) URL.", "A fresh observation shows a single matching canonical."] },
  "page-error": { title: (s) => `Previously working page now errors: ${s.url}`, impact: "Visitors and crawlers get an error instead of the page; persistent errors lead to the page being dropped from results.", action: "Restore the page or fix the server/route error; if the page was removed on purpose, record an approved removal (and redirect or 410/404 as intended).", verify: ["The URL returns 200 directly.", "A fresh observation shows the previous status again."] },
  "unexpected-redirect": { title: (s) => `Page now redirects: ${s.url}`, impact: "The URL no longer serves its own content; rankings consolidate to the target only if the redirect is intended and relevant.", action: "Confirm the redirect is intended. If not, remove it; if it is, record an approved redirect with the expected target.", verify: ["The URL returns 200 without redirecting, or redirects to the approved target."] },
  "redirect-loop": { title: (s) => `Redirect loop: ${s.url}`, impact: "The URL can never load, for visitors or crawlers.", action: "Break the loop in the redirect rules (server, CDN, application, trailing-slash or www/HTTPS rules).", verify: ["The URL resolves to a final page without revisiting any URL."] },
  "redirect-chain": { title: (s) => `Redirect chain: ${s.url}`, impact: "Extra hops slow crawling and dilute signals; crawlers may stop following long chains.", action: "Point the first URL directly at the final destination in one hop.", verify: [`The URL reaches its final page in at most ${CHAIN_LIMIT} redirect.`] },
  "sitemap-removal": { title: (s) => `Removed from the sitemap: ${s.url}`, impact: "A previously listed, indexable page is no longer offered to search engines through the sitemap, which can slow discovery and recrawling.", action: "Re-add the page to the sitemap unless its removal is intended (then record an approved removal).", verify: ["The sitemap lists the URL again."] },
  "sitemap-entry-redirected": { title: (s) => `Sitemap URL now redirects: ${s.url}`, impact: "Sitemaps should list final, indexable URLs; redirecting entries waste crawl budget and send mixed signals.", action: "Update the sitemap to list the redirect target, or remove the redirect.", verify: ["The sitemap URL returns 200 without redirecting."] },
  "sitemap-entry-noncanonical": { title: (s) => `Sitemap URL is no longer canonical: ${s.url}`, impact: "The page lists itself for indexing while declaring another URL canonical.", action: "Align the sitemap entry and the page's canonical URL.", verify: ["The page's canonical equals its sitemap URL."] },
  "sitemap-entry-noindex": { title: (s) => `Sitemap URL is now noindex: ${s.url}`, impact: "The sitemap offers a URL that tells search engines not to index it.", action: "Remove the noindex or remove the URL from the sitemap.", verify: ["The page no longer carries noindex, or is no longer in the sitemap."] },
  "broken-internal-link": { title: (s) => `New broken internal link: ${s.source} → ${s.target}`, impact: "Visitors and crawlers hit an error following the link, and link equity is wasted.", action: "Fix the link, restore the target, or redirect the target to its replacement.", verify: ["The linking page no longer links to the broken target, or the target returns 200."] },
  "orphaned-page": { title: (s) => `Important page has no internal links: ${s.url}`, impact: "A page with no internal links is hard to discover and loses internal link equity.", action: "Restore internal links to the page (navigation, footer, related content).", verify: ["At least one other crawled page links to this URL in a coverage-sufficient observation."] },
};
export const FINDING_TYPES = Object.keys(TYPES);

// Severity rules (deterministic; documented in docs/methodology/regression-detection.md):
//   critical  site-wide robots block (Disallow: /), a restriction hitting >= BROAD_SHARE of the baseline's eligible pages or any
//             important page, noindex / canonical-changed / page-error / redirect-loop on an important page
//   high      the same defects on other pages; unexpected redirect, sitemap removal, sitemap-entry defects, canonical-missing/conflict,
//             orphaned-page and a broken link TO an important page, when important
//   medium    the lesser defects on other pages, any broken internal link
//   low       redirect chains on other pages
const RULES = {
  "noindex-added": ["critical", "high"], "canonical-changed": ["critical", "high"], "page-error": ["critical", "high"], "redirect-loop": ["critical", "high"],
  "unexpected-redirect": ["high", "medium"], "sitemap-removal": ["high", "medium"], "sitemap-entry-redirected": ["high", "medium"], "sitemap-entry-noncanonical": ["critical", "high"],
  "sitemap-entry-noindex": ["critical", "high"], "canonical-missing": ["high", "medium"], "canonical-conflict": ["high", "medium"],
  "redirect-chain": ["medium", "low"], "broken-internal-link": ["high", "medium"], "orphaned-page": ["high", "high"],
};
export function severityFor(type, { important = false, siteWide = false, broad = false } = {}) {
  if (type === "robots-restriction") return siteWide || broad || important ? "critical" : "high";
  const [imp, other] = RULES[type];
  return important ? imp : other;
}

// ---------------------------------------------------------------- compare

const idOf = (type, subjectKey) => `rg-${type}-${sha256hex(`${type}|${subjectKey}`).slice(0, 10)}`;
export const findingId = idOf;

// Compare `observation` with `baseline`. Pure. Returns { compatible, reasons, detections[], unknown[], checks[], ... } — never throws on bad evidence.
export function compareObservations(baseline, observation, { now = new Date().toISOString() } = {}) {
  const vb = validateObservation(baseline, { purpose: "baseline" });
  const vo = validateObservation(observation);
  const base = { engineVersion: REGRESSION_ENGINE_VERSION, comparedAt: now, indexingStatement: INDEXING_STATEMENT };
  if (!vo.usable) return { ...base, comparable: false, status: "not-comparable", reasons: vo.errors.length ? vo.errors : ["the observation is not usable"], detections: [], unknown: [], checks: [] };
  if (!vb.usable) return { ...base, comparable: false, status: "not-comparable", reasons: ["the accepted baseline is not valid: " + vb.errors.join("; ")], detections: [], unknown: [], checks: [] };
  const compat = checkCompatibility(baseline, observation);
  if (!compat.ok) return { ...base, comparable: false, status: "incompatible", reasons: compat.reasons, detections: [], unknown: [], checks: [] };

  const ctx = buildCtx(baseline, observation);
  const detections = []; const unknown = []; const checks = {};
  const note = (check) => (checks[check] ??= { id: check, subjects: 0, regressions: 0, unknown: 0, clear: 0, notApplicable: 0 });
  for (const [type, ev] of Object.entries(EVALUATORS)) {
    const c = note(ev.check);
    for (const s of ev.enumerate(ctx)) {
      c.subjects += 1;
      const r = ev.evaluate(ctx, s);
      if (r.r === "detect") { c.regressions += 1; detections.push(buildDetection(ctx, type, s, r)); }
      else if (r.r === "unknown") { c.unknown += 1; unknown.push({ check: ev.check, type, subject: s.key, reason: r.reason }); }
      else if (r.r === "clear") c.clear += 1;
      else c.notApplicable += 1;
    }
  }
  const checkList = Object.values(checks).map((c) => ({ ...c, state: c.subjects === 0 ? "nothing-to-compare" : c.unknown === 0 ? "compared" : c.unknown === c.subjects - c.notApplicable ? "unknown" : "partial" }));
  // checks whose gate failed even with zero enumerated subjects (e.g. orphan detection on a partial crawl)
  const gate = orphanGate(ctx);
  const orphans = checkList.find((c) => c.id === "orphans");
  if (gate && orphans) { orphans.state = orphans.subjects ? "unknown" : "unknown"; orphans.reason = gate; }
  if (gate && !orphans) checkList.push({ id: "orphans", subjects: 0, regressions: 0, unknown: 0, clear: 0, notApplicable: 0, state: "unknown", reason: gate });
  const detected = dedupe(detections, ctx);
  detections.length = 0; detections.push(...detected);
  detections.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
  return {
    ...base, comparable: true, status: detections.length ? "regressions" : "clean", reasons: [], warnings: [...vo.warnings],
    baseline: { observedAt: baseline.observedAt, environment: baseline.environment }, observation: { id: observation.id ?? null, observedAt: observation.observedAt, status: observation.status, environment: observation.environment, coverage: { ...observation.coverage, ratio: Number(ctx.coverageRatio.toFixed(3)) } },
    detections, unknown, checks: checkList,
  };
}

function buildDetection(ctx, type, s, r) {
  const T = TYPES[type];
  const subject = s.source ? { source: s.source, target: s.target } : s.rule ? { rule: s.rule, group: s.group } : { url: s.url };
  const important = s.source ? ctx.important.has(s.target) : s.url ? ctx.important.has(s.url) : (r.urls ?? []).some((u) => ctx.important.has(u));
  const eligible = Object.keys(ctx.B.pages).filter((k) => eligibleInBaseline(ctx, k)).length || 1;
  const siteWide = type === "robots-restriction" && /^disallow:\s*\/$/i.test(r.rule ?? "");
  const broad = type === "robots-restriction" && (r.urls?.length ?? 0) >= BROAD_MIN && (r.urls?.length ?? 0) / eligible >= BROAD_SHARE;
  const limitations = [INDEXING_STATEMENT, ...(r.limitations ?? [])];
  if (ctx.C.status === "partial") limitations.push(`the current observation is partial (${ctx.C.coverage.fetched} of ${ctx.C.coverage.discovered} URLs fetched); this finding is based on pages that were fetched`);
  if (type === "page-error" && r.evidence?.status >= 500) limitations.push("a 5xx response can be transient; recovery or persistence is only known from further observations");
  if (type === "robots-restriction") limitations.push("robots.txt rules were evaluated with the engine's own parser using Google's matching rules for the configured crawler");
  const confirmed = ctx.C.status === "complete" && limitations.length === 1;
  return {
    id: idOf(type, s.key), type, subject, subjectKey: s.key, severity: severityFor(type, { important, siteWide, broad }), important,
    title: T.title(s), impact: T.impact + (siteWide ? " The whole site is affected." : ""), recommendedAction: T.action, verification: T.verify,
    previous: r.previous, current: { observedAt: ctx.C.observedAt, ...(r.evidence ? { evidence: r.evidence } : {}) },
    affectedUrls: r.urls ? r.urls.length : undefined, affectedSample: r.urls ? r.urls.slice(0, 20) : undefined,
    confidence: confirmed ? "confirmed" : "limited", limitations, _detail: { urls: r.urls, evidence: r.evidence },
  };
}

// One root cause, one finding. A sitemap URL that became noindex / redirected / non-canonical is reported as the sitemap-entry finding
// (it names the sitemap impact) instead of ALSO as the page-level finding. A robots rule that blocks sitemap URLs says how many.
const SUPERSEDED_BY = { "noindex-added": "sitemap-entry-noindex", "unexpected-redirect": "sitemap-entry-redirected", "canonical-changed": "sitemap-entry-noncanonical" };
function dedupe(detections, ctx) {
  const winners = new Set(detections.filter((d) => Object.values(SUPERSEDED_BY).includes(d.type)).map((d) => `${d.type}|${d.subjectKey}`));
  const inSitemap = new Set(ctx.C.checks.sitemap.documents.flatMap((d) => d.locs));
  for (const d of detections) if (d.type === "robots-restriction") {
    const n = (d._detail.urls ?? []).filter((u) => inSitemap.has(u)).length;
    if (n) { d.sitemapUrlsAffected = n; d.impact += ` ${n} of the affected URL(s) are listed in the sitemap.`; d.current.evidence = { ...d.current.evidence, sitemapUrlsAffected: n }; }
  }
  return detections.filter((d) => !(SUPERSEDED_BY[d.type] && winners.has(`${SUPERSEDED_BY[d.type]}|${d.subjectKey}`)));
}

// Re-run one finding's own check on a later observation to see whether recovery is CONFIRMED. Only a "clear" result counts.
export function recoveryCheck(baseline, observation, finding) {
  const vo = validateObservation(observation);
  if (!vo.usable) return { r: "unknown", reason: "the observation is not usable" };
  if (!checkCompatibility(baseline, observation).ok) return { r: "unknown", reason: "the observation is not comparable with the baseline" };
  const ev = EVALUATORS[finding.type]; if (!ev) return { r: "unknown", reason: "unknown finding type" };
  const ctx = buildCtx(baseline, observation);
  const s = finding.subject.source ? { key: finding.subjectKey, source: finding.subject.source, target: finding.subject.target } : finding.subject.rule ? { key: finding.subjectKey, rule: finding.subject.rule, group: finding.subject.group } : { key: finding.subjectKey, url: finding.subject.url };
  const r = ev.evaluate(ctx, s);
  return r.r === "detect" ? { r: "detect" } : r.r === "clear" ? { r: "clear", evidence: recoveryEvidence(ctx, finding) } : { r: "unknown", reason: r.reason ?? "this check does not apply to the page in the current observation" };
}
function recoveryEvidence(ctx, f) {
  const k = f.subject.url ?? f.subject.target;
  const p = k ? ctx.C.pages[k] : null;
  return { observedAt: ctx.C.observedAt, ...(p && okPage(p) ? { page: evidenceOf(p) } : { robotsOk: ctx.C.checks.robots.state === "ok" }) };
}

export const FINDING_FIELDS = ["id", "type", "severity", "subject", "subjectKey", "title", "impact", "recommendedAction", "verification", "previous", "current", "firstObservedAt", "lastObservedAt", "confidence", "limitations", "status", "decision", "intentionalChange"];
