// BWESEO target-page and sitemap validation for the Keyword Performance System — pure functions (Node 18+, Worker, browser).
// Engine 1.10.0. The caller fetches the page / sitemap / robots.txt (a site adapter, or the CLI) and hands the text in;
// nothing here touches the network. It reports FACTS about the page. It does not score keyword density: it asks whether the page
// states its topic where a reader and a search engine look for it (title, H1, opening copy), which is a judgement for a person to confirm.
import { normalizeUrl, parseSitemapLocs, isSitemapIndex } from "./index-monitor.mjs";
import { normalizeKeyword } from "./keyword-registry.mjs";

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const strip = (h) => decode(String(h ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
const attrOf = (tag, name) => {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decode(m[1] ?? m[2]) : "";
};

// ---------------------------------------------------------------- reading the page

export function readPage(html, origin) {
  const h = String(html ?? "");
  const metas = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const metaContent = (name) => metas.filter((t) => new RegExp(`name\\s*=\\s*["']${name}["']`, "i").test(t)).map((t) => attrOf(t, "content")).join(",");
  const canonTag = [...h.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /rel\s*=\s*["']canonical["']/i.test(t));
  const body = /<body[\s>][\s\S]*$/i.exec(h)?.[0] ?? h;
  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])).filter(Boolean);
  const types = new Set();
  for (const m of h.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          for (const t of [].concat(n["@type"] ?? [])) if (isStr(t)) types.add(t);
          Object.values(n).forEach(walk);
        }
      };
      walk(JSON.parse(m[1]));
    } catch {
      types.add("(unparseable JSON-LD)");
    }
  }
  const links = new Set();
  for (const m of h.matchAll(/<a\b[^>]*>/gi)) {
    const href = attrOf(m[0], "href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    const n = origin ? normalizeUrl(href, origin) : null;
    if (n) links.add(n.path.split("?")[0]);
  }
  const text = strip(body);
  return {
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? "") || null,
    metaDescription: decode(metaContent("description")) || null,
    robotsMeta: metaContent("robots").toLowerCase(),
    canonicalUrl: canonTag ? attrOf(canonTag, "href") || null : null,
    h1s,
    text,
    words: text ? text.split(/\s+/).length : 0,
    structuredDataTypes: [...types],
    links: [...links],
  };
}

// ---------------------------------------------------------------- robots.txt (crawlability)

// Is this path blocked for "User-agent: *" or Googlebot by robots.txt? Simple prefix rules (+ "*" and "$"), longest match wins,
// Allow beats Disallow on a tie. null robotsTxt = unknown (the caller could not fetch it), which is NOT the same as allowed.
export function robotsAllows(robotsTxt, path) {
  if (!isStr(robotsTxt)) return { allowed: null, basis: "robots.txt was not available" };
  let group = null;
  const rules = [];
  let applies = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (group !== "ua") { applies = false; group = "ua"; }
      if (/^(\*|googlebot)$/i.test(m[2].trim())) applies = true;
    } else {
      group = "rules";
      if (applies && (key === "allow" || key === "disallow") && m[2].trim()) rules.push({ allow: key === "allow", pattern: m[2].trim() });
    }
  }
  const rx = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  let best = null;
  for (const r of rules) if (rx(r.pattern).test(path) && (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))) best = r;
  return best && !best.allow ? { allowed: false, basis: `robots.txt disallows ${best.pattern}` } : { allowed: true, basis: "robots.txt does not block this path" };
}

// ---------------------------------------------------------------- the target page

