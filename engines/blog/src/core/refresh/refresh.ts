import type { SimilarityIndex } from "../analyzer/similarity.js";
import { COMMERCIAL_TYPES } from "../inventory/classify.js";
import type { BlogArticle, BrokenLink, SitePage } from "../types.js";
import { daysBetween } from "../util/time.js";
import { urlKey } from "../util/url.js";

export interface RefreshInput {
  articles: BlogArticle[];
  pages: SitePage[];
  previousPages: SitePage[];
  broken: BrokenLink[];
  sim: SimilarityIndex;
  now: string;
  reviewIntervalDays: number;
  /** Plain text of each article (for date references). */
  text: Map<string, string>;
}

/**
 * Flags articles that may need a refresh, with the reasons. Flags only: content is never rewritten
 * automatically because it is old.
 */
export function evaluateRefresh(i: RefreshInput): BlogArticle[] {
  const prevHash = new Map(i.previousPages.map((p) => [urlKey(p.url), p.contentHash]));
  const prevKeys = new Set(i.previousPages.map((p) => urlKey(p.url)));
  const curByKey = new Map(i.pages.map((p) => [urlKey(p.url), p]));
  const newCommercial = i.pages.filter((p) => p.indexable && COMMERCIAL_TYPES.includes(p.pageType) && i.previousPages.length > 0 && !prevKeys.has(urlKey(p.url)));
  const brokenFrom = new Map<string, number>();
  for (const b of i.broken) brokenFrom.set(urlKey(b.fromUrl), (brokenFrom.get(urlKey(b.fromUrl)) ?? 0) + 1);
  const year = Number(i.now.slice(0, 4));

  return i.articles.map((a) => {
    if (a.status !== "published") return a;
    const reasons: string[] = [];
    for (const u of [...new Set([...a.relatedSitePages, ...a.internalLinksOut])]) {
      const k = urlKey(u);
      const cur = curByKey.get(k);
      if (cur && prevHash.has(k) && prevHash.get(k) !== cur.contentHash && !cur.isBlogArticle) reasons.push(`linked page changed: ${cur.path}`);
    }
    const broken = brokenFrom.get(urlKey(a.url));
    if (broken) reasons.push(`${broken} broken internal link(s)`);
    const text = `${a.title} ${i.text.get(a.id) ?? ""}`;
    const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y <= year);
    if (years.length && Math.max(...years) <= year - 2 && /\b(in|for|as of|updated|current|latest)\s+20\d{2}\b/i.test(text)) reasons.push(`refers to ${Math.max(...years)} as current`);
    for (const p of newCommercial) {
      if (a.internalLinksOut.some((h) => urlKey(h) === urlKey(p.url))) continue;
      if (i.sim.similarity(`art:${urlKey(a.url)}`, `page:${urlKey(p.url)}`) >= 0.3) reasons.push(`new related page to link: ${p.path}`);
    }
    const reviewed = a.lastReviewedAt ?? a.modifiedAt ?? a.publishedAt;
    if (reviewed && daysBetween(reviewed, i.now) > i.reviewIntervalDays) reasons.push(`not reviewed in ${Math.floor(daysBetween(reviewed, i.now))} days`);
    return { ...a, refreshRecommended: reasons.length > 0, refreshReason: reasons };
  });
}
