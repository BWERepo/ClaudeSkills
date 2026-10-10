import type { PageType, SearchIntent } from "../types.js";
import type { ExtractedPage } from "../html/extract.js";
import { intentFacets } from "../util/text.js";
import { isUnderPath } from "../util/url.js";

export const BLOG_ROOT_CANDIDATES = ["/blog", "/news", "/articles", "/posts", "/insights", "/journal", "/stories", "/updates", "/resources/blog", "/learn", "/guides"];

const ARTICLE_SCHEMA = new Set(["Article", "BlogPosting", "NewsArticle", "TechArticle", "Report"]);

/** Does this page look like a blog article (independent of where it lives)? */
export function looksLikeArticle(x: ExtractedPage, frontmatter?: Record<string, unknown>): boolean {
  if (x.schemaTypes.some((t) => ARTICLE_SCHEMA.has(t))) return true;
  if (x.ogType === "article") return true;
  if (x.publishedAt) return true;
  if (frontmatter && (frontmatter.date || frontmatter.pubDate || frontmatter.publishedAt || frontmatter.published)) return true;
  return false;
}

export interface ClassifyInput {
  path: string;
  extracted: ExtractedPage;
  frontmatter?: Record<string, unknown>;
  blogRoot: string;
  wordCount: number;
  fromContentDir: boolean;
}

export function classifyPage(i: ClassifyInput): PageType {
  const p = i.path.toLowerCase().replace(/\/index\.html?$/, "/").replace(/\.html?$/, "");
  const trimmed = p.length > 1 ? p.replace(/\/+$/, "") : p;
  const x = i.extracted;
  const types = new Set(x.schemaTypes);
  const title = `${x.title} ${x.h1}`.toLowerCase();
  const blogRoot = i.blogRoot.toLowerCase();

  if (trimmed === "/" || trimmed === "") return "home";
  if (trimmed === blogRoot) return "blog-index";
  if (isUnderPath(trimmed, blogRoot)) {
    const rest = trimmed.slice(blogRoot.length);
    if (/^\/(category|categories|tag|tags|topic|topics|author|authors|page)(\/|$)/.test(rest)) return "blog-category";
    if (looksLikeArticle(x, i.frontmatter) || i.fromContentDir || i.wordCount > 250) return "blog-article";
    return "blog-category";
  }
  if (i.fromContentDir && looksLikeArticle(x, i.frontmatter)) return "blog-article";

  if (/\/(privacy|terms|legal|cookie|cookies|disclaimer|accessibility|gdpr|imprint)(-policy)?(\/|$)/.test(trimmed)) return "legal";
  if (/\/(contact|contact-us|get-in-touch|book|booking|appointment|quote|get-a-quote)(\/|$)/.test(trimmed)) return "contact";
  if (/\/(about|about-us|team|our-story|company)(\/|$)/.test(trimmed)) return "about";
  if (/\/(faq|faqs|frequently-asked-questions|help)(\/|$)/.test(trimmed) || types.has("FAQPage")) return "faq";
  if (/calculator|estimator/.test(trimmed) || /\bcalculator\b/.test(title)) return "calculator";
  if (/\/(tools?|apps?|generator|checker|converter)(\/|$)/.test(trimmed) || types.has("WebApplication") || types.has("SoftwareApplication")) return "tool";
  if (types.has("Product") || /\/(products?|shop|store|item)\//.test(trimmed)) return "product";
  if (/\/(collections?|categories|category|shop|store|catalog)(\/|$)/.test(trimmed) || types.has("CollectionPage") || types.has("OfferCatalog")) return "category";
  if (types.has("Service") || /\/(services?|solutions|what-we-do|treatments?|practice-areas?)(\/|$)/.test(trimmed)) return "service";
  if (/\/(locations?|areas?|service-areas?|cities|near-me|offices?)(\/|$)/.test(trimmed)) return "location";
  if (/\s(vs\.?|versus)\s/.test(title) || /-vs-|comparison|compare/.test(trimmed)) return "comparison";
  if (/\/(guides?|how-to|tutorials?|learn)(\/|$)/.test(trimmed) || /\bguide\b/.test(title)) return "guide";
  if (/\/(resources?|library|downloads?|glossary)(\/|$)/.test(trimmed)) return "resource";
  if (/\/(lp|landing|offers?|promo|campaign)(\/|$)/.test(trimmed)) return "landing";
  if (/\/(login|signin|signup|register|cart|checkout|account|search|404|thank-you|thanks)(\/|$)/.test(trimmed)) return "utility";
  if (looksLikeArticle(x, i.frontmatter) && i.wordCount > 300) return "blog-article";
  if (i.wordCount >= 250) return "informational";
  return "other";
}

export const PAGE_IMPORTANCE: Record<PageType, number> = {
  home: 1,
  product: 0.8,
  service: 0.85,
  tool: 0.8,
  calculator: 0.8,
  category: 0.7,
  landing: 0.7,
  location: 0.65,
  comparison: 0.6,
  guide: 0.6,
  informational: 0.5,
  faq: 0.5,
  resource: 0.5,
  "blog-index": 0.5,
  "blog-article": 0.4,
  "blog-category": 0.3,
  about: 0.3,
  contact: 0.4,
  legal: 0.05,
  utility: 0.05,
  other: 0.2,
};

/** Page types that convert (targets for blog -> site links). */
export const COMMERCIAL_TYPES: PageType[] = ["product", "service", "tool", "calculator", "category", "landing", "location", "comparison"];

export function inferIntent(title: string, pageType?: PageType): SearchIntent {
  const f = intentFacets(title);
  if (pageType === "product" || pageType === "landing") return "transactional";
  if (/\b(buy|order|book|hire|near me|for sale|coupon|deal|quote)\b/i.test(title)) return "transactional";
  if (f.includes("compare") || f.includes("best")) return f.includes("howto") || f.includes("what") ? "mixed" : "commercial";
  if (f.includes("cost")) return "mixed";
  if (/\b(login|sign in|contact|hours|location of)\b/i.test(title)) return "navigational";
  return "informational";
}
