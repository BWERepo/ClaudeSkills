// Small, dependency-free text helpers shared by every FAQ Engine stage.
import { createHash } from 'node:crypto';

export const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Collapse all whitespace and trim. */
export const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Lowercase, strip punctuation and typographic quotes: the form used to compare quotes and questions. */
export function normalize(s) {
  return squash(
    String(s ?? '')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/&nbsp;/g, ' ')
      .replace(/[^\p{L}\p{N}%$.'\- ]+/gu, ' '),
  );
}

export function slugify(s, max = 64) {
  const slug = normalize(s).replace(/['.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf('-'), 20)).replace(/-+$/, '');
}

export const STOPWORDS = new Set(
  'a an and are as at be but by can could do does did for from has have how i if in is it its many me much my of on or our so than that the their them then there these they this to us was we what when where which who why will with would you your'.split(' '),
);

/** Very light stemming: enough to match "calculate/calculates/calculating/calculator" without a dictionary. */
export function stem(w) {
  let s = w;
  if (s.length > 5 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('ors')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('or')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('at')) s = s.slice(0, -2);
  return s;
}

/** Built-in synonym groups (each group maps to its first word). Sites add their own in config.synonyms. */
export const BASE_SYNONYMS = [
  ['cost', 'price', 'pricing', 'fee', 'charge', 'pay', 'paying', 'expensive'],
  ['free', 'gratis'],
  ['account', 'login', 'signup', 'register', 'registration'],
  ['refund', 'reimbursement'],
  ['return', 'exchange'],
  ['contact', 'email', 'reach'],
  ['privacy', 'private', 'confidential'],
  ['accurate', 'accuracy', 'correct', 'reliable'],
  ['wrong', 'incorrect', 'error', 'mistake'],
  ['phone', 'mobile', 'smartphone'],
];

export function buildSynonymMap(extra = []) {
  const map = new Map();
  for (const group of [...BASE_SYNONYMS, ...extra]) {
    const head = stem(normalize(group[0]));
    for (const w of group) map.set(stem(normalize(w)), head);
  }
  return map;
}

/** Content tokens (stopwords removed, stemmed, synonyms folded). */
export function tokens(s, synonyms = buildSynonymMap()) {
  return normalize(s)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => {
      const st = stem(w);
      return synonyms.get(st) ?? st;
    });
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Share of A found in B (A "contained in" B). */
export function containment(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / A.size;
}

/** Split text into sentences without breaking on common abbreviations or decimals. */
export function sentences(text) {
  const t = squash(text).replace(/\b(e\.g|i\.e|etc|vs|approx|no)\./gi, (m) => m.replace('.', '\u0001'));
  return t
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.replace(/\u0001/g, '.').trim())
    .filter(Boolean);
}

export const firstSentence = (text) => sentences(text)[0] ?? '';

/** Numbers, money, percentages: facts that must appear in a source before an answer may state them. */
export function numericFacts(text) {
  return [...new Set((String(text).match(/[$€£]?\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/,/g, '')))];
}

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Answers are plain text with optional [label](/path) links and {{token}} placeholders. Returns plain text with links reduced to labels. */
export function plainAnswer(answer, tokenMap = {}) {
  return squash(
    String(answer)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/\{\{(\w+)\}\}/g, (_, k) => tokenMap[k] ?? ''),
  );
}

export const mdLinks = (answer) => [...String(answer).matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ text: m[1], href: m[2] }));
