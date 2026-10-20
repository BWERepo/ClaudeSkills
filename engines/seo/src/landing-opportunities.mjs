// BWESEO landing-page opportunities — pure functions, zero dependencies.
// Decides, for each keyword group, whether a NEW page is justified or an EXISTING page should be improved, ranks the result
// from evidence only, and proposes a URL / title / H1. Nothing here invents volumes, difficulty, competitor facts or prices.
import { normalizeKeyword } from "./keyword-registry.mjs";
import { UNAVAILABLE } from "./landing-keywords.mjs";

const STOP = new Set(["a", "an", "the", "for", "in", "of", "to", "and", "or", "your", "my", "near", "me", "best", "top"]);
const canonWord = (w) => ({ web: "website", site: "website", sites: "website", websites: "website", designer: "design", designers: "design", designing: "design", cheap: "affordable", inexpensive: "affordable", budget: "affordable", cheapest: "affordable", price: "cost", pricing: "cost", prices: "cost", costs: "cost", redesigning: "redesign", businesses: "business", packages: "package", plans: "package", plan: "package" })[w] ?? w;
export const tokens = (s) => [...new Set(normalizeKeyword(s).split(" ").map(canonWord).filter((w) => w && !STOP.has(w)))];

// How much of a keyword group's wording an existing page already covers. `where` says which parts matched, strongest first.
export function pageOverlap(group, page) {
  const want = new Set(tokens(group.primary));
  if (!want.size) return { score: 0, where: [] };
  const parts = { title: page.title, h1: page.h1, headings: (page.h2 ?? []).join(" "), description: page.description, path: (page.path ?? "").replace(/[-/]/g, " ") };
  const where = [];
  let best = 0;
  for (const [k, v] of Object.entries(parts)) {
    const t = new Set(tokens(v ?? ""));
    const hit = [...want].filter((w) => t.has(w)).length / want.size;
    if (hit >= 0.6) where.push(k);
    if (k === "title" || k === "h1") best = Math.max(best, hit);
    else if (k === "headings") best = Math.max(best, hit * 0.7);
    else best = Math.max(best, hit * 0.5); // a description or URL alone does not show the page targets the phrase
  }
  if (page.path === "/") best *= 0.8; // the home page is a hub; it should not absorb a specific service phrase
  return { score: Number(best.toFixed(2)), where };
}

const INTENT_VALUE = { // wording-based, a hint for the owner; never a statement about Google's results
  "service": { buyerIntent: "high", conversion: "high" }, "service-redesign": { buyerIntent: "high", conversion: "high" },
  "comparison": { buyerIntent: "high", conversion: "medium" }, "cost-research": { buyerIntent: "medium", conversion: "medium" },
  "local": { buyerIntent: "high", conversion: "high" }, "informational": { buyerIntent: "low", conversion: "low" },
};
const RANK = { high: 3, medium: 2, low: 1 };

// Evidence-backed scoring. competition is "unavailable" unless the caller passes real evidence (a sourced, dated note).
export function scoreOpportunity(group, { offerings = [], evidence = {} } = {}) {
  const t = tokens(group.keywords.map((k) => k.keyword).join(" "));
  const offered = offerings.some((o) => tokens(o).some((w) => t.includes(w) && !["website", "small", "business"].includes(w)));
  const v = INTENT_VALUE[group.intent] ?? { buyerIntent: "medium", conversion: "medium" };
  const verifiedVolume = group.keywords.some((k) => k.metrics?.searchVolume?.verified);
  const competition = evidence.competition?.source && evidence.competition?.researchedOn ? evidence.competition : { value: UNAVAILABLE };
  const relevance = offerings.length ? (offered ? "high" : "medium") : "medium";
  const points = RANK[relevance] + RANK[v.buyerIntent] + RANK[v.conversion] + (verifiedVolume ? 1 : 0);
  return { relevance, buyerIntent: v.buyerIntent, conversionPotential: v.conversion, competition, volume: verifiedVolume ? "verified" : UNAVAILABLE, points, priority: points >= 8 ? "P1" : points >= 6 ? "P2" : "P3" };
}

const slug = (s) => tokens(s).join("-");
// Decide new vs improve. An existing page that already covers the primary phrase in its title/H1 always wins over a new page.
export function recommendAction(group, pages, opts = {}) {
  const place = (p) => /-(web-design|website-design)$/.test(p.path ?? "") && !/^\/(affordable|website-redesign)/.test(p.path ?? "") && (opts.places ?? []).some((l) => normalizeKeyword(`${p.path} ${p.title}`).includes(normalizeKeyword(l)));
  const ranked = pages.filter((p) => group.intent === "local" || !place(p)).map((p) => ({ page: p, ...pageOverlap(group, p) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const base = { intent: group.intent, primary: group.primary, secondary: group.secondary, score: scoreOpportunity(group, opts) };
  if (top && top.score >= 0.85) return { ...base, action: "improve-existing", target: top.page.path, reason: `${top.page.path} already covers "${group.primary}" in its ${top.where.slice(0, 2).join("/") || "content"}; a second page would compete with it`, overlaps: ranked.slice(0, 3).map((x) => ({ path: x.page.path, score: x.score })) };
  if (top && top.score >= 0.6) return { ...base, action: "improve-existing", target: top.page.path, reason: `${top.page.path} overlaps this intent (${top.where.join("/") || "partial"}); extend it unless a clearly different intent is shown`, overlaps: ranked.slice(0, 3).map((x) => ({ path: x.page.path, score: x.score })) };
  return { ...base, action: "new-page", target: `/${slug(group.primary)}`, reason: "no existing page covers this intent", overlaps: ranked.slice(0, 3).map((x) => ({ path: x.page.path, score: x.score })) };
}

// Plan every group. Two groups that would become the same URL, or two NEW pages with the same intent, are merged — never split
// into near-duplicates (doorway-page prevention).
const MODIFIERS = new Set(["affordable", "small", "business", "cost", "package", "under", "low", "free", "custom"]);
const core = (s) => tokens(s).filter((w) => !MODIFIERS.has(w) && !/^\d/.test(w)).sort().join(" ");
export function planOpportunities(groups, pages, opts = {}) {
  const recs = groups.map((g) => recommendAction(g, pages, opts));
  const out = [];
  for (const r of recs) {
    // Same core service differing only in price/size wording ("affordable", "under $1000", "low cost") is ONE page, never several.
    const twin = out.find((o) => o.action === r.action && (o.target === r.target || (r.action === "new-page" && (o.intent === r.intent || core(o.primary) === core(r.primary)))) && (r.action === "new-page" || o.intent === r.intent));
    if (twin) { twin.secondary = [...new Set([...twin.secondary, r.primary, ...r.secondary])]; twin.merged = [...(twin.merged ?? []), r.primary]; continue; }
    out.push(r);
  }
  return out.sort((a, b) => b.score.points - a.score.points);
}

const title = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
// Proposed on-page basics. Title <= 60 chars incl. brand; the owner edits wording — these are starting points.
export function proposeBasics(rec, { brand = "", maxTitle = 60 } = {}) {
  const h1 = title(rec.primary);
  const suffix = brand ? ` | ${brand}` : "";
  const t = (h1 + suffix).length <= maxTitle ? h1 + suffix : h1;
  return { url: rec.target, title: t, h1, supporting: rec.secondary };
}
