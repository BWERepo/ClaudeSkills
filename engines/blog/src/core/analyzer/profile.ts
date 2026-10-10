import type { BlogEngineConfig } from "../../config/config.js";
import type { ExtractedPage } from "../html/extract.js";
import { stripSiteSuffix } from "../inventory/inventory.js";
import type { SitePage, SiteProfile } from "../types.js";
import { keyPhrases, titleCase, words } from "../util/text.js";
import { urlKey } from "../util/url.js";

const OFFERING_TYPES = new Set(["product", "service", "tool", "calculator", "category"]);

/**
 * What the website is about, derived only from its own content. Every inferred value says so;
 * nothing here is invented or looked up elsewhere.
 */
export function buildProfile(pages: SitePage[], extracted: Map<string, ExtractedPage>, config: BlogEngineConfig): SiteProfile {
  const notes: string[] = [];
  const home = pages.find((p) => p.pageType === "home");
  const homeX = home ? extracted.get(home.url) : undefined;
  const name =
    config.siteName ??
    homeX?.siteName ??
    orgNameFromLd(homeX?.jsonLd ?? []) ??
    (home ? (home.title.split(/\s+[|\-–—·]\s+/).pop() ?? home.title) : new URL(config.siteUrl).hostname);

  // Subjects: phrases weighted by page importance, from titles/headings of non-blog pages first.
  const weighted = new Map<string, number>();
  for (const p of pages) {
    if (!p.indexable || p.pageType === "legal" || p.pageType === "utility") continue;
    const w = p.isBlogArticle ? 0.5 : 1 + p.importance;
    const text = `${p.title}. ${p.h1}. ${p.h1}. ${p.headings.map((h) => h.text).join(". ")}. ${p.description}. ${p.excerpt.slice(0, 1500)}`;
    for (const { phrase, count } of keyPhrases(text, 25)) {
      if (name && phrase.includes(name.toLowerCase())) continue;
      weighted.set(phrase, (weighted.get(phrase) ?? 0) + count * w);
    }
    for (const t of p.keyTerms.slice(0, 6)) weighted.set(t, (weighted.get(t) ?? 0) + 0.6 * w);
  }
  const ranked = [...weighted.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const subjects: string[] = [];
  for (const [phrase] of ranked) {
    if (subjects.some((s) => s.includes(phrase) || phrase.includes(s))) continue;
    subjects.push(phrase);
    if (subjects.length >= 8) break;
  }

  const offerings = pages
    .filter((p) => OFFERING_TYPES.has(p.pageType) && p.indexable)
    .map((p) => ({ name: offeringName(p, name), kind: (p.pageType === "calculator" ? "tool" : p.pageType === "category" ? "product" : p.pageType) as "product" | "service" | "tool", url: p.url }))
    .filter((o) => o.name);

  const audience = detectAudience(pages);
  if (audience.inferred) notes.push(`Target audience inferred from site copy ("${audience.value}").`);
  const geo = detectGeo(pages, extracted);

  const topics = ranked.slice(0, 30).map(([term, weight]) => ({
    term,
    weight: Math.round(weight * 10) / 10,
    pages: pages.filter((p) => `${p.title} ${p.h1} ${p.excerpt}`.toLowerCase().includes(term)).map((p) => p.url).slice(0, 20),
  }));

  const inbound = new Map<string, number>();
  const anyInbound = new Map<string, number>();
  for (const p of pages) {
    for (const l of p.internalLinksOut) {
      const k = urlKey(l.href);
      if (k === urlKey(p.url)) continue;
      anyInbound.set(k, (anyInbound.get(k) ?? 0) + 1);
      if (l.context === "body") inbound.set(k, (inbound.get(k) ?? 0) + 1);
    }
  }
  const candidates = pages.filter((p) => p.indexable && p.pageType !== "home" && p.pageType !== "utility" && p.pageType !== "legal");
  const orphanPages = candidates.filter((p) => !anyInbound.get(urlKey(p.url))).map((p) => p.url);
  const weaklyLinkedPages = candidates.filter((p) => (inbound.get(urlKey(p.url)) ?? 0) <= 1 && !orphanPages.includes(p.url)).map((p) => p.url);

  const articles = pages.filter((p) => p.isBlogArticle);
  return {
    siteUrl: config.siteUrl,
    name: name.trim(),
    primarySubject: subjects[0] ? titleCase(subjects[0]) : "Not determined (too little content)",
    secondarySubjects: subjects.slice(1, 6).map(titleCase),
    offerings,
    targetAudience: audience.value,
    geographicMarket: geo,
    entities: detectEntities(pages, name),
    topics,
    contentDepth: {
      pages: pages.length,
      articles: articles.length,
      averageWords: pages.length ? Math.round(pages.reduce((s, p) => s + p.wordCount, 0) / pages.length) : 0,
    },
    orphanPages,
    weaklyLinkedPages,
    notes,
  };
}

export function offeringName(p: SitePage, siteName: string): string {
  const raw = p.h1 && p.h1.split(/\s+/).length <= 7 ? p.h1 : stripSiteSuffix(p.title, siteName);
  return raw
    .replace(new RegExp(`\\b${escapeRe(siteName)}\\b`, "ig"), "")
    .replace(/^(our|the|professional|expert|affordable|best|top)\s+/i, "")
    .replace(/\s+(services?|solutions?)$/i, "")
    .replace(/\s*[|\-–—:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function orgNameFromLd(ld: unknown[]): string | undefined {
  for (const v of ld.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const items = Array.isArray(o["@graph"]) ? (o["@graph"] as Record<string, unknown>[]) : [o];
      for (const it of items) {
        if (["Organization", "LocalBusiness", "WebSite", "Corporation"].includes(String(it["@type"])) && typeof it.name === "string") return it.name;
      }
    }
  }
  return undefined;
}

function detectAudience(pages: SitePage[]): { value: string; inferred: boolean } {
  const counts = new Map<string, number>();
  for (const p of pages.filter((x) => !x.isBlogArticle)) {
    const text = `${p.title} ${p.h1} ${p.description} ${p.excerpt.slice(0, 3000)}`;
    for (const m of text.matchAll(/\b(?:for|helping|serving)\s+((?:[a-z]+\s){0,2}[a-z]+s)\b/gi)) {
      const g = m[1]!.toLowerCase();
      if (/^(years|decades|days|hours|minutes|months|weeks|details|questions|results|more|others|us|yours|ours|this|these|those|less|sales|news|terms|cookies|items|products|services|solutions|tools)$/.test(g.split(" ").pop()!)) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 2).slice(0, 3).map(([g]) => g);
  if (top.length) return { value: top.join(", "), inferred: true };
  return { value: "Not stated on the site", inferred: false };
}

function detectGeo(pages: SitePage[], extracted: Map<string, ExtractedPage>): string {
  const places = new Map<string, number>();
  for (const p of pages) {
    const x = extracted.get(p.url);
    for (const ld of x?.jsonLd ?? []) collectAddress(ld, places);
    if (p.pageType === "location") {
      const n = (p.h1 || p.title).replace(/\b(services?|in|near|serving|locations?|areas?)\b/gi, " ").trim();
      if (n) places.set(n, (places.get(n) ?? 0) + 1);
    }
    for (const m of `${p.title} ${p.h1} ${p.description}`.matchAll(/\b(?:serving|in|near|across)\s+([A-Z][a-zA-Z]+(?:[ ,]+[A-Z][a-zA-Z]+){0,3})/g)) {
      const v = m[1]!.trim();
      if (!/^(The|Our|Your|A|An|This|Stock|Business|Time|Order|Addition|Depth|Detail|Store|Person)$/.test(v.split(/\s|,/)[0]!)) places.set(v, (places.get(v) ?? 0) + 0.5);
    }
  }
  const top = [...places.entries()].sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 1).slice(0, 3);
  return top.length ? `${top.map(([p]) => p).join("; ")} (inferred from site content)` : "Not stated (no location signals found on the site)";
}

function collectAddress(v: unknown, out: Map<string, number>, d = 0): void {
  if (d > 6 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) return v.forEach((x) => collectAddress(x, out, d + 1));
  const o = v as Record<string, unknown>;
  if (o.address && typeof o.address === "object") {
    const a = o.address as Record<string, unknown>;
    const loc = [a.addressLocality, a.addressRegion].filter((x) => typeof x === "string").join(", ");
    if (loc) out.set(loc, (out.get(loc) ?? 0) + 3);
  }
  if (typeof o.areaServed === "string") out.set(o.areaServed, (out.get(o.areaServed) ?? 0) + 2);
  if (o["@graph"]) collectAddress(o["@graph"], out, d + 1);
}

function detectEntities(pages: SitePage[], siteName: string): string[] {
  const counts = new Map<string, Set<string>>();
  for (const p of pages) {
    const text = `${p.title}. ${p.h1}. ${p.headings.map((h) => h.text).join(". ")}. ${p.excerpt.slice(0, 3000)}`;
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9&]+(?:\s+(?:[A-Z][a-zA-Z0-9&]+|of|and|&)){0,3}\s+[A-Z][a-zA-Z0-9&]+|[A-Z]{2,6})\b/g)) {
      const e = m[1]!.trim();
      if (e.length < 3 || words(e).every((w) => ["the", "and", "of", "our", "your", "how", "what", "why", "faq"].includes(w))) continue;
      if (/^(The|How|What|Why|When|Where|Our|Your|This|We|You|Get|Call|Contact|Read|Learn|Home)\b/.test(e)) continue;
      const set = counts.get(e) ?? new Set();
      set.add(p.url);
      counts.set(e, set);
    }
  }
  return [...counts.entries()]
    .filter(([e, s]) => s.size >= 2 || e === siteName)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([e]) => e);
}
