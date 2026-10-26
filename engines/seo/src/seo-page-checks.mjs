#!/usr/bin/env node
// BWESEO page checks — reusable, customer-neutral diagnostics on a page's server-rendered HTML:
//
//   1. og:url vs canonical        (compareCanonicalAndOgUrl)
//   2. social image dimensions    (parseImageSize, checkSocialImage, fetchImageSize)
//   3. above-the-fold visibility  (checkAboveFoldVisibility)
//   4. shared navigation / footer (analyzeNavigation, checkNavigation)
//
// Everything here is pure (HTML / bytes in, findings out) except fetchImageSize, which takes the caller's fetch.
// Nothing knows about any particular website. Each check returns { id, label, status, detail, ... } where status is
//   "pass"    the page is fine
//   "fail"    a defect the check can establish reliably
//   "review"  REVIEW REQUIRED — something looks off but the check cannot be certain (never claimed as a defect)
//   "skip"    not enough information to judge (e.g. a remote image that cannot be inspected safely)
//
// It is installed into a project as seo/tools/seo-page-checks.mjs and used by post-publish-check.mjs; it can also be
// run on a saved page:  node seo/tools/seo-page-checks.mjs --html page.html --url https://example.com/page [--home home.html] [--public-dir public]

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PAGE_CHECKS_VERSION = "1.0.0";
export const REVIEW_REQUIRED = "REVIEW REQUIRED";

// ---------------------------------------------------------------- small HTML helpers (no dependencies)

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (s) =>
  String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (m) => ENT[m] ?? m);

