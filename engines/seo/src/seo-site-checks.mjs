#!/usr/bin/env node
// BWESEO site checks — reusable, customer-neutral, READ-ONLY indexing-readiness checks for a whole production site
// (added 2026-10-18). post-publish-check.mjs answers "is this one page ready?"; this answers "is anything about the site
// itself keeping search engines from consolidating, crawling or reading it?":
//
//   1. protocol-host     http:// and the other production hosts reach the canonical https host in ONE 301/308
//   2. robots-hosts      every production host serves the canonical robots.txt (or redirects to it) with a Sitemap line;
//                        rules a CDN prepends (a "managed" block) are flagged for review
//   3. sitemap-sweep     every sitemap URL: 200 with no redirect, indexable, self-canonical, with a valid past lastmod
//   4. redirect-codes    trailing-slash and uppercase variants redirect permanently (301/308), never 302/307
//   5. noindex-blocked   pages linked from the site that robots.txt blocks AND that say noindex (Google never sees it)
//   6. key-page-links    the inventory's key (P1, published, indexable) pages get enough internal links
//   7. image-weight      images a page preloads, and any image, above a size budget
//   8. owned-subdomains  demo / example hosts on the business's domain say noindex where Google can read it
//
// Each check returns { id, label, status, detail, items? } with status pass | fail | review | skip, like
// seo-page-checks.mjs. A network error is ALWAYS "skip", never "fail": a host this machine cannot reach (a firewall,
// a sandbox, a Worker fetching its own zone) is a fact about where the check ran, not proof that the site is down.
//
// CLI (from the website root; reads seo/seo-config.json and seo/content-inventory.json, writes nothing):
//   node seo/tools/seo-site-checks.mjs [--max-pages 40] [--demo-host demo.example.com]... [--key-page /path]... [--json]

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractHead, extractLinks, parseAttrs, parseRobots, parseSitemap, robotsAllows } from "./post-publish-check.mjs";

export const SITE_CHECKS_VERSION = "1.0.0";
const USER_AGENT = "BWESEO-site-checks/1.0 (read-only SEO verification)";
export const BUDGET = { preloadImageBytes: 100_000, imageBytes: 200_000, minKeyPageLinks: 5 };
const NETWORK_NOTE = "a network result from where this check ran, not proof the site is down";

// ---------------------------------------------------------------- fetching (redirects recorded hop by hop)

export async function fetchChain(fetchImpl, url, { method = "GET", maxHops = 10 } = {}) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    let res;
    try {
      res = await fetchImpl(current, { method, redirect: "manual", headers: { "user-agent": USER_AGENT } });
    } catch (e) {
      return { chain, final: null, error: e?.message ?? String(e) };
    }
    const location = res.headers.get("location");
    chain.push({ url: current, status: res.status, location });
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    const text = method === "HEAD" ? "" : await res.text().catch(() => "");
    return { chain, final: { url: current, status: res.status, headers: res.headers, text } };
  }
  return { chain, final: null, error: "too many redirects" };
}

const hops = (r) => r.chain.filter((h) => h.status >= 300 && h.status < 400);
const describeChain = (r) => r.chain.map((h) => `${h.status}${h.location ? ` → ${h.location}` : ""}`).join(", ");
const isNoindex = (values) => values.some((v) => /\b(noindex|none)\b/i.test(v ?? ""));
const result = (id, label, status, detail, items) => ({ id, label, status, detail, ...(items ? { items } : {}) });
const worst = (statuses) => (statuses.includes("fail") ? "fail" : statuses.includes("review") ? "review" : statuses.every((s) => s === "skip") ? "skip" : "pass");

// ---------------------------------------------------------------- 1. protocol and host consolidation

