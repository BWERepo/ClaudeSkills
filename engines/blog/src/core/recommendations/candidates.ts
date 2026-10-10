import type { ContentGap, ContentType, SitePage } from "../types.js";
import { sentenceCase, titleCase } from "../util/text.js";
import { urlKey } from "../util/url.js";

export interface Candidate {
  key: string;
  gap: ContentGap;
  title: string;
  primaryTopic: string;
  contentType: ContentType;
  clusterHint: string;
  clusterRole?: "pillar" | "supporting";
  angle: string;
  weight: number;
  source: string;
}

const SERVICE_NEEDS = /\b(repair|replacement|replace|install|installation|treatment|cleaning|inspection|removal|maintenance|restoration|therapy|whitening|filling|implant|crown|braces|tune-?up|pumping|testing|remediation|audit|review|consultation)\b/i;

/**
 * Turn each gap into one or more concrete article ideas. Ideas are tied to a real page or question on the
 * site; nothing is proposed that the site's own content does not support.
 */
export function candidatesForGap(gap: ContentGap, pageByKey: Map<string, SitePage>): Candidate[] {
  const page = gap.supportsPages[0] ? pageByKey.get(urlKey(gap.supportsPages[0])) : undefined;
  const N = tidy(gap.topic);
  const n = N.toLowerCase();
  const c = (sub: string, title: string, contentType: ContentType, angle: string, weightFactor = 1, clusterRole?: "pillar" | "supporting"): Candidate => ({
    key: `${gap.id}:${sub}`,
    gap,
    title,
    primaryTopic: n,
    contentType,
    clusterHint: gap.kind === "unanswered-question" && page ? page.url : gap.supportsPages[0] ?? n,
    ...(clusterRole ? { clusterRole } : {}),
    angle,
    weight: gap.weight * weightFactor,
    source: gap.kind === "unanswered-question" ? "Site Content Analysis (question found on the site)" : "Site Content Analysis",
  });

  switch (gap.kind) {
    case "unsupported-offering": {
      const t = page?.pageType;
      if (t === "service") {
        const out = [c("expect", `${titleCase(N)}: What to Expect, Step by Step`, "how-to", `Walk a prospective customer through the ${n} process from first contact to completion, so they know what happens and what to prepare.`)];
        if (SERVICE_NEEDS.test(N)) out.push(c("signs", `Signs You Need ${titleCase(N)}`, "checklist", `Help readers recognise when ${n} is actually needed, and when it is not.`, 0.95));
        out.push(c("cost", `${titleCase(N)} Cost: What Affects the Price`, "cost-guide", `Explain the factors that change the price of ${n}. Use only figures the business has published; otherwise describe factors, not numbers.`, 0.9));
        return out;
      }
      if (t === "product" || t === "category") {
        return [
          c("choose", `How to Choose the Right ${titleCase(N)}`, "guide", `A buyer's guide to choosing ${n}: the criteria that matter, trade-offs, and who each option suits.`),
          c("care", `${titleCase(N)}: Care and Maintenance Tips`, "checklist", `Practical care and maintenance guidance for owners of ${n}.`, 0.8),
        ];
      }
      if (t === "tool" || t === "calculator") {
        return [c("concepts", `Understanding ${titleCase(N)} Results`, "explainer", `Explain the concepts behind the ${n} so readers can interpret and act on its results.`, 0.9)];
      }
      return [c("guide", `${titleCase(N)}: A Practical Guide`, "guide", `A practical guide to ${n} for the site's audience.`, 0.8)];
    }
    case "missing-how-to":
      return [c("howto", `How to Use the ${titleCase(N)}`, "how-to", `Step-by-step instructions for the ${n}, with a worked example and how to read the output.`)];
    case "unanswered-question": {
      const q = sentenceCase(N.replace(/\s*\?*$/, "?"));
      const type: ContentType = /\b(cost|price|how much)\b/i.test(q) ? "cost-guide" : /^how\b/i.test(q) ? "how-to" : /\b(vs|versus|difference)\b/i.test(q) ? "comparison" : "explainer";
      return [c("answer", q, type, `Answer "${q}" directly in the first paragraph, then give the detail and context the short answer on ${page?.path ?? "the site"} cannot.`, 1)];
    }
    case "missing-comparison":
      return [c("compare", `${N.split(" vs ").map((s) => titleCase(s)).join(" vs ")}: Key Differences and Which to Choose`, "comparison", `Compare ${N} side by side (a table works well) and say who each option suits.`)];
    case "thin-cluster":
      return [c("guide", `${titleCase(N)}: A Practical Guide`, "guide", `Bring the site's scattered coverage of ${n} together into one useful guide.`, 0.9)];
    case "missing-pillar":
      return [c("pillar", `The Complete Guide to ${titleCase(N)}`, "guide", `A pillar page for ${n} that summarises the topic and links to every supporting article.`, 1, "pillar")];
    case "missing-explainer":
      return [c("explainer", `What Is ${titleCase(N)}? A Plain-Language Explanation`, "explainer", `Define ${n} plainly with an example.`)];
    default:
      return [];
  }
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[.:;,]+$/, "").trim();
}
