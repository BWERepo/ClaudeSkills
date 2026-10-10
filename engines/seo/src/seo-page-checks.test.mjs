// Generic tests for the reusable page checks (seo-page-checks.mjs). Fictional example.com data only — this file is
// installed into customer projects, so it must never contain a real business, domain or page.
import { describe, expect, it } from "vitest";
import {
  analyzeNavigation,
  checkAboveFoldVisibility,
  checkNavigation,
  checkSocialImage,
  compareCanonicalAndOgUrl,
  fetchImageSize,
  formatPageChecks,
  headFromHtml,
  normalizeUrl,
  parseImageSize,
  runPageChecks,
  walkElements,
} from "./seo-page-checks.mjs";

// ---------------------------------------------------------------- tiny real images, built byte by byte
const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w, h) => {
  // SOI, an APP0 segment to be skipped, then SOF0 carrying the size
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
};
const gif = (w, h) => {
  const b = Buffer.alloc(13);
  b.write("GIF89a", 0, "ascii");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};
const webpX = (w, h) => {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};

// ================================================================ 1. og:url vs canonical
describe("normalizeUrl", () => {
  it("treats case, default ports, fragments, a trailing slash and query order as the same page", () => {
    const k = (u) => normalizeUrl(u).key;
    expect(k("https://Example.com/Pricing/")).toBe(k("https://example.com/Pricing"));
    expect(k("https://example.com:443/a")).toBe(k("https://example.com/a"));
    expect(k("https://example.com/a#section")).toBe(k("https://example.com/a"));
    expect(k("https://example.com/a?x=1&y=2")).toBe(k("https://example.com/a?y=2&x=1"));
    expect(k("https://example.com/")).toBe(k("https://example.com"));
  });
  it("keeps what can be a different page: scheme, www, path and query", () => {
    const k = (u) => normalizeUrl(u).key;
    expect(k("http://example.com/a")).not.toBe(k("https://example.com/a"));
    expect(k("https://www.example.com/a")).not.toBe(k("https://example.com/a"));
    expect(k("https://example.com/a")).not.toBe(k("https://example.com/b"));
    expect(k("https://example.com/a?page=2")).not.toBe(k("https://example.com/a"));
  });
  it("resolves relative URLs and rejects non-web ones", () => {
    expect(normalizeUrl("/a", "https://example.com/x").key).toBe("https://example.com/a");
    expect(normalizeUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("compareCanonicalAndOgUrl", () => {
  const cmp = (canonical, ogUrl) => compareCanonicalAndOgUrl({ canonical, ogUrl, pageUrl: "https://example.com/p" });
  it("passes identical and equivalent URLs — no false positive for slash / fragment / case / port", () => {
    expect(cmp(["https://example.com/pricing"], "https://example.com/pricing").status).toBe("pass");
    expect(cmp(["https://example.com/pricing"], "https://example.com/pricing/").status).toBe("pass");
    expect(cmp(["https://example.com/pricing"], "https://example.com/pricing#faq").status).toBe("pass");
    expect(cmp(["https://EXAMPLE.com:443/pricing"], "https://example.com/pricing").status).toBe("pass");
    expect(cmp(["https://example.com/"], "https://example.com").status).toBe("pass");
  });
  it("fails a genuinely different page — the inherited-homepage og:url bug", () => {
    const r = cmp(["https://example.com/pricing"], "https://example.com/");
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/path \(\/ vs \/pricing\)/);
  });
  it("names exactly what differs: scheme, host, query", () => {
    expect(cmp(["https://example.com/a"], "http://example.com/a").detail).toMatch(/scheme/);
    expect(cmp(["https://example.com/a"], "https://www.example.com/a").detail).toMatch(/host/);
    expect(cmp(["https://example.com/a"], "https://example.com/a?ref=x").detail).toMatch(/query/);
    expect(cmp(["https://example.com/a"], "https://example.com/a?ref=x").status).toBe("fail");
  });
  it("fails when the page carries two different og:url values", () => {
    expect(cmp(["https://example.com/a"], ["https://example.com/a", "https://example.com/"]).status).toBe("fail");
    expect(cmp(["https://example.com/a"], ["https://example.com/a", "https://example.com/a/"]).status).toBe("pass");
  });
  it("skips, never fails, when one of the two is absent", () => {
    expect(cmp([], "https://example.com/a").status).toBe("skip");
    expect(cmp(["https://example.com/a"], null).status).toBe("skip");
  });
});

// ================================================================ 2. social image dimensions
describe("parseImageSize", () => {
  it("reads PNG, JPEG (past other segments), GIF and WebP", () => {
    expect(parseImageSize(png(1200, 630))).toEqual({ type: "png", width: 1200, height: 630 });
    expect(parseImageSize(jpeg(746, 583))).toEqual({ type: "jpeg", width: 746, height: 583 });
    expect(parseImageSize(gif(300, 200))).toEqual({ type: "gif", width: 300, height: 200 });
    expect(parseImageSize(webpX(1200, 630))).toEqual({ type: "webp", width: 1200, height: 630 });
  });
  it("returns null — never a guess — for unknown, empty or truncated data", () => {
    expect(parseImageSize(Buffer.from("<html>not an image</html>"))).toBeNull();
    expect(parseImageSize(Buffer.alloc(0))).toBeNull();
    expect(parseImageSize(png(10, 10).subarray(0, 12))).toBeNull();
    expect(parseImageSize(jpeg(10, 10).subarray(0, 8))).toBeNull();
    expect(parseImageSize(undefined)).toBeNull();
  });
});

describe("checkSocialImage", () => {
  const src = "https://example.com/og.jpg";
  it("passes when the declared size is the real size", () => {
    const r = checkSocialImage({ declaredWidth: "1200", declaredHeight: "630", actual: { width: 1200, height: 630 }, src });
    expect(r.status).toBe("pass");
  });
  it("fails a real mismatch and says both sizes", () => {
    const r = checkSocialImage({ declaredWidth: "1200", declaredHeight: "630", actual: { width: 746, height: 583 }, src });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/declared 1200×630 but the image is 746×583/);
  });
  it("fails when only one dimension is declared", () => {
    expect(checkSocialImage({ declaredWidth: "1200", declaredHeight: null, actual: { width: 1200, height: 630 }, src }).status).toBe("fail");
  });
  it("does not fail an image that could not be inspected", () => {
    const r = checkSocialImage({ declaredWidth: 1200, declaredHeight: 630, actual: null, src, skippedReason: "the image is hosted on another site — not inspected" });
    expect(r.status).toBe("skip");
    expect(r.detail).toMatch(/another site/);
  });
  it("skips when there is no image or no declared size", () => {
    expect(checkSocialImage({}).status).toBe("skip");
    expect(checkSocialImage({ src, actual: { width: 1, height: 1 } }).status).toBe("skip");
  });
});

describe("fetchImageSize", () => {
  const res = (status, body) => ({ status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
  const page = "https://example.com/p";
  it("reads the size of a same-site image", async () => {
    let asked = null;
    const r = await fetchImageSize(async (u, o) => ((asked = { u, o }), res(206, png(1200, 630))), "https://example.com/og.png", { pageUrl: page });
    expect(r.actual).toEqual({ type: "png", width: 1200, height: 630 });
    expect(asked.o.headers.Range).toMatch(/^bytes=0-/);
  });
  it("accepts a relative og:image and the www / non-www variant of the site", async () => {
    expect((await fetchImageSize(async () => res(200, png(10, 20)), "/og.png", { pageUrl: page })).actual.height).toBe(20);
    expect((await fetchImageSize(async () => res(200, png(10, 20)), "https://www.example.com/og.png", { pageUrl: page })).actual.width).toBe(10);
  });
  it("never contacts another host", async () => {
    let called = false;
    const r = await fetchImageSize(async () => ((called = true), res(200, png(1, 1))), "https://cdn.other.test/og.png", { pageUrl: page });
    expect(called).toBe(false);
    expect(r.skippedReason).toMatch(/another site/);
  });
  it("turns HTTP errors, network errors, unreadable bodies and unknown formats into a skip", async () => {
    expect((await fetchImageSize(async () => res(404, Buffer.from("x")), "/og.png", { pageUrl: page })).skippedReason).toMatch(/HTTP 404/);
    expect((await fetchImageSize(async () => { throw new Error("boom"); }, "/og.png", { pageUrl: page })).skippedReason).toMatch(/could not be fetched/);
    expect((await fetchImageSize(async () => ({ status: 200 }), "/og.png", { pageUrl: page })).skippedReason).toMatch(/no readable body/);
    expect((await fetchImageSize(async () => res(200, Buffer.from("<html>")), "/og.png", { pageUrl: page })).skippedReason).toMatch(/not one this check can read/);
    expect((await fetchImageSize(null, "/og.png", { pageUrl: page })).skippedReason).toMatch(/no fetch/);
  });
});

// ================================================================ 3. above-the-fold visibility
const page = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

describe("walkElements", () => {
  it("tracks ancestors and ignores what is inside script, style, noscript and comments", () => {
    const els = walkElements(page(`<div id="a"><!-- <h1 style="opacity:0"> --><script>var s = "<h1>";</script><p id="b">x</p></div><noscript><h1>no</h1></noscript><h1 id="c">y</h1>`));
    expect(els.filter((e) => e.tag === "h1")).toHaveLength(1);
    expect(els.find((e) => e.attrs.id === "b").parents.map((p) => p.tag)).toEqual(["html", "body", "div"]);
    expect(els.find((e) => e.attrs.id === "c").parents.map((p) => p.tag)).toEqual(["html", "body"]);
  });
  it("copes with void tags and unclosed paragraphs", () => {
    const els = walkElements(page(`<main><p>one<br><img src="a.png"><p>two</main><h1>after</h1>`));
    expect(els.find((e) => e.tag === "h1").parents.map((p) => p.tag)).toEqual(["html", "body"]);
  });
});

describe("checkAboveFoldVisibility", () => {
  it("FAILS when an ancestor of the H1 is server-rendered at opacity:0", () => {
    const r = checkAboveFoldVisibility(page(`<section><div style="opacity:0;transform:translateY(20px)"><h1>Welcome to Example</h1></div></section>`));
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/inline style opacity:0/);
    expect(r.detail).toMatch(/Welcome to Example/);
  });
  it("FAILS for opacity:0 with spacing / a trailing !important, opacity:0.0, and visibility:hidden on the H1 itself", () => {
    expect(checkAboveFoldVisibility(page(`<div style="transition: all .3s; opacity : 0 !important"><h1>A</h1></div>`)).status).toBe("fail");
    expect(checkAboveFoldVisibility(page(`<div style="opacity:0.0"><h1>A</h1></div>`)).status).toBe("fail");
    expect(checkAboveFoldVisibility(page(`<h1 style="visibility:hidden">A</h1>`)).status).toBe("fail");
  });
  it("PASSES a visible H1 and does not mistake opacity:0.5, opacity:1 or a different property for hiding", () => {
    expect(checkAboveFoldVisibility(page(`<section><h1>Hello</h1><p>text</p></section>`)).status).toBe("pass");
    expect(checkAboveFoldVisibility(page(`<div style="opacity:0.5"><h1>A</h1></div>`)).status).toBe("pass");
    expect(checkAboveFoldVisibility(page(`<div style="opacity:1"><h1>A</h1></div>`)).status).toBe("pass");
    expect(checkAboveFoldVisibility(page(`<div style="margin-opacity:0"><h1>A</h1></div>`)).status).toBe("pass");
  });
  it("is REVIEW REQUIRED — not a failure — when hiding is by class, the hidden attribute or display:none", () => {
    for (const wrapper of [`<div class="grid opacity-0">`, `<div class="invisible">`, `<div hidden>`, `<div style="display:none">`]) {
      const r = checkAboveFoldVisibility(page(`${wrapper}<h1>Hi</h1></div>`));
      expect(r.status, wrapper).toBe("review");
      expect(r.detail).toMatch(/REVIEW REQUIRED/);
    }
  });
  it("does not report hover / responsive patterns: a hiding class that names a state showing it again", () => {
    for (const cls of ["opacity-0 group-hover:opacity-100", "grid opacity-0 md:opacity-100", "invisible focus-within:visible"]) {
      expect(checkAboveFoldVisibility(page(`<section><div class="${cls}"><h1>Hi</h1></div></section>`)).status, cls).toBe("pass");
      expect(checkAboveFoldVisibility(page(`<section><h1>Hi</h1><div class="${cls}">card overlay</div></section>`)).status, cls).toBe("pass");
    }
  });
  it("ignores accordion panels and other hidden / display:none blocks that are not on the H1's own chain", () => {
    const r = checkAboveFoldVisibility(page(`<section><h1>Hi</h1><div hidden>panel one</div><div hidden>panel two</div><div style="display:none">menu</div></section>`));
    expect(r.status).toBe("pass");
  });
  it("groups repeated findings instead of listing each one", () => {
    const r = checkAboveFoldVisibility(page(`<section><h1>Hi</h1><div class="opacity-0">a</div><div class="opacity-0">b</div><div class="opacity-0">c</div></section>`));
    expect(r.status).toBe("review");
    expect(r.detail).toMatch(/3 × <div> hidden by the "opacity-0" class/);
  });
  it("is REVIEW REQUIRED when other content in the H1's own section is hidden, and PASSES when the hidden thing is elsewhere", () => {
    const inSection = checkAboveFoldVisibility(page(`<section><h1>Hi</h1><div style="opacity:0"><a href="/go">Get started</a></div></section>`));
    expect(inSection.status).toBe("review");
    const elsewhere = checkAboveFoldVisibility(page(`<section><h1>Hi</h1></section><section><div style="opacity:0">later</div></section>`));
    expect(elsewhere.status).toBe("pass");
  });
  it("ignores a hidden navigation menu / dialog in the same section", () => {
    const r = checkAboveFoldVisibility(page(`<header><nav hidden><a href="/a">A</a></nav><h1>Hi</h1></header>`));
    expect(r.status).toBe("pass");
  });
  it("ignores opacity:0 that only appears inside script, style or noscript", () => {
    const r = checkAboveFoldVisibility(page(`<style>.x{opacity:0}</style><script>el.style="opacity:0"</script><noscript><div style="opacity:0"></div></noscript><h1>Hi</h1>`));
    expect(r.status).toBe("pass");
  });
  it("skips a page with no H1 instead of guessing", () => {
    expect(checkAboveFoldVisibility(page(`<div style="opacity:0">x</div>`)).status).toBe("skip");
  });
});

// ================================================================ 4. navigation and footer
const nav = `<header><nav><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/#faq">FAQ</a></nav></header>`;
const foot = `<footer><a href="/privacy">Privacy</a></footer>`;
const home = page(`${nav}<main><h1>Home</h1><section id="faq">faq</section></main>${foot}`);

describe("analyzeNavigation", () => {
  it("finds landmarks and counts their links", () => {
    const a = analyzeNavigation(home);
    expect(a).toMatchObject({ hasNav: true, hasHeader: true, hasFooter: true, hasSiteNavigation: true });
    expect(a.navLinks).toBe(3);
    expect(a.footerLinks).toBe(1);
  });
  it("does not treat a header or footer nested inside an article/section as the site's", () => {
    const a = analyzeNavigation(page(`<main><article><header><a href="/x">x</a></header><footer><a href="/y">y</a></footer></article></main>`));
    expect(a.hasHeader).toBe(false);
    expect(a.hasFooter).toBe(false);
  });
  it("finds dead in-page anchors in the navigation and footer only", () => {
    const a = analyzeNavigation(page(`<nav><a href="#pricing">Pricing</a><a href="#top">Top</a><a href="#">Up</a><a href="/#faq">FAQ</a></nav><main><a href="#nowhere">body link</a></main><footer><a href="#contact">Contact</a></footer>`));
    expect(a.brokenFragments.map((b) => b.href).sort()).toEqual(["#contact", "#pricing"]);
  });
  it("accepts an anchor whose target is an id or a named anchor on the page", () => {
    const a = analyzeNavigation(page(`<nav><a href="#pricing">P</a><a href="#faq">F</a></nav><section id="pricing"></section><a name="faq"></a>`));
    expect(a.brokenFragments).toEqual([]);
  });
});

describe("checkNavigation", () => {
  const byId = (checks, id) => checks.find((c) => c.id === id);
  it("FAILS a sub-page with no navigation and no footer when the home page has both", () => {
    const checks = checkNavigation({ html: page(`<main><h1>About</h1><a href="/pricing">Pricing</a></main>`), homeHtml: home });
    expect(byId(checks, "site-navigation").status).toBe("fail");
    expect(byId(checks, "site-footer").status).toBe("fail");
    expect(byId(checks, "site-navigation").detail).toMatch(/home page has one/);
  });
  it("PASSES a sub-page with the shared header and footer", () => {
    const checks = checkNavigation({ html: page(`${nav}<main><h1>About</h1></main>${foot}`), homeHtml: home });
    expect(checks.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
  });
  it("FAILS footer anchors that only work on the home page, when seen on a sub-page", () => {
    const sub = page(`${nav}<main><h1>About</h1></main><footer><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></footer>`);
    const r = byId(checkNavigation({ html: sub, homeHtml: home }), "nav-anchors");
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/#pricing/);
    expect(r.detail).toMatch(/\/#pricing/); // the suggested fix
  });
  it("the same anchors are fine on the home page itself", () => {
    const h = page(`${nav}<main><h1>Home</h1><section id="pricing"></section></main><footer><a href="#pricing">Pricing</a></footer>`);
    expect(byId(checkNavigation({ html: h, isHome: true }), "nav-anchors").status).toBe("pass");
  });
  it("is REVIEW REQUIRED when the home page has no navigation either — nothing to compare with", () => {
    const bare = page(`<main><h1>Home</h1></main>`);
    const checks = checkNavigation({ html: page(`<main><h1>About</h1></main>`), homeHtml: bare });
    expect(byId(checks, "site-navigation").status).toBe("review");
    expect(byId(checks, "site-navigation").detail).toMatch(/REVIEW REQUIRED/);
    expect(byId(checks, "site-footer").status).toBe("review");
  });
  it("skips, rather than fails, when the home page could not be read", () => {
    const checks = checkNavigation({ html: page(`<main><h1>About</h1></main>`), homeHtml: null });
    expect(byId(checks, "site-navigation").status).toBe("skip");
    expect(byId(checks, "site-footer").status).toBe("skip");
  });
  it("skips a noindex page — a standalone page may have no site navigation", () => {
    const checks = checkNavigation({ html: page(`<main><h1>Demo</h1></main>`), homeHtml: home, noindex: true });
    expect(byId(checks, "site-navigation").status).toBe("skip");
    expect(byId(checks, "site-footer").status).toBe("skip");
  });
  it("does not count an empty <nav> or a link-less header as site navigation", () => {
    const checks = checkNavigation({ html: page(`<header><h2>Brand</h2></header><nav></nav><main><h1>About</h1></main>${foot}`), homeHtml: home });
    expect(byId(checks, "site-navigation").status).toBe("fail");
  });
});

// ================================================================ all of it together
describe("runPageChecks / headFromHtml / formatPageChecks", () => {
  const doc = (extra = "", body = `${nav}<main><h1>About</h1></main>${foot}`) =>
    `<!doctype html><html><head><title>About</title><link rel="canonical" href="https://example.com/about"><meta property="og:url" content="https://example.com/about"><meta property="og:image" content="https://example.com/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">${extra}</head><body>${body}</body></html>`;

  it("reads the head", () => {
    expect(headFromHtml(doc())).toMatchObject({ canonicals: ["https://example.com/about"], ogUrl: "https://example.com/about", ogImage: "https://example.com/og.png", ogImageWidth: "1200", ogImageHeight: "630" });
  });
  it("a healthy page passes every check (local image)", async () => {
    const html = doc();
    const checks = await runPageChecks({ html, head: headFromHtml(html), pageUrl: "https://example.com/about", homeHtml: home, localImage: () => png(1200, 630) });
    expect(checks.map((c) => `${c.id}:${c.status}`)).toEqual(["og-url-canonical:pass", "social-image-size:pass", "above-fold-visible:pass", "nav-anchors:pass", "site-navigation:pass", "site-footer:pass"]);
  });
  it("catches the whole family of defects at once", async () => {
    const html = doc("", `<main><div style="opacity:0"><h1>About</h1></div></main><footer><a href="#pricing">Pricing</a></footer>`).replace('content="https://example.com/about"><meta property="og:image"', 'content="https://example.com/"><meta property="og:image"');
    const checks = await runPageChecks({ html, head: headFromHtml(html), pageUrl: "https://example.com/about", homeHtml: home, localImage: () => png(746, 583) });
    const failed = checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(["og-url-canonical", "social-image-size", "above-fold-visible", "nav-anchors", "site-navigation"]));
  });
  it("uses the provided fetch for a same-site image and skips a remote one, without failing", async () => {
    const html = doc();
    const fetchImpl = async () => ({ status: 200, arrayBuffer: async () => png(1200, 630).buffer });
    const same = await runPageChecks({ html, head: headFromHtml(html), pageUrl: "https://example.com/about", homeHtml: home, fetchImpl });
    expect(same.find((c) => c.id === "social-image-size").status).toBe("pass");
    const remote = html.replace("https://example.com/og.png", "https://cdn.other.test/og.png");
    const r = await runPageChecks({ html: remote, head: headFromHtml(remote), pageUrl: "https://example.com/about", homeHtml: home, fetchImpl });
    expect(r.find((c) => c.id === "social-image-size").status).toBe("skip");
  });
  it("formats REVIEW REQUIRED with its own mark", () => {
    const text = formatPageChecks([{ status: "review", label: "L", detail: "REVIEW REQUIRED: d" }, { status: "fail", label: "F", detail: "x" }]);
    expect(text).toContain("? L");
    expect(text).toContain("✗ F");
  });
});