export async function checkProtocolHost(fetchImpl, { origin, hosts, samplePath }) {
  const canonicalHost = new URL(origin).host;
  const paths = [...new Set(["/", "/robots.txt", samplePath].filter(Boolean))];
  const items = [];
  for (const host of hosts) {
    for (const scheme of ["http", "https"]) {
      if (scheme === "https" && host === canonicalHost) continue;
      for (const path of paths) {
        const from = `${scheme}://${host}${path}`;
        const want = `${origin}${path}`;
        const r = await fetchChain(fetchImpl, from);
        if (r.error && !r.chain.length) {
          items.push({ url: from, status: "skip", detail: `could not reach (${r.error}) — ${NETWORK_NOTE}` });
          continue;
        }
        const first = r.chain[0];
        const redirects = hops(r);
        let status = "pass";
        let detail = describeChain(r);
        if (!redirects.length) {
          status = "fail";
          detail = `served directly (${first.status}) instead of redirecting to ${want} — a second copy of the site`;
        } else if (![301, 308].includes(first.status)) {
          status = "fail";
          detail = `${first.status} is a temporary redirect; use 301 or 308 (${detail})`;
        } else if (redirects.length > 1) {
          status = "review";
          detail = `reaches the canonical URL in ${redirects.length} hops; fold them into one (${detail})`;
        } else if (r.final?.url !== want) {
          status = "fail";
          detail = `redirects to ${r.final?.url ?? "(nothing)"}, not ${want}`;
        }
        items.push({ url: from, status, detail });
      }
    }
  }
  const status = items.length ? worst(items.map((i) => i.status)) : "skip";
  const bad = items.filter((i) => i.status !== "pass");
  return result(
    "protocol-host",
    "HTTP and host variants redirect to the canonical HTTPS host",
    status,
    bad.length ? bad.map((i) => `${i.url}: ${i.detail}`).join("; ") : `${items.length} variant(s) checked — each is one permanent redirect`,
    items,
  );
}

// ---------------------------------------------------------------- 2. robots.txt on every production host

const MANAGED_MARKERS = [/BEGIN Cloudflare Managed/i, /Content-Signal\s*:/i];

export async function checkRobotsHosts(fetchImpl, { origin, hosts }) {
  const canonicalHost = new URL(origin).host;
  const items = [];
  let canonicalBody = null;
  const apex = await fetchChain(fetchImpl, `${origin}/robots.txt`);
  if (!apex.final) {
    return result("robots-hosts", "robots.txt on every production host", "skip", `could not read ${origin}/robots.txt (${apex.error}) — ${NETWORK_NOTE}`);
  }
  canonicalBody = apex.final.text;
  const parsed = parseRobots(canonicalBody);
  if (apex.final.status !== 200) {
    items.push({ host: canonicalHost, status: "fail", detail: `robots.txt returned ${apex.final.status}` });
  } else {
    items.push({
      host: canonicalHost,
      status: parsed.sitemaps.length ? "pass" : "review",
      detail: parsed.sitemaps.length ? `200, Sitemap: ${parsed.sitemaps.join(", ")}` : "200 but no Sitemap: line",
    });
    if (!robotsAllows(parsed, "Googlebot", "/").allowed)
      items.push({ host: canonicalHost, status: "fail", detail: "robots.txt blocks Googlebot from the home page" });
    if (MANAGED_MARKERS.some((re) => re.test(canonicalBody)))
      items.push({
        host: canonicalHost,
        status: "review",
        detail: "robots.txt contains rules the site's own code did not write (a CDN-managed block) — confirm they are wanted; they are not in the repository's tests",
      });
  }
  for (const host of hosts.filter((h) => h !== canonicalHost)) {
    const r = await fetchChain(fetchImpl, `https://${host}/robots.txt`);
    if (r.error && !r.chain.length) {
      items.push({ host, status: "skip", detail: `could not reach (${r.error}) — ${NETWORK_NOTE}` });
      continue;
    }
    if (hops(r).length && r.final?.url === `${origin}/robots.txt`) {
      items.push({ host, status: "pass", detail: `redirects to the canonical robots.txt (${describeChain(r)})` });
    } else if (r.final?.status === 200 && r.final.text === canonicalBody) {
      items.push({ host, status: "pass", detail: "serves the same robots.txt as the canonical host" });
    } else {
      const sm = r.final ? parseRobots(r.final.text).sitemaps.length : 0;
      items.push({
        host,
        status: "fail",
        detail: `serves a different robots.txt (${describeChain(r)}${sm ? "" : ", no Sitemap: line"}) — redirect it to ${origin}/robots.txt`,
      });
    }
  }
  const bad = items.filter((i) => i.status !== "pass");
  return result(
    "robots-hosts",
    "robots.txt on every production host",
    worst(items.map((i) => i.status)),
    bad.length ? bad.map((i) => `${i.host}: ${i.detail}`).join("; ") : `${items.length} host(s) consistent`,
    items,
  );
}

// ---------------------------------------------------------------- 3. sitemap sweep

