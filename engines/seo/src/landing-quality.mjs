// BWESEO landing-page quality gate and approval workflow — pure functions, zero dependencies.
// Blocks keyword stuffing, thin / duplicate / doorway pages, unsupported claims, price drift from the source of truth, and
// publishing without an explicit administrator approval of the exact content.
import { createHash } from "node:crypto";
import { tokens } from "./landing-opportunities.mjs";

export const STATUSES = ["proposed", "draft", "approved", "published"];
const ALLOWED = { proposed: ["draft"], draft: ["approved", "proposed"], approved: ["published", "draft"], published: ["draft"] };

const words = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9$'-]+/g) ?? [];
export const contentHash = (page) => createHash("sha256").update(JSON.stringify({ t: page.title, d: page.description, h1: page.h1, b: page.body, f: page.faq ?? [] })).digest("hex");

// Status moves one step at a time; "published" needs an approval by a named person that covers the CURRENT content hash.
export function canTransition(page, to) {
  const from = page.status ?? "proposed";
  if (!ALLOWED[from]?.includes(to)) return { ok: false, reason: `${from} -> ${to} is not allowed (allowed: ${(ALLOWED[from] ?? []).join(", ") || "none"})` };
  if (to === "published") {
    const a = page.approval;
    if (!a?.by) return { ok: false, reason: "not approved by an administrator" };
    if (a.contentHash !== contentHash(page)) return { ok: false, reason: "content changed after approval; approve it again" };
  }
  return { ok: true };
}
export function approve(page, by, on = new Date().toISOString().slice(0, 10)) {
  if (!by || !String(by).trim()) throw new Error("approval needs the approver's name");
  if (page.status !== "draft") throw new Error("only a draft can be approved");
  return { ...page, status: "approved", approval: { by: by.trim(), on, contentHash: contentHash(page) } };
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

// page = { path,title,description,h1,body (visible text),headings[],images[{alt}],faq[{q,a}],cta,links[],primary,secondary[],type }
// ctx  = { others[] (other pages), verifiedPrices[] (e.g. ["$499","$999"]), requiredCta, minWords, brand, locationPages[] }
export function checkPage(page, ctx = {}) {
  const f = []; const add = (level, id, msg) => f.push({ level, id, msg });
  const minWords = ctx.minWords ?? (page.type === "location" ? 600 : 500);
  const wc = words(page.body).length;
  if (!page.title) add("error", "title", "missing title"); else if (page.title.length > 60) add("warn", "title-length", `title is ${page.title.length} characters (aim for 60 or fewer)`);
  if (!page.description) add("error", "description", "missing meta description"); else if (page.description.length < 70 || page.description.length > 160) add("warn", "description-length", `meta description is ${page.description.length} characters (aim for 70-160)`);
  if (!page.h1) add("error", "h1", "missing H1");
  if (wc < minWords) add("error", "thin", `${wc} words of visible text; below ${minWords} — thin pages are not generated`);
  if ((page.headings ?? []).length < 3) add("warn", "structure", "fewer than 3 H2/H3 headings");
  for (const im of page.images ?? []) if (!String(im.alt ?? "").trim()) add("error", "alt", `image without alt text: ${im.src ?? "?"}`);
  if (page.primary && wc) {
    const p = tokens(page.primary); const body = words(page.body).join(" ");
    const hits = body.split(page.primary.toLowerCase()).length - 1;
    const density = (hits * p.length) / wc;
    if (hits >= 4 && density > 0.03) add("error", "stuffing", `"${page.primary}" appears ${hits} times (${(density * 100).toFixed(1)}% of words); rewrite naturally`);
    else if (hits > 8) add("warn", "stuffing", `"${page.primary}" appears ${hits} times`);
  }
  for (const [re, why] of CLAIMS) { const m = re.exec(`${page.title} ${page.description} ${page.body}`); if (m) add("error", "claim", `${why}: "${m[0].slice(0, 60)}"`); }
  if (ctx.verifiedPrices) {
    const shown = (page.body.match(/\$\d[\d,]*(?:\.\d{2})?/g) ?? []).map((x) => x.replace(/\.00$/, ""));
    const bad = [...new Set(shown.filter((x) => !ctx.verifiedPrices.includes(x)))];
    if (bad.length) add("error", "price", `price(s) not in the verified source of truth: ${bad.join(", ")}`);
  }
  if (ctx.requiredCta && !(page.cta === ctx.requiredCta || String(page.body).includes(ctx.requiredCta))) add("error", "cta", `primary CTA "${ctx.requiredCta}" not present`);
  if ((page.links ?? []).length < 2) add("warn", "internal-links", "fewer than 2 contextual internal links");
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
  return { ok: errors === 0, errors, warnings: f.length - errors, findings: f };
}
