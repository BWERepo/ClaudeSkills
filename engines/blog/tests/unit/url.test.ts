import { describe, expect, it } from "vitest";
import { isLocalHost, isStagingHost, isUnderPath, normalizeLink, urlKey } from "../../src/core/util/url.js";

describe("urlKey", () => {
  it("normalizes trailing slashes, index.html and case of the host", () => {
    expect(urlKey("https://Example.com/blog/")).toBe(urlKey("https://example.com/blog"));
    expect(urlKey("https://example.com/blog/index.html")).toBe(urlKey("https://example.com/blog"));
  });
});

describe("isUnderPath", () => {
  it("matches the prefix and its children, not siblings", () => {
    expect(isUnderPath("/blog/post", "/blog")).toBe(true);
    expect(isUnderPath("/blog", "/blog")).toBe(true);
    expect(isUnderPath("/blogging", "/blog")).toBe(false);
  });
});

describe("isLocalHost / isStagingHost", () => {
  it("flags localhost and loopback", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("example.com")).toBe(false);
  });
  it("flags configured staging hosts", () => {
    expect(isStagingHost("staging.example.com", ["staging.example.com"])).toBe(true);
    expect(isStagingHost("example.com", ["staging.example.com"])).toBe(false);
  });
});

describe("normalizeLink", () => {
  const site = "https://www.sunrisedental.example";
  it("resolves a relative link against the page URL", () => {
    const n = normalizeLink("/blog/post", `${site}/blog/`, site);
    expect(n.internal).toBe(true);
    expect(n.url).toBe(`${site}/blog/post`);
  });
  it("flags javascript: and data: links", () => {
    expect(normalizeLink("javascript:void(0)", `${site}/`, site).kind).toBe("javascript");
    expect(normalizeLink("data:text/plain;base64,aGk=", `${site}/`, site).kind).toBe("data");
  });
  it("flags a staging host as a problem", () => {
    const n = normalizeLink("https://staging.sunrisedental.example/blog/x", `${site}/`, site, ["staging.sunrisedental.example"]);
    expect(n.problems.some((p) => p.startsWith("staging"))).toBe(true);
  });
  it("marks an external link as external, not internal", () => {
    const n = normalizeLink("https://unrelated.example/", `${site}/`, site);
    expect(n.internal).toBe(false);
  });
});