export async function checkSitemapSweep(fetchImpl, { sitemapUrl, now = new Date(), maxPages = 60 }) {
  const sm = await fetchChain(fetchImpl, sitemapUrl);
  if (!sm.final) return { check: result("sitemap-sweep", "Every sitemap URL is indexable", "skip", `could not read ${sitemapUrl} (${sm.error}) — ${NETWORK_NOTE}`), pages: [] };
  if (sm.final.status !== 200)
    return { check: result("sitemap-sweep", "Every sitemap URL is indexable", "fail", `${sitemapUrl} returned ${sm.final.status}`), pages: [] };
  const parsed = parseSitemap(sm.final.text);
  if (parsed.malformed)
    return { check: result("sitemap-sweep", "Every sitemap URL is indexable", "fail", `${sitemapUrl} is not a well-formed sitemap`), pages: [] };
  const today = now.toISOString().slice(0, 10);
  const seen = new Set();
  const items = [];
  const pages = [];
  for (const entry of parsed.entries.slice(0, maxPages)) {
    const problems = [];
    let status = "pass";
    if (seen.has(entry.loc)) problems.push(["fail", "listed twice"]);
    seen.add(entry.loc);
    if (!entry.lastmod) problems.push(["review", "no lastmod"]);
    else if (Number.isNaN(new Date(entry.lastmod).getTime())) problems.push(["fail", `lastmod "${entry.lastmod}" is not a date`]);
    else if (entry.lastmod.slice(0, 10) > today) problems.push(["fail", `lastmod ${entry.lastmod} is in the future`]);
    const r = await fetchChain(fetchImpl, entry.loc);
    if (!r.final) {
      items.push({ url: entry.loc, status: "skip", detail: `could not fetch (${r.error}) — ${NETWORK_NOTE}` });
      continue;
    }
    if (hops(r).length) problems.push(["fail", `redirects (${describeChain(r)}) — list the destination instead`]);
    if (r.final.status !== 200) problems.push(["fail", `final status ${r.final.status}`]);
    const head = extractHead(r.final.text);
    const header = r.final.headers.get("x-robots-tag") ?? "";
    if (isNoindex([...head.robots, header])) problems.push(["fail", `noindex (${[...head.robots, header].filter(Boolean).join(" | ")})`]);
    if (!head.canonicals.length) problems.push(["review", "no canonical"]);
    else if (head.canonicals.length > 1) problems.push(["fail", `${head.canonicals.length} canonical tags`]);
    else if (new URL(head.canonicals[0], r.final.url).toString() !== entry.loc) problems.push(["fail", `canonical points to ${head.canonicals[0]}`]);
    if (problems.length) status = worst(problems.map(([s]) => s));
    items.push({ url: entry.loc, status, detail: problems.length ? problems.map(([, d]) => d).join("; ") : "200, indexable, self-canonical" });
    if (r.final.status === 200) pages.push({ url: r.final.url, html: r.final.text });
  }
  const bad = items.filter((i) => i.status !== "pass");
  const truncated = parsed.entries.length > maxPages ? ` (first ${maxPages} of ${parsed.entries.length})` : "";
  return {
    check: result(
      "sitemap-sweep",
      "Every sitemap URL is indexable",
      items.length ? worst(items.map((i) => i.status)) : "review",
      items.length
        ? bad.length
          ? bad.map((i) => `${i.url}: ${i.detail}`).join("; ") + truncated
          : `${items.length} URL(s) — all 200, indexable, self-canonical, dated${truncated}`
        : "the sitemap lists no URLs",
      items,
    ),
    pages,
  };
}

// ---------------------------------------------------------------- 4. variant redirect codes

