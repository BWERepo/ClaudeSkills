// BWESEO landing-page keyword intake — pure functions, zero dependencies (Node 18+, Worker, browser).
// CSV import, search-intent grouping and the verified-metrics model for the SEO Landing Page Generator.
//
// Rule: a metric is a number only when the owner supplies it WITH a source and a research date. Anything else is the string
// "unavailable". Nothing here estimates, guesses or fills in a search volume, difficulty or CPC.
import { normalizeKeyword, similarKeywords } from "./keyword-registry.mjs";

export const UNAVAILABLE = "unavailable";
export const METRIC_FIELDS = ["searchVolume", "keywordDifficulty", "cpc"];

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

// A metric is verified only with a finite non-negative number AND a source AND a research date.
export function metricOf(value, source, researchedOn) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value.replace(/[$,]/g, "")) : value;
  if (typeof n === "number" && Number.isFinite(n) && n >= 0 && isStr(source) && isDate(researchedOn)) {
    return { value: n, source: source.trim(), researchedOn: researchedOn.slice(0, 10), verified: true };
  }
  return { value: UNAVAILABLE, source: null, researchedOn: null, verified: false };
}

// Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF/LF). Returns an array of rows.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text ?? "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_ALIASES = {
  keyword: ["keyword", "keywords", "query", "phrase", "term"],
  searchVolume: ["searchvolume", "volume", "monthlysearches", "avgmonthlysearches"],
  keywordDifficulty: ["keyworddifficulty", "difficulty", "kd"],
  cpc: ["cpc", "costperclick"],
  source: ["source", "tool"],
  researchedOn: ["researchedon", "researchdate", "date", "checkedon"],
};
const headerKey = (h) => { const n = String(h).toLowerCase().replace(/[^a-z]/g, ""); return Object.keys(HEADER_ALIASES).find((k) => HEADER_ALIASES[k].includes(n)) ?? null; };

// Import a keyword list. A file with no header row is read as one keyword per line.
// Returns { keywords[], duplicates[], rejected[] }; metrics not backed by a source and date come back "unavailable".
export function importKeywordsCsv(text) {
  const rows = parseCsv(text);
  const out = { keywords: [], duplicates: [], rejected: [] };
  if (!rows.length) return out;
  const cols = rows[0].map(headerKey);
  const hasHeader = cols.includes("keyword");
  const body = hasHeader ? rows.slice(1) : rows;
  const seen = new Set();
  body.forEach((r, i) => {
    const rec = {};
    if (hasHeader) cols.forEach((k, ci) => { if (k && r[ci] !== undefined) rec[k] = r[ci].trim(); });
    else rec.keyword = (r[0] ?? "").trim();
    const line = i + (hasHeader ? 2 : 1);
    const norm = normalizeKeyword(rec.keyword);
    if (!norm) { out.rejected.push({ line, reason: "no searchable words" }); return; }
    if (seen.has(norm)) { out.duplicates.push({ line, keyword: rec.keyword }); return; }
    seen.add(norm);
    out.keywords.push({
      keyword: rec.keyword,
      normalized: norm,
      metrics: Object.fromEntries(METRIC_FIELDS.map((f) => [f, metricOf(rec[f], rec.source, rec.researchedOn)])),
    });
  });
  return out;
}

// ---- intent classification (heuristic, wording only — a hint for the owner, never a fact about Google's results)
const LOCAL_RE = /\b(near me|in [a-z]+ ?(?:[a-z]+)?,? ?[a-z]{2}\b|[a-z]+ (?:tn|tx|ca|ny|fl|ga|nc|sc|va|oh|pa|il|wa))\b/;
export function classifyIntent(keyword, { locations = [] } = {}) {
  const n = normalizeKeyword(keyword).replace(/\blow cost\b/g, "affordable"); // "low cost" is wording for cheap, not cost research
  const words = new Set(n.split(" "));
  if (locations.some((l) => n.includes(normalizeKeyword(l))) || /\bnear me\b/.test(n)) return "local";
  if (/\b(cost|price|pricing|how much|average|rates?)\b/.test(n)) return "cost-research";
  if (/\b(packages?|plans?|vs|compare|comparison|under|budget)\b/.test(n) || [...words].some((w) => /^\d/.test(w))) return "comparison";
  if (/\b(how to|what is|guide|tips|ideas|examples?)\b/.test(n)) return "informational";
  if (/\b(redesign|revamp|rebuild|refresh)\b/.test(n)) return "service-redesign";
  return "service";
}

// Wording variants that mean the same thing for grouping (web design = website design; cheap = low cost = affordable).
const canon = (k) => normalizeKeyword(k).replace(/\blow cost\b/g, "affordable").replace(/\b(cheap|inexpensive|budget)\b/g, "affordable").replace(/\b(web|site)\b/g, "website").replace(/\b(designer|designers|designing)\b/g, "design");

// Group keywords that share one intent AND overlap in wording. Each group suggests ONE page; the first keyword is only a
// default primary — the owner picks. Returns [{ intent, primary, secondary[], keywords[] }].
export function groupKeywords(keywords, opts = {}) {
  const groups = [];
  for (const k of keywords) {
    const intent = classifyIntent(k.keyword, opts);
    const g = groups.find((x) => x.intent === intent && x.keywords.some((m) => similarKeywords(canon(m.keyword), canon(k.keyword)).similar));
    if (g) g.keywords.push(k); else groups.push({ intent, keywords: [k] });
  }
  return groups.map((g) => ({ intent: g.intent, primary: g.keywords[0].keyword, secondary: g.keywords.slice(1).map((k) => k.keyword), keywords: g.keywords }));
}

// Which keywords an existing inventory already targets (primary or secondary, normalized). Returns Map(normalized -> pageId[]).
export function targetedKeywords(inventory) {
  const m = new Map();
  for (const p of inventory?.pages ?? []) {
    if (p?.status === "rejected") continue;
    const k = p?.keywords;
    for (const phrase of [k?.primary, ...(Array.isArray(k?.secondary) ? k.secondary : [])]) {
      const n = normalizeKeyword(phrase);
      if (n) m.set(n, [...(m.get(n) ?? []), p.id]);
    }
  }
  return m;
}
