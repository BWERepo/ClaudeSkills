import type { ContentType, SearchIntent } from "../types.js";

/** Everything a provider needs to write one article. Site excerpts are untrusted and marked as such in prompts. */
export interface ArticleBrief {
  title: string;
  slug: string;
  url: string;
  primaryTopic: string;
  intent: SearchIntent;
  contentType: ContentType;
  audience: string;
  angle: string;
  category: string;
  tags: string[];
  language: string;
  site: { name: string; url: string; subject: string; market: string };
  supportingPages: { url: string; title: string; type: string; summary: string }[];
  /** The only internal URLs the article may link to. */
  linkTargets: { url: string; title: string; kind: "article" | "page" }[];
  avoidOverlapWith: string[];
  ymyl: boolean;
  disclaimer?: string;
  editorNotes?: string;
}

const YMYL = /\b(loan|loans|mortgage|credit|debt|tax|taxes|invest|investing|insurance|retire|retirement|pension|medical|medicine|health|symptom|treatment|dental|dentist|surgery|drug|dosage|pregnan|legal|law|lawyer|attorney|lawsuit|visa|immigration|safety|electrical|gas leak|asbestos|mold|benefits|medicare|medicaid|social security|salary|wage|employment|regulation|permit|code compliance|price|prices|cost|costs)\b/i;

/** Your-Money-or-Your-Life topics need sourced, qualified claims and a disclaimer. */
export function isYmyl(text: string): boolean {
  return YMYL.test(text);
}
