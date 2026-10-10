// Categorisation: categories come from site config (derived from the site's real structure), never from a fixed taxonomy.
import { tokens, buildSynonymMap, plainAnswer } from './text.mjs';

export function assignCategory(item, cfg) {
  if (item.categoryLocked && item.category) return item.category;
  const known = new Set(cfg.categories.map((c) => c.id));
  if (item.categoryHint && known.has(item.categoryHint)) return item.categoryHint;
  const syn = buildSynonymMap(cfg.synonyms);
  const bag = new Set(tokens(`${item.question} ${plainAnswer(item.answer ?? '', cfg.tokens)}`, syn));
  const pages = [...(item.sources ?? []).map((s) => s.url), ...(item.relatedPages ?? [])];
  let best = null;
  for (const c of cfg.categories) {
    let score = 0;
    for (const k of c.keywords ?? []) {
      const kt = tokens(k, syn);
      if (kt.length && kt.every((t) => bag.has(t))) score += kt.length;
    }
    for (const p of c.pages ?? []) if (pages.some((u) => u === p || u.startsWith(p.endsWith('/') ? p : p + '/'))) score += 2;
    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id ?? cfg.fallbackCategory.id;
}

/**
 * Fold nearly-empty categories into the fallback and decide whether category sections are shown at all.
 * `items` are the ones that will be visible (ACTIVE). Returns { categories:[{id,title,description,count}], showCategories, moved:[{id,from,to}] }.
 */
export function organise(items, cfg) {
  const def = new Map(cfg.categories.map((c) => [c.id, c]));
  def.set(cfg.fallbackCategory.id, { ...cfg.fallbackCategory, ...(def.get(cfg.fallbackCategory.id) ?? {}) });
  const counts = new Map();
  for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  const moved = [];
  const final = new Map();
  for (const i of items) {
    let cat = i.category;
    const keep = def.get(cat)?.keep === true;
    if (cat !== cfg.fallbackCategory.id && !keep && (counts.get(cat) ?? 0) < cfg.minCategorySize) {
      moved.push({ id: i.id, from: cat, to: cfg.fallbackCategory.id });
      cat = cfg.fallbackCategory.id;
    }
    final.set(i.id, cat);
  }
  const used = new Map();
  for (const cat of final.values()) used.set(cat, (used.get(cat) ?? 0) + 1);
  const order = (c) => def.get(c)?.order ?? (c === cfg.fallbackCategory.id ? 999 : 100 + [...def.keys()].indexOf(c));
  const categories = [...used.keys()]
    .sort((a, b) => order(a) - order(b))
    .map((id) => ({ id, title: def.get(id)?.title ?? id, description: def.get(id)?.description ?? '', count: used.get(id) }));
  const showCategories = categories.length > 1 && items.length >= cfg.categoryThreshold;
  return { categories, showCategories, moved, assignment: final };
}
