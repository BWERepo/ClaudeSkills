import type { ArticleBrief } from "../../core/generator/brief.js";
import { EngineError } from "../../core/errors.js";
import { sentenceCase, truncate } from "../../core/util/text.js";
import type { AIProvider, GenerateRequest, GenerateResult } from "./types.js";

const SECTIONS: Record<string, string[]> = {
  "how-to": ["Before you start", "Step by step", "Common mistakes to avoid", "When to get help"],
  guide: ["What it covers", "How to decide", "Practical tips", "Where to go next"],
  explainer: ["The short version", "How it works", "Why it matters", "Related questions"],
  comparison: ["At a glance", "Key differences", "Which option suits whom", "Making the choice"],
  checklist: ["What to look for", "Checklist", "What to do next"],
  faq: ["The answer", "Details that change the answer", "Related questions"],
  "cost-guide": ["What drives the price", "Factors that raise or lower it", "How to get an accurate figure"],
  "case-for": ["The case", "Trade-offs", "Next steps"],
  troubleshooting: ["Likely causes", "What to check first", "When to call a professional"],
  glossary: ["Definition", "Examples", "Related terms"],
};

/**
 * Offline, deterministic provider. It assembles a structured draft from the brief and the site's own page
 * summaries: useful for tests, demos, and as a writing scaffold. It has no knowledge beyond the brief, so its
 * drafts are blocked from publication unless `generation.publishDeterministicDrafts` is explicitly enabled.
 */
export class DeterministicProvider implements AIProvider {
  readonly id = "deterministic";
  readonly model = "bwe-deterministic-1";

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (req.purpose === "ideas") return { text: JSON.stringify({ ideas: [] }), model: this.model };
    if (!req.brief) throw new EngineError("PROVIDER_ERROR", "the deterministic provider needs a structured brief");
    const b = req.brief;
    return { text: JSON.stringify({ title: b.title, description: description(b), markdown: body(b), sources: [] }), model: this.model };
  }
}

function description(b: ArticleBrief): string {
  let d = `${sentenceCase(b.primaryTopic)}: ${b.angle}`.replace(/\s+/g, " ").trim();
  if (d.length < 120) d = `${d} A practical guide from ${b.site.name}.`;
  return truncate(d, 160);
}

function body(b: ArticleBrief): string {
  const sections = SECTIONS[b.contentType] ?? SECTIONS.guide!;
  const pages = b.supportingPages;
  const links = b.linkTargets.slice(0, 5);
  const link = (i: number) => {
    const l = links[i % Math.max(1, links.length)];
    return l ? `[${anchorFor(l.title)}](${l.url})` : "";
  };
  const out: string[] = [];
  out.push(`${sentenceCase(b.primaryTopic)} is the subject of this ${b.contentType.replace("-", " ")}, written for readers comparing their options. ${sentenceCase(b.angle)}`);
  if (pages[0]) out.push(`${b.site.name} offers this; see ${link(0) || pages[0].title} for current details.`);
  sections.forEach((s, i) => {
    out.push(`## ${s}`);
    const p = pages[i % Math.max(1, pages.length)];
    // Only the first section repeats the supporting-page link; later sections vary the wording so the
    // same anchor phrase doesn't repeat often enough to read as keyword stuffing.
    const reference = i === 0 && p ? `For the details specific to ${b.site.name}, see ${link(i + 1) || p.title}.` : "";
    out.push(`This section covers ${s.toLowerCase()}. ${reference} The points below are general guidance; confirm specifics for your own situation.`);
    if (s === "Step by step" || s === "Checklist") {
      out.push(["1. Write down what you need and why.", "2. Check the relevant page on this site for current details.", "3. Compare the options against your situation.", "4. Ask questions before you commit."].join("\n"));
    }
    if (s === "At a glance" || s === "Factors that raise or lower it") {
      out.push(["| Factor | Why it matters |", "| --- | --- |", `| Scope | Larger or more complex ${b.primaryTopic} takes more time and materials |`, "| Timing | Urgent or out-of-hours work usually costs more |", "| Condition | Existing problems found during the work can change the plan |"].join("\n"));
    }
  });
  if (b.ymyl && b.disclaimer) out.push(`*${b.disclaimer}*`);
  return out.join("\n\n");
}

function anchorFor(title: string): string {
  const t = title.replace(/\s*[|–—-]\s.*$/, "").trim();
  return t.charAt(0).toLowerCase() + t.slice(1);
}
