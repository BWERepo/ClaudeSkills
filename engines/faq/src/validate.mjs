// Validation: everything that must be true before FAQ content ships. Errors fail the build; warnings go to the human reviewer.
import { STATUSES } from './registry.mjs';
import { firstSentence, plainAnswer } from './text.mjs';
import { checkLinks } from './links.mjs';
import { duplicateGroups } from './dedupe.mjs';
import { faqPageJsonLd } from './seo.mjs';
import { renderFaq, buildLinkIndex } from './render.mjs';
import { organise } from './categorize.mjs';
import { groundItem } from './grounding.mjs';

const ANCHOR = /^[a-z0-9][a-z0-9-]*$/;

/** <details> tags that carry the boolean `open` attribute (attribute VALUES are ignored: a question may contain the word "open"). */
export function openDetails(html) {
  return [...html.matchAll(/<details\b([^>]*)>/g)].filter((m) => /\sopen(\s|=|$)/.test(' ' + m[1].replace(/"[^"]*"/g, '""')));
}

export function validate({ cfg, registry, imported = [], inventory = null, now = new Date() }) {
  const errors = [];
  const warnings = [];
  const err = (id, msg) => errors.push({ id, msg });
  const warn = (id, msg) => warnings.push({ id, msg });
  const pages = inventory ? new Map(inventory.pages.map((p) => [p.url, p])) : null;
  const urls = inventory ? new Set([...inventory.pages.map((p) => p.url), cfg.faqPage.path]) : null;

  if (cfg.collapseCategories !== true) err('config', 'collapseCategories must stay true: categories must default to collapsed');

  const ids = new Set();
  const anchorsByPage = new Map();
  for (const i of [...registry.items, ...imported]) {
    if (ids.has(i.id)) err(i.id, 'duplicate id');
    ids.add(i.id);
    if (!STATUSES.includes(i.status)) err(i.id, `unknown status ${i.status}`);
    const set = anchorsByPage.get(i.page) ?? anchorsByPage.set(i.page, new Set()).get(i.page);
    for (const a of [i.anchor, ...(i.aliases ?? [])]) {
      if (!ANCHOR.test(a)) err(i.id, `anchor "${a}" is not a stable slug`);
      if (set.has(a)) err(i.id, `anchor "${a}" is used twice on ${i.page}`);
      set.add(a);
    }
  }

  for (const i of registry.items) {
    if (i.status === 'RETIRED') continue;
    if (!/\?$/.test(i.question)) warn(i.id, 'question should read as a question and end with "?"');
    if (i.question.length > 140) warn(i.id, 'question is long; keep it to what a visitor would type');
    if (!i.answer?.trim()) { err(i.id, 'empty answer'); continue; }
    const text = plainAnswer(i.answer, cfg.tokens);
    if (firstSentence(text).length > 260) warn(i.id, 'first sentence is long: the direct answer should come first and be short');
    if (text.split(/\s+/).length > 160) warn(i.id, 'answer is long (>160 words): consider linking to a deeper page');
    if (urls) for (const p of checkLinks(i.answer, urls, cfg)) (i.status === 'ACTIVE' ? err : warn)(i.id, p);
    if (i.status === 'ACTIVE') {
      if (i.confidence === 'UNKNOWN') err(i.id, 'ACTIVE answers must not be UNKNOWN: unsupported content cannot be published as fact');
      if (!i.sources?.length && i.origin !== 'manual') err(i.id, 'ACTIVE answer has no cited source');
      if (pages && i.sources?.length) {
        const g = groundItem(i, pages, cfg);
        if (g.sources.some((s) => !s.verified)) err(i.id, `source evidence missing: ${g.problems[0]}`);
      }
      if (!i.category) err(i.id, 'no category');
    }
    if (i.status === 'NEEDS REVIEW' && !i.reviewReason) warn(i.id, 'NEEDS REVIEW without a reason');
  }

  const active = registry.items.filter((i) => i.status === 'ACTIVE');
  for (const g of duplicateGroups(active, cfg)) err(g[0].id, `semantic duplicates among ACTIVE FAQs: ${g.map((x) => x.id).join(', ')}`);

  const organised = organise(active, cfg);
  for (const c of organised.categories) if (c.count < cfg.minCategorySize && c.id !== cfg.fallbackCategory.id) warn(c.id, `category "${c.title}" has ${c.count} item(s)`);

  // Rendered-page checks (defaults, search threshold, schema parity).
  const linkIndex = cfg.linkIndex.enabled ? buildLinkIndex(imported, cfg, cfg.linkIndex) : null;
  const html = renderFaq({ items: active, organised, cfg, linkIndex });
  const ids2 = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const d of new Set(ids2.filter((x, n) => ids2.indexOf(x) !== n))) err('render', `id "${d}" appears twice on the FAQ page`);
  for (const m of openDetails(html)) err('render', `${/faq-category/.test(m[1]) ? 'a category' : 'a question'} renders open by default: categories and questions must start collapsed`);
  const searchShown = html.includes('data-faq-search-input');
  const total = active.length + (linkIndex?.count ?? 0);
  if (searchShown && total < cfg.searchThreshold) err('render', 'search shown below the threshold');
  if (!searchShown && total >= cfg.searchThreshold) err('render', 'search missing above the threshold');
  const ld = faqPageJsonLd(active, cfg);
  if (ld) {
    const visible = (html.match(/<details class="faq-item"/g) ?? []).length;
    if (ld.mainEntity.length !== visible) err('schema', `FAQPage lists ${ld.mainEntity.length} questions but ${visible} are visible`);
  }
  return {
    errors,
    warnings,
    stats: {
      owned: registry.items.length,
      imported: imported.length,
      active: active.length,
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, registry.items.filter((i) => i.status === s).length])),
      categories: organised.categories,
      showCategories: organised.showCategories,
      search: searchShown,
      linkIndex: linkIndex?.count ?? 0,
      schema: ld ? ld.mainEntity.length : 'disabled by site policy',
    },
  };
}
