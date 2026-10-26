// BWESEO landing-page quality gate and approval workflow — pure functions, zero dependencies.
// Blocks keyword stuffing, thin / duplicate / doorway pages, unsupported claims, price drift from the source of truth, and
// publishing without an explicit administrator approval of the exact content.
import { sha256hex } from "./landing-hash.mjs";
import { tokens } from "./landing-opportunities.mjs";

export const STATUSES = ["proposed", "draft", "approved", "published"];
const ALLOWED = { proposed: ["draft"], draft: ["approved", "proposed"], approved: ["published", "draft"], published: ["draft"] };

const words = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9$'-]+/g) ?? [];
// Everything that changes what a visitor or crawler gets from the page. An approval covers exactly this payload; private notes,
// reviewer comments, check results and any other field are NOT part of it. Aligned with the city-page `publicHash`
// (title, description, H1, body, FAQ, canonical, structured data, links, indexability) plus the destination path, headings,
// images and CTA that a landing page also publishes.
export const APPROVAL_HASH_VERSION = 2;
const canonicalJson = (v) => {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};
export function publishPayload(page) {
  return {
    path: page.path ?? null, title: page.title ?? null, description: page.description ?? null, h1: page.h1 ?? null, body: page.body ?? null,
    headings: page.headings ?? [], faq: page.faq ?? [], cta: page.cta ?? null, canonical: page.canonical ?? null,
    structuredData: page.structuredData ?? null, links: [...(page.links ?? [])].map(String).sort(),
    images: (page.images ?? []).map((i) => ({ src: i?.src ?? null, alt: i?.alt ?? null, decorative: i?.decorative })), indexable: page.indexable !== false,
  };
}
export const contentHash = (page) => `v${APPROVAL_HASH_VERSION}:${sha256hex(canonicalJson(publishPayload(page)))}`;

// "valid" | "stale" (content changed) | "legacy" (recorded before the full payload; never trusted) | "none"
export function approvalState(page) {
  const a = page.approval;
  if (!a?.by) return "none";
  if (a.hashVersion !== APPROVAL_HASH_VERSION || !String(a.contentHash ?? "").startsWith(`v${APPROVAL_HASH_VERSION}:`)) return "legacy";
  return a.contentHash === contentHash(page) ? "valid" : "stale";
}

// Status moves one step at a time; "published" needs an approval by a named person that covers the CURRENT publish payload.
export function canTransition(page, to) {
  const from = page.status ?? "proposed";
  if (!ALLOWED[from]?.includes(to)) return { ok: false, reason: `${from} -> ${to} is not allowed (allowed: ${(ALLOWED[from] ?? []).join(", ") || "none"})` };
  if (to === "published") {
    const st = approvalState(page);
    if (st === "none") return { ok: false, reason: "not approved by an administrator" };
    if (st === "legacy") return { ok: false, reason: "this approval was recorded before approvals covered the full publish content (path, canonical, structured data, links, images, indexability); run check and approve again" };
    if (st === "stale") return { ok: false, reason: "content changed after approval; run check and approve it again" };
  }
  return { ok: true };
}
export function approve(page, by, on = new Date().toISOString().slice(0, 10)) {
  if (!by || !String(by).trim()) throw new Error("approval needs the approver's name");
  if (page.status !== "draft") throw new Error("only a draft can be approved");
  return { ...page, status: "approved", approval: { by: by.trim(), on, contentHash: contentHash(page), hashVersion: APPROVAL_HASH_VERSION } };
}

// Shingle similarity (5-word windows) for near-duplicate detection.
const shingles = (s, n = 5) => { const w = words(s); const set = new Set(); for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" ")); return set; };
export function similarity(a, b) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let both = 0; for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

