import type { BlogEngineConfig } from "../../config/config.js";
import type { BlogArticle } from "../types.js";
import { absoluteUrl } from "../util/url.js";

type Json = Record<string, unknown>;

/**
 * Article/BlogPosting JSON-LD with only the properties that are actually known. Nothing is manufactured
 * to fill a field: no image unless the article has one, no author unless one is set.
 */
export function articleSchema(a: BlogArticle, config: BlogEngineConfig, siteName: string): Json {
  const s: Json = {
    "@context": "https://schema.org",
    "@type": config.schema.articleType,
    headline: a.title.slice(0, 110),
    description: a.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": a.canonicalUrl },
    url: a.canonicalUrl,
  };
  if (a.image) s.image = [a.image];
  if (a.author) s.author = { "@type": config.authors.defaultType === "Person" && a.author !== siteName ? "Person" : config.authors.defaultType, name: a.author };
  if (siteName) {
    const pub: Json = { "@type": "Organization", name: siteName, url: config.siteUrl };
    if (config.schema.publisherLogo) pub.logo = { "@type": "ImageObject", url: absoluteUrl(config.siteUrl, config.schema.publisherLogo) };
    s.publisher = pub;
  }
  if (a.publishedAt) s.datePublished = a.publishedAt;
  if (a.modifiedAt ?? a.lastModifiedAt) s.dateModified = a.modifiedAt ?? a.lastModifiedAt;
  if (a.category) s.articleSection = a.category;
  if (a.tags.length) s.keywords = a.tags.join(", ");
  if (a.wordCount) s.wordCount = a.wordCount;
  return s;
}

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbSchema(crumbs: Crumb[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
}

/** Home -> Blog -> Category -> Article. Category is included only when a category page exists. */
export function articleCrumbs(a: BlogArticle, config: BlogEngineConfig, blogTitle: string, categoryUrl?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { name: "Home", url: absoluteUrl(config.siteUrl, "/") },
    { name: blogTitle, url: absoluteUrl(config.siteUrl, config.blogPath) },
  ];
  if (a.category && categoryUrl) crumbs.push({ name: a.category, url: categoryUrl });
  crumbs.push({ name: a.title, url: a.canonicalUrl });
  return crumbs;
}

/** Structural validation of generated JSON-LD (the subset Google's rich-result checks rely on). */
export function validateSchema(s: Json): string[] {
  const errs: string[] = [];
  if (s["@context"] !== "https://schema.org") errs.push("@context must be https://schema.org");
  const type = s["@type"];
  if (typeof type !== "string" || !type) errs.push("@type is required");
  const isUrl = (v: unknown) => typeof v === "string" && /^https?:\/\/[^\s]+$/.test(v);
  const isDate = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}/.test(v);
  if (type === "Article" || type === "BlogPosting" || type === "NewsArticle") {
    if (typeof s.headline !== "string" || !s.headline.trim()) errs.push("headline is required");
    else if (s.headline.length > 110) errs.push("headline must be 110 characters or fewer");
    const me = s.mainEntityOfPage as Json | undefined;
    if (!me || !isUrl(me["@id"])) errs.push("mainEntityOfPage @id must be an absolute URL");
    if (s.datePublished !== undefined && !isDate(s.datePublished)) errs.push("datePublished must be an ISO 8601 date");
    if (s.dateModified !== undefined && !isDate(s.dateModified)) errs.push("dateModified must be an ISO 8601 date");
    if (s.datePublished && s.dateModified && Date.parse(String(s.dateModified)) < Date.parse(String(s.datePublished))) errs.push("dateModified is earlier than datePublished");
    if (s.image !== undefined && !(Array.isArray(s.image) && s.image.every(isUrl))) errs.push("image must be a list of absolute URLs");
    const author = s.author as Json | undefined;
    if (author !== undefined && (typeof author.name !== "string" || !author.name)) errs.push("author needs a name");
    const pub = s.publisher as Json | undefined;
    if (pub !== undefined && (typeof pub.name !== "string" || !pub.name)) errs.push("publisher needs a name");
  }
  if (type === "BreadcrumbList") {
    const items = s.itemListElement;
    if (!Array.isArray(items) || !items.length) errs.push("BreadcrumbList needs items");
    else
      (items as Json[]).forEach((it, i) => {
        if (it.position !== i + 1) errs.push(`breadcrumb ${i + 1} has the wrong position`);
        if (typeof it.name !== "string" || !it.name) errs.push(`breadcrumb ${i + 1} needs a name`);
        if (!isUrl(it.item)) errs.push(`breadcrumb ${i + 1} needs an absolute URL`);
      });
  }
  // No empty strings anywhere: an empty property is worse than an absent one.
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string" && !v.trim()) errs.push(`${p} is empty`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(s, "");
  return errs;
}

/** Serialize JSON-LD safely for embedding in <script> (no "</script>" breakout). */
export function jsonLdScript(s: Json): string {
  return `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`;
}