export async function checkRedirectCodes(fetchImpl, { pageUrl }) {
  const u = new URL(pageUrl);
  if (u.pathname === "/") return result("redirect-codes", "URL variants redirect permanently", "skip", "needs an inner page to test");
  const variants = [
    { kind: "trailing slash", url: `${u.origin}${u.pathname}/` },
    { kind: "uppercase", url: `${u.origin}${u.pathname.toUpperCase()}` },
  ];
  const items = [];
  for (const v of variants) {
    const r = await fetchChain(fetchImpl, v.url);
    if (!r.chain.length) {
      items.push({ ...v, status: "skip", detail: `could not reach (${r.error}) — ${NETWORK_NOTE}` });
      continue;
    }
    const first = r.chain[0];
    if (first.status >= 300 && first.status < 400) {
      items.push({
        ...v,
        status: [301, 308].includes(first.status) ? "pass" : "fail",
        detail: [301, 308].includes(first.status) ? describeChain(r) : `${first.status} is temporary — use 301 or 308 (${describeChain(r)})`,
      });
    } else if (first.status === 200) {
      const canonical = extractHead(r.final?.text ?? "").canonicals[0];
      items.push({
        ...v,
        status: "review",
        detail: `served with 200${canonical ? `, canonical ${canonical}` : ", no canonical"} — a 301 to ${pageUrl} is firmer`,
      });
    } else {
      items.push({ ...v, status: "pass", detail: `${first.status} (not served as a duplicate)` });
    }
  }
  const bad = items.filter((i) => i.status !== "pass");
  return result(
    "redirect-codes",
    "URL variants redirect permanently",
    worst(items.map((i) => i.status)),
    bad.length ? bad.map((i) => `${i.kind} ${i.url}: ${i.detail}`).join("; ") : "trailing-slash and uppercase variants redirect permanently",
    items,
  );
}

// ---------------------------------------------------------------- 5. blocked by robots.txt but noindex

