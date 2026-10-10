import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash, metadataHash, sha256, stableId } from "../../src/core/util/hash.js";

describe("contentHash", () => {
  it("is stable for the same content", () => {
    expect(contentHash("Hello world")).toBe(contentHash("Hello world"));
  });
  it("ignores whitespace and line-ending noise", () => {
    expect(contentHash("Hello   world\r\n\r\n\r\nMore")).toBe(contentHash("Hello world\n\nMore"));
  });
  it("differs for different content", () => {
    expect(contentHash("Hello world")).not.toBe(contentHash("Goodbye world"));
  });
});

describe("metadataHash / canonicalJson", () => {
  it("is independent of key order", () => {
    expect(metadataHash({ a: 1, b: 2 })).toBe(metadataHash({ b: 2, a: 1 }));
  });
  it("canonicalJson sorts nested object keys too", () => {
    expect(canonicalJson({ z: 1, a: { y: 1, x: 2 } })).toBe(canonicalJson({ a: { x: 2, y: 1 }, z: 1 }));
  });
});

describe("stableId", () => {
  it("is deterministic and idempotent for the same URL", () => {
    const id1 = stableId("art", "https://example.com/blog/post");
    const id2 = stableId("art", "https://example.com/blog/post");
    expect(id1).toBe(id2);
    expect(id1.startsWith("art-")).toBe(true);
  });
  it("differs for different inputs", () => {
    expect(stableId("art", "a")).not.toBe(stableId("art", "b"));
  });
});

describe("sha256", () => {
  it("produces a 64-char hex digest", () => {
    expect(sha256("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
