import { describe, expect, it } from "vitest";
import { isValidSlug, slugify, uniqueSlug } from "../../src/core/util/slug.js";

describe("slugify", () => {
  it("lowercases, strips punctuation and hyphenates", () => {
    expect(slugify("How to Prevent Cavities?")).toBe("how-to-prevent-cavities");
  });
  it("collapses repeated separators", () => {
    expect(slugify("  A --- B  ")).toBe("a-b");
  });
  it("is deterministic for the same input", () => {
    expect(slugify("Dental Implants Cost")).toBe(slugify("Dental Implants Cost"));
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase, digits and hyphens", () => {
    expect(isValidSlug("teeth-whitening-101")).toBe(true);
  });
  it("rejects spaces, uppercase and leading/trailing hyphens", () => {
    expect(isValidSlug("Teeth Whitening")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", () => {
    expect(uniqueSlug("teeth-whitening", new Set())).toBe("teeth-whitening");
  });
  it("appends -2, -3... until a free slug is found", () => {
    const taken = new Set(["teeth-whitening", "teeth-whitening-2"]);
    expect(uniqueSlug("teeth-whitening", taken)).toBe("teeth-whitening-3");
  });
  it("accepts a predicate instead of a Set", () => {
    expect(uniqueSlug("x", (s) => s === "x")).toBe("x-2");
  });
});
