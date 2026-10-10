import type { ValidationIssue } from "../types.js";
import { contentTokens, splitSentences, wordCount, words } from "../util/text.js";

const FILLER: [RegExp, string][] = [
  [/in today'?s (fast[- ]paced|digital|modern|ever[- ]changing) (world|age|landscape)/i, "\"In today's fast-paced world\" style opener"],
  [/\bin the ever[- ]evolving\b/i, "\"ever-evolving\" filler"],
  [/^#+\s*conclusion\s*$/im, "a generic \"Conclusion\" section"],
  [/\bin conclusion\b/i, "\"In conclusion\""],
  [/\bit'?s (important|worth|crucial) to (note|mention|remember) that\b/i, "\"It's important to note\" filler"],
  [/\bdelve\b/i, "\"delve\""],
  [/\bunlock (the|your) (power|potential|full potential)\b/i, "\"unlock the power\" filler"],
  [/\bgame[- ]changer\b/i, "\"game-changer\""],
  [/\blook no further\b/i, "\"look no further\""],
  [/\bwithout further ado\b/i, "\"without further ado\""],
  [/\b(click here|read more here)\b/i, "\"click here\" anchor"],
  [/\bas an ai\b|\blanguage model\b/i, "AI self-reference"],
  [/\blorem ipsum\b/i, "placeholder text"],
  [/\[(insert|your|todo|tbd)[^\]]*\]/i, "unfilled placeholder"],
];

export interface QualityReport {
  issues: ValidationIssue[];
  wordCount: number;
  answerEarly: boolean;
}

/**
 * Editorial checks on a generated body. Errors block publication; warnings are shown to the reviewer.
 * These catch generation failures and filler; they do not replace a human reading the article.
 */
export function checkQuality(markdown: string, opts: { title: string; primaryTopic: string; contentType: string }): QualityReport {
  const issues: ValidationIssue[] = [];
  const text = markdown.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const wc = wordCount(text.replace(/[#>*_|-]/g, " "));

  if (wc < 150) issues.push({ code: "too-short", severity: "error", message: `only ${wc} words: the article looks like a failed or truncated generation` });
  else if (wc < 350 && !["faq", "checklist", "glossary"].includes(opts.contentType)) issues.push({ code: "thin", severity: "warning", message: `${wc} words: check that the question is fully answered` });
  if (wc > 3200) issues.push({ code: "long", severity: "warning", message: `${wc} words: check for padding; length should follow the question` });

  for (const [re, label] of FILLER) if (re.test(markdown)) issues.push({ code: "filler", severity: label.includes("placeholder") || label.includes("AI self") ? "error" : "warning", message: `contains ${label}` });

  if (/^#\s/m.test(markdown)) issues.push({ code: "h1-in-body", severity: "warning", message: "body contains a level-1 heading; the page template supplies the H1 (it was demoted)" });
  const levels = [...markdown.matchAll(/^(#{2,6})\s/gm)].map((m) => m[1]!.length);
  if (levels.length === 0 && wc > 500) issues.push({ code: "no-headings", severity: "warning", message: "no subheadings in a long article" });
  for (let i = 1; i < levels.length; i++) if (levels[i]! - levels[i - 1]! > 1) {
    issues.push({ code: "heading-skip", severity: "warning", message: `heading level jumps from H${levels[i - 1]} to H${levels[i]}` });
    break;
  }

  // Answer early: the first real paragraph should be short and on topic.
  const firstPara = markdown.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#") && !p.startsWith("<!--")) ?? "";
  const topicToks = new Set(contentTokens(`${opts.primaryTopic} ${opts.title}`));
  const firstToks = contentTokens(firstPara);
  const answerEarly = wordCount(firstPara) <= 130 && firstToks.some((t) => topicToks.has(t));
  if (!answerEarly) issues.push({ code: "late-answer", severity: "warning", message: "the opening paragraph does not get to the point quickly" });

  // Keyword stuffing: the topic phrase repeated far more than natural writing does.
  const phrase = opts.primaryTopic.toLowerCase().trim();
  if (phrase.split(/\s+/).length >= 2) {
    const count = (text.toLowerCase().match(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
    const density = count / Math.max(1, wc / 100);
    if (count > 6 && density > 2.5) issues.push({ code: "keyword-stuffing", severity: "error", message: `"${phrase}" appears ${count} times (${density.toFixed(1)} per 100 words)` });
  }

  // Repeated paragraphs (a common generation failure).
  const paras = markdown.split(/\n\s*\n/).map((p) => p.trim().toLowerCase()).filter((p) => p.length > 80);
  if (new Set(paras).size < paras.length) issues.push({ code: "repeated-paragraph", severity: "error", message: "the same paragraph appears more than once" });

  // Unsourced statistics and quotations.
  const statSentences = splitSentences(text).filter((s) => /\b\d{1,3}(\.\d+)?\s?%|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d+)? (million|billion)\b/i.test(s) && !/(according to|source|reports?|survey by|data from|\bper\b the|\(https?:)/i.test(s));
  if (statSentences.length) issues.push({ code: "unsourced-statistic", severity: "warning", message: `${statSentences.length} sentence(s) state figures without a source, e.g. "${statSentences[0]!.slice(0, 100)}"` });
  if (/["“][^"”]{20,}["”]\s*(,|—|-)?\s*(said|says|according to|explains|notes)\s+[A-Z]/.test(text)) issues.push({ code: "attributed-quote", severity: "warning", message: "contains an attributed quotation; confirm it is real and sourced" });

  // Repetition of the same sentence opener (padding signal).
  const openers = splitSentences(text).map((s) => words(s).slice(0, 3).join(" ")).filter((o) => o.split(" ").length === 3);
  const counts = new Map<string, number>();
  for (const o of openers) counts.set(o, (counts.get(o) ?? 0) + 1);
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 6) issues.push({ code: "repetitive", severity: "warning", message: `${worst[1]} sentences start with "${worst[0]}"` });

  return { issues, wordCount: wc, answerEarly };
}
