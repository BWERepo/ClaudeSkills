import type { Heading, LinkRef } from "../types.js";
import { normalizeLink } from "../util/url.js";
import { parseLooseDate } from "../util/time.js";
import { ancestors, attr, byTag, findAll, findOne, isTag, parseHtml, text, type AnyNode, type Element } from "./dom.js";

/** Everything the engine reads from one HTML page. Crawled HTML is untrusted: values are plain strings, never executed. */
export interface ExtractedPage {
  title: string;
  description: string;
  canonical?: string;
  robots: string;
  lang?: string;
  h1: string;
  headings: Heading[];
  links: LinkRef[];
  externalLinks: LinkRef[];
  linkProblems: { href: string; problems: string[] }[];
  schemaTypes: string[];
  jsonLd: unknown[];
  mainText: string;
  siteName?: string;
  ogImage?: string;
  ogType?: string;
  publishedAt?: string;
  modifiedAt?: string;
  author?: string;
  section?: string;
  tags: string[];
  faqQuestions: string[];
  breadcrumbs: string[];
  hasViewport: boolean;
  navLabels: string[];
}

const NAV_TAGS = new Set(["nav", "header", "footer", "aside"]);

export function extractPage(html: string, pageUrl: string, siteUrl: string, stagingHosts: string[] = []): ExtractedPage {
  const doc = parseHtml(html);
  const head = findOne(doc, byTag("head")) ?? doc;
  const meta = (pred: (el: Element) => boolean) => findOne(head, (el) => el.name === "meta" && pred(el));
  const metaContent = (key: string) => {
    const el = meta((e) => (attr(e, "name") ?? "").toLowerCase() === key || (attr(e, "property") ?? "").toLowerCase() === key);
    return el ? attr(el, "content")?.trim() : undefined;
  };

  const titleEl = findOne(head, byTag("title"));
  const canonicalEl = findOne(head, (el) => el.name === "link" && (attr(el, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const htmlEl = findOne(doc, byTag("html"));

  // JSON-LD
  const jsonLd: unknown[] = [];
  const schemaTypes = new Set<string>();
  for (const s of findAll(doc, (el) => el.name === "script" && (attr(el, "type") ?? "").toLowerCase() === "application/ld+json")) {
    try {
      const data = JSON.parse(text(s.children as AnyNode[]) || "null");
      jsonLd.push(data);
      collectTypes(data, schemaTypes);
    } catch {
      // Invalid JSON-LD is reported by validation, not here.
    }
  }

  // Microdata itemtype
  for (const el of findAll(doc, (e) => !!attr(e, "itemtype"))) {
    const t = (attr(el, "itemtype") ?? "").split("/").pop();
    if (t) schemaTypes.add(t);
  }

  const bodyRoot = findOne(doc, byTag("body")) ?? doc;
  const main =
    findOne(bodyRoot, byTag("main")) ??
    findOne(bodyRoot, (el) => attr(el, "role") === "main") ??
    findOne(bodyRoot, byTag("article")) ??
    bodyRoot;

  const headings: Heading[] = findAll(main, byTag("h1", "h2", "h3", "h4", "h5", "h6"))
    .map((h) => ({ level: Number(h.name.slice(1)), text: text(h) }))
    .filter((h) => h.text);
  const h1 = findOne(bodyRoot, byTag("h1"));

  const links: LinkRef[] = [];
  const externalLinks: LinkRef[] = [];
  const linkProblems: { href: string; problems: string[] }[] = [];
  for (const a of findAll(bodyRoot, (el) => el.name === "a" && attr(el, "href") !== undefined)) {
    const href = attr(a, "href")!;
    const n = normalizeLink(href, pageUrl, siteUrl, stagingHosts);
    if (n.kind === "anchor" || n.kind === "mailto" || n.kind === "tel" || n.kind === "data") continue;
    const ctx = linkContext(a);
    const anchor = text(a) || attr(a, "aria-label") || attr(a, "title") || "";
    if (n.problems.length) linkProblems.push({ href, problems: n.problems });
    if (n.kind === "malformed" || n.kind === "javascript") continue;
    const ref: LinkRef = { href: n.url, anchor, context: ctx };
    if (n.internal) links.push(ref);
    else externalLinks.push(ref);
  }

  const mainText = visibleText(main);

  const faqQuestions = new Set<string>();
  collectFaq(jsonLd, faqQuestions);
  for (const s of findAll(main, byTag("summary", "dt"))) {
    const q = text(s);
    if (q.endsWith("?")) faqQuestions.add(q);
  }
  for (const h of headings) if (h.level >= 2 && h.text.trim().endsWith("?")) faqQuestions.add(h.text.trim());

  const tags = new Set<string>();
  for (const m of findAll(head, (el) => el.name === "meta" && (attr(el, "property") ?? "") === "article:tag")) {
    const v = attr(m, "content");
    if (v) tags.add(v.trim());
  }
  for (const a of findAll(bodyRoot, (el) => el.name === "a" && (attr(el, "rel") ?? "").split(/\s+/).includes("tag"))) {
    const v = text(a);
    if (v) tags.add(v);
  }

  const breadcrumbs: string[] = [];
  collectBreadcrumbs(jsonLd, breadcrumbs);

  const timeEl = findOne(main, (el) => el.name === "time" && !!attr(el, "datetime"));
  const navLabels = findAll(bodyRoot, byTag("nav")).flatMap((n) => findAll(n, byTag("a")).map((a) => text(a))).filter(Boolean);

  const ldArticle = findArticleLd(jsonLd);

  return {
    title: titleEl ? text(titleEl) : "",
    description: metaContent("description") ?? metaContent("og:description") ?? "",
    canonical: canonicalEl ? attr(canonicalEl, "href")?.trim() : undefined,
    robots: [metaContent("robots"), metaContent("googlebot")].filter(Boolean).join(", "),
    lang: htmlEl ? attr(htmlEl, "lang") : undefined,
    h1: h1 ? text(h1) : "",
    headings,
    links,
    externalLinks,
    linkProblems,
    schemaTypes: [...schemaTypes],
    jsonLd,
    mainText,
    siteName: metaContent("og:site_name"),
    ogImage: metaContent("og:image"),
    ogType: metaContent("og:type"),
    publishedAt:
      parseLooseDate(metaContent("article:published_time")) ??
      parseLooseDate(ldArticle?.datePublished) ??
      parseLooseDate(timeEl ? attr(timeEl, "datetime") : undefined),
    modifiedAt: parseLooseDate(metaContent("article:modified_time")) ?? parseLooseDate(ldArticle?.dateModified),
    author: metaContent("author") ?? authorName(ldArticle?.author),
    section: metaContent("article:section"),
    tags: [...tags],
    faqQuestions: [...faqQuestions],
    breadcrumbs,
    hasViewport: !!meta((el) => (attr(el, "name") ?? "").toLowerCase() === "viewport"),
    navLabels,
  };
}

function linkContext(a: Element): LinkRef["context"] {
  for (const p of ancestors(a)) {
    if (NAV_TAGS.has(p.name)) return p.name === "aside" ? "nav" : (p.name as LinkRef["context"]);
    const role = attr(p, "role");
    if (role === "navigation") return "nav";
    if (role === "contentinfo") return "footer";
    if (role === "banner") return "header";
    if (p.name === "main" || p.name === "article") return "body";
  }
  return "body";
}

/** Text a reader sees: skips scripts, styles, templates, nav chrome. */
export function visibleText(root: AnyNode): string {
  const parts: string[] = [];
  const walk = (n: AnyNode): void => {
    if (isTag(n)) {
      if (["script", "style", "noscript", "template", "svg", "nav", "header", "footer", "form", "button", "select"].includes(n.name)) return;
      if (attr(n, "hidden") !== undefined || attr(n, "aria-hidden") === "true") return;
      const block = /^(p|div|section|article|li|h[1-6]|td|th|br|tr|blockquote|pre|dd|dt|figcaption|summary)$/.test(n.name);
      if (block) parts.push("\n");
      for (const c of n.children) walk(c);
      if (block) parts.push("\n");
    } else if (n.type === "text") {
      parts.push((n as unknown as { data: string }).data);
    } else if ("children" in n && Array.isArray((n as { children?: AnyNode[] }).children)) {
      for (const c of (n as { children: AnyNode[] }).children) walk(c);
    }
  };
  walk(root);
  return parts
    .join(" ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

function collectTypes(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) collectTypes(x, out, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  const t = o["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x);
  if (o["@graph"]) collectTypes(o["@graph"], out, depth + 1);
}

function collectFaq(v: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) collectFaq(x, out, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  if (o["@type"] === "Question" && typeof o.name === "string") out.add(o.name.trim());
  for (const k of ["@graph", "mainEntity"]) if (o[k]) collectFaq(o[k], out, depth + 1);
}

function collectBreadcrumbs(v: unknown, out: string[], depth = 0): void {
  if (depth > 8 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) collectBreadcrumbs(x, out, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  if (o["@type"] === "BreadcrumbList" && Array.isArray(o.itemListElement)) {
    for (const it of o.itemListElement as Record<string, unknown>[]) if (typeof it?.name === "string") out.push(it.name);
  }
  if (o["@graph"]) collectBreadcrumbs(o["@graph"], out, depth + 1);
}

function findArticleLd(ld: unknown[]): Record<string, unknown> | undefined {
  const flat: Record<string, unknown>[] = [];
  const walk = (v: unknown, d = 0) => {
    if (d > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, d + 1));
    const o = v as Record<string, unknown>;
    flat.push(o);
    if (o["@graph"]) walk(o["@graph"], d + 1);
  };
  ld.forEach((x) => walk(x));
  return flat.find((o) => ["Article", "BlogPosting", "NewsArticle", "TechArticle"].includes(String(o["@type"])));
}

function authorName(a: unknown): string | undefined {
  if (!a) return undefined;
  if (typeof a === "string") return a;
  if (Array.isArray(a)) return authorName(a[0]);
  if (typeof a === "object" && typeof (a as { name?: unknown }).name === "string") return (a as { name: string }).name;
  return undefined;
}
