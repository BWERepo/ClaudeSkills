import { describe, expect, it } from "vitest";
import {
  checkImageWeight,
  checkKeyPageLinks,
  checkNoindexBlocked,
  checkOwnedSubdomains,
  checkProtocolHost,
  checkRedirectCodes,
  checkRobotsHosts,
  checkSitemapSweep,
  keyPathsFromInventory,
  runSiteChecks,
} from "./seo-site-checks.mjs";

// A tiny fake web: URL → { status, headers, body }. Anything unlisted is a 404; a value of "down" throws like a
// network failure.
function fakeFetch(routes) {
  return async (url, opts = {}) => {
    const r = routes[url];
    if (r === "down") throw new Error("connect ECONNREFUSED");
    const { status = 200, headers = {}, body = "" } = r ?? { status: 404, body: "not found" };
    return new Response(opts.method === "HEAD" || status === 301 || status === 308 || status === 307 ? null : body, {
      status,
      headers: { "content-type": "text/html", ...headers },
    });
  };
}
const moved = (to, status = 301) => ({ status, headers: { location: to } });
const page = (url, { robots = "index, follow", links = [], imgs = "" } = {}) => ({
  body: `<html><head><title>t</title><meta name="robots" content="${robots}"><link rel="canonical" href="${url}">${imgs}</head><body>${links
    .map((l) => `<a href="${l}">x</a>`)
    .join("")}</body></html>`,
});
const O = "https://site.example";
const ROBOTS = "User-agent: *\nDisallow: /admin\n\nSitemap: https://site.example/sitemap.xml\n";
const SITEMAP = (lastmod = "2020-01-01") =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${O}/</loc><lastmod>${lastmod}</lastmod></url><url><loc>${O}/pricing</loc><lastmod>${lastmod}</lastmod></url></urlset>`;

describe("checkProtocolHost", () => {
  it("passes when every variant is one 301 to the canonical https URL", async () => {
    const routes = {};
    for (const p of ["/", "/robots.txt", "/pricing"]) {
      routes[`http://site.example${p}`] = moved(`${O}${p}`);
      routes[`http://www.site.example${p}`] = moved(`${O}${p}`);
      routes[`https://www.site.example${p}`] = moved(`${O}${p}`);
      routes[`${O}${p}`] = { body: "ok" };
    }
    const c = await checkProtocolHost(fakeFetch(routes), { origin: O, hosts: ["site.example", "www.site.example"], samplePath: "/pricing" });
    expect(c.status).toBe("pass");
  });

  it("fails http served directly, and flags a two-hop chain", async () => {
    const routes = {
      "http://site.example/": { body: "ok" },
      "http://www.site.example/": moved("http://site.example/"),
      "https://www.site.example/": moved(`${O}/`),
      [`${O}/`]: { body: "ok" },
    };
    const c = await checkProtocolHost(fakeFetch(routes), { origin: O, hosts: ["site.example", "www.site.example"] });
    expect(c.status).toBe("fail");
    const byUrl = Object.fromEntries(c.items.map((i) => [i.url, i.status]));
    expect(byUrl["http://site.example/"]).toBe("fail");
    expect(c.detail).toContain("served directly");
  });

  it("an unreachable host is a skip, never a failure", async () => {
    const c = await checkProtocolHost(fakeFetch({ "http://site.example/": "down" }), { origin: O, hosts: ["site.example"] });
    expect(c.items.find((i) => i.url === "http://site.example/").status).toBe("skip");
    expect(c.items.find((i) => i.url === "http://site.example/").detail).toContain("not proof the site is down");
  });
});

