// BWESEO regression detection — observation collector (Node; takes an INJECTED fetch, makes no request of its own).
// This is not a second crawler: it is glue over the engine's existing primitives — seo-site-checks.fetchChain (hop-by-hop redirects),
// post-publish-check's extractHead / extractLinks / parseSitemap / parseRobots — that records what they see in the versioned
// observation format. The CLI `observe` passes the global fetch; every test passes a fake.
import { fetchChain } from "./seo-site-checks.mjs";
import { extractHead, extractLinks, parseSitemap } from "./post-publish-check.mjs";
import { FORMAT_VERSION, OBSERVATION_FORMAT, originKey, urlKey } from "./regression-detect.mjs";

const redactHeader = (v) => (v == null ? null : String(v).slice(0, 500));
const withTimeout = (fetchImpl, timeoutMs) => (url, init = {}) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  return Promise.race([
    Promise.resolve(fetchImpl(url, { ...init, signal: ctl.signal })).finally(() => clearTimeout(timer)),
    new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(new Error(`timed out after ${timeoutMs} ms`)))),
  ]);
};
const excluded = (scope, key) => { const u = new URL(key); const p = u.pathname; return scope.excludePaths.some((x) => p.startsWith(x)) || (scope.includePaths.length > 0 && !scope.includePaths.some((x) => p.startsWith(x))); };

export async function collectObservation({ fetchImpl, origin, environment = "production", projectId = null, sitemapUrls = null, importantPaths = ["/"], includePaths = [], excludePaths = [], robotsAgent = "Googlebot", maxPages = 200, timeoutMs = 10000, now = () => new Date().toISOString(), id = null }) {
  const o = originKey(origin);
  if (!o) throw new Error("collectObservation needs an http(s) origin");
  const f = withTimeout(fetchImpl, timeoutMs);
  const scope = { origin: o, sitemapUrls: [], includePaths: [...includePaths], excludePaths: [...excludePaths], robotsAgent, maxPages, seeds: importantPaths };
  const host = new URL(o).host;

  // robots.txt
  const r = await fetchChain(f, `${o}/robots.txt`);
  const robots = r.final && r.final.status === 200 ? { state: "ok", httpStatus: 200, fetchedAt: now(), text: r.final.text }
    : r.final && [404, 410].includes(r.final.status) ? { state: "ok", httpStatus: r.final.status, fetchedAt: now(), text: "" }
    : { state: "unavailable", httpStatus: r.final?.status ?? null, fetchedAt: now(), reason: r.error ?? `HTTP ${r.final?.status}` };

  // sitemaps (an index is followed one level)
  const start = (sitemapUrls?.length ? sitemapUrls : [`${o}/sitemap.xml`]).map((u) => urlKey(u, o)).filter(Boolean);
  scope.sitemapUrls = start;
  const documents = []; const queue = start.map((u) => ({ url: u, depth: 0 }));
  while (queue.length && documents.length < 25) {
    const { url, depth } = queue.shift();
    const res = await fetchChain(f, url);
    if (!res.final || res.final.status !== 200) { documents.push({ url, role: "urlset", state: "unavailable", httpStatus: res.final?.status ?? null, locs: [], reason: res.error ?? `HTTP ${res.final?.status}` }); continue; }
    const parsed = parseSitemap(res.final.text);
    const locs = parsed.locs.map((l) => urlKey(l, o)).filter(Boolean);
    if (parsed.kind === "index") { documents.push({ url, role: "index", state: parsed.malformed ? "malformed" : "ok", httpStatus: 200, locs: [] }); if (depth < 1) for (const l of locs) queue.push({ url: l, depth: depth + 1 }); }
    else documents.push({ url, role: "urlset", state: parsed.malformed ? "malformed" : "ok", httpStatus: 200, locs: locs.filter((l) => new URL(l).host === host) });
  }
  const sitemapState = documents.length && documents.every((d) => d.state === "ok") ? "ok" : documents.some((d) => d.state === "ok") ? "partial" : "unavailable";

  // pages: important paths, sitemap URLs, then internal links, breadth first, up to maxPages
  const important = importantPaths.map((p) => urlKey(p, o)).filter(Boolean);
  const order = []; const seen = new Set();
  const add = (u) => { if (u && !seen.has(u) && new URL(u).host === host && !excluded(scope, u)) { seen.add(u); order.push(u); } };
  important.forEach(add); documents.flatMap((d) => d.locs).forEach(add);
  const pages = {}; let failed = 0;
  for (let i = 0; i < order.length && i < maxPages; i++) {
    const url = order[i];
    const res = await fetchChain(f, url);
    const chain = res.chain.map((h) => ({ url: urlKey(h.url) ?? h.url, status: h.status, location: h.location ? urlKey(h.location, h.url) ?? h.location : null }));
    const loopSeen = new Set(chain.map((h) => h.url));
    const redirectLoop = !res.final && res.error === "too many redirects" && loopSeen.size < chain.length;
    const chainExceeded = !res.final && res.error === "too many redirects" && !redirectLoop;
    if (!res.final && !redirectLoop && !chainExceeded) { failed += 1; pages[url] = { url, state: "unreachable", error: String(res.error ?? "network error").slice(0, 200), fetchedAt: now(), chain }; continue; }
    const p = { url, state: "ok", fetchedAt: now(), status: res.final?.status ?? chain.at(-1)?.status ?? null, finalUrl: urlKey(res.final?.url ?? chain.at(-1)?.url ?? url) ?? url, chain, redirectLoop, chainExceeded, metaRobots: null, xRobotsTag: null, canonicals: null, links: null };
    if (res.final) {
      p.xRobotsTag = res.final.headers.get("x-robots-tag") != null ? [redactHeader(res.final.headers.get("x-robots-tag"))] : [];
      if (res.final.status === 200 && /html/i.test(res.final.headers.get("content-type") ?? "text/html")) {
        const head = extractHead(res.final.text);
        p.metaRobots = head.robots; p.canonicals = head.canonicals.map((c) => urlKey(c, p.finalUrl) ?? c);
        p.links = [...new Set(extractLinks(res.final.text, p.finalUrl).map((l) => urlKey(l.href)).filter(Boolean))];
        for (const l of p.links) add(l);
      }
    }
    pages[url] = p;
  }
  const fetched = Object.keys(pages).length;
  const truncated = order.length > maxPages;
  const htmlOk = Object.values(pages).filter((p) => p.state === "ok" && p.status === 200 && p.metaRobots !== null);
  const complete = !truncated && failed === 0 && robots.state === "ok" && sitemapState === "ok";
  const anyPage = Object.values(pages).some((p) => p.state === "ok");
  return {
    format: OBSERVATION_FORMAT, version: FORMAT_VERSION, id: id ?? `obs-${now().replace(/[^0-9]/g, "").slice(0, 14)}`, project: { id: projectId }, observedAt: now(),
    environment: { name: environment, origin: o }, status: complete ? "complete" : anyPage || robots.state === "ok" ? "partial" : "failed", scope,
    config: { importantPaths }, coverage: { discovered: order.length, fetched, failed, truncated, linkGraphComplete: complete && htmlOk.length === Object.values(pages).filter((p) => p.state === "ok" && p.status === 200).length },
    checks: { robots, sitemap: { state: sitemapState, fetchedAt: now(), documents } }, pages,
  };
}
