// Propose stage: turn the inventory + candidate sources into a REVIEWABLE proposal. Nothing here changes the registry.
import { existsSync, readFileSync } from 'node:fs';
import { slugify, firstSentence, sentences, squash } from './text.mjs';
import { fromRoot } from './config.mjs';
import { findMatch, duplicateGroups } from './dedupe.mjs';
import { groundItem } from './grounding.mjs';
import { assignCategory } from './categorize.mjs';
import { buildLinkTargets, proposeLinks, checkLinks } from './links.mjs';
import { reviewRegistry, uniqueId, today } from './registry.mjs';

/** Stable anchors for a page's questions: slug of the question, "-2" on a repeat. Sites use this same function to put the ids on their pages. */
export function anchorsFor(questions) {
  const taken = new Set();
  return questions.map((q) => {
    const slug = slugify(String(q).replace(/\?+$/, '')) || 'question';
    let anchor = slug;
    for (let n = 2; taken.has(anchor); n++) anchor = `${slug}-${n}`;
    taken.add(anchor);
    return anchor;
  });
}

/** FAQs that already live on a page (read-only, contextual). They are imported so the SEO registry sees them, never copied into the registry file. */
export function importedPageFaqs(inventory, cfg) {
  if (!cfg.importPageFaqs) return [];
  const out = [];
  for (const p of inventory.pages) {
    if (p.url === cfg.faqPage.path) continue; // the hub renders the registry itself; its questions are not "page FAQs"
    const anchors = anchorsFor(p.faqs.map((f) => f.q));
    for (const [n, f] of p.faqs.entries()) {
      const anchor = anchors[n];
      out.push({
        id: `${slugify(p.url.replace(/^\//, '') || 'home', 40)}--${anchor}`.replace(/^--/, 'home--'),
        anchor,
        question: f.q,
        answer: f.a,
        category: p.category ?? null,
        pageTitle: String(p.title).split(/\s[|\u2013\u2014]\s|:\s/)[0],
        pageType: p.type,
        status: p.indexable ? 'ACTIVE' : 'DRAFT',
        origin: 'page',
        page: p.url,
        contexts: [p.url],
        relatedPages: [],
        relatedTools: p.type === 'tool' ? [p.url] : [],
        sources: [{ url: p.url, quote: f.a.slice(0, 120) }],
        confidence: 'CONFIRMED',
        created: p.updated ?? null,
        updated: p.updated ?? null,
      });
    }
  }
  return out;
}

export function loadAuthored(cfg) {
  const file = fromRoot(cfg, cfg.paths.candidates);
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return (data.candidates ?? data).map((c) => ({ ...c, origin: 'authored' }));
}

/** Candidates the engine can find without any language model: question headings with a short answer beneath them. */
export function headingCandidates(inventory, cfg) {
  if (!cfg.generators.includes('headings')) return [];
  const out = [];
  for (const p of inventory.pages) {
    if (!p.indexable) continue;
    const own = new Set(p.faqs.map((f) => squash(f.q).toLowerCase()));
    for (const s of p.sections) {
      if (!s.heading.endsWith('?') || own.has(s.heading.toLowerCase()) || !s.text) continue;
      const ss = sentences(s.text);
      const answer = ss.slice(0, 2).join(' ');
      if (answer.length < 30 || answer.length > 500) continue;
      out.push({ question: s.heading, answer, origin: 'heading', sources: [{ url: p.url, quote: firstSentence(s.text) }], relatedPages: [p.url] });
    }
  }
  return out;
}

const excluded = (c, cfg) => cfg.exclusions.questions.some((r) => new RegExp(r, 'i').test(c.question));

