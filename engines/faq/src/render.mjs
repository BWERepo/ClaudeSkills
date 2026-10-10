// Framework-neutral renderer: returns an HTML string for the FAQ area. Native <details>/<summary> give correct expand/collapse
// semantics, keyboard behaviour and screen-reader state with no JavaScript, so the content works for crawlers and without scripts.
// client/faq-client.js only adds search, deep-link opening and the live result count.
import { escapeHtml as esc, plainAnswer, normalize, slugify, BASE_SYNONYMS } from './text.mjs';
import { categoryAnchor } from './seo.mjs';

const attr = (s) => esc(s);

export function renderAnswerHtml(answer, cfg, tokenHtml = {}) {
  return String(answer)
    .split(/\n{2,}/)
    .map((para) => {
      let out = '';
      let last = 0;
      const re = /\[([^\]]+)\]\(([^)]+)\)|\{\{(\w+)\}\}/g;
      let m;
      while ((m = re.exec(para))) {
        out += esc(para.slice(last, m.index));
        if (m[1]) out += `<a href="${attr(m[2])}">${esc(m[1])}</a>`;
        else out += tokenHtml[m[3]] ?? esc(cfg.tokens[m[3]] ?? '');
        last = m.index + m[0].length;
      }
      return `<p>${out + esc(para.slice(last))}</p>`;
    })
    .join('');
}

/** Lowercase search text: question, answer, category, keywords, plus synonym expansions so "price" finds "cost". */
export function searchText(item, categoryTitle, cfg) {
  const base = normalize([item.question, plainAnswer(item.answer, cfg.tokens), categoryTitle, ...(item.keywords ?? [])].join(' '));
  const words = new Set(base.split(' '));
  const extra = [];
  for (const g of [...BASE_SYNONYMS, ...cfg.synonyms]) {
    const norm = g.map(normalize);
    if (norm.some((w) => words.has(w))) extra.push(...norm);
  }
  return [...new Set([...base.split(' '), ...extra])].join(' ');
}

function renderItem(item, level, ctx) {
  const aliases = (item.aliases ?? []).length ? ` data-faq-aliases="${attr(item.aliases.join(' '))}"` : '';
  const cat = ctx.titleOf(item);
  return (
    `<details class="faq-item" id="${attr(item.anchor)}" data-faq-item${aliases} data-search="${attr(searchText(item, cat, ctx.cfg))}">` +
    `<summary><h${level} class="faq-q">${esc(item.question)}</h${level}></summary>` +
    `<div class="faq-a">${renderAnswerHtml(item.answer, ctx.cfg, ctx.tokenHtml)}` +
    `<p class="faq-permalink"><a href="#${attr(item.anchor)}" aria-label="Link to this question: ${attr(item.question)}">Link to this question</a></p></div>` +
    `</details>`
  );
}

const cleanFrom = (s) => String(s ?? '').split(/\s[|\u2013\u2014]\s|:\s/)[0];

/** Group imported page FAQs (questions that live on other pages) for the link index: { title, groups:[{title, rows:[{question, href, from, search}]}] }. */
export function buildLinkIndex(imported, cfg, { title = 'Questions about specific pages', id = 'page-questions', other = 'Other pages' } = {}) {
  const groups = new Map();
  for (const i of imported.filter((x) => x.status === 'ACTIVE')) {
    const g = i.category ?? other;
    (groups.get(g) ?? groups.set(g, []).get(g)).push({
      id: `${i.id}`,
      question: i.question,
      href: `${i.page}#${i.anchor}`,
      from: cleanFrom(i.pageTitle),
      search: [i.question, cleanFrom(i.pageTitle), i.category ?? '', plainAnswer(i.answer, cfg.tokens).split(/(?<=[.!?])\s/)[0] ?? ''].join(' '),
    });
  }
  const list = [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([t, rows]) => ({ title: t, rows }));
  return { title, id, groups: list, count: list.reduce((n, g) => n + g.rows.length, 0) };
}