describe("checkRobotsHosts", () => {
  it("fails a second host that serves its own robots.txt, and reviews a CDN-managed block", async () => {
    const routes = {
      [`${O}/robots.txt`]: { body: "# BEGIN Cloudflare Managed content\nUser-agent: *\nContent-Signal: search=yes\nAllow: /\n" + ROBOTS },
      "https://www.site.example/robots.txt": { body: "User-agent: *\nAllow: /\n", headers: { location: `${O}/robots.txt` } },
    };
    const c = await checkRobotsHosts(fakeFetch(routes), { origin: O, hosts: ["site.example", "www.site.example"] });
    expect(c.status).toBe("fail");
    expect(c.items.find((i) => i.host === "www.site.example").status).toBe("fail");
    expect(c.items.some((i) => i.status === "review" && /CDN-managed/.test(i.detail))).toBe(true);
  });

  it("passes a redirecting second host", async () => {
    const routes = { [`${O}/robots.txt`]: { body: ROBOTS }, "https://www.site.example/robots.txt": moved(`${O}/robots.txt`) };
    const c = await checkRobotsHosts(fakeFetch(routes), { origin: O, hosts: ["site.example", "www.site.example"] });
    expect(c.status).toBe("pass");
  });
});

describe("checkSitemapSweep", () => {
  it("passes indexable, self-canonical, dated URLs", async () => {
    const routes = { [`${O}/sitemap.xml`]: { body: SITEMAP() }, [`${O}/`]: page(`${O}/`), [`${O}/pricing`]: page(`${O}/pricing`) };
    const { check, pages } = await checkSitemapSweep(fakeFetch(routes), { sitemapUrl: `${O}/sitemap.xml`, now: new Date("2026-01-01") });
    expect(check.status).toBe("pass");
    expect(pages).toHaveLength(2);
  });

  it("fails noindex, redirects, wrong canonicals and future dates; reviews a missing lastmod", async () => {
    const xml = `<urlset><url><loc>${O}/</loc></url><url><loc>${O}/a</loc><lastmod>2099-01-01</lastmod></url><url><loc>${O}/b</loc><lastmod>2020-01-01</lastmod></url><url><loc>${O}/c</loc><lastmod>2020-01-01</lastmod></url></urlset>`;
    const routes = {
      [`${O}/sitemap.xml`]: { body: xml },
      [`${O}/`]: page(`${O}/`),
      [`${O}/a`]: page(`${O}/a`, { robots: "noindex" }),
      [`${O}/b`]: moved(`${O}/b2`),
      [`${O}/b2`]: page(`${O}/b2`),
      [`${O}/c`]: page(`${O}/other`),
    };
    const { check } = await checkSitemapSweep(fakeFetch(routes), { sitemapUrl: `${O}/sitemap.xml`, now: new Date("2026-01-01") });
    const s = Object.fromEntries(check.items.map((i) => [i.url, i]));
    expect(s[`${O}/`].status).toBe("review");
    expect(s[`${O}/a`].detail).toMatch(/future.*noindex/);
    expect(s[`${O}/b`].detail).toContain("redirects");
    expect(s[`${O}/c`].detail).toContain("canonical points to");
    expect(check.status).toBe("fail");
  });
});

describe("checkRedirectCodes", () => {
  it("fails a 307 trailing-slash redirect and reviews an uppercase 200", async () => {
    const routes = {
      [`${O}/pricing/`]: moved(`${O}/pricing`, 307),
      [`${O}/PRICING`]: page(`${O}/pricing`),
      [`${O}/pricing`]: page(`${O}/pricing`),
    };
    const c = await checkRedirectCodes(fakeFetch(routes), { pageUrl: `${O}/pricing` });
    expect(c.items.find((i) => i.kind === "trailing slash").status).toBe("fail");
    expect(c.items.find((i) => i.kind === "uppercase").status).toBe("review");
  });
});

