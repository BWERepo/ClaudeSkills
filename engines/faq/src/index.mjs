// Public API of the FAQ Engine core.
export { loadConfig, DEFAULTS } from './config.mjs';
export { buildInventory, parseHtml, finalizePage } from './inventory.mjs';
export { propose, anchorsFor, importedPageFaqs, headingCandidates, proposalMarkdown } from './propose.mjs';
export { groundItem, quoteInPage } from './grounding.mjs';
export { findMatch, duplicateGroups, isDuplicate } from './dedupe.mjs';
export { assignCategory, organise } from './categorize.mjs';
export { buildLinkTargets, proposeLinks, applyLinks, checkLinks } from './links.mjs';
export { loadRegistry, saveRegistry, newItem, reviewRegistry, visibleItems, STATUSES } from './registry.mjs';
export { buildSeoRegistry, faqPageJsonLd, faqSitemapPaths, categoryAnchor } from './seo.mjs';
export { renderFaq, renderAnswerHtml, searchText, buildLinkIndex } from './render.mjs';
export { validate, openDetails } from './validate.mjs';
export { scan, applyProposal, buildAll, organiseRegistry } from './engine.mjs';
export { slugify, plainAnswer } from './text.mjs';
