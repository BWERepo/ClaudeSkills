// Site configuration: everything site-specific lives in ONE JSON file (default faq/faq.config.json). The engine core never names a site.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export const DEFAULTS = {
  site: { name: '', url: '' },
  paths: {
    registry: 'faq/faq-registry.json', // the site's FAQ data (the one source of truth for owned FAQs)
    candidates: 'faq/candidates.json', // optional hand- or Claude-authored candidates with source quotes
    inventory: '.faq/inventory.json', // generated content inventory (git-ignored)
    proposal: '.faq/proposal.json', // generated proposal (git-ignored)
    proposalReport: '.faq/proposal.md',
    seoRegistry: 'seo/faq-registry.json', // generated export for the site's SEO system
  },
  adapters: [], // [{ type: 'json', path } | { type: 'html-dir', dir, baseUrl }]
  generators: ['headings'], // 'headings' = question headings found in pages. Authored candidates are always read.
  faqPage: { path: '/faq', title: 'Frequently asked questions', description: '' },
  /** Pages whose own question list the engine imports (read-only) as contextual FAQs. */
  importPageFaqs: true,
  /** Show imported page FAQs on the hub as a collapsed, searchable index of links (no answers are duplicated). */
  linkIndex: { enabled: false, title: 'Questions about specific pages', id: 'page-questions', other: 'Other pages' },
  categories: [], // [{ id, title, description?, keywords: [], pages: [prefix], order? }]
  fallbackCategory: { id: 'general', title: 'General questions' },
  minCategorySize: 2, // a smaller category is folded into the fallback instead of shown nearly empty
  categoryAnchorPrefix: 'category-', // '' keeps legacy #privacy-style category anchors
  collapseCategories: true, // categories ALWAYS render collapsed; kept as a setting so the test can assert it
  searchThreshold: 25, // FAQ search is added only when the visible collection reaches this size
  categoryThreshold: 6, // below this many items a flat list is used (no category sections)
  synonyms: [], // [['cost','price',...]]
  exclusions: { pages: [], questions: [] }, // page url prefixes and question regexes never turned into FAQs
  linkTargets: { exclude: [], aliases: {} }, // aliases: { '/url': ['other name'] }
  linkPolicy: { maxPerAnswer: 2, auto: false },
  dedupe: { questionThreshold: 0.72, answerThreshold: 0.85, ignoreTerms: [] }, // ignoreTerms: words that say nothing about meaning on this site (its name is ignored automatically)
  grounding: { activate: ['CONFIRMED', 'DERIVED'], requireVerifiedQuote: true, minOverlap: 0.6 },
  schema: { faqPage: true }, // false when the site's own policy forbids FAQ markup
  tokens: {}, // {{token}} placeholders usable in answers, e.g. { contact: 'the contact page' }
  externalHosts: [], // hosts allowed in answer links
  knownPaths: [], // extra paths that exist but are not in the inventory (e.g. '/#find')
};

function merge(base, over) {
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || base === null || typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

export function loadConfig(file = 'faq/faq.config.json', cwd = process.cwd()) {
  const abs = resolve(cwd, file);
  if (!existsSync(abs)) throw new Error(`FAQ config not found: ${abs}`);
  const user = JSON.parse(readFileSync(abs, 'utf8'));
  const cfg = merge(DEFAULTS, user);
  cfg.root = cwd;
  cfg.configDir = dirname(abs);
  return cfg;
}

export const fromRoot = (cfg, p) => resolve(cfg.root, p);
