// SEO integration: the registry export the site's SEO system reads, FAQPage JSON-LD, and sitemap paths.
import { plainAnswer, mdLinks } from './text.mjs';

const abs = (cfg, path) => `${(cfg.site.url || '').replace(/\/$/, '')}${path}`;

export function categoryAnchor(id, cfg) {
  return `${cfg?.categoryAnchorPrefix ?? 'category-'}${id}`;
}

/** URLs that belong in the sitemap for the FAQ system. Individual questions are anchors on these pages, never separate URLs. */
export function faqSitemapPaths(cfg) {
  return [cfg.faqPage.path];
}

export function buildSeoRegistry({ cfg, registry, imported = [], organised, now = new Date() }) {
  const faqs = [...registry.items, ...imported].map((i) => ({
    id: i.id,
    question: i.question,
    answer: plainAnswer(i.answer, cfg.tokens),
    category: i.category ?? null,
    page: i.page,
    canonicalUrl: abs(cfg, i.page) + `#${i.anchor}`,
    anchor: i.anchor,
    aliases: i.aliases ?? [],
    contexts: i.contexts ?? [],
    relatedPages: i.relatedPages ?? [],
    relatedTools: i.relatedTools ?? [],
    internalLinks: mdLinks(i.answer),
    status: i.status,
    origin: i.origin,
    confidence: i.confidence,
    created: i.created ?? null,
    updated: i.updated ?? null,
  }));
  const categories = (organised?.categories ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    count: c.count,
    page: cfg.faqPage.path,
    anchor: categoryAnchor(c.id, cfg),
    canonicalUrl: abs(cfg, cfg.faqPage.path) + `#${categoryAnchor(c.id, cfg)}`,
  }));
  const pages = [{ kind: 'faq-hub', url: cfg.faqPage.path, canonicalUrl: abs(cfg, cfg.faqPage.path), title: cfg.faqPage.title, inSitemap: true }];
  const ctx = new Map();
  for (const f of faqs) if (f.status === 'ACTIVE') for (const c of f.contexts) ctx.set(c, (ctx.get(c) ?? 0) + 1);
  for (const [url, n] of [...ctx].sort((a, b) => a[0].localeCompare(b[0]))) pages.push({ kind: 'contextual', url, canonicalUrl: abs(cfg, url), faqCount: n, inSitemap: false });
  const counts = { total: faqs.length };
  for (const f of faqs) counts[f.status] = (counts[f.status] ?? 0) + 1;
  return { schema: 1, generated: now.toISOString().slice(0, 10), site: cfg.site, counts, pages, categories, faqs };
}

/** FAQPage JSON-LD built ONLY from the items passed in (the ones visible on the page). Returns null when the site's policy forbids it. */
export function faqPageJsonLd(items, cfg, { url } = {}) {
  if (!cfg.schema.faqPage || !items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    ...(url ? { url } : {}),
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: plainAnswer(i.answer, cfg.tokens) },
    })),
  };
}
