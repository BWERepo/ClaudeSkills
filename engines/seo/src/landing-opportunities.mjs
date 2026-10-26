// BWESEO landing-page opportunities — pure functions, zero dependencies.
// Decides, for each keyword group, whether a NEW page is justified or an EXISTING page should be improved, ranks the result
// from evidence only, and proposes a URL / title / H1. Nothing here invents volumes, difficulty, competitor facts or prices.
import { normalizeKeyword } from "./keyword-registry.mjs";
import { UNAVAILABLE } from "./landing-keywords.mjs";

const STOP = new Set(["a", "an", "the", "for", "in", "of", "to", "and", "or", "your", "my", "near", "me", "best", "top"]);
const canonWord = (w) => ({ web: "website", site: "website", sites: "website", websites: "website", designer: "design", designers: "design", designing: "design", cheap: "affordable", inexpensive: "affordable", budget: "affordable", cheapest: "affordable", price: "cost", pricing: "cost", prices: "cost", costs: "cost", redesigning: "redesign", businesses: "business", packages: "package", plans: "package", plan: "package", plumber: "plumbing", plumbers: "plumbing", roofer: "roofing", roofers: "roofing", electrician: "electrical", electricians: "electrical" })[w] ?? w;
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

// Plan every group. Two groups become ONE proposal only when they have the same service/topic identity (the words left after
// price/size wording and generic filler are removed) AND the same intent, or are the identical phrase differing only in price
// wording. "emergency plumbing" and "roof repair" share the `service` intent but are different services, so they stay separate;
// "emergency plumber" folds into "emergency plumbing". A different place is a different identity.
const MODIFIERS = new Set(["affordable", "small", "business", "cost", "package", "under", "low", "free", "custom", "service", "company", "agency"]);
const core = (s) => tokens(s).filter((w) => !MODIFIERS.has(w) && !/^\d/.test(w)).sort();
const placeTokens = (opts) => new Set((opts.places ?? []).flatMap((p) => tokens(p)));
const sameSet = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);
// Identical service identity, or one phrase is the other plus a single extra word (and has at least two words of its own).
export function sameIdentity(a, b, opts = {}) {
  const A = core(a), B = core(b);
  if (!A.length || !B.length) return false;
  const places = placeTokens(opts);
  const where = (x) => x.filter((w) => places.has(w));
  const what = (x) => x.filter((w) => !places.has(w));
  if (!sameSet(where(A), where(B))) return false;
  const [sa, sb] = [what(A), what(B)];
  if (!sa.length || !sb.length) return false;
  if (sameSet(sa, sb)) return true;
  const [small, big] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return small.length >= 2 && big.length - small.length === 1 && small.every((w) => big.includes(w));
}
export function planOpportunities(groups, pages, opts = {}) {
  const recs = groups.map((g) => recommendAction(g, pages, opts));
  const out = [];
  for (const r of recs) {
    const twin = out.find((o) => o.action === r.action && (r.action === "new-page" || o.target === r.target) && sameIdentity(o.primary, r.primary, opts)
      && (o.intent === r.intent || (r.action === "new-page" && sameIdentity(o.primary, r.primary, opts) && core(o.primary).join() === core(r.primary).join())));
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

// ---------------------------------------------------------------- replanning without losing work
// `planned` is the fresh output of planOpportunities (with proposeBasics merged in); `prior` the opportunities already in state;
// `retired` the recoverable archive. Identity is stable: an opportunity keeps its id, draft, checks, approval and history when the
// new plan still covers the same primary phrase, one of its phrases, or the same service identity. What cannot be matched is moved
// to `retired` (never deleted) and is restored if a later plan matches it again.
const nk = (s) => normalizeKeyword(s);
const phrasesOf = (o) => new Set([nk(o.primary), ...(o.secondary ?? []).map(nk)].filter(Boolean));
const hasWork = (o) => !!(o.draft || o.checks || o.approval || (o.status && o.status !== "proposed"));
export function reconcileOpportunities(planned, prior = [], retired = [], { today = new Date().toISOString().slice(0, 10), places = [] } = {}) {
  const opts = { places };
  const pool = [...prior.map((o) => ({ o, from: "prior" })), ...retired.map((o) => ({ o, from: "retired" }))];
  const claimed = new Set();
  const find = (r) => {
    const free = pool.filter((p) => !claimed.has(p));
    const mine = phrasesOf(r);
    return free.find((p) => nk(p.o.primary) === nk(r.primary))
      ?? free.find((p) => [...phrasesOf(p.o)].some((x) => mine.has(x)))
      ?? free.find((p) => p.o.intent === r.intent && sameIdentity(p.o.primary, r.primary, opts));
  };
  const events = [];
  const out = planned.map((r) => {
    const hit = find(r);
    if (!hit) return r;
    claimed.add(hit);
    const old = hit.o;
    const note = (event, extra = {}) => { events.push({ id: old.id, event, ...extra }); return { at: today, event, ...extra }; };
    const history = [...(old.history ?? [])];
    let next = { ...r, id: old.id, status: old.status ?? "proposed", performance: old.performance ?? "unavailable" };
    for (const k of ["draft", "checks", "approval"]) if (old[k] !== undefined) next[k] = old[k];
    if (hit.from === "retired") history.push(note("restored"));
    if (old.status === "published") {
      // What was published stays as published; a different plan is only offered, never applied silently.
      if (old.target !== r.target || old.action !== r.action) {
        next = { ...old, pendingChange: { action: r.action, target: r.target, primary: r.primary, secondary: r.secondary, at: today } };
        history.push(note("replan-differs-from-published", { target: r.target }));
      } else next = { ...next, target: old.target, url: old.url ?? next.url };
    } else if (old.target !== r.target || old.action !== r.action) {
      for (const k of ["checks", "approval"]) delete next[k];
      if (old.status === "approved") next.status = "draft";
      if (old.draft && old.draft.path && old.draft.path !== r.target) next.draft = { ...old.draft, path: undefined };
      history.push(note("target-changed", { from: old.target, to: r.target, invalidated: ["checks", "approval"].filter((k) => old[k] !== undefined) }));
    } else if (nk(old.primary) !== nk(r.primary)) {
      for (const k of ["checks", "approval"]) delete next[k];
      if (old.status === "approved") next.status = "draft";
      history.push(note("primary-changed", { from: old.primary, to: r.primary, invalidated: ["checks", "approval"].filter((k) => old[k] !== undefined) }));
    }
    if (history.length) next.history = history; else delete next.history;
    return next;
  });
  const nowRetired = [];
  for (const p of pool) {
    if (claimed.has(p)) continue;
    if (p.from === "retired") { nowRetired.push(p.o); continue; }
    if (hasWork(p.o)) nowRetired.push({ ...p.o, retiredOn: today, retiredReason: "no longer produced by the current keyword plan" });
  }
  return { opportunities: out, retired: nowRetired, events };
}
