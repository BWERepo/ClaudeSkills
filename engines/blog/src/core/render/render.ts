import type { BlogEngineConfig } from "../../config/config.js";
import type { HostTemplate } from "../../adapters/host-site/types.js";
import { escapeAttr, escapeHtml } from "../html/dom.js";
import { articleCrumbs, articleSchema, breadcrumbSchema, jsonLdScript, type Crumb } from "../seo/schema-org.js";
import type { BlogArticle } from "../types.js";
import { absoluteUrl, joinRoute } from "../util/url.js";
import { slugify } from "../util/slug.js";

export interface RenderContext {
  config: BlogEngineConfig;
  siteName: string;
  blogTitle: string;
  template?: HostTemplate;
  lang?: string;
}

/**
 * Minimal, scoped CSS. The host's own stylesheet supplies typography, colours and spacing; this only keeps
 * engine markup responsive (images and tables never overflow small screens).
 */
const SCOPED_CSS = `<style id="bwe-blog-css">.bwe-article,.bwe-listing{max-width:72ch;margin-inline:auto}.bwe-article img{max-width:100%;height:auto}.bwe-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}.bwe-table-wrap table{border-collapse:collapse;min-width:100%}.bwe-table-wrap th,.bwe-table-wrap td{padding:.5em .75em;border:1px solid currentColor;border-color:rgba(127,127,127,.35);text-align:left;vertical-align:top}.bwe-breadcrumbs ol{list-style:none;padding:0;margin:0 0 1em;display:flex;flex-wrap:wrap;gap:.35em}.bwe-breadcrumbs li+li::before{content:"\\203A";margin-right:.35em;opacity:.6}.bwe-meta{opacity:.75;font-size:.9em}.bwe-related ul,.bwe-listing ul{padding-left:1.1em}.bwe-listing li{margin-bottom:1.1em}.bwe-pagination{display:flex;gap:1em;justify-content:space-between;margin-top:2em}</style>`;

export function categoryPath(config: BlogEngineConfig, category: string): string {
  return joinRoute(config.blogPath, "category", slugify(category));
}

function headTags(o: { title: string; description: string; canonical: string; robots: string; ogType: string; image?: string; published?: string; modified?: string; jsonLd: Record<string, unknown>[]; siteName: string }): string {
  const t = [
    `<title>${escapeHtml(o.title)}</title>`,
    `<meta name="description" content="${escapeAttr(o.description)}">`,
    `<link rel="canonical" href="${escapeAttr(o.canonical)}">`,
    `<meta name="robots" content="${o.robots}">`,
    `<meta property="og:type" content="${o.ogType}">`,
    `<meta property="og:title" content="${escapeAttr(o.title)}">`,
    `<meta property="og:description" content="${escapeAttr(o.description)}">`,
    `<meta property="og:url" content="${escapeAttr(o.canonical)}">`,
    ...(o.siteName ? [`<meta property="og:site_name" content="${escapeAttr(o.siteName)}">`] : []),
    ...(o.image ? [`<meta property="og:image" content="${escapeAttr(o.image)}">`] : []),
    ...(o.published ? [`<meta property="article:published_time" content="${o.published}">`] : []),
    ...(o.modified ? [`<meta property="article:modified_time" content="${o.modified}">`] : []),
    ...o.jsonLd.map(jsonLdScript),
    SCOPED_CSS,
  ];
  return t.join("\n");
}

function wrap(ctx: RenderContext, head: string, main: string): string {
  if (ctx.template) {
    let html = ctx.template.html.replace("<!--BWE:HEAD-->", head).replace("<!--BWE:MAIN-->", main);
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) html = html.replace("</head>", `<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>`);
    return html;
  }
  return `<!doctype html>
<html lang="${escapeAttr(ctx.lang ?? ctx.config.generation.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;margin:0;padding:1.25rem;color:#1d1d1f;background:#fff}a{color:#0b5cad}</style>
</head>
<body>
<main>${main}</main>
</body>
</html>
`;
}

function breadcrumbsNav(crumbs: Crumb[]): string {
  return `<nav class="bwe-breadcrumbs" aria-label="Breadcrumb"><ol>${crumbs
    .map((c, i) => (i === crumbs.length - 1 ? `<li><span aria-current="page">${escapeHtml(c.name)}</span></li>` : `<li><a href="${escapeAttr(new URL(c.url).pathname)}">${escapeHtml(c.name)}</a></li>`))
    .join("")}</ol></nav>`;
}