export async function checkNoindexBlocked(fetchImpl, { origin, robotsTxt, pages }) {
  if (!pages.length) return result("noindex-blocked", "No linked page is both blocked and noindex", "skip", "no pages could be read to collect links");
  const robots = parseRobots(robotsTxt ?? "");
  const blocked = new Map();
  for (const p of pages) {
    for (const link of extractLinks(p.html, p.url)) {
      let u;
      try {
        u = new URL(link.href);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      const path = u.pathname;
      if (robotsAllows(robots, "Googlebot", path).allowed) continue;
      const entry = blocked.get(path) ?? { path, from: new Set() };
      entry.from.add(new URL(p.url).pathname);
      blocked.set(path, entry);
    }
  }
  if (!blocked.size) return result("noindex-blocked", "No linked page is both blocked and noindex", "pass", "no internal link points into a robots.txt-blocked path");
  const items = [];
  for (const { path, from } of blocked.values()) {
    const r = await fetchChain(fetchImpl, `${origin}${path}`);
    if (!r.final) {
      items.push({ path, status: "skip", detail: `could not fetch (${r.error}) — ${NETWORK_NOTE}` });
      continue;
    }
    const head = extractHead(r.final.text);
    const noindex = isNoindex([...head.robots, r.final.headers.get("x-robots-tag") ?? ""]);
    items.push({
      path,
      linkedFrom: from.size,
      status: noindex ? "fail" : "review",
      detail: noindex
        ? `linked from ${from.size} page(s), disallowed in robots.txt AND noindex — Google cannot read the noindex and may list the bare URL ("Indexed, though blocked by robots.txt"); allow crawling so the noindex works`
        : `linked from ${from.size} page(s) and disallowed in robots.txt — Google may list the bare URL; add noindex and allow crawling if it must stay out of results`,
    });
  }
  return result(
    "noindex-blocked",
    "No linked page is both blocked and noindex",
    worst(items.map((i) => i.status)),
    items.map((i) => `${i.path}: ${i.detail}`).join("; "),
    items,
  );
}

// ---------------------------------------------------------------- 6. internal links to key pages

export function checkKeyPageLinks({ pages, keyPaths, minLinks = BUDGET.minKeyPageLinks }) {
  if (!pages.length) return result("key-page-links", "Key pages get enough internal links", "skip", "no pages could be read");
  if (!keyPaths.length) return result("key-page-links", "Key pages get enough internal links", "skip", "no key pages (published, indexable P1 inventory entries or --key-page)");
  const inbound = new Map(keyPaths.map((k) => [k, new Set()]));
  for (const p of pages) {
    const self = new URL(p.url).pathname;
    for (const link of extractLinks(p.html, p.url)) {
      let path;
      try {
        const u = new URL(link.href);
        if (u.origin !== new URL(p.url).origin) continue;
        path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
      } catch {
        continue;
      }
      if (path !== self && inbound.has(path)) inbound.get(path).add(self);
    }
  }
  const need = Math.min(minLinks, Math.max(1, pages.length - 1));
  const items = keyPaths.map((k) => {
    const n = inbound.get(k).size;
    return { path: k, inbound: n, status: n >= need ? "pass" : "review", detail: `${n} linking page(s) of ${pages.length} crawled` };
  });
  const weak = items.filter((i) => i.status !== "pass");
  return result(
    "key-page-links",
    "Key pages get enough internal links",
    worst(items.map((i) => i.status)),
    weak.length
      ? weak.map((i) => `${i.path}: ${i.detail} — add it to the shared navigation/footer or link it from related pages`).join("; ")
      : `${items.length} key page(s), each linked from ${need}+ pages`,
    items,
  );
}

// ---------------------------------------------------------------- 7. image weight

export function imagesOf(html, pageUrl) {
  const out = [];
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const a = parseAttrs(m[0]);
    if ((a.rel ?? "").toLowerCase() === "preload" && (a.as ?? "").toLowerCase() === "image" && a.href) out.push({ src: a.href, preload: true });
  }
  for (const m of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const a = parseAttrs(m[0]);
    if (a.src && !a.src.startsWith("data:")) out.push({ src: a.src, preload: false, lazy: (a.loading ?? "").toLowerCase() === "lazy" });
  }
  return out
    .map((i) => {
      try {
        return { ...i, src: new URL(i.src, pageUrl).toString() };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function checkImageWeight(fetchImpl, { pages, budget = BUDGET }) {
  if (!pages.length) return result("image-weight", "Images within size budget", "skip", "no pages could be read");
  const sizes = new Map();
  const uses = new Map();
  for (const p of pages) {
    for (const img of imagesOf(p.html, p.url)) {
      const u = uses.get(img.src) ?? { src: img.src, preload: false, pages: new Set() };
      u.preload ||= img.preload;
      u.pages.add(new URL(p.url).pathname);
      uses.set(img.src, u);
    }
  }
  for (const src of uses.keys()) {
    const r = await fetchChain(fetchImpl, src, { method: "HEAD" });
    const len = Number(r.final?.headers.get("content-length"));
    sizes.set(src, Number.isFinite(len) && len > 0 ? len : null);
  }
  const items = [];
  for (const u of uses.values()) {
    const bytes = sizes.get(u.src);
    if (bytes == null) continue;
    if (u.preload && bytes > budget.preloadImageBytes)
      items.push({ src: u.src, bytes, pages: u.pages.size, status: "fail", detail: `${Math.round(bytes / 1000)} KB and preloaded on ${u.pages.size} page(s) — resize it to its display size` });
    else if (bytes > budget.imageBytes)
      items.push({ src: u.src, bytes, pages: u.pages.size, status: "review", detail: `${Math.round(bytes / 1000)} KB on ${u.pages.size} page(s)` });
  }
  const measured = [...sizes.values()].filter((v) => v != null).length;
  if (!uses.size) return result("image-weight", "Images within size budget", "pass", "no images found");
  if (!measured) return result("image-weight", "Images within size budget", "skip", "no image reported its size (content-length)");
  return result(
    "image-weight",
    "Images within size budget",
    items.length ? worst(items.map((i) => i.status)) : "pass",
    items.length
      ? items.map((i) => `${i.src}: ${i.detail}`).join("; ")
      : `${measured} image(s) measured — none preloaded over ${budget.preloadImageBytes / 1000} KB or over ${budget.imageBytes / 1000} KB`,
    items,
  );
}

// ---------------------------------------------------------------- 8. owned demo subdomains

export async function checkOwnedSubdomains(fetchImpl, { hosts }) {
  if (!hosts.length) return result("owned-subdomains", "Demo hosts on the domain are noindex", "skip", "no demo hosts given (--demo-host)");
  const items = [];
  for (const host of hosts) {
    const r = await fetchChain(fetchImpl, `https://${host}/`);
    if (!r.final) {
      items.push({ host, status: "skip", detail: `could not reach (${r.error}) — ${NETWORK_NOTE}` });
      continue;
    }
    const head = extractHead(r.final.text);
    const noindex = isNoindex([...head.robots, r.final.headers.get("x-robots-tag") ?? ""]);
    const rb = await fetchChain(fetchImpl, `https://${host}/robots.txt`);
    const blocked = rb.final?.status === 200 && !robotsAllows(parseRobots(rb.final.text), "Googlebot", "/").allowed;
    items.push({
      host,
      status: noindex && !blocked ? "pass" : "fail",
      detail: noindex
        ? blocked
          ? "noindex, but robots.txt blocks crawling so Google cannot read it — allow crawling"
          : "noindex, crawlable"
        : "indexable — a demo of a fictional business should send noindex (meta or X-Robots-Tag)",
    });
  }
  const bad = items.filter((i) => i.status !== "pass");
  return result(
    "owned-subdomains",
    "Demo hosts on the domain are noindex",
    worst(items.map((i) => i.status)),
    bad.length ? bad.map((i) => `${i.host}: ${i.detail}`).join("; ") : `${items.length} demo host(s) noindex and crawlable`,
    items,
  );
}

// ---------------------------------------------------------------- all together

export function keyPathsFromInventory(inventory) {
  return (inventory?.pages ?? [])
    .filter((p) => p.priority === "P1" && p.indexable !== false && p.status === "published" && typeof p.url === "string" && p.url.startsWith("/"))
    .map((p) => p.url);
}

export async function runSiteChecks({ fetchImpl = fetch, config = {}, inventory = {}, demoHosts = [], keyPaths = null, maxPages = 40, now = new Date() } = {}) {
  const prod = config.environments?.production ?? {};
  const origin = new URL(prod.url ?? config.website).origin;
  const hosts = [...new Set([new URL(origin).host, ...(prod.hosts ?? [])])];
  const checks = [];
  const robots = await fetchChain(fetchImpl, `${origin}/robots.txt`);
  const sitemapUrl = (robots.final ? parseRobots(robots.final.text).sitemaps[0] : null) ?? `${origin}/sitemap.xml`;
  const sweep = await checkSitemapSweep(fetchImpl, { sitemapUrl, now, maxPages });
  const inner = sweep.pages.map((p) => p.url).find((u) => new URL(u).pathname !== "/");
  checks.push(await checkProtocolHost(fetchImpl, { origin, hosts, samplePath: inner ? new URL(inner).pathname : null }));
  checks.push(await checkRobotsHosts(fetchImpl, { origin, hosts }));
  checks.push(sweep.check);
  checks.push(inner ? await checkRedirectCodes(fetchImpl, { pageUrl: inner }) : result("redirect-codes", "URL variants redirect permanently", "skip", "no inner page in the sitemap"));
  checks.push(await checkNoindexBlocked(fetchImpl, { origin, robotsTxt: robots.final?.text ?? "", pages: sweep.pages }));
  checks.push(checkKeyPageLinks({ pages: sweep.pages, keyPaths: keyPaths ?? keyPathsFromInventory(inventory) }));
  checks.push(await checkImageWeight(fetchImpl, { pages: sweep.pages }));
  checks.push(await checkOwnedSubdomains(fetchImpl, { hosts: demoHosts }));
  return { origin, checkedAt: now.toISOString(), checks };
}

const MARK = { pass: "✓", fail: "✗", review: "?", skip: "–" };
export function formatSiteChecks({ origin, checks }) {
  return [`BWESEO site checks ${SITE_CHECKS_VERSION} — ${origin} (read-only)`, ...checks.map((c) => `${MARK[c.status] ?? "•"} ${c.label} — ${c.detail}`)].join("\n");
}

// ---------------------------------------------------------------- CLI

async function cli(argv) {
  const values = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
  if (argv.includes("--help")) {
    console.log("usage: node seo/tools/seo-site-checks.mjs [--project <dir>] [--max-pages 40] [--demo-host <host>]... [--key-page </path>]... [--json]");
    return 0;
  }
  const project = resolve(values("--project")[0] ?? process.cwd());
  const read = (f) => (existsSync(join(project, "seo", f)) ? JSON.parse(readFileSync(join(project, "seo", f), "utf8")) : {});
  const config = read("seo-config.json");
  if (!config.environments?.production?.url && !config.website) {
    console.error("No production URL: seo/seo-config.json needs environments.production.url (or website).");
    return 1;
  }
  const keyPages = values("--key-page");
  const report = await runSiteChecks({
    config,
    inventory: read("content-inventory.json"),
    demoHosts: values("--demo-host"),
    keyPaths: keyPages.length ? keyPages : null,
    maxPages: values("--max-pages")[0] ? Number(values("--max-pages")[0]) : 40,
  });
  console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : formatSiteChecks(report));
  return report.checks.some((c) => c.status === "fail") ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).then((c) => process.exit(c));
