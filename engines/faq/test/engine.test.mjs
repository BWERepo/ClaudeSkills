import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/config.mjs';
import { finalizePage, parseHtml } from '../src/inventory.mjs';
import { groundItem } from '../src/grounding.mjs';
import { findMatch, duplicateGroups } from '../src/dedupe.mjs';
import { assignCategory, organise } from '../src/categorize.mjs';
import { buildLinkTargets, proposeLinks, applyLinks, checkLinks } from '../src/links.mjs';
import { propose, importedPageFaqs } from '../src/propose.mjs';
import { applyProposal, buildAll } from '../src/engine.mjs';
import { newItem, reviewRegistry, emptyRegistry } from '../src/registry.mjs';
import { renderFaq } from '../src/render.mjs';
import { validate, openDetails } from '../src/validate.mjs';
import { faqPageJsonLd } from '../src/seo.mjs';
import { slugify, sentences, numericFacts } from '../src/text.mjs';

const cfg = (over = {}) => ({
  ...structuredClone(DEFAULTS),
  site: { name: 'Demo', url: 'https://demo.test' },
  root: '.',
  categories: [
    { id: 'billing', title: 'Billing', keywords: ['price', 'invoice', 'refund'] },
    { id: 'shipping', title: 'Shipping', keywords: ['shipping', 'delivery'], pages: ['/shipping'] },
  ],
  ...over,
});

const pages = () => [
  finalizePage({ url: '/', title: 'Demo Shop', text: 'Welcome to Demo Shop.' }),
  finalizePage({ url: '/pricing', title: 'Pricing | Demo', description: 'Plans and prices.', text: 'The Basic plan costs $12 per month. Refunds are available within 30 days of purchase.', headings: [{ level: 1, text: 'Pricing' }] }),
  finalizePage({ url: '/shipping', title: 'Shipping and Delivery', text: 'Orders ship within 2 business days. Delivery takes 3 to 5 days inside the country.', headings: [{ level: 1, text: 'Shipping and Delivery' }] }),
  finalizePage({
    url: '/widget', title: 'Widget Calculator', type: 'tool', category: 'tools',
    text: 'Enter a size to get a price estimate.',
    faqs: [{ q: 'How do I use the widget calculator?', a: 'Enter a size and read the estimate.' }],
    sections: [{ heading: 'Can I use it offline?', level: 2, text: 'The widget calculator needs an internet connection to load. Once it has loaded, it keeps working.' }],
  }),
];
const inv = () => ({ pages: pages() });
const map = () => new Map(pages().map((p) => [p.url, p]));

test('text helpers', () => {
  assert.equal(slugify('How much does it cost?'), 'how-much-does-it-cost');
  assert.deepEqual(numericFacts('It costs $1,200.50 or 15%'), ['$1200.50', '15%']);
  assert.equal(sentences('See e.g. the page. It works.').length, 2);
});

test('html parser extracts headings, links, faqs and noindex', () => {
  const p = parseHtml('<html><head><title>T | S</title><meta name="description" content="D"><meta name="robots" content="noindex"></head><body><main><h1>Hi</h1><a href="/x">x</a><details><summary>Why?</summary><p>Because.</p></details></main></body></html>', '/t');
  assert.equal(p.title, 'T | S');
  assert.equal(p.indexable, false);
  assert.deepEqual(p.faqs, [{ q: 'Why?', a: 'Because.' }]);
  assert.deepEqual(p.links, ['/x']);
});

test('grounding: verified quote and supported numbers confirm; invented numbers do not', () => {
  const c = cfg();
  const ok = groundItem({ answer: 'The Basic plan costs $12 per month.', sources: [{ url: '/pricing', quote: 'The Basic plan costs $12 per month.' }] }, map(), c);
  assert.equal(ok.confidence, 'CONFIRMED');
  const bad = groundItem({ answer: 'The Basic plan costs $15 per month.', sources: [{ url: '/pricing', quote: 'The Basic plan costs $12 per month.' }] }, map(), c);
  assert.equal(bad.confidence, 'UNKNOWN');
  const fake = groundItem({ answer: 'Refunds take 90 days.', sources: [{ url: '/pricing', quote: 'Refunds are available for 90 days.' }] }, map(), c);
  assert.equal(fake.confidence, 'UNKNOWN');
  assert.ok(fake.problems.some((p) => p.includes('quote not found')));
});

