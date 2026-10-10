// Answer grounding: an answer is only as good as the website text that supports it.
//
//   CONFIRMED  every sentence is (almost) fully carried by the cited pages, and each cited quote exists verbatim
//   DERIVED    the cited quotes exist and the answer's wording and numbers are supported, but it is a paraphrase or short synthesis
//   UNKNOWN    no verified source, an unsupported number, or too little overlap: never published as fact
import { normalize, tokens, containment, sentences, plainAnswer, numericFacts, buildSynonymMap } from './text.mjs';

export function pageCorpus(page) {
  return [page.title, page.description, page.text, ...page.faqs.flatMap((f) => [f.q, f.a]), ...page.sections.flatMap((s) => [s.heading, s.text])].join(' ');
}

/** Is `quote` present (whitespace/punctuation/case-insensitive) in the page? */
export function quoteInPage(quote, page) {
  const q = normalize(quote);
  return q.length >= 12 && normalize(pageCorpus(page)).includes(q);
}

export function groundItem(item, pages, cfg) {
  const synonyms = buildSynonymMap(cfg.synonyms);
  const problems = [];
  const sources = (item.sources ?? []).map((s) => {
    const page = pages.get(s.url);
    if (!page) {
      problems.push(`source page not found: ${s.url}`);
      return { ...s, verified: false, missing: true };
    }
    const verified = s.quote ? quoteInPage(s.quote, page) : false;
    if (!verified) problems.push(`quote not found on ${s.url}: "${(s.quote ?? '').slice(0, 60)}"`);
    return { ...s, verified, hash: page.hash };
  });
  const good = sources.filter((s) => s.verified);
  if (!good.length) {
    return { confidence: 'UNKNOWN', sources, problems: [...problems, 'no verified source quote'], overlap: 0 };
  }
  const corpus = good.map((s) => pageCorpus(pages.get(s.url))).join(' ');
  const corpusTokens = tokens(corpus, synonyms);
  const text = plainAnswer(item.answer, cfg.tokens);
  const sents = sentences(text);
  const per = sents.map((s) => containment(tokens(s, synonyms), corpusTokens));
  const overlap = per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0;
  const minSentence = per.length ? Math.min(...per) : 0;
  const corpusNumbers = new Set(numericFacts(corpus));
  const unsupported = numericFacts(text).filter((n) => !corpusNumbers.has(n));
  if (unsupported.length) problems.push(`numbers not found in sources: ${unsupported.join(', ')}`);
  let confidence = 'UNKNOWN';
  if (!unsupported.length) {
    if (minSentence >= 0.8 && problems.length === 0) confidence = 'CONFIRMED';
    else if (overlap >= cfg.grounding.minOverlap) confidence = 'DERIVED';
    else problems.push(`wording only ${Math.round(overlap * 100)}% supported by the cited pages`);
  }
  return { confidence, sources, problems, overlap: Math.round(overlap * 100) / 100 };
}