// Facts and issues for one keyword's target page.
// input: { path, origin, status, redirectedTo?, xRobotsTag?, html?, robotsTxt?, sitemapPaths?: Set|array, inboundLinks?: number|null, keyword?, rendersWithJs? }
export function inspectTargetPage(input) {
  const { origin, status = null, xRobotsTag = null, html = null, robotsTxt = null, keyword = null } = input;
  const n = normalizeUrl(input.path, origin);
  const path = n?.path ?? input.path;
  const issues = [];
  const add = (severity, id, message) => issues.push({ severity, id, message });
  const ok = Number.isFinite(status) && status >= 200 && status < 300;
  const exists = status == null ? null : ok || (status >= 300 && status < 400);
  if (status == null) add("unknown", "not-fetched", "The page could not be fetched, so its content has not been checked.");
  else if (status === 404 || status === 410) add("fix", "not-found", `The target page returns ${status}. Nothing can rank until the page exists at this address.`);
  else if (status >= 500) add("fix", "server-error", `The target page returns a server error (${status}).`);
  else if (status >= 300 && status < 400) add("improve", "redirects", `The target address redirects${input.redirectedTo ? ` to ${input.redirectedTo}` : ""}. The registry should point at the final address.`);
  else if (!ok) add("fix", "http-error", `The target page returned HTTP ${status}.`);
  const page = ok && isStr(html) ? readPage(html, origin) : null;
  const sitemap = new Set([...(input.sitemapPaths ?? [])].map((p) => normalizeUrl(p, origin)?.path).filter(Boolean));
  const inSitemap = input.sitemapPaths == null ? null : sitemap.has(path);
  const robotsDirectives = [...new Set([...(page?.robotsMeta ?? "").split(",").map((s) => s.trim()).filter(Boolean), ...String(xRobotsTag ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean)])];
  const noindex = robotsDirectives.some((d) => /noindex|none/.test(d));
  const crawl = robotsAllows(robotsTxt, path);
  let canonical = { url: page?.canonicalUrl ?? null, status: page ? "missing" : "unknown" };
  if (page?.canonicalUrl) {
    const c = normalizeUrl(page.canonicalUrl, origin);
    canonical = c ? { url: c.url, status: c.path === path ? "self" : "other" } : { url: page.canonicalUrl, status: "other-site" };
  }
  if (noindex) add("fix", "noindex", "The page tells search engines not to index it (noindex), so it cannot appear in Google.");
  if (crawl.allowed === false) add("fix", "robots-blocked", `Search engines are blocked from crawling this page: ${crawl.basis}.`);
  if (canonical.status === "other" || canonical.status === "other-site") add("fix", "canonical-elsewhere", `The page's canonical points to ${canonical.url}, so Google is told another address is the main one.`);
  if (canonical.status === "missing") add("improve", "no-canonical", "The page has no canonical tag.");
  if (inSitemap === false) add("improve", "not-in-sitemap", "The page is not in the sitemap. That does not stop indexing, but it makes discovery slower.");
  if (inSitemap === true && (noindex || canonical.status === "other")) add("fix", "sitemap-contradiction", "The sitemap lists a page that is noindex or canonical to another address.");
  const inbound = Number.isFinite(input.inboundLinks) ? input.inboundLinks : null;
  const orphan = inbound == null ? null : inbound === 0;
  if (orphan) add("improve", "orphan", "No other page on the site links to this page.");
  else if (inbound != null && inbound < 2) add("improve", "weak-internal-links", "Only one other page links here. Relevant internal links help visitors and search engines find it.");

  // Does the page say what it is about? Evidence, not density: where do the keyword's words appear?
  let topic = { verdict: "unknown", reasons: [] };
  if (page && isStr(keyword)) {
    const kw = normalizeKeyword(keyword).split(" ").filter(Boolean);
    const has = (t) => { const n2 = normalizeKeyword(t ?? ""); return kw.length > 0 && kw.every((w) => n2.includes(w.replace(/s$/, ""))); };
    const inTitle = has(page.title);
    const inH1 = page.h1s.some(has);
    const opening = has(page.text.split(/\s+/).slice(0, 150).join(" "));
    const reasons = [`title ${inTitle ? "names" : "does not clearly name"} the topic`, `H1 ${inH1 ? "names" : "does not clearly name"} the topic`, `opening copy ${opening ? "covers" : "does not clearly cover"} the topic`];
    const score = [inTitle, inH1, opening].filter(Boolean).length;
    topic = { verdict: score >= 2 ? "clear" : score === 1 ? "partly-clear" : "unclear", inTitle, inH1, inOpeningCopy: opening, reasons };
    if (topic.verdict === "unclear") add("improve", "topic-unclear", `The page does not clearly state the topic "${keyword}" in its title, H1 or opening copy. Check it matches what a searcher wants.`);
  }
  if (page) {
    if (!page.title) add("fix", "no-title", "The page has no <title>.");
    if (!page.metaDescription) add("improve", "no-meta-description", "The page has no meta description, so Google writes its own snippet.");
    if (page.h1s.length === 0) add("improve", "no-h1", "No H1 was found in the page's HTML.");
    if (page.h1s.length > 1) add("improve", "many-h1", `The page has ${page.h1s.length} H1 headings.`);
  }
  // A page with almost no server-rendered text may be rendered by JavaScript: say so instead of calling it thin.
  const content = !page ? { verdict: "unknown", words: null } : page.words >= 150 ? { verdict: "meaningful", words: page.words } : input.rendersWithJs || page.words < 40 ? { verdict: "unknown", words: page.words, note: "Very little text is in the page's HTML. If the content is drawn by JavaScript this is only a limit of this check — confirm in the browser." } : { verdict: "thin", words: page.words };
  if (content.verdict === "thin") add("improve", "thin-content", `Only ${content.words} words of text were found. A person should confirm the page fully answers the search.`);
  return {
    path, url: n?.url ?? null, exists, httpStatus: status, redirectedTo: input.redirectedTo ?? null,
    indexable: status == null || !page ? null : !noindex && crawl.allowed !== false,
    indexableBasis: page ? (noindex ? "noindex directive" : crawl.allowed === false ? crawl.basis : "no noindex and not blocked by robots.txt (this says nothing about whether Google HAS indexed it)") : "page not fetched",
    robotsDirectives, crawlable: crawl.allowed, crawlBasis: crawl.basis, canonical, inSitemap,
    title: page?.title ?? null, metaDescription: page?.metaDescription ?? null, h1: page?.h1s ?? [], topic, content,
    structuredDataTypes: page?.structuredDataTypes ?? [], internalLinks: inbound, orphan, outboundLinks: page?.links ?? [], issues,
  };
}