function attrsOf(tagSource) {
  const out = {};
  const inner = String(tagSource).replace(/^<\s*[a-z0-9:-]+/i, "").replace(/\/?>$/, "");
  const re = /([^\s=/>"']+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = m[3] !== undefined || m[4] !== undefined || m[5] !== undefined ? decode(m[3] ?? m[4] ?? m[5]) : "";
  return out;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "noscript", "template", "textarea", "svg"]);

// A forgiving element walker: yields every start tag with its ancestor chain, skipping the inside of script / style /
// noscript / template / svg. It is not an HTML5 parser — it does not need to be: the checks only need nesting.
export function walkElements(html) {
  const src = String(html ?? "");
  const out = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m;
  let skipUntil = null;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (skipUntil) {
      if (closing && tag === skipUntil) {
        const node = stack.pop();
        if (node) node.end = m.index + m[0].length;
        skipUntil = null;
      }
      continue;
    }
    if (closing) {
      // Pop to the matching open tag (tolerating unclosed <p>, <li>…).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const node = stack[i];
          node.end = m.index + m[0].length;
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const selfClosed = /\/\s*$/.test(m[3]) || VOID.has(tag);
    const node = { tag, attrs: attrsOf(`<${tag}${m[3]}>`), index: m.index, start: m.index, contentStart: m.index + m[0].length, end: null, parents: [...stack] };
    out.push(node);
    if (selfClosed) {
      node.end = node.contentStart;
      continue;
    }
    if (RAW.has(tag)) {
      skipUntil = tag;
      // Keep it on the stack so the closing tag is matched and ends the node.
      stack.push(node);
      continue;
    }
    stack.push(node);
  }
  return out;
}

const textBetween = (html, node) => decode(String(html).slice(node.contentStart, node.end ?? node.contentStart + 400).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- 1. og:url vs canonical

// A URL in the form used to COMPARE two page addresses. Normalizes only what cannot change which page it is:
// scheme/host case, default ports, the fragment, a trailing slash, and the order of query parameters. It deliberately
// does NOT hide differences that may be real: http vs https, www vs non-www, a different path, or a different query.
export function normalizeUrl(input, base) {
  let u;
  try {
    u = new URL(String(input).trim(), base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? "?" + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
  const path = u.pathname.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
  return { scheme: u.protocol.slice(0, -1), host: u.hostname.toLowerCase(), path, query, key: `${u.protocol}//${u.host.toLowerCase()}${path}${query}` };
}

export function compareCanonicalAndOgUrl({ canonical, ogUrl, pageUrl } = {}) {
  const base = { id: "og-url-canonical", label: "og:url matches the canonical URL" };
  const canonicals = [].concat(canonical ?? []).filter(Boolean);
  const ogs = [].concat(ogUrl ?? []).filter(Boolean);
  if (!canonicals.length || !ogs.length)
    return { ...base, status: "skip", detail: !ogs.length ? "no og:url on the page" : "no canonical on the page" };
  const c = normalizeUrl(canonicals[0], pageUrl);
  const distinctOg = [...new Set(ogs.map((o) => normalizeUrl(o, pageUrl)?.key ?? o))];
  if (!c) return { ...base, status: "skip", detail: `canonical is not a comparable URL: ${canonicals[0]}` };
  if (distinctOg.length > 1) return { ...base, status: "fail", detail: `the page has ${distinctOg.length} different og:url values: ${ogs.join(", ")}` };
  const o = normalizeUrl(ogs[0], pageUrl);
  if (!o) return { ...base, status: "fail", detail: `og:url is not a valid URL: ${ogs[0]}` };
  if (o.key === c.key) return { ...base, status: "pass", detail: c.key };
  const why = [];
  if (o.scheme !== c.scheme) why.push(`scheme (${o.scheme} vs ${c.scheme})`);
  if (o.host !== c.host) why.push(`host (${o.host} vs ${c.host})`);
  if (o.path !== c.path) why.push(`path (${o.path} vs ${c.path})`);
  if (o.query !== c.query) why.push(`query (${o.query || "none"} vs ${c.query || "none"})`);
  return { ...base, status: "fail", detail: `og:url ${ogs[0]} points to a different address than the canonical ${canonicals[0]} — differs in ${why.join(", ")}` };
}

// ---------------------------------------------------------------- 2. social image dimensions

// Pixel size from a file's first bytes. PNG, JPEG, GIF and WebP (VP8 / VP8L / VP8X). Returns null when it is not one of
// those or the bytes are too short to tell — never a guess.
export function parseImageSize(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR") return { type: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") return { type: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: "jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 " && b.length >= 30) return { type: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X" && b.length >= 30) return { type: "webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// Compares the declared og:image:width/height with the real image. `actual` is { width, height } or null when the
// image could not be inspected (remote host, network error, unsupported format) — which is a "skip", never a failure.
export function checkSocialImage({ declaredWidth, declaredHeight, actual, src, skippedReason } = {}) {
  const base = { id: "social-image-size", label: "Social image dimensions match the image" };
  const dw = declaredWidth == null || declaredWidth === "" ? null : Number(declaredWidth);
  const dh = declaredHeight == null || declaredHeight === "" ? null : Number(declaredHeight);
  if (!src) return { ...base, status: "skip", detail: "no og:image on the page" };
  if (dw == null && dh == null) return { ...base, status: "skip", detail: "no og:image:width / og:image:height declared" };
  if (!actual || !Number.isFinite(actual.width) || !Number.isFinite(actual.height))
    return { ...base, status: "skip", detail: skippedReason ?? `the image could not be inspected (${src}) — declared ${dw}×${dh} not verified` };
  const wrong = [];
  if (dw != null && dw !== actual.width) wrong.push(`width ${dw} ≠ ${actual.width}`);
  if (dh != null && dh !== actual.height) wrong.push(`height ${dh} ≠ ${actual.height}`);
  if ((dw == null) !== (dh == null)) wrong.push("only one of og:image:width / og:image:height is declared");
  if (wrong.length) return { ...base, status: "fail", detail: `declared ${dw ?? "?"}×${dh ?? "?"} but the image is ${actual.width}×${actual.height} (${wrong.join("; ")})`, actual };
  return { ...base, status: "pass", detail: `${actual.width}×${actual.height}`, actual };
}

const siteHost = (h) => String(h ?? "").toLowerCase().replace(/^www\./, "");

// Fetches the first bytes of an image to read its size — ONLY from the same site as the page (a remote host is never
// contacted: it may be a private bucket, slow, or large). Returns { actual } or { skippedReason }.
export async function fetchImageSize(fetchImpl, src, { pageUrl, maxBytes = 262144, timeoutMs = 8000 } = {}) {
  let u;
  try {
    u = new URL(src, pageUrl);
  } catch {
    return { skippedReason: `og:image is not a valid URL (${src})` };
  }
  let page;
  try {
    page = new URL(pageUrl);
  } catch {
    return { skippedReason: "no page URL to compare the image host with" };
  }
  if (siteHost(u.hostname) !== siteHost(page.hostname)) return { skippedReason: `the image is hosted on another site (${u.hostname}) — not inspected` };
  if (typeof fetchImpl !== "function") return { skippedReason: "no fetch available to read the image" };
  try {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(u.toString(), { headers: { Range: `bytes=0-${maxBytes - 1}` }, signal: ctl?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || !(res.status >= 200 && res.status < 300)) return { skippedReason: `the image returned HTTP ${res?.status ?? "no response"} — not inspected` };
    if (typeof res.arrayBuffer !== "function") return { skippedReason: "the response has no readable body — image not inspected" };
    const bytes = Buffer.from(await res.arrayBuffer()).subarray(0, maxBytes);
    const actual = parseImageSize(bytes);
    return actual ? { actual } : { skippedReason: "the image format is not one this check can read (PNG, JPEG, GIF, WebP) or the file is truncated" };
  } catch (e) {
    return { skippedReason: `the image could not be fetched (${e?.name === "AbortError" ? "timed out" : (e?.message ?? "error")}) — not inspected` };
  }
}

// Resolves an og:image URL to a file in the project's public folder(s) when it is on this site — for checking a LOCAL
// build before anything is deployed. Returns the file's bytes or null.
export function readLocalImage(src, { siteOrigin, publicDirs = [], pageUrl } = {}) {
  let u;
  try {
    u = new URL(src, pageUrl ?? siteOrigin);
  } catch {
    return null;
  }
  if (siteOrigin) {
    try {
      if (siteHost(new URL(siteOrigin).hostname) !== siteHost(u.hostname)) return null;
    } catch {
      return null;
    }
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return null;
  for (const dir of publicDirs) {
    const f = resolve(dir, rel);
    if (f.startsWith(resolve(dir)) && existsSync(f)) return readFileSync(f);
  }
  return null;
}

// ---------------------------------------------------------------- 3. above-the-fold visibility

const STYLE_HIDES = [
  [/(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:;|!|$)/i, "inline style opacity:0"],
  [/(?:^|;)\s*visibility\s*:\s*hidden\s*(?:;|!|$)/i, "inline style visibility:hidden"],
];
const STYLE_UNCERTAIN = [
  [/(?:^|;)\s*display\s*:\s*none\s*(?:;|!|$)/i, "inline style display:none"],
  [/(?:^|;)\s*(?:height|max-height)\s*:\s*0(?:px)?\s*(?:;|!|$)/i, "inline style height:0"],
  [/(?:^|;)\s*clip-path\s*:\s*inset\(\s*100%/i, "inline style clip-path inset(100%)"],
];
const CLASS_HIDES = /(?:^|\s)(?:opacity-0|invisible|sr-only-hidden|is-hidden|hidden-until-load)(?:\s|$)/;

// A class list that hides content but also names a state that shows it again (group-hover:opacity-100, md:opacity-100,
// focus-within:opacity-100 …) is a hover/responsive pattern, not content hidden until JavaScript — it is not reported.
const CLASS_RESTORES = /(?:^|\s)[a-z0-9-]+:!?(?:opacity-(?:100|[1-9]\d?)|visible)(?:\s|$)/;

// `chain` = the node is the H1 or one of its ancestors. Only there do the weaker signals (the hidden attribute,
// display:none) count: elsewhere in the section they are almost always an accordion panel or a menu.
function hiddenKind(node, { chain = false } = {}) {
  const style = node.attrs.style ?? "";
  for (const [re, label] of STYLE_HIDES) if (re.test(style)) return { certainty: "certain", how: label };
  if (chain) {
    for (const [re, label] of STYLE_UNCERTAIN) if (re.test(style)) return { certainty: "uncertain", how: label };
    if (node.attrs.hidden !== undefined && node.attrs.hidden !== "until-found") return { certainty: "uncertain", how: "the hidden attribute" };
  }
  const cls = node.attrs.class ?? "";
  if (CLASS_HIDES.test(cls) && !CLASS_RESTORES.test(cls)) return { certainty: "uncertain", how: `the "${(cls.match(CLASS_HIDES) ?? [""])[0].trim()}" class` };
  return null;
}

// Is the page's primary content visible in the server HTML? The primary content is the first <h1>. A server-rendered
// h1 (or an ancestor of it) carrying inline opacity:0 / visibility:hidden is a defect: the visitor sees nothing until
// JavaScript runs — a slow first paint. Other hidden elements in the same section, hiding by class, or display:none
// are REVIEW REQUIRED — they may well be animation set-up or a responsive toggle.
export function checkAboveFoldVisibility(html) {
  const base = { id: "above-fold-visible", label: "Above-the-fold content visible in the server HTML" };
  const nodes = walkElements(html);
  const h1 = nodes.find((n) => n.tag === "h1");
  if (!h1) return { ...base, status: "skip", detail: "no H1 in the server HTML to anchor the check on", findings: [] };
  const findings = [];
  for (const n of [...h1.parents, h1]) {
    const k = hiddenKind(n, { chain: true });
    if (k) findings.push({ element: n.tag === "h1" ? "h1" : n.tag, scope: n === h1 ? "the H1 itself" : "an ancestor of the H1", ...k });
  }
  const certain = findings.filter((f) => f.certainty === "certain");
  if (certain.length)
    return {
      ...base,
      status: "fail",
      detail: `the H1 "${textBetween(html, h1).slice(0, 60)}" is hidden in the server HTML by ${certain.map((f) => `${f.how} on ${f.scope === "the H1 itself" ? "itself" : `<${f.element}>`}`).join("; ")} — visitors see nothing until JavaScript runs`,
      findings,
    };
  // Not certain: anything else that hides content in the H1's own section, or uncertain hiding on the H1's chain.
  const section = [...h1.parents].reverse().find((p) => ["section", "header", "main", "article"].includes(p.tag));
  const inSection = section ? nodes.filter((n) => n !== h1 && n.index > section.index && n.index < (section.end ?? Infinity)) : [];
  const sectionHidden = inSection
    .map((n) => ({ n, k: hiddenKind(n) }))
    .filter(({ k }) => k)
    .filter(({ n }) => !["nav", "dialog"].includes(n.tag))
    .slice(0, 8)
    .map(({ n, k }) => ({ element: n.tag, scope: "in the same section as the H1", ...k }));
  const review = [...findings, ...sectionHidden];
  const grouped = new Map();
  for (const f of review) {
    const key = `<${f.element}> hidden by ${f.how} (${f.scope})`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  if (review.length)
    return {
      ...base,
      status: "review",
      detail: `${REVIEW_REQUIRED}: ${[...grouped].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k)).join("; ")} — may be intentional (a menu, an animation) or may hide content until JavaScript loads; check the page before it is shown to visitors`,
      findings: review,
    };
  return { ...base, status: "pass", detail: `the H1 "${textBetween(html, h1).slice(0, 60)}" and its section are visible in the server HTML`, findings: [] };
}

// ---------------------------------------------------------------- 4. shared navigation / footer

const isPlainFragment = (href) => /^#/.test(href ?? "") && !/^#!?\/?$/.test(href) && href !== "#top";

// What a page's navigation looks like in its server HTML: which landmarks exist, how many links each holds, and which
// in-page "#anchors" in the navigation / footer point at nothing on the page.
export function analyzeNavigation(html) {
  const nodes = walkElements(html);
  const ids = new Set();
  for (const n of nodes) {
    if (n.attrs.id) ids.add(n.attrs.id);
    if (n.tag === "a" && n.attrs.name) ids.add(n.attrs.name);
  }
  const within = (n, tag) => n.parents.some((p) => p.tag === tag) || n.tag === tag;
  const inLandmark = (n, tags) => tags.find((t) => within(n, t)) ?? null;
  const links = nodes.filter((n) => n.tag === "a" && n.attrs.href !== undefined);
  const count = (tags) => links.filter((a) => inLandmark(a, tags)).length;
  const navs = nodes.filter((n) => n.tag === "nav" || (n.tag === "div" && n.attrs.role === "navigation"));
  const headers = nodes.filter((n) => n.tag === "header" && !n.parents.some((p) => ["article", "section", "main"].includes(p.tag)));
  const footers = nodes.filter((n) => n.tag === "footer" && !n.parents.some((p) => ["article", "section", "main"].includes(p.tag)));
  const broken = [];
  for (const a of links) {
    const where = inLandmark(a, ["nav", "header", "footer"]);
    if (!where || !isPlainFragment(a.attrs.href)) continue;
    const id = decodeURIComponent(a.attrs.href.slice(1));
    if (!ids.has(id) && !ids.has(a.attrs.href.slice(1))) broken.push({ href: a.attrs.href, in: where, text: textBetween(html, a) });
  }
  return {
    hasNav: navs.length > 0,
    hasHeader: headers.length > 0,
    hasFooter: footers.length > 0,
    navLinks: count(["nav"]),
    headerLinks: count(["header"]),
    footerLinks: count(["footer"]),
    // "site navigation" = a <nav>, or a site <header>, that actually holds links
    hasSiteNavigation: navs.some((n) => links.some((a) => a.parents.includes(n))) || headers.some((h) => links.some((a) => a.parents.includes(h) && a.index >= h.index)),
    brokenFragments: broken,
  };
}

// Checks one page's navigation against a reference page (normally the site's home page). `isHome` turns off the
// "compared with home" checks. Returns an array of checks:
//   nav-anchors      fail  when a navigation/footer "#anchor" has no target on the page (reliable: ids are in the HTML)
//   site-navigation  fail  when this page has no navigation but the reference does;
//                    review when the reference has none either, or cannot be read (nothing to compare with)
//   site-footer      fail  when this page has no footer but the reference does; review likewise
export function checkNavigation({ html, homeHtml = null, isHome = false, noindex = false } = {}) {
  const page = analyzeNavigation(html);
  const out = [];
  const brokenList = page.brokenFragments.slice(0, 8).map((b) => `${b.href} (${b.in}: "${b.text}")`).join(", ");
  out.push(
    page.brokenFragments.length
      ? { id: "nav-anchors", label: "Navigation and footer anchors point at something on the page", status: "fail", detail: `${page.brokenFragments.length} in-page anchor(s) in the navigation/footer have no matching element on this page: ${brokenList} — on a page other than the home page, link to the home page section instead (e.g. "/#pricing")`, findings: page.brokenFragments }
      : { id: "nav-anchors", label: "Navigation and footer anchors point at something on the page", status: "pass", detail: "no dead in-page anchors in the navigation or footer" },
  );
  if (isHome || noindex) {
    const why = isHome ? "this is the reference page" : "the page is noindex (a standalone page is allowed to have no site navigation)";
    out.push({ id: "site-navigation", label: "Site navigation present", status: "skip", detail: why });
    out.push({ id: "site-footer", label: "Site footer present", status: "skip", detail: why });
    return out;
  }
  const ref = homeHtml ? analyzeNavigation(homeHtml) : null;
  const judge = (id, label, pageHas, refHas, noun) => {
    if (pageHas) return { id, label, status: "pass", detail: `${noun} present` };
    if (!ref) return { id, label, status: "skip", detail: `no ${noun} on this page, and the reference page could not be read to know whether one is expected` };
    if (refHas) return { id, label, status: "fail", detail: `this page has no ${noun}, but the site's home page has one — visitors who land here from search cannot reach the rest of the site` };
    return { id, label, status: "review", detail: `${REVIEW_REQUIRED}: no ${noun} on this page, and none was found on the reference page either, so it is unclear whether one is expected` };
  };
  out.push(judge("site-navigation", "Site navigation present", page.hasSiteNavigation, ref?.hasSiteNavigation, "site navigation (a <nav> or <header> with links)"));
  out.push(judge("site-footer", "Site footer present", page.hasFooter, ref?.hasFooter, "site footer"));
  return out;
}

// ---------------------------------------------------------------- everything, for one page

// Runs the four checks on one page's HTML. `head` is post-publish-check's extractHead() result (or anything with
// canonicals / ogUrl / ogImage / ogImageWidth / ogImageHeight).
export async function runPageChecks({ html, head, pageUrl, homeHtml = null, isHome = false, fetchImpl = null, localImage = null } = {}) {
  const checks = [];
  checks.push(compareCanonicalAndOgUrl({ canonical: head?.canonicals, ogUrl: head?.ogUrl, pageUrl }));
  const src = head?.ogImage ?? null;
  if (!src) checks.push(checkSocialImage({}));
  else {
    let actual = null;
    let skippedReason;
    const local = localImage ? localImage(src) : null;
    if (local) actual = parseImageSize(local);
    else if (fetchImpl) ({ actual = null, skippedReason } = await fetchImageSize(fetchImpl, src, { pageUrl }));
    else skippedReason = "no fetch or local image available — image not inspected";
    checks.push(checkSocialImage({ declaredWidth: head?.ogImageWidth, declaredHeight: head?.ogImageHeight, actual, src, skippedReason }));
  }
  checks.push(checkAboveFoldVisibility(html));
  const noindex = (head?.robots ?? []).some((r) => /noindex/i.test(r));
  checks.push(...checkNavigation({ html, homeHtml, isHome, noindex }));
  return checks;
}

// ---------------------------------------------------------------- CLI

function metaContent(html, key) {
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if ((a.property ?? a.name ?? "").toLowerCase() === key) return a.content ?? null;
  }
  return null;
}
export function headFromHtml(html) {
  const canonicals = [...String(html).matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0])).filter((a) => (a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")).map((a) => a.href ?? "");
  const robots = [...String(html).matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0])).filter((a) => ["robots", "googlebot"].includes((a.name ?? "").toLowerCase())).map((a) => a.content ?? "");
  return { canonicals, robots, ogUrl: metaContent(html, "og:url"), ogImage: metaContent(html, "og:image"), ogImageWidth: metaContent(html, "og:image:width"), ogImageHeight: metaContent(html, "og:image:height") };
}

const MARK = { pass: "✓", fail: "✗", review: "?", skip: "–" };
export function formatPageChecks(checks) {
  return checks.map((c) => `${MARK[c.status] ?? "•"} ${c.label} — ${c.detail}`).join("\n");
}

async function cli(argv) {
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const htmlFile = arg("--html");
  if (!htmlFile || argv.includes("--help")) {
    console.log("usage: node seo/tools/seo-page-checks.mjs --html <page.html> --url <page URL> [--home <home.html>] [--is-home] [--public-dir <dir>]... [--json]");
    return htmlFile ? 0 : 1;
  }
  let html;
  try { html = readFileSync(htmlFile, "utf8"); } catch (e) { console.error(`cannot read ${htmlFile}: ${e.code ?? e.message}`); return 3; }
  const pageUrl = arg("--url") ?? undefined;
  let homeHtml = null;
  if (arg("--home")) { try { homeHtml = readFileSync(arg("--home"), "utf8"); } catch (e) { console.error(`cannot read ${arg("--home")}: ${e.code ?? e.message}`); return 3; } }
  const publicDirs = argv.flatMap((a, i) => (a === "--public-dir" ? [join(process.cwd(), argv[i + 1])] : []));
  const head = headFromHtml(html);
  const checks = await runPageChecks({
    html,
    head,
    pageUrl,
    homeHtml,
    isHome: argv.includes("--is-home"),
    localImage: publicDirs.length ? (s) => readLocalImage(s, { publicDirs, pageUrl, siteOrigin: pageUrl ? new URL(pageUrl).origin : undefined }) : null,
  });
  console.log(argv.includes("--json") ? JSON.stringify(checks, null, 2) : formatPageChecks(checks));
  return checks.some((c) => c.status === "fail") ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).then((c) => process.exit(c));