function renderLinkIndex(index, level, ctx) {
  const groups = index.groups
    .map((g) => {
      const rows = g.rows
        .map((r) => `<li class="faq-item faq-link" id="${attr(r.id)}" data-faq-item data-search="${attr(searchText({ question: r.search, answer: '' }, g.title, ctx.cfg))}"><a href="${attr(r.href)}">${esc(r.question)}</a> <span class="faq-from">${esc(r.from)}</span></li>`)
        .join('');
      return `<details class="faq-category faq-subcategory" id="${attr(index.id)}-${attr(slugify(g.title))}" data-faq-category><summary><h${level + 1} class="faq-cat-title">${esc(g.title)} <span class="faq-count">(${g.rows.length})</span></h${level + 1}></summary><ul class="faq-cat-body faq-links">${rows}</ul></details>`;
    })
    .join('');
  return (
    `<details class="faq-category" id="${attr(index.id)}" data-faq-category>` +
    `<summary><h${level} class="faq-cat-title">${esc(index.title)} <span class="faq-count">(${index.count})</span></h${level}></summary>` +
    `<div class="faq-cat-body"><p class="faq-cat-desc">Each page has its own questions. Choose one to go to its answer.</p>${groups}</div></details>`
  );
}

/**
 * options: { items (ACTIVE only), organised ({categories, showCategories, assignment}), search (force true/false), tokenHtml, idPrefix, headingLevel }
 * Categories ALWAYS render closed (no `open` attribute). Questions render closed too.
 */
/** @param {{ items: any[], organised: any, cfg: any, search?: boolean | null, tokenHtml?: Record<string, string>, idPrefix?: string, headingLevel?: number, linkIndex?: any }} opts */
export function renderFaq({ items, organised, cfg, search = null, tokenHtml = {}, idPrefix = 'faq', headingLevel = 2, linkIndex = null }) {
  const total = items.length + (linkIndex?.count ?? 0);
  const showSearch = search ?? (total >= cfg.searchThreshold);
  const titles = new Map((organised?.categories ?? []).map((c) => [c.id, c.title]));
  const ctx = { cfg, tokenHtml, titleOf: (i) => titles.get(organised?.assignment?.get(i.id) ?? i.category) ?? '' };
  const parts = [`<div class="faq-engine" data-faq-root data-faq-search="${showSearch}">`];
  if (showSearch) {
    parts.push(
      `<div class="faq-search" role="search"><label for="${idPrefix}-search" class="faq-search-label">Search FAQs</label>` +
        `<input id="${idPrefix}-search" class="faq-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search questions and answers" data-faq-search-input>` +
        `<p class="faq-status" role="status" aria-live="polite" data-faq-status></p></div>`,
    );
  }
  parts.push(`<p class="faq-empty" data-faq-empty hidden>No matching questions found.</p>`);
  if (organised?.showCategories) {
    for (const c of organised.categories) {
      const inCat = items.filter((i) => organised.assignment.get(i.id) === c.id);
      parts.push(
        `<details class="faq-category" id="${categoryAnchor(c.id, cfg)}" data-faq-category>` +
          `<summary><h${headingLevel} class="faq-cat-title">${esc(c.title)} <span class="faq-count">(${inCat.length})</span></h${headingLevel}></summary>` +
          `<div class="faq-cat-body">${c.description ? `<p class="faq-cat-desc">${esc(c.description)}</p>` : ''}` +
          inCat.map((i) => renderItem(i, headingLevel + 1, ctx)).join('') +
          `</div></details>`,
      );
    }
  } else {
    parts.push(`<div class="faq-flat">${items.map((i) => renderItem(i, headingLevel, ctx)).join('')}</div>`);
  }
  if (linkIndex?.count) parts.push(renderLinkIndex(linkIndex, headingLevel, ctx));
  parts.push('</div>');
  return parts.join('');
}