// Count inbound internal links for each path from a { path: [outbound paths] } map (the monitor's gi:links, or a crawl).
export function inboundCounts(linkMap) {
  const out = {};
  for (const [from, tos] of Object.entries(linkMap ?? {})) for (const to of new Set(tos ?? [])) if (to !== from) out[to] = (out[to] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------- the sitemap

// Check a sitemap document (and optional per-URL probes) for problems. A URL's presence in the sitemap is a separate fact
// from Google having indexed it - this only reports on the sitemap's own health.
//   probes: { <path>: { status, redirectedTo, noindex, canonicalPath } }   (what the caller found by fetching each listed URL)
export function analyzeSitemap(xml, { origin, probes = {} } = {}) {
  const found = isStr(xml);
  if (!found) return { detected: false, isIndex: false, entries: 0, problems: [], paths: [] };
  const isIndex = isSitemapIndex(xml);
  const locs = parseSitemapLocs(xml);
  const problems = [];
  const seen = new Map();
  const paths = [];
  for (const raw of locs) {
    const n = normalizeUrl(raw, origin);
    if (!n) { problems.push({ type: "malformed", url: raw, message: "Not a page on this site's production address (wrong host, http instead of https, or not a URL)." }); continue; }
    const key = n.path;
    if (seen.has(key)) { problems.push({ type: "duplicate", url: n.url, message: "Listed more than once." }); continue; }
    seen.set(key, n.url);
    paths.push(key);
    if (raw !== n.url && raw.replace(/\/$/, "") !== n.url) problems.push({ type: "noncanonical-form", url: raw, message: `Written in a different form from the address the site uses (${n.url}).` });
    const pr = probes[key];
    if (!pr) continue;
    if (pr.status === 404 || pr.status === 410) problems.push({ type: "not-found", url: n.url, message: `Returns ${pr.status}.` });
    else if (pr.status >= 500) problems.push({ type: "server-error", url: n.url, message: `Returns ${pr.status}.` });
    else if (pr.status >= 300 && pr.status < 400) problems.push({ type: "redirect", url: n.url, message: `Redirects${pr.redirectedTo ? ` to ${pr.redirectedTo}` : ""}; the sitemap should list the final address.` });
    if (pr.noindex) problems.push({ type: "noindex", url: n.url, message: "Marked noindex but listed in the sitemap." });
    if (pr.canonicalPath && pr.canonicalPath !== key) problems.push({ type: "noncanonical", url: n.url, message: `Its canonical is ${pr.canonicalPath}; list that address instead.` });
  }
  return { detected: true, isIndex, entries: locs.length, problems, paths };
}