test('duplicates are detected by meaning, not text', () => {
  const c = cfg();
  const a = { id: 'a', question: 'How much does it cost?', answer: 'It costs $12.' };
  assert.ok(findMatch({ question: 'What is the price?', answer: 'The price is $12.' }, [a], c));
  assert.ok(findMatch({ question: 'How much will I pay?', answer: 'You pay $12.' }, [a], c));
  assert.equal(findMatch({ question: 'Where do you ship?', answer: 'Inside the country.' }, [a], c), null);
  assert.equal(duplicateGroups([a, { id: 'b', question: 'What does it cost?', answer: 'It costs $12.' }, { id: 'c', question: 'Can I return an item?', answer: 'Yes.' }], c).length, 1);
});

test('categories: keyword and page rules; tiny categories fold into the fallback', () => {
  const c = cfg();
  assert.equal(assignCategory({ question: 'Can I get a refund?', answer: 'Yes.' }, c), 'billing');
  assert.equal(assignCategory({ question: 'Where is it?', answer: 'x', relatedPages: ['/shipping'] }, c), 'shipping');
  assert.equal(assignCategory({ question: 'Hello there', answer: 'x' }, c), 'general');
  const items = [
    ...[1, 2, 3].map((n) => ({ id: `b${n}`, category: 'billing' })),
    { id: 's1', category: 'shipping' },
    ...[1, 2].map((n) => ({ id: `g${n}`, category: 'general' })),
  ];
  const o = organise(items, c);
  assert.deepEqual(o.categories.map((x) => x.id), ['billing', 'general']);
  assert.equal(o.moved[0].id, 's1');
  assert.equal(o.showCategories, true);
  assert.equal(organise(items.slice(0, 3), c).showCategories, false); // too few: flat list
});

test('links: proposes a link to a page the answer names, never to itself, validates targets', () => {
  const c = cfg();
  const targets = buildLinkTargets(inv(), c);
  const item = { answer: 'See Shipping and Delivery for times.', contexts: [], page: '/faq' };
  const lp = proposeLinks(item, targets, c);
  assert.deepEqual(lp, [{ text: 'Shipping and Delivery', href: '/shipping' }]);
  assert.equal(applyLinks(item.answer, lp), 'See [Shipping and Delivery](/shipping) for times.');
  assert.equal(proposeLinks({ ...item, page: '/shipping' }, targets, c).length, 0);
  const urls = new Set(['/shipping']);
  assert.deepEqual(checkLinks('Go [here](/shipping) or [there](/nope).', urls, c), ['broken internal link: /nope']);
  assert.equal(checkLinks('[x](https://evil.test/)', urls, c).length, 1);
});

test('propose: authored candidate is grounded, duplicates merged, headings generate, imported page FAQs are not republished', () => {
  const c = cfg({ generators: ['headings'] });
  const registry = emptyRegistry();
  registry.items.push(newItem({ question: 'How much does it cost?', answer: 'The Basic plan costs $12 per month.', category: 'billing', status: 'ACTIVE', origin: 'manual' }, { taken: new Set(), cfg: c }));
  const authored = [
    { question: 'What is the price?', answer: 'The Basic plan costs $12 per month.', sources: [{ url: '/pricing', quote: 'The Basic plan costs $12 per month.' }] },
    { question: 'How fast is delivery?', answer: 'Delivery takes 3 to 5 days inside the country.', sources: [{ url: '/shipping', quote: 'Delivery takes 3 to 5 days inside the country.' }] },
    { question: 'Do you offer free gifts?', answer: 'Every order includes a free gift.', sources: [{ url: '/shipping', quote: 'Every order includes a free gift.' }] },
  ];
  const p = propose({ cfg: { ...c, paths: { ...c.paths, candidates: '/nonexistent.json' } }, inventory: inv(), registry, now: new Date('2026-01-01') });
  // authored file absent: only the heading candidate exists
  assert.equal(p.adds.length, 1);
  assert.equal(p.adds[0].question, 'Can I use it offline?');
  assert.equal(p.adds[0].proposedStatus, 'ACTIVE');
  assert.equal(importedPageFaqs(inv(), c).length, 1);
  // authored path, simulated by injecting through a temp file-less call
  const res = authored.map((a) => findMatch(a, registry.items, c));
  assert.ok(res[0] && !res[1] && !res[2]);
  assert.equal(groundItem(authored[2], map(), c).confidence, 'UNKNOWN');
});

