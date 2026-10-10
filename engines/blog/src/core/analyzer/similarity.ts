import { Corpus, cosine, featureTokens, intentFacets, jaccard, subjectTokens, type Vector } from "../util/text.js";

export interface Doc {
  key: string;
  /** Title-like text (weighted heavily). */
  title: string;
  /** Body-like text. */
  body?: string;
}

/**
 * Topic similarity over the site's own vocabulary (TF-IDF with bigrams). Shared by recommendations,
 * cannibalization, clustering and link scoring so they agree on what "about the same thing" means.
 */
export class SimilarityIndex {
  private corpus = new Corpus();
  private titleVecs = new Map<string, Vector>();
  private bodyVecs = new Map<string, Vector>();

  constructor(docs: Doc[]) {
    for (const d of docs) this.corpus.add(featureTokens(`${d.title} ${d.title} ${d.body ?? ""}`));
    for (const d of docs) this.addDoc(d);
  }

  addDoc(d: Doc): void {
    this.titleVecs.set(d.key, this.corpus.vector(featureTokens(d.title)));
    this.bodyVecs.set(d.key, this.corpus.vector(featureTokens(`${d.title} ${d.title} ${(d.body ?? "").slice(0, 12000)}`)));
  }

  has(key: string): boolean {
    return this.titleVecs.has(key);
  }

  vectorOf(text: string): Vector {
    return this.corpus.vector(featureTokens(text));
  }

  /** 0..1 blend of title similarity and full-text similarity. */
  similarity(a: string, b: string): number {
    const ta = this.titleVecs.get(a);
    const tb = this.titleVecs.get(b);
    const ba = this.bodyVecs.get(a);
    const bb = this.bodyVecs.get(b);
    if (!ta || !tb || !ba || !bb) return 0;
    return 0.55 * cosine(ta, tb) + 0.45 * cosine(ba, bb);
  }

  similarityToText(key: string, text: string): number {
    const v = this.vectorOf(text);
    const t = this.titleVecs.get(key);
    const b = this.bodyVecs.get(key);
    if (!t || !b) return 0;
    return 0.55 * cosine(t, v) + 0.45 * cosine(b, v);
  }

  titleSimilarity(a: string, b: string): number {
    const ta = this.titleVecs.get(a);
    const tb = this.titleVecs.get(b);
    return ta && tb ? cosine(ta, tb) : 0;
  }

  idf(term: string): number {
    return this.corpus.idf(term);
  }
}

/**
 * Same query intent: the subject overlaps strongly AND the intent facets match.
 * "How Much Does X Cost?", "Average Cost of X" and "Price of X" are one intent.
 */
export function sameSearchIntent(titleA: string, titleB: string): { same: boolean; subjectOverlap: number } {
  const sa = subjectTokens(titleA);
  const sb = subjectTokens(titleB);
  const subjectOverlap = jaccard(sa, sb);
  const fa = intentFacets(titleA);
  const fb = intentFacets(titleB);
  const facetMatch = (fa.length === 0 && fb.length === 0) || fa.some((f) => fb.includes(f));
  return { same: subjectOverlap >= 0.6 && facetMatch, subjectOverlap };
}