const CLAIMS = [
  [/\b(guarantee[sd]?|guaranteed)\b[^.]{0,40}\b(rank|ranking|#?1|first page|top)\b/i, "promises search rankings"],
  [/\b(#1|number one|best in|top-?rated|award[- ]winning)\b/i, "superlative or award claim needs proof"],
  [/\b(testimonials?|\"[^\"]{20,}\"\s*[-—]\s*[A-Z])/i, "testimonial or quote needs a real, attributable source"],
  [/\b\d[\d,]*\+?\s+(happy |satisfied )?(clients|customers|websites|businesses)\b/i, "customer-count claim needs proof"],
  [/\b(increase[sd]?|boost(ed)?|grew|doubled|tripled)\b[^.]{0,30}\b\d+\s?%/i, "result claim with a number needs proof"],
];

// Heuristic thresholds. They produce REVIEW signals (a person decides), never a block: word count and keyword density are weak proxies
// for quality. Override any of them per project through ctx.thresholds; unknown or non-numeric values are ignored.
export const THRESHOLDS = Object.freeze({ minWords: 500, minWordsLocation: 600, stuffingMinHits: 4, stuffingDensity: 0.03, stuffingWarnHits: 8, titleMax: 60, descriptionMin: 70, descriptionMax: 160, minHeadings: 3, minLinks: 2 });
export const resolveThresholds = (o = {}) => ({ ...THRESHOLDS, ...Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => k in THRESHOLDS && Number.isFinite(v) && v >= 0)) });
// What the automated gate can and cannot establish: see docs/methodology/landing-pages.md ("What the checks establish").
// level "error" = objectively invalid or unsupported (blocks); "warn" = likely worth fixing; "review" = a heuristic signal for a person.

// page = { path,title,description,h1,body (visible text),headings[],images[{alt}],faq[{q,a}],cta,links[],primary,secondary[],type }
// ctx  = { others[] (other pages), verifiedPrices[] (e.g. ["$499","$999"]), requiredCta, minWords, brand, locationPages[] }
export function checkPage(page, ctx = {}) {
  const f = []; const add = (level, id, msg) => f.push({ level, id, msg });
  const th = resolveThresholds({ ...ctx.thresholds, ...(ctx.minWords != null ? { minWords: ctx.minWords, minWordsLocation: ctx.minWords } : {}) });
  const minWords = page.type === "location" ? th.minWordsLocation : th.minWords;
  const wc = words(page.body).length;
  if (!page.title) add("error", "title", "missing title"); else if (page.title.length > th.titleMax) add("warn", "title-length", `title is ${page.title.length} characters (aim for ${th.titleMax} or fewer)`);
  if (!page.description) add("error", "description", "missing meta description"); else if (page.description.length < th.descriptionMin || page.description.length > th.descriptionMax) add("warn", "description-length", `meta description is ${page.description.length} characters (aim for ${th.descriptionMin}-${th.descriptionMax})`);
  if (!page.h1) add("error", "h1", "missing H1");
  // Length is a signal, not proof: a short page can fully answer a narrow question, a long one can say nothing. Only an empty body is invalid.
  if (wc === 0) add("error", "empty", "no visible text");
  else if (wc < minWords) add("review", "thin", `${wc} words of visible text; below the ${minWords}-word review threshold. Length alone does not show the page is poor - confirm it fully answers what the visitor came for, or lengthen it if it does not`);
  if ((page.headings ?? []).length < th.minHeadings) add("warn", "structure", `fewer than ${th.minHeadings} H2/H3 headings`);
  // Alt text: a MISSING alt attribute is an error; an explicitly EMPTY alt ("") marks a decorative image and is accepted unless the image is
  // declared informative; whitespace-only is neither and is an error. Whether a given alt text is actually appropriate is a human judgement.
  let decorative = 0;
  for (const im of page.images ?? []) {
    const alt = im?.alt;
    if (alt === undefined || alt === null) add("error", "alt-missing", `image has no alt attribute: ${im?.src ?? "?"} (add descriptive alt text, or alt="" if it is purely decorative)`);
    else if (typeof alt !== "string" || (alt !== "" && !alt.trim())) add("error", "alt-invalid", `image alt is blank or not text: ${im?.src ?? "?"}`);
    else if (alt === "") { if (im.decorative === false || im.informative === true) add("error", "alt-empty-informative", `informative image has empty alt text: ${im?.src ?? "?"}`); else decorative++; }
  }
  if (decorative) add("review", "alt-decorative", `${decorative} image(s) marked decorative with empty alt; confirm they carry no information a visitor needs`);
  if (page.primary && wc) {
    const p = tokens(page.primary); const body = words(page.body).join(" ");
    const hits = body.split(page.primary.toLowerCase()).length - 1;
    const density = (hits * p.length) / wc;
    // Repetition counts are a signal for a person to read the page aloud; they cannot tell natural emphasis from stuffing.
    if (hits >= th.stuffingMinHits && density > th.stuffingDensity) add("review", "stuffing", `"${page.primary}" appears ${hits} times (${(density * 100).toFixed(1)}% of words); read it aloud and rewrite if it sounds forced`);
    else if (hits > th.stuffingWarnHits) add("review", "stuffing", `"${page.primary}" appears ${hits} times`);
  }
  for (const [re, why] of CLAIMS) { const m = re.exec(`${page.title} ${page.description} ${page.body}`); if (m) add("error", "claim", `${why}: "${m[0].slice(0, 60)}"`); }
  if (ctx.verifiedPrices) {
    const shown = (page.body.match(/\$\d[\d,]*(?:\.\d{2})?/g) ?? []).map((x) => x.replace(/\.00$/, ""));
    const bad = [...new Set(shown.filter((x) => !ctx.verifiedPrices.includes(x)))];
    if (bad.length) add("error", "price", `price(s) not in the verified source of truth: ${bad.join(", ")}`);
  }
  if (ctx.requiredCta && !(page.cta === ctx.requiredCta || String(page.body).includes(ctx.requiredCta))) add("error", "cta", `primary CTA "${ctx.requiredCta}" not present`);
  if ((page.links ?? []).length < th.minLinks) add("warn", "internal-links", `fewer than ${th.minLinks} contextual internal links`);
  for (const o of ctx.others ?? []) {
    if (o.path === page.path) continue;
    if (o.title && o.title.toLowerCase() === (page.title ?? "").toLowerCase()) add("error", "dup-title", `same title as ${o.path}`);
    if (o.description && o.description === page.description) add("error", "dup-description", `same meta description as ${o.path}`);
    if (o.h1 && o.h1.toLowerCase() === (page.h1 ?? "").toLowerCase()) add("error", "dup-h1", `same H1 as ${o.path}`);
    if (o.body) { const s = similarity(page.body, o.body); if (s >= 0.35) add("error", "dup-content", `${Math.round(s * 100)}% of wording shared with ${o.path}`); }
    if (o.primary && page.primary && tokens(o.primary).join() === tokens(page.primary).join()) add("error", "cannibalization", `same primary keyword as ${o.path}`);
  }
  if (page.type === "location") {
    if (!ctx.verifiedLocation) add("error", "location-claim", "location page without a verified service-area fact for that place");
    const sibs = (ctx.locationPages ?? []).filter((x) => x.path !== page.path);
    const worst = Math.max(0, ...sibs.map((x) => similarity(page.body, x.body)));
    if (worst >= 0.25) add("error", "doorway", `${Math.round(worst * 100)}% shared wording with another location page (near-identical city pages)`);
  }
  const errors = f.filter((x) => x.level === "error").length;
  const reviews = f.filter((x) => x.level === "review").length;
  return { ok: errors === 0, errors, warnings: f.length - errors - reviews, reviews, findings: f, thresholds: th };
}