describe("checkNoindexBlocked", () => {
  it("fails a linked page that robots.txt blocks while it says noindex", async () => {
    const pages = [{ url: `${O}/`, html: page(`${O}/`, { links: ["/admin", "/pricing"] }).body }];
    const routes = { [`${O}/admin`]: page(`${O}/admin`, { robots: "noindex" }) };
    const c = await checkNoindexBlocked(fakeFetch(routes), { origin: O, robotsTxt: ROBOTS, pages });
    expect(c.status).toBe("fail");
    expect(c.items[0].path).toBe("/admin");
  });

  it("passes when nothing links into a blocked path", async () => {
    const pages = [{ url: `${O}/`, html: page(`${O}/`, { links: ["/pricing"] }).body }];
    const c = await checkNoindexBlocked(fakeFetch({}), { origin: O, robotsTxt: ROBOTS, pages });
    expect(c.status).toBe("pass");
  });
});

describe("checkKeyPageLinks", () => {
  it("reviews a key page that few pages link to", () => {
    const pages = ["/", "/a", "/b", "/c", "/d", "/e"].map((p) => ({
      url: `${O}${p}`,
      html: page(`${O}${p}`, { links: ["/a", ...(p === "/" ? ["/pricing"] : [])] }).body,
    }));
    const c = checkKeyPageLinks({ pages, keyPaths: ["/a", "/pricing"] });
    expect(c.items.find((i) => i.path === "/a").status).toBe("pass");
    expect(c.items.find((i) => i.path === "/pricing").status).toBe("review");
  });

  it("reads key pages from the inventory", () => {
    expect(
      keyPathsFromInventory({
        pages: [
          { url: "/pricing", priority: "P1", status: "published", indexable: true },
          { url: "/draft", priority: "P1", status: "approved" },
          { url: "/x", priority: "P2", status: "published" },
        ],
      }),
    ).toEqual(["/pricing"]);
  });
});

describe("checkImageWeight", () => {
  it("fails a big preloaded image and reviews a big lazy one", async () => {
    const html = `<link rel="preload" as="image" href="/logo.png"><img src="/logo.png" alt=""><img src="/photo.jpg" loading="lazy" alt=""><img src="/small.webp" alt="">`;
    const routes = {
      [`${O}/logo.png`]: { headers: { "content-length": "930000" } },
      [`${O}/photo.jpg`]: { headers: { "content-length": "1200000" } },
      [`${O}/small.webp`]: { headers: { "content-length": "6000" } },
    };
    const c = await checkImageWeight(fakeFetch(routes), { pages: [{ url: `${O}/`, html }] });
    expect(c.status).toBe("fail");
    expect(c.items.find((i) => i.src.endsWith("/logo.png")).status).toBe("fail");
    expect(c.items.find((i) => i.src.endsWith("/photo.jpg")).status).toBe("review");
    expect(c.items.some((i) => i.src.endsWith("/small.webp"))).toBe(false);
  });
});

describe("checkOwnedSubdomains", () => {
  it("passes a crawlable noindex demo and fails an indexable one", async () => {
    const routes = {
      "https://demo1.site.example/": { body: "<html></html>", headers: { "x-robots-tag": "noindex" } },
      "https://demo1.site.example/robots.txt": { body: "User-agent: *\nAllow: /\n" },
      "https://demo2.site.example/": page("https://demo2.site.example/"),
    };
    const c = await checkOwnedSubdomains(fakeFetch(routes), { hosts: ["demo1.site.example", "demo2.site.example"] });
    expect(c.items.map((i) => i.status)).toEqual(["pass", "fail"]);
  });
});

describe("runSiteChecks", () => {
  it("runs every check from the project config without throwing when the site is unreachable", async () => {
    const report = await runSiteChecks({
      fetchImpl: async () => {
        throw new Error("blocked by proxy");
      },
      config: { environments: { production: { url: O, hosts: ["site.example", "www.site.example"] } } },
    });
    expect(report.checks.map((c) => c.id)).toEqual([
      "protocol-host",
      "robots-hosts",
      "sitemap-sweep",
      "redirect-codes",
      "noindex-blocked",
      "key-page-links",
      "image-weight",
      "owned-subdomains",
    ]);
    expect(report.checks.some((c) => c.status === "fail")).toBe(false);
    expect(report.checks.every((c) => c.status === "skip")).toBe(true);
  });
});