test('registry: apply keeps ids stable, never overwrites; update mode flags lost evidence and preserves manual edits', () => {
  const c = cfg();
  const pm = map();
  const urls = new Set(pm.keys());
  const reg = emptyRegistry();
  const taken = new Set();
  const a = newItem({ question: 'How much is the Basic plan?', answer: 'The Basic plan costs $12 per month.', category: 'billing', status: 'ACTIVE', sources: [{ url: '/pricing', quote: 'The Basic plan costs $12 per month.' }], confidence: 'CONFIRMED' }, { taken, cfg: c });
  const b = newItem({ question: 'Can I get a refund?', answer: 'Refunds are available within 30 days of purchase.', category: 'billing', status: 'ACTIVE', sources: [{ url: '/pricing', quote: 'Refunds are available within 30 days of purchase.' }], confidence: 'DERIVED' }, { taken, cfg: c });
  reg.items.push(a, b);
  assert.equal(a.id, 'how-much-is-the-basic-plan');
  // site changes: price changes, refund text kept
  const changed = new Map(pm);
  changed.set('/pricing', finalizePage({ url: '/pricing', title: 'Pricing', text: 'The Basic plan costs $15 per month. Refunds are available within 30 days of purchase.' }));
  const r = reviewRegistry(reg, changed, urls, c);
  assert.equal(r.items.find((i) => i.id === a.id).status, 'NEEDS REVIEW');
  assert.equal(r.items.find((i) => i.id === b.id).status, 'ACTIVE');
  assert.ok(r.changes.some((x) => x.kind === 'source-changed'));
  // manual edit is detected and the answer text survives
  const edited = structuredClone(reg);
  edited.items[1].answer = 'Refunds are available within 30 days of purchase. Email us first.';
  const r2 = reviewRegistry(edited, pm, urls, c);
  assert.equal(r2.items[1].manualEdit, true);
  assert.equal(r2.items[1].answer, edited.items[1].answer);
  // removed page
  const gone = new Map(pm); gone.delete('/pricing');
  assert.ok(reviewRegistry(reg, gone, new Set(gone.keys()), c).changes.some((x) => x.kind === 'source-removed'));
  // retired items are left alone
  const ret = structuredClone(reg); ret.items[0].status = 'RETIRED';
  assert.equal(reviewRegistry(ret, changed, urls, c).items[0].status, 'RETIRED');
});

test('applyProposal adds without touching existing answers', () => {
  const c = cfg({ generators: ['headings'], paths: { ...cfg().paths, candidates: '/none' } });
  const reg = emptyRegistry();
  const p = propose({ cfg: c, inventory: inv(), registry: reg });
  const { registry, added } = applyProposal(c, reg, p);
  assert.equal(added.length, 1);
  const again = propose({ cfg: c, inventory: inv(), registry });
  assert.equal(again.adds.length, 0); // rerun does not regenerate
  assert.equal(again.merged.length, 1);
});

function activeRegistry(n, catCount) {
  const c = cfg({ searchThreshold: 25, categories: Array.from({ length: catCount }, (_, i) => ({ id: `c${i}`, title: `Category ${i}`, keywords: [`topic${i}`] })) });
  const reg = emptyRegistry();
  const taken = new Set();
  for (let i = 0; i < n; i++) {
    reg.items.push(newItem({ question: `What is thing number ${i} like in practice?`, answer: `Thing ${i} works fine.`, category: `c${i % catCount}`, status: 'ACTIVE', origin: 'manual', confidence: 'CONFIRMED' }, { taken, cfg: c }));
  }
  return { c, reg };
}

test('render: categories and questions default COLLAPSED; search only above the threshold', () => {
  const small = activeRegistry(8, 2);
  const o1 = buildAll(small.c, small.reg, null);
  const html1 = renderFaq({ items: o1.items, organised: o1.organised, cfg: small.c });
  assert.match(html1, /data-faq-category/);
  assert.ok(!/<details[^>]*\sopen/.test(html1), 'nothing renders open');
  assert.ok(!html1.includes('data-faq-search-input'));
  const big = activeRegistry(30, 4);
  const o2 = buildAll(big.c, big.reg, null);
  const html2 = renderFaq({ items: o2.items, organised: o2.organised, cfg: big.c });
  assert.ok(html2.includes('data-faq-search-input'));
  assert.ok(html2.includes('No matching questions found.'));
  assert.ok(!/<details[^>]*\sopen/.test(html2));
  const flat = activeRegistry(4, 1);
  const o3 = buildAll(flat.c, flat.reg, null);
  assert.ok(!renderFaq({ items: o3.items, organised: o3.organised, cfg: flat.c }).includes('data-faq-category'));
});

