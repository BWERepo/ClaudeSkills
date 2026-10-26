// BWESEO city landing pages — pure functions, zero dependencies, no network, no file writes.
// Registry (lifecycle + duplicate-route protection), brief validation (facts vs assumptions, availability), local-presence
// claim detection, sitemap eligibility / planned changes / stable lastmod, and the release package an owner approves.
import { sha256hex } from "./landing-hash.mjs";
import { parseSitemap, parseRobots, robotsAllows } from "./web-parse.mjs";
import { similarity } from "./landing-quality.mjs";

export const CITY_STATES = ["draft", "researching", "review-required", "approved", "published", "unpublished", "redirected", "archived", "failed"];
export const FACT_STATUS = ["verified", "business-provided", "assumption"];
const sha = (v) => sha256hex(JSON.stringify(v));
const slugOf = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const cityId = (city, state, service = "web-design") => `${slugOf(city)}-${slugOf(state)}-${slugOf(service)}`;
export const normalizePath = (p) => { const s = "/" + String(p ?? "").trim().replace(/^\/+/, "").replace(/[?#].*$/, ""); return s.length > 1 ? s.replace(/\/+$/, "").toLowerCase() : s; };

// ---------------------------------------------------------------- registry
// entry = { city,state,service,path, status, publicContent:{title,description,h1,body,faq,canonical,structuredData,links}, ... }
// Idempotent: the same id + same route is an update; a different id on an existing route (or the reverse) is a conflict.
export function upsertEntry(registry, entry, { existingPaths = [] } = {}) {
  const id = cityId(entry.city, entry.state, entry.service);
  const path = normalizePath(entry.path ?? `/${slugOf(entry.city)}-web-design`);
  const entries = registry.entries ?? [];
  const sameRoute = entries.find((e) => e.path === path && e.id !== id);
  if (sameRoute) return { ok: false, reason: `route ${path} already belongs to ${sameRoute.id}` };
  if (existingPaths.map(normalizePath).includes(path) && !entries.some((e) => e.id === id))
    return { ok: false, reason: `route ${path} already exists on the site; improve that page instead of creating a second one` };
  const prior = entries.find((e) => e.id === id);
  const next = { status: "draft", ...prior, ...entry, id, path, history: [...(prior?.history ?? [])] };
  if (!CITY_STATES.includes(next.status)) return { ok: false, reason: `unknown status ${next.status}` };
  return { ok: true, created: !prior, registry: { ...registry, entries: [...entries.filter((e) => e.id !== id), next] } };
}

// ---------------------------------------------------------------- research brief
// brief = { city,state,service, availability:{status,evidence}, facts:[{claim,status,source?,url?,retrievedOn?}], sources:[{url,retrievedOn,supports[]}] }
export function checkBrief(brief) {
  const f = []; const add = (level, id, msg) => f.push({ level, id, msg });
  if (!brief.city || !brief.state) add("error", "identity", "city and state are required");
  if (brief.availability?.status !== "verified") add("error", "availability", "service availability in this city is not verified by the business; no city content may imply local presence");
  for (const x of brief.facts ?? []) {
    if (!FACT_STATUS.includes(x.status)) add("error", "fact-status", `fact "${String(x.claim).slice(0, 50)}" must be verified, business-provided or assumption`);
    else if (x.status === "assumption") add("warn", "assumption", `assumption needs review: "${String(x.claim).slice(0, 60)}"`);
    else if (x.status === "verified" && !(x.url && x.retrievedOn)) add("error", "fact-source", `verified fact has no source URL and retrieval date: "${String(x.claim).slice(0, 50)}"`);
  }
  if (!(brief.sources ?? []).length) add("error", "no-sources", "no research sources recorded; research is required before factual content is approved");
  for (const s of brief.sources ?? []) if (!s.url || !s.retrievedOn) add("error", "source", "every source needs a URL and retrieval date");
  const errors = f.filter((x) => x.level === "error").length;
  return { ok: errors === 0, errors, warnings: f.length - errors, findings: f };
}

// ---------------------------------------------------------------- local-presence claims
const PRESENCE = [
  /\b(our|the)\s+(\w+\s+)?(office|studio|team|staff|showroom)\s+(in|at|near)\b/i,
  /\b(visit|stop by|come by|meet)\s+(us|our)\b/i,
  /\b(located|based|headquartered)\s+(in|at)\b/i,
  /\blocal\s+(team|office|experts?|designers?)\b/i,
  /\bon[- ]site\s+(visits?|meetings?)\b/i,
  /\b(same[- ]day|\d+[- ]hour)\s+(response|service)\b/i,
  /\b(licensed|insured|bonded)\b/i,
];
const NEGATED = /\b(no|not|without|doesn't|does not|do not|don't|isn't|never)\b[^.]{0,40}\b(office|location|team|staff|based|located|showroom)\b|\b(office|location|team|staff)\b[^.]{0,20}\b(is|are)\s+not\b|\b(based|located)\b[^.]{0,40}\b(not|rather than)\b/i;
// ctx.homeBase: the place the business really is (e.g. "Knoxville"); sentences naming only that place are allowed.
export function localPresenceClaims(text, { city, homeBase = "" } = {}) {
  const sentences = String(text ?? "").split(/(?<=[.!?])\s+/);
  const hits = [];
  for (const s of sentences) {
    if (!PRESENCE.some((re) => re.test(s))) continue;
    if (NEGATED.test(s)) continue; // an honest disclaimer ("no office in X", "not based in X") is not a claim
    const names = city && new RegExp(`\\b${city}\\b`, "i").test(s);
    const homeOnly = homeBase && new RegExp(`\\b${homeBase}\\b`, "i").test(s) && !names;
    if (names || !homeOnly) hits.push(s.trim().slice(0, 140));
  }
  return hits;
}

// ---------------------------------------------------------------- lastmod
// Public hash covers only what a visitor or crawler sees. lastmod moves only when it changes.
export const publicHash = (e) => sha({ t: e.publicContent?.title, d: e.publicContent?.description, h1: e.publicContent?.h1, b: e.publicContent?.body, f: e.publicContent?.faq ?? [], c: e.publicContent?.canonical, s: e.publicContent?.structuredData ?? null, l: [...(e.publicContent?.links ?? [])].sort(), i: e.indexable !== false });
export function stampPublicChange(entry, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("today must be yyyy-mm-dd");
  const h = publicHash(entry);
  if (entry.publicHash === h) return entry;
  return { ...entry, publicHash: h, lastmod: today };
}
export const validLastmod = (v, today) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") && !Number.isNaN(Date.parse(v)) && v <= today;

// ---------------------------------------------------------------- sitemap
// observed = { status, redirected, canonical, robotsMeta, xRobotsTag, contentType } fetched from the deployed page.
export function sitemapEligibility(entry, { origin, robotsTxt = "", observed = null } = {}) {
  const reasons = []; const url = origin + entry.path;
  if (entry.status !== "published") reasons.push(`status is ${entry.status}`);
  if (entry.indexable === false) reasons.push("intended noindex");
  if ((entry.publicContent?.canonical ?? url) !== url) reasons.push("canonical points elsewhere");
  if (robotsTxt && !robotsAllows(parseRobots(robotsTxt), "Googlebot", entry.path).allowed) reasons.push("blocked by robots.txt");
  if (entry.redirectTo) reasons.push("redirects");
  const configured = reasons.length === 0;
  let observedOk = null;
  if (observed) {
    const o = [];
    if (observed.status !== 200 || observed.redirected) o.push(`status ${observed.status}${observed.redirected ? " (redirected)" : ""}`);
    if (observed.canonical && observed.canonical !== url) o.push("observed canonical differs");
    if (/noindex/i.test(`${observed.robotsMeta ?? ""} ${observed.xRobotsTag ?? ""}`)) o.push("observed noindex");
    if (observed.contentType && !/html/i.test(observed.contentType)) o.push("not HTML");
    observedOk = o.length === 0;
    if (configured !== observedOk) reasons.push(`configured and observed eligibility disagree (${o.join("; ") || "observed ok"})`);
    else if (!observedOk) reasons.push(...o);
  }
  return { url, eligible: configured && (observedOk ?? true) && !reasons.length, configured, observed: observedOk, reasons };
}

// Planned sitemap changes for one urlset. Unrelated entries are never touched; verifies `current` stays byte-for-byte per entry.
export function planSitemapChanges(currentXml, entries, { origin, today, robotsTxt = "", observedBy = {} } = {}) {
  const cur = parseSitemap(currentXml);
  if (cur.malformed || cur.kind !== "urlset") return { ok: false, reason: "current sitemap is malformed or not a urlset; repair before synchronizing" };
  const have = new Map(cur.entries.map((e) => [e.loc, e]));
  const adds = [], removes = [], lastmodChanges = [], blocked = [];
  const owned = new Set();
  for (const e of entries) {
    const url = origin + e.path; owned.add(url);
    const el = sitemapEligibility(e, { origin, robotsTxt, observed: observedBy[e.path] ?? null });
    const row = have.get(url);
    if (el.eligible) {
      const lm = validLastmod(e.lastmod, today) ? e.lastmod : null;
      if (!lm) blocked.push({ url, reason: "no trustworthy lastmod; entry would omit it" });
      if (!row) adds.push({ url, lastmod: lm });
      else if ((row.lastmod ?? null) !== lm) lastmodChanges.push({ url, from: row.lastmod, to: lm });
    } else if (row) removes.push({ url, reasons: el.reasons });
  }
  return { ok: true, adds, removes, lastmodChanges, blocked, unrelatedKept: cur.entries.filter((e) => !owned.has(e.loc)).length };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function renderUrlset(rows) {
  const seen = new Set();
  const body = rows.filter((r) => !seen.has(r.loc) && seen.add(r.loc)).map((r) => `  <url>\n    <loc>${esc(r.loc)}</loc>${r.lastmod ? `\n    <lastmod>${r.lastmod}</lastmod>` : ""}\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// robots.txt must name the public sitemap with an absolute production URL, never a placeholder.
export function checkRobotsSitemap(robotsTxt, sitemapUrl) {
  const { sitemaps } = parseRobots(robotsTxt);
  const f = [];
  if (/[<>]/.test(robotsTxt) || /verified-production-host/.test(robotsTxt)) f.push("robots.txt still contains a placeholder");
  if (!sitemaps.includes(sitemapUrl)) f.push(`robots.txt does not reference ${sitemapUrl}`);
  return { ok: f.length === 0, findings: f };
}

// ---------------------------------------------------------------- internal links
export function linkReport(entries, { existingPaths = [] } = {}) {
  const live = new Set([...existingPaths.map(normalizePath), ...entries.filter((e) => e.status === "published").map((e) => e.path)]);
  const inbound = new Map(entries.map((e) => [e.path, 0])); const broken = [];
  for (const e of entries) for (const l of e.publicContent?.links ?? []) {
    const p = normalizePath(l);
    if (inbound.has(p) && p !== e.path) inbound.set(p, inbound.get(p) + 1);
    if (!live.has(p)) broken.push({ from: e.path, to: p });
  }
  return { orphans: entries.filter((e) => e.status === "published" && inbound.get(e.path) === 0).map((e) => e.path), broken };
}

// ---------------------------------------------------------------- readiness + release package
export function cityReadiness(entry, brief, siblings = []) {
  const blockers = [];
  const b = checkBrief(brief); for (const x of b.findings) if (x.level === "error") blockers.push(`brief: ${x.msg}`);
  const text = `${entry.publicContent?.title} ${entry.publicContent?.description} ${entry.publicContent?.body}`;
  for (const s of localPresenceClaims(text, { city: entry.city, homeBase: entry.homeBase })) blockers.push(`local-presence claim without evidence: "${s}"`);
  for (const sib of siblings) if (sib.id !== entry.id && similarity(entry.publicContent?.body, sib.publicContent?.body) >= 0.25) blockers.push(`near-duplicate of ${sib.path}`);
  if (/placeholder|lorem ipsum|\[\[/i.test(text)) blockers.push("placeholder text in public content");
  return { ready: blockers.length === 0, blockers };
}

export function releasePackage({ entries, currentSitemapXml, origin, today, robotsTxt, observedBy = {}, approval = null, existingPaths = [] }) {
  const sitemap = planSitemapChanges(currentSitemapXml, entries, { origin, today, robotsTxt, observedBy });
  const revisions = entries.map((e) => ({ id: e.id, path: e.path, status: e.status, publicHash: publicHash(e) }));
  const hash = sha({ revisions, sitemap });
  const approved = approval?.packageHash === hash;
  return {
    packageHash: hash, revisions, sitemap,
    robots: robotsTxt ? checkRobotsSitemap(robotsTxt, `${origin}/sitemap.xml`) : { ok: false, findings: ["robots.txt not supplied"] },
    links: linkReport(entries, { existingPaths }), approved,
    note: approval && !approved ? "approval no longer matches this package; material change since approval, approve again" : undefined,
    productionActions: ["deploy approved revisions", "synchronize sitemap", "run post-deploy verification", "submit sitemap to Search Console (only if approved)"],
  };
}
