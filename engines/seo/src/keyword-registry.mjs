// BWESEO Keyword → Target Page registry — pure functions, zero dependencies, no Node-only imports (Node 18+, Worker, browser).
// Engine 1.10.0. Part of the Keyword Performance System (docs/methodology/keyword-performance.md).
//
// The registry is NOT a new data store. Each site keeps its keywords inside its OWN seo/content-inventory.json, on the page that
// is meant to rank for them:
//
//   pages[].keywords = { primary: "metric to imperial converter", secondary: ["metric converter", ...],
//                        searchIntent: "...", addedOn: "2026-10-03", notes: "..." }
//   keywordDecisions[] = { query, decision: "ignore"|"monitor"|"investigate", on, note }   (decisions about DISCOVERED queries)
//
// Nothing here calls Google, the network or the filesystem. Nothing here creates, deletes or edits a page: a keyword never
// creates a page, and two keywords that look alike never become two pages.

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

export const KEYWORD_ROLES = ["primary", "secondary"];
export const DECISIONS = ["ignore", "monitor", "investigate"];
export const SEARCH_INTENTS = ["informational", "transactional", "commercial", "navigational", "local", "tool", "unknown"];

// ---------------------------------------------------------------- normalization

// How Search Console and the registry compare phrases: lower case, punctuation to spaces, whitespace collapsed.
export const normalizeKeyword = (k) =>
  String(k ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(["a", "an", "the", "of", "to", "for", "in", "on", "and", "or", "into", "my", "your", "is", "are", "how", "do", "i", "me", "online", "free", "best"]);
const stem = (w) => (w.length > 3 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokensOf = (k) => new Set(normalizeKeyword(k).split(" ").filter((w) => w && !STOP.has(w)).map(stem));

// Do two phrases appear to ask for the same thing? Word-set overlap only - a HINT for the owner to review, never a decision.
// (Wording that differs but means the same, like "kg to pounds" vs "kilograms to lbs", is not detected - and that is fine:
// Search Console evidence, not word matching, is what settles intent.)
export function similarKeywords(a, b) {
  const x = tokensOf(a);
  const y = tokensOf(b);
  if (!x.size || !y.size) return { similar: false, score: 0 };
  const inter = [...x].filter((t) => y.has(t)).length;
  const score = inter / new Set([...x, ...y]).size;
  const subset = inter === Math.min(x.size, y.size) && Math.min(x.size, y.size) >= 2;
  return { similar: score >= 0.67 || subset, score: Math.round(score * 100) / 100 };
}

// ---------------------------------------------------------------- reading the registry

const secondaryOf = (k) => (Array.isArray(k?.secondary) ? k.secondary.filter(isStr) : []);

// Flatten the inventory into registry records, one per keyword (the shape the spec asks for).
//   siteId, keyword, targetUrl, pageTitle, primaryKeyword, secondaryKeywords[], searchIntent, priority, status, dateAdded,
//   lastChecked, notes — plus pageId, role, canonicalUrl, pageType, category when the page records them.
// lastChecked is filled in later from the performance snapshot; here it is null.
export function registryOf(inventory, { siteId = null } = {}) {
  const out = [];
  for (const p of inventory?.pages ?? []) {
    const k = p?.keywords;
    if (!k || p.status === "rejected") continue;
    const primary = isStr(k.primary) ? k.primary.trim() : null;
    const secondary = secondaryOf(k);
    const base = {
      siteId,
      pageId: p.id,
      targetUrl: p.url,
      pageTitle: p.title ?? p.name ?? null,
      primaryKeyword: primary,
      secondaryKeywords: secondary,
      searchIntent: isStr(k.searchIntent) ? k.searchIntent : (p.primaryIntent ?? null),
      priority: p.priority ?? null,
      status: p.status,
      dateAdded: isDate(k.addedOn) ? k.addedOn.slice(0, 10) : (p.created ?? null),
      lastChecked: null,
      notes: isStr(k.notes) ? k.notes : null,
      canonicalUrl: p.canonicalUrl ?? null,
      pageType: p.type ?? null,
      category: p.category ?? null,
      indexable: p.indexable !== false,
      published: p.status === "published" || p.status === "update-needed",
    };
    if (primary) out.push({ ...base, keyword: primary, role: "primary" });
    for (const s of secondary) out.push({ ...base, keyword: s, role: "secondary" });
  }
  return out;
}

// Look a phrase up (normalized). Returns every registry record for it - more than one means two pages claim the same phrase.
export function findKeyword(records, phrase) {
  const n = normalizeKeyword(phrase);
  return n ? records.filter((r) => normalizeKeyword(r.keyword) === n) : [];
}

export const decisionsOf = (inventory) =>
  new Map((Array.isArray(inventory?.keywordDecisions) ? inventory.keywordDecisions : []).filter((d) => isStr(d?.query) && DECISIONS.includes(d.decision)).map((d) => [normalizeKeyword(d.query), d]));

// ---------------------------------------------------------------- validating the registry

// Problems with the registry itself (not with Google data). { errors[], warnings[], groups[] }.
//   errors    — structural (a keyword is not a string, a page has two primaries …)
//   warnings  — the same phrase on two pages (potential cannibalization BY DESIGN)
//   groups    — phrases on one page that look like the SAME intent: informational, "do not make separate pages"
export function validateRegistry(inventory) {
  const errors = [];
  const warnings = [];
  const groups = [];
  const owner = new Map();
  for (const p of inventory?.pages ?? []) {
    const k = p?.keywords;
    if (k === undefined) continue;
    const where = `pages[${p.id ?? "?"}].keywords`;
    if (!k || typeof k !== "object" || Array.isArray(k)) { errors.push(`${where} must be an object { primary, secondary[] }`); continue; }
    if (k.primary !== undefined && k.primary !== null && !isStr(k.primary)) errors.push(`${where}.primary must be one non-empty string (a page has exactly ONE primary keyword)`);
    if (k.secondary !== undefined && !Array.isArray(k.secondary)) errors.push(`${where}.secondary must be an array of strings`);
    else for (const s of k.secondary ?? []) if (!isStr(s)) errors.push(`${where}.secondary contains a value that is not a non-empty string`);
    const all = [k.primary, ...secondaryOf(k)].filter(isStr);
    const seen = new Set();
    for (const phrase of all) {
      const n = normalizeKeyword(phrase);
      if (!n) { errors.push(`${where}: "${phrase}" has no searchable words`); continue; }
      if (seen.has(n)) warnings.push(`${where}: "${phrase}" is listed more than once on the same page`);
      seen.add(n);
      const prev = owner.get(n);
      if (prev && prev !== p.id) warnings.push(`"${phrase}" is registered on two pages (${prev} and ${p.id}) — they may compete for the same search; decide which page should own it`);
      else owner.set(n, p.id);
    }
    // same-intent hints, within one page
    const list = [...seen];
    const used = new Set();
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      const g = [list[i]];
      for (let j = i + 1; j < list.length; j++) if (!used.has(j) && similarKeywords(list[i], list[j]).similar) { g.push(list[j]); used.add(j); }
      if (g.length > 1) groups.push({ pageId: p.id, phrases: g, note: "These phrases look like one search intent. They belong on ONE page; they do not need separate pages." });
    }
    if (isStr(k.searchIntent) && !SEARCH_INTENTS.includes(k.searchIntent)) warnings.push(`${where}.searchIntent "${k.searchIntent}" is not one of ${SEARCH_INTENTS.join(", ")}`);
  }
  for (const d of Array.isArray(inventory?.keywordDecisions) ? inventory.keywordDecisions : []) {
    if (!isStr(d?.query) || !DECISIONS.includes(d?.decision)) errors.push(`keywordDecisions: each entry needs a query and a decision (${DECISIONS.join(" | ")})`);
  }
  return { errors, warnings, groups };
}

// ---------------------------------------------------------------- changing the registry (pure: returns a NEW inventory)

const clone = (o) => JSON.parse(JSON.stringify(o));
const result = (ok, fields) => ({ ok, ...fields });

// Add a keyword to a page. role "primary" is refused if the page already has one (use replace:true to swap it deliberately).
// A phrase already registered on ANOTHER page is refused unless allowDuplicate:true - the owner decides, not the engine.
// This never creates a page: the page must already exist in the inventory.
export function addKeyword(inventory, { pageId, keyword, role = "secondary", on = null, replace = false, allowDuplicate = false, searchIntent = null }) {
  if (!isStr(keyword) || !normalizeKeyword(keyword)) return result(false, { error: "a keyword needs searchable words" });
  if (!KEYWORD_ROLES.includes(role)) return result(false, { error: `role must be ${KEYWORD_ROLES.join(" or ")}` });
  const next = clone(inventory ?? { pages: [] });
  const page = (next.pages ?? []).find((p) => p.id === pageId);
  if (!page) return result(false, { error: `no page "${pageId}" in the inventory — a keyword never creates a page` });
  const n = normalizeKeyword(keyword);
  const other = registryOf(next).find((r) => r.pageId !== pageId && normalizeKeyword(r.keyword) === n);
  if (other && !allowDuplicate) return result(false, { error: `"${keyword.trim()}" is already registered on ${other.pageId} (${other.targetUrl}). Decide which page should own it, or pass allowDuplicate.`, conflict: other });
  const k = (page.keywords = page.keywords && typeof page.keywords === "object" ? page.keywords : {});
  k.secondary = secondaryOf(k);
  if (on && isDate(on) && !isDate(k.addedOn)) k.addedOn = on.slice(0, 10);
  if (isStr(searchIntent)) k.searchIntent = searchIntent;
  const sameAsPrimary = isStr(k.primary) && normalizeKeyword(k.primary) === n;
  if (role === "primary") {
    if (sameAsPrimary) return result(true, { inventory: next, changed: false, note: "already the primary keyword" });
    if (isStr(k.primary) && !replace) return result(false, { error: `${pageId} already has the primary keyword "${k.primary}". A page has one primary keyword; add this as secondary, or pass replace.` });
    if (isStr(k.primary)) k.secondary = [...new Set([...k.secondary, k.primary])];
    k.primary = keyword.trim();
    k.secondary = k.secondary.filter((s) => normalizeKeyword(s) !== n);
  } else {
    if (sameAsPrimary || k.secondary.some((s) => normalizeKeyword(s) === n)) return result(true, { inventory: next, changed: false, note: "already registered on this page" });
    k.secondary.push(keyword.trim());
  }
  return result(true, { inventory: next, changed: true });
}

export function removeKeyword(inventory, { pageId, keyword }) {
  const next = clone(inventory ?? { pages: [] });
  const page = (next.pages ?? []).find((p) => p.id === pageId);
  const k = page?.keywords;
  if (!k) return result(false, { error: `no keywords recorded on "${pageId}"` });
  const n = normalizeKeyword(keyword);
  const before = (isStr(k.primary) ? 1 : 0) + secondaryOf(k).length;
  if (isStr(k.primary) && normalizeKeyword(k.primary) === n) k.primary = null;
  k.secondary = secondaryOf(k).filter((s) => normalizeKeyword(s) !== n);
  const after = (isStr(k.primary) ? 1 : 0) + k.secondary.length;
  return after === before ? result(false, { error: `"${keyword}" is not registered on ${pageId}` }) : result(true, { inventory: next, changed: true });
}

// What an administrator can do with a DISCOVERED query. Never creates a page.
//   ignore / monitor / investigate  → recorded in keywordDecisions (a discovered query is dropped from the "new" list)
//   add-secondary / add-primary     → registered on the page that Google already shows for it (or the page you name)
export function applyDiscoveredAction(inventory, { query, action, pageId = null, on = null, note = null }) {
  if (!isStr(query)) return result(false, { error: "a query is required" });
  if (action === "add-secondary" || action === "add-primary") {
    if (!isStr(pageId)) return result(false, { error: "name the page this keyword belongs to" });
    return addKeyword(inventory, { pageId, keyword: query, role: action === "add-primary" ? "primary" : "secondary", on });
  }
  if (!DECISIONS.includes(action)) return result(false, { error: `action must be one of ${[...DECISIONS, "add-secondary", "add-primary"].join(", ")}` });
  const next = clone(inventory ?? { pages: [] });
  const n = normalizeKeyword(query);
  const list = (Array.isArray(next.keywordDecisions) ? next.keywordDecisions : []).filter((d) => normalizeKeyword(d.query) !== n);
  list.push({ query: query.trim(), decision: action, ...(isDate(on) ? { on: on.slice(0, 10) } : {}), ...(isStr(note) ? { note } : {}) });
  next.keywordDecisions = list;
  return result(true, { inventory: next, changed: true, note: action === "investigate" ? "recorded as a possible new content or tool opportunity — nothing is created automatically; take it through /BWESEOOpportunities" : undefined });
}