test('render: escapes, links, tokens, aliases, synonyms in search text', () => {
  const c = cfg({ tokens: { contact: 'our contact page' } });
  const item = { id: 'x', anchor: 'x', aliases: ['old-x'], question: 'What does it <cost>?', answer: 'See [Pricing](/pricing). Write to {{contact}}.', category: 'general', keywords: [] };
  const html = renderFaq({ items: [item], organised: { categories: [{ id: 'general', title: 'General' }], showCategories: false, assignment: new Map() }, cfg: c });
  assert.ok(html.includes('What does it &lt;cost&gt;?'));
  assert.ok(html.includes('<a href="/pricing">Pricing</a>'));
  assert.ok(html.includes('our contact page'));
  assert.ok(html.includes('data-faq-aliases="old-x"'));
  assert.match(html, /data-search="[^"]*\bprice\b/); // "cost" finds "price"
});

test('seo registry has every required field; schema matches visible items and can be disabled by site policy', () => {
  const { c, reg } = activeRegistry(8, 2);
  const b = buildAll(c, reg, inv());
  const f = b.seo.faqs.find((x) => x.status === 'ACTIVE');
  for (const k of ['id', 'question', 'answer', 'category', 'page', 'canonicalUrl', 'anchor', 'relatedPages', 'relatedTools', 'internalLinks', 'status', 'created', 'updated']) assert.ok(k in f, k);
  assert.equal(f.canonicalUrl, `https://demo.test/faq#${f.anchor}`);
  assert.ok(b.seo.pages.some((p) => p.kind === 'faq-hub' && p.inSitemap));
  assert.ok(b.seo.categories.length === 2);
  assert.equal(b.jsonLd['@type'], 'FAQPage');
  assert.equal(b.jsonLd.mainEntity.length, 8);
  assert.equal(faqPageJsonLd(b.items, { ...c, schema: { faqPage: false } }), null);
});

test('validate: catches unsupported ACTIVE answers, duplicates, bad anchors, broken links', () => {
  const c = cfg();
  const reg = emptyRegistry();
  const taken = new Set();
  reg.items.push(newItem({ question: 'How much does it cost?', answer: 'It costs $12.', category: 'billing', status: 'ACTIVE', confidence: 'UNKNOWN', origin: 'generated' }, { taken, cfg: c }));
  reg.items.push(newItem({ question: 'What is the price?', answer: 'It costs [here](/nope).', category: 'billing', status: 'ACTIVE', confidence: 'CONFIRMED', origin: 'manual' }, { taken, cfg: c }));
  reg.items[1].anchor = 'Bad Anchor';
  const r = validate({ cfg: c, registry: reg, inventory: inv() });
  const msgs = r.errors.map((e) => e.msg).join('\n');
  assert.match(msgs, /UNKNOWN/);
  assert.match(msgs, /duplicates/);
  assert.match(msgs, /stable slug/);
  assert.match(msgs, /broken internal link/);
  const clean = emptyRegistry();
  const ok = validate({ cfg: c, registry: clean, inventory: inv() });
  assert.equal(ok.errors.length, 0);
});

test('open-by-default detection ignores the word "open" inside attribute values', () => {
  assert.equal(openDetails('<details class="faq-item" data-search="how to open it"><summary>x</summary></details>').length, 0);
  assert.equal(openDetails('<details class="faq-category" open><summary>x</summary></details>').length, 1);
});

test('page FAQs on the hub itself are not imported as contextual FAQs', () => {
  const c = cfg();
  const hub = finalizePage({ url: '/faq', title: 'FAQ', faqs: [{ q: 'Is it free?', a: 'Yes.' }] });
  assert.equal(importedPageFaqs({ pages: [hub, ...pages()] }, c).length, 1);
});

test('inventory ignores blocks the engine rendered itself (no feedback loop)', () => {
  const html = '<main><h1>Methodology</h1><p>Real text here.</p><section><div class="faq-engine" data-faq-root><div><details class="faq-item"><summary>Is it echoed?</summary><div>Echo.</div></details></div></div></section><p>After.</p></main>';
  const p = parseHtml(html, '/m');
  assert.equal(p.faqs.length, 0);
  assert.ok(!p.text.includes('Echo'));
  assert.ok(p.text.includes('After.'));
});
