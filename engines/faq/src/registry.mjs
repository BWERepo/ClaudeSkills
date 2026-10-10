// The FAQ registry: the single source of truth for FAQs a site OWNS, plus the rules that keep it stable across reruns.
//
//   statuses   ACTIVE (published) | DRAFT | NEEDS REVIEW | RETIRED
//   ids        assigned once from the question and never changed; renamed questions keep their id and old anchors stay as aliases
//   manual     an answer edited by hand after generation is never overwritten; it is only flagged when its source evidence disappears
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha, slugify, plainAnswer } from './text.mjs';
import { fromRoot } from './config.mjs';
import { groundItem } from './grounding.mjs';
import { checkLinks } from './links.mjs';

export const STATUSES = ['ACTIVE', 'DRAFT', 'NEEDS REVIEW', 'RETIRED'];
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export function emptyRegistry() {
  return { schema: 1, categories: [], items: [] };
}

export function loadRegistry(cfg) {
  const file = fromRoot(cfg, cfg.paths.registry);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : emptyRegistry();
}

export function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function saveRegistry(cfg, reg) {
  reg.items.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.id.localeCompare(b.id));
  writeJson(fromRoot(cfg, cfg.paths.registry), reg);
}

export function uniqueId(question, taken) {
  const base = slugify(question.replace(/\?+$/, '')) || 'question';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function newItem(c, ctx) {
  const id = c.id ?? uniqueId(c.question, ctx.taken);
  ctx.taken.add(id);
  const now = today(ctx.now);
  return {
    id,
    anchor: c.anchor ?? id,
    aliases: [],
    question: c.question,
    answer: c.answer,
    category: c.category,
    status: c.status ?? 'DRAFT',
    origin: c.origin ?? 'generated',
    confidence: c.confidence ?? 'UNKNOWN',
    page: c.page ?? ctx.cfg.faqPage.path,
    contexts: c.contexts ?? [],
    relatedPages: c.relatedPages ?? [],
    relatedTools: c.relatedTools ?? [],
    keywords: c.keywords ?? [],
    sources: (c.sources ?? []).map(({ url, quote, hash, verified }) => ({ url, quote, ...(hash ? { hash } : {}), ...(verified !== undefined ? { verified } : {}) })),
    reviewReason: c.reviewReason ?? null,
    manualEdit: false,
    answerHash: sha(c.answer),
    created: now,
    updated: now,
  };
}

/** Which of an item's fields count as "a human changed this"? Only the answer text; questions keep their id regardless. */
export const isManuallyEdited = (item) => sha(item.answer) !== item.answerHash;

/**
 * Update mode for items already in the registry. Re-checks every owned item against the current inventory.
 * Never rewrites answers. Returns { items (updated copies), changes:[{id,kind,detail}] }.
 */
export function reviewRegistry(reg, pages, urls, cfg, now = new Date()) {
  const changes = [];
  const items = reg.items.map((orig) => {
    const item = structuredClone(orig);
    if (item.status === 'RETIRED') return item;
    const edited = item.origin !== 'manual' && isManuallyEdited(item); // origin "manual" is hand-written by definition: always preserved
    if (item.origin === 'manual') item.manualEdit = true;
    if (edited && !item.manualEdit) {
      item.manualEdit = true;
      changes.push({ id: item.id, kind: 'manual-edit-detected', detail: 'answer differs from the generated text; it will be preserved' });
    }
    const flag = (reason, kind) => {
      if (item.status === 'ACTIVE') item.status = 'NEEDS REVIEW';
      item.reviewReason = reason;
      item.updated = today(now);
      changes.push({ id: item.id, kind, detail: reason });
    };
    const linkProblems = checkLinks(item.answer, urls, cfg);
    if (item.sources.length) {
      const g = groundItem(item, pages, cfg);
      const gone = g.sources.filter((s) => s.missing).map((s) => s.url);
      if (gone.length) flag(`source page removed or moved: ${gone.join(', ')}`, 'source-removed');
      else if (g.sources.some((s) => !s.verified)) flag(`supporting text changed or removed: ${g.problems[0]}`, 'source-changed');
      else if (g.confidence === 'UNKNOWN' && !item.manualEdit) flag(`answer no longer supported: ${g.problems.join('; ')}`, 'unsupported');
      else {
        for (const s of item.sources) {
          const now_ = g.sources.find((x) => x.url === s.url);
          if (now_?.hash && s.hash && now_.hash !== s.hash) changes.push({ id: item.id, kind: 'source-edited-quote-intact', detail: `${s.url} changed but the cited text is still present` });
          if (now_?.hash) s.hash = now_.hash;
        }
        item.confidence = g.confidence === 'UNKNOWN' ? item.confidence : g.confidence;
      }
    } else if (item.origin !== 'manual') {
      flag('no cited source', 'no-source');
    }
    if (linkProblems.length) flag(linkProblems.join('; '), 'broken-link');
    return item;
  });
  return { items, changes };
}

export const visibleItems = (reg) => reg.items.filter((i) => i.status === 'ACTIVE');
export const answerText = (item, cfg) => plainAnswer(item.answer, cfg.tokens);
