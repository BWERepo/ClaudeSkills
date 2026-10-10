/**
 * Language utilities for topic modelling, similarity and cannibalization detection.
 * Deterministic and dependency-free; tuned for English but degrades gracefully for other Latin-script text.
 */

export const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each either few for from further get gets got had has have having he her here hers
him his how however i if in into is it its itself just let like me more most my no nor not now of off on once only or other
our ours out over own per same she should so some such than that the their theirs them then there these they this those
through to too under until up us very via was we were what when where which while who whom why will with within without
would you your yours yourself yourselves etc vs versus may might must shall much many one two three new use used using make
made way ways thing things really well need needs want wants know see look best top great good help helps way home page site
website click read more learn contact call today us our we're you're it's don't can't won't let's get started menu skip
content copyright rights reserved privacy policy terms cookie cookies`
    .split(/\s+/)
    .filter(Boolean),
);

/** Very light English stemmer: enough to merge plurals and common verb forms without mangling entities. */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  if (/ies$/.test(w) && w.length > 5) return w.replace(/ies$/, "y");
  if (/(ss|us|is)$/.test(w)) return w;
  if (/sses$/.test(w)) return w.replace(/es$/, "");
  if (/s$/.test(w) && !/ss$/.test(w)) w = w.replace(/s$/, "");
  if (/ing$/.test(w) && w.length > 6) return w.replace(/ing$/, "");
  if (/ed$/.test(w) && w.length > 5 && !/eed$/.test(w)) return w.replace(/ed$/, "");
  return w;
}

export function words(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9][a-z0-9'-]*[a-z0-9]|[a-z0-9]/g) ?? []).map((w) =>
    w.replace(/'s$/, "").replace(/'/g, ""),
  );
}

export function contentTokens(text: string): string[] {
  return words(text)
    .filter((w) => !STOPWORDS.has(w) && w.length > 2 && !/^\d+$/.test(w))
    .map(stem);
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

export type Vector = Map<string, number>;

export function termFrequencies(tokens: string[]): Vector {
  const v: Vector = new Map();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

/** Adds bigrams so "car loan" and "loan car" are not identical. */
export function featureTokens(text: string): string[] {
  const t = contentTokens(text);
  const out = [...t];
  for (let i = 0; i < t.length - 1; i++) out.push(`${t[i]}_${t[i + 1]}`);
  return out;
}

export class Corpus {
  private df = new Map<string, number>();
  private docs = 0;

  add(tokens: string[]): void {
    this.docs++;
    for (const t of new Set(tokens)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
  }

  idf(term: string): number {
    return Math.log((1 + this.docs) / (1 + (this.df.get(term) ?? 0))) + 1;
  }

  documentFrequency(term: string): number {
    return this.df.get(term) ?? 0;
  }

  get size(): number {
    return this.docs;
  }

  vector(tokens: string[]): Vector {
    const tf = termFrequencies(tokens);
    const v: Vector = new Map();
    for (const [t, n] of tf) v.set(t, (1 + Math.log(n)) * this.idf(t));
    return v;
  }
}

export function cosine(a: Vector, b: Vector): number {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, x] of a) na += x * x;
  for (const [, y] of b) nb += y * y;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, x] of small) {
    const y = big.get(k);
    if (y) dot += x * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Intent facets: phrases that mean the same search intent. Used to catch
 * "How Much Does X Cost?" vs "Average Cost of X" vs "Price of X" as one intent.
 */
const FACETS: [string, RegExp][] = [
  ["cost", /\b(cost|costs|price|prices|pricing|priced|how much|expensive|cheap|affordable|budget|fee|fees|rates?)\b/i],
  ["howto", /\b(how to|how do i|how can i|step[- ]by[- ]step|guide to|tutorial|diy)\b/i],
  ["compare", /\b(vs\.?|versus|comparison|compared to|difference between|which is better)\b/i],
  ["best", /\b(best|top \d+|top-rated|recommended|choose|choosing|pick|picking|select)\b/i],
  ["what", /\b(what is|what are|what does|meaning of|definition|explained|basics|introduction)\b/i],
  ["why", /\b(why|benefits?|advantages?|reasons?)\b/i],
  ["signs", /\b(signs?|symptoms?|when to|warning)\b/i],
  ["fix", /\b(fix|repair|troubleshoot|problem|issues?|not working|broken|error)\b/i],
  ["checklist", /\b(checklist|tips|mistakes|dos and don'?ts)\b/i],
  ["time", /\b(how long|lifespan|last|duration|timeline)\b/i],
];

export function intentFacets(text: string): string[] {
  return FACETS.filter(([, re]) => re.test(text)).map(([k]) => k);
}

/** Subject tokens of a title once intent words are removed: "Average Cost of Roof Repair" -> roof, repair. */
export function subjectTokens(text: string): string[] {
  const stripped = text
    .toLowerCase()
    .replace(/\b(how much does|how much is|how much|what does|what is|what are|average|typical|guide|complete|ultimate|explained|cost|costs|price|prices|pricing|of|to|the|a|an|in|for|do|does|i|need|should|it|vs\.?|versus|20\d\d)\b/g, " ");
  return [...new Set(contentTokens(stripped))];
}

export function isQuestion(s: string): boolean {
  return /\?\s*$/.test(s.trim()) || /^(how|what|why|when|where|which|who|can|do|does|is|are|should|will)\b/i.test(s.trim());
}

/** Frequent multi-word phrases (2-3 words) that look like entities/topics. */
export function keyPhrases(text: string, limit = 20): { phrase: string; count: number }[] {
  const w = words(text);
  const counts = new Map<string, number>();
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= w.length; i++) {
      const gram = w.slice(i, i + n);
      if (STOPWORDS.has(gram[0]!) || STOPWORDS.has(gram[n - 1]!)) continue;
      if (gram.some((g) => g.length < 3 || /^\d+$/.test(g))) continue;
      if (gram.filter((g) => STOPWORDS.has(g)).length > 1) continue;
      const k = gram.join(" ");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}

export function titleCase(s: string): string {
  const small = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function sentenceCase(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