export function propose({ cfg, inventory, registry, now = new Date() }) {
  const pages = new Map(inventory.pages.map((p) => [p.url, p]));
  const urls = new Set(inventory.pages.map((p) => p.url));
  const imported = importedPageFaqs(inventory, cfg);
  const targets = buildLinkTargets(inventory, cfg);
  const taken = new Set(registry.items.map((i) => i.id));
  const pool = registry.items.filter((i) => i.status !== 'RETIRED');
  const proposal = { generated: today(now), adds: [], merged: [], skipped: [], similarToImported: [], linkProposals: [], review: null, importedDuplicateGroups: [] };

  const cands = [...loadAuthored(cfg), ...headingCandidates(inventory, cfg)];
  const accepted = [];
  for (const c of cands) {
    if (!c.question || !c.answer) { proposal.skipped.push({ question: c.question ?? '(none)', reason: 'missing question or answer' }); continue; }
    if (excluded(c, cfg)) { proposal.skipped.push({ question: c.question, reason: 'excluded by config' }); continue; }
    const dupe = findMatch(c, [...pool, ...accepted], cfg);
    if (dupe) { proposal.merged.push({ question: c.question, into: dupe.with.id ?? dupe.with.question, why: dupe.why, score: +dupe.question.toFixed(2) }); continue; }
    const sim = findMatch(c, imported, cfg);
    if (sim) proposal.similarToImported.push({ question: c.question, page: sim.with.page, existing: sim.with.question });
    const g = groundItem(c, pages, cfg);
    const category = assignCategory(c, cfg);
    const item = { ...c, category, confidence: g.confidence, sources: g.sources, id: uniqueId(c.question, taken) };
    taken.add(item.id);
    const activate = cfg.grounding.activate.includes(g.confidence) && (!cfg.grounding.requireVerifiedQuote || g.sources.some((s) => s.verified));
    item.proposedStatus = activate && !g.problems.length ? 'ACTIVE' : 'NEEDS REVIEW';
    item.reviewReason = g.problems.length ? g.problems.join('; ') : null;
    const lp = proposeLinks(item, targets, cfg);
    if (lp.length) proposal.linkProposals.push({ id: item.id, links: lp });
    item.brokenLinks = checkLinks(item.answer, urls, cfg);
    if (item.brokenLinks.length) { item.proposedStatus = 'NEEDS REVIEW'; item.reviewReason = [item.reviewReason, ...item.brokenLinks].filter(Boolean).join('; '); }
    accepted.push(item);
    proposal.adds.push(item);
  }
  proposal.review = reviewRegistry(registry, pages, urls, cfg, now);
  proposal.importedDuplicateGroups = duplicateGroups(imported, cfg)
    .map((g) => ({ question: g[0].question, pages: g.map((x) => x.page), identicalAnswers: new Set(g.map((x) => squash(x.answer))).size === 1 }))
    .sort((a, b) => b.pages.length - a.pages.length);
  return proposal;
}

export function proposalMarkdown(p, cfg) {
  const L = [`# FAQ proposal (${p.generated})`, '', 'Nothing has been changed. Review, then run `faq-engine apply`.', ''];
  L.push(`## New FAQs (${p.adds.length})`, '');
  for (const a of p.adds) L.push(`- **${a.question}** — ${a.proposedStatus}, ${a.confidence}, category \`${a.category}\`${a.reviewReason ? `\n  - review: ${a.reviewReason}` : ''}`);
  L.push('', `## Merged as duplicates (${p.merged.length})`, '');
  for (const m of p.merged) L.push(`- "${m.question}" → \`${m.into}\` (${m.why}, ${m.score})`);
  L.push('', `## Skipped (${p.skipped.length})`, '');
  for (const s of p.skipped) L.push(`- "${s.question}": ${s.reason}`);
  L.push('', `## Existing FAQs that changed state (${p.review.changes.length})`, '');
  for (const c of p.review.changes) L.push(`- \`${c.id}\` ${c.kind}: ${c.detail}`);
  L.push('', `## Link proposals (${p.linkProposals.length})`, '');
  for (const l of p.linkProposals) L.push(`- \`${l.id}\`: ${l.links.map((x) => `"${x.text}" → ${x.href}`).join(', ')}`);
  L.push('', `## Page FAQs repeated across pages (top 15 of ${p.importedDuplicateGroups.length})`, '', 'Kept (they are contextual and each page needs its own answer), listed so they can be consolidated deliberately.', '');
  for (const g of p.importedDuplicateGroups.slice(0, 15)) L.push(`- "${g.question}" on ${g.pages.length} pages${g.identicalAnswers ? ' (identical answers)' : ''}`);
  return L.join('\n') + '\n';
}
