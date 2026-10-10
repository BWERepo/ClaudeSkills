// Duplicate detection by meaning, not by exact text: "How much does it cost?" and "What is the price?" fold to the same tokens.
import { tokens, jaccard, buildSynonymMap, plainAnswer } from './text.mjs';

/** The site's own name (and config.dedupe.ignoreTerms) appears in many questions and says nothing about meaning: it is ignored when comparing. */
export function ignoredTerms(cfg, syn) {
  return new Set(tokens([cfg.site?.name ?? '', ...(cfg.dedupe.ignoreTerms ?? [])].join(' '), syn));
}

const prep = (x, syn, cfg) => {
  const ignore = ignoredTerms(cfg, syn);
  const keep = (t) => !ignore.has(t);
  return { ...x, _q: tokens(x.question, syn).filter(keep), _a: tokens(plainAnswer(x.answer ?? '', cfg.tokens), syn).filter(keep) };
};

export function similarity(a, b) {
  const q = jaccard(a._q, b._q);
  const ans = jaccard(a._a, b._a);
  return { question: q, answer: ans };
}

export function isDuplicate(a, b, cfg) {
  const s = similarity(a, b);
  if (s.question >= cfg.dedupe.questionThreshold) return { duplicate: true, ...s, why: 'same question meaning' };
  if (s.answer >= cfg.dedupe.answerThreshold && s.question >= 0.4) return { duplicate: true, ...s, why: 'same answer, similar question' };
  return { duplicate: false, ...s };
}

/** Best match for a candidate among a pool (existing FAQs, page FAQs, other candidates). */
export function findMatch(candidate, pool, cfg) {
  const syn = buildSynonymMap(cfg.synonyms);
  const c = prep(candidate, syn, cfg);
  let best = null;
  for (const p of pool) {
    if (p.id && p.id === candidate.id) continue;
    const r = isDuplicate(c, prep(p, syn, cfg), cfg);
    if (r.duplicate && (!best || r.question > best.question)) best = { with: p, ...r };
  }
  return best;
}

/** Cluster a list into groups of mutual duplicates (union-find). Returns only groups of 2 or more. */
export function duplicateGroups(items, cfg) {
  const syn = buildSynonymMap(cfg.synonyms);
  const list = items.map((x) => prep(x, syn, cfg));
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // Blocking: only compare items that share at least one rare-ish token, so thousands of items stay fast.
  const byToken = new Map();
  list.forEach((x, i) => new Set(x._q).forEach((t) => (byToken.get(t) ?? byToken.set(t, []).get(t)).push(i)));
  const seen = new Set();
  for (const ids of byToken.values()) {
    if (ids.length > 200) continue;
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const key = ids[a] * 100000 + ids[b];
      if (seen.has(key)) continue;
      seen.add(key);
      if (isDuplicate(list[ids[a]], list[ids[b]], cfg).duplicate) parent[find(ids[a])] = find(ids[b]);
    }
  }
  const groups = new Map();
  list.forEach((x, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))).push(x));
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.map(({ _q, _a, ...rest }) => rest));
}
