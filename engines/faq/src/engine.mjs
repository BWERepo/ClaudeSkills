// Orchestration: the workflow stages, each callable on its own and from the CLI.
import { existsSync, readFileSync } from 'node:fs';
import { fromRoot } from './config.mjs';
import { buildInventory } from './inventory.mjs';
import { propose, importedPageFaqs } from './propose.mjs';
import { loadRegistry, saveRegistry, newItem, visibleItems, writeJson, today } from './registry.mjs';
import { applyLinks } from './links.mjs';
import { assignCategory, organise } from './categorize.mjs';
import { buildSeoRegistry, faqPageJsonLd } from './seo.mjs';
import { buildLinkIndex } from './render.mjs';

export function loadInventory(cfg) {
  const file = fromRoot(cfg, cfg.paths.inventory);
  if (!existsSync(file)) throw new Error(`No inventory at ${file}. Run: faq-engine scan`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function scan(cfg) {
  const inv = buildInventory(cfg);
  writeJson(fromRoot(cfg, cfg.paths.inventory), inv);
  return inv;
}

/** Apply a proposal to the registry. Existing answers are never overwritten; flags from update mode are applied. */
export function applyProposal(cfg, registry, proposal, { draftsOnly = false, now = new Date() } = {}) {
  const taken = new Set(registry.items.map((i) => i.id));
  const updated = proposal.review ? { ...registry, items: proposal.review.items } : { ...registry };
  const linkFor = new Map(proposal.linkProposals.map((l) => [l.id, l.links]));
  const added = [];
  for (const c of proposal.adds) {
    if (taken.has(c.id)) continue;
    const answer = cfg.linkPolicy.auto && linkFor.has(c.id) ? applyLinks(c.answer, linkFor.get(c.id)) : c.answer;
    const item = newItem({ ...c, answer, status: draftsOnly ? 'DRAFT' : c.proposedStatus, category: c.category }, { taken, cfg, now });
    updated.items.push(item);
    added.push(item);
  }
  return { registry: updated, added };
}

export function organiseRegistry(cfg, registry) {
  const items = visibleItems(registry).map((i) => ({ ...i, category: i.categoryLocked ? i.category : i.category ?? assignCategory(i, cfg) }));
  return { items, organised: organise(items, cfg) };
}

export function buildAll(cfg, registry, inventory, now = new Date()) {
  const imported = inventory ? importedPageFaqs(inventory, cfg) : [];
  const { items, organised } = organiseRegistry(cfg, registry);
  const seo = buildSeoRegistry({ cfg, registry, imported, organised, now });
  const linkIndex = cfg.linkIndex.enabled ? buildLinkIndex(imported, cfg, cfg.linkIndex) : null;
  return { items, organised, imported, seo, linkIndex, jsonLd: faqPageJsonLd(items, cfg, { url: `${(cfg.site.url || '').replace(/\/$/, '')}${cfg.faqPage.path}` }) };
}

export { propose, loadRegistry, saveRegistry, writeJson, today };