/** Wrap tables so they scroll horizontally on small screens instead of breaking the layout. */
export function responsiveBody(html: string): string {
  return html.replace(/<table>/g, '<div class="bwe-table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
}

function fmtDate(iso: string | undefined, lang: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function renderArticlePage(a: BlogArticle, bodyHtml: string, ctx: RenderContext, opts: { categoryUrl?: string; related: { url: string; title: string }[]; preview?: boolean }): string {
  const { config } = ctx;
  const crumbs = articleCrumbs(a, config, ctx.blogTitle, opts.categoryUrl);
  const jsonLd = config.enableSchema ? [articleSchema(a, config, ctx.siteName), ...(config.schema.breadcrumbs ? [breadcrumbSchema(crumbs)] : [])] : [];
  const head = headTags({
    title: `${a.title}${ctx.siteName ? ` | ${ctx.siteName}` : ""}`,
    description: a.description,
    canonical: a.canonicalUrl,
    robots: opts.preview || a.status !== "published" ? "noindex, nofollow" : "index, follow",
    ogType: "article",
    ...(a.image ? { image: a.image } : {}),
    ...(a.publishedAt ? { published: a.publishedAt } : {}),
    ...((a.modifiedAt ?? a.lastModifiedAt) ? { modified: a.modifiedAt ?? a.lastModifiedAt } : {}),
    jsonLd,
    siteName: ctx.siteName,
  });
  const lang = ctx.lang ?? config.generation.language;
  const meta = [a.publishedAt ? `<time datetime="${a.publishedAt}">${fmtDate(a.publishedAt, lang)}</time>` : "", a.author ? `<span>${escapeHtml(a.author)}</span>` : ""].filter(Boolean).join(" · ");
  const related = opts.related.length
    ? `<aside class="bwe-related" aria-labelledby="bwe-related-h"><h2 id="bwe-related-h">Related articles</h2><ul>${opts.related.map((r) => `<li><a href="${escapeAttr(new URL(r.url).pathname)}">${escapeHtml(r.title)}</a></li>`).join("")}</ul></aside>`
    : "";
  const main = `<article class="bwe-article" data-bwe-article="${escapeAttr(a.id)}">${config.schema.breadcrumbs ? breadcrumbsNav(crumbs) : ""}<header><h1>${escapeHtml(a.title)}</h1>${meta ? `<p class="bwe-meta">${meta}</p>` : ""}</header>${responsiveBody(bodyHtml)}${related}</article>`;
  return wrap(ctx, head, main);
}

export const PAGE_SIZE = 12;

export function renderListingPage(
  ctx: RenderContext,
  o: { title: string; intro: string; path: string; articles: BlogArticle[]; page: number; totalPages: number; crumbs: Crumb[]; categories?: { name: string; url: string; count: number }[] },
): string {
  const { config } = ctx;
  const canonical = absoluteUrl(config.siteUrl, o.page > 1 ? joinRoute(o.path, "page", String(o.page)) + "/" : `${o.path}/`.replace(/\/\/$/, "/"));
  const lang = ctx.lang ?? config.generation.language;
  const items = o.articles
    .map(
      (a) =>
        `<li><h2><a href="${escapeAttr(new URL(a.url).pathname)}">${escapeHtml(a.title)}</a></h2>${a.publishedAt ? `<p class="bwe-meta"><time datetime="${a.publishedAt}">${fmtDate(a.publishedAt, lang)}</time></p>` : ""}${a.description ? `<p>${escapeHtml(a.description)}</p>` : ""}</li>`,
    )
    .join("");
  const cats = o.categories?.length
    ? `<nav aria-label="Blog categories"><h2>Categories</h2><ul>${o.categories.map((c) => `<li><a href="${escapeAttr(new URL(c.url).pathname)}">${escapeHtml(c.name)}</a> (${c.count})</li>`).join("")}</ul></nav>`
    : "";
  const prev = o.page > 1 ? `<a rel="prev" href="${o.page === 2 ? `${o.path}/` : `${joinRoute(o.path, "page", String(o.page - 1))}/`}">Newer articles</a>` : "<span></span>";
  const next = o.page < o.totalPages ? `<a rel="next" href="${joinRoute(o.path, "page", String(o.page + 1))}/">Older articles</a>` : "<span></span>";
  const jsonLd = config.enableSchema && config.schema.breadcrumbs ? [breadcrumbSchema(o.crumbs)] : [];
  const head = headTags({ title: `${o.title}${o.page > 1 ? ` (page ${o.page})` : ""}${ctx.siteName ? ` | ${ctx.siteName}` : ""}`, description: o.intro.slice(0, 160), canonical, robots: "index, follow", ogType: "website", jsonLd, siteName: ctx.siteName });
  const main = `<section class="bwe-listing">${config.schema.breadcrumbs ? breadcrumbsNav(o.crumbs) : ""}<h1>${escapeHtml(o.title)}</h1><p>${escapeHtml(o.intro)}</p><ul>${items}</ul>${o.totalPages > 1 ? `<nav class="bwe-pagination" aria-label="Pagination">${prev}${next}</nav>` : ""}${cats}</section>`;
  return wrap(ctx, head, main);
}
