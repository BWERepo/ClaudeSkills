import { describe, expect, it } from "vitest";
import { bandOf, scoreLink, termsOf, type LinkNode } from "../../src/core/linking/scoring.js";
import { anchorCandidates, findAnchor, isGenericAnchor } from "../../src/core/linking/anchors.js";
import { SimilarityIndex } from "../../src/core/analyzer/similarity.js";

function node(partial: Partial<LinkNode>): LinkNode {
  return { key: "k", url: "https://example.com/x", title: "Title", kind: "page", pageType: "informational", importance: 0.5, terms: [], ...partial };
}

describe("relationship scoring", () => {
  const sim = new SimilarityIndex([
    { key: "a", title: "Teeth Whitening Cost", body: "whitening cost price teeth" },
    { key: "b", title: "How Much Does Teeth Whitening Cost", body: "whitening cost price teeth guide" },
    { key: "c", title: "Dental Implants Overview", body: "implants surgery teeth missing" },
  ]);

  it("scores topically related pages higher than unrelated ones", () => {
    const from = node({ key: "a", terms: termsOf("teeth whitening cost") });
    const related = node({ key: "b", terms: termsOf("how much does teeth whitening cost") });
    const unrelated = node({ key: "c", terms: termsOf("dental implants overview") });
    const relatedScore = scoreLink({ from, to: related, sim, alreadyLinked: false, anchorFound: true });
    const unrelatedScore = scoreLink({ from, to: unrelated, sim, alreadyLinked: false, anchorFound: true });
    expect(relatedScore.score).toBeGreaterThan(unrelatedScore.score);
  });

  it("bandOf classifies against configured thresholds", () => {
    const t = { excellent: 90, strong: 75, optional: 60 };
    expect(bandOf(95, t)).toBe("excellent");
    expect(bandOf(80, t)).toBe("strong");
    expect(bandOf(65, t)).toBe("optional");
    expect(bandOf(10, t)).toBe("below-threshold");
  });
});

describe("anchor selection", () => {
  it("finds a natural anchor phrase already present in the text", () => {
    const text = "Many patients ask about teeth whitening after a cleaning.";
    const match = findAnchor(text, { title: "Teeth Whitening Guide" }, new Set());
    expect(match?.anchor.toLowerCase()).toContain("teeth whitening");
  });
  it("rejects generic anchor phrases", () => {
    expect(isGenericAnchor("click here")).toBe(true);
    expect(isGenericAnchor("teeth whitening")).toBe(false);
  });
  it("produces longer candidate phrases first", () => {
    const candidates = anchorCandidates({ title: "Dental Implants Cost Guide" });
    expect(candidates[0]!.split(" ").length).toBeGreaterThanOrEqual(candidates.at(-1)!.split(" ").length);
  });
});
