// Tests for the vendored BWESEO post-publication checker (seo/tools/post-publish-check.mjs).
// Everything runs against a simulated website on example.com — no network, and nothing here is
// specific to this project, matching the engine's rule that the checker is business-agnostic.

import { describe, expect, it } from "vitest";
import {
  ACTION_REQUIRED,
  INDEXING_DISABLED,
  NOT_APPLICABLE,
  NOT_LIVE_MESSAGE,
  UNAVAILABLE_MESSAGE,
  NOT_ON_STAGING,
  READY,
  STAGING_PASSED,
  STAGING_PROBLEMS,
  SITEMAP_SUBMISSION_UNVERIFIED,
  addDays,
  checkPublication,
  extractHead,
  extractLinks,
  formatReport,
  parseRobots,
  parseSitemap,
  robotsAllows,
  samePage,
} from "./post-publish-check.mjs";

const ORIGIN = "https://example.com";
const PAGE_URL = `${ORIGIN}/new-page`;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const pageHtml = ({
  robots = "index, follow",
  canonical = PAGE_URL,
  title = "New Page | Example",
  jsonLd = '{"@context":"https://schema.org","@type":"Service","name":"New"}',
} = {}) => `<!doctype html>
<html><head>
<title>${title}</title>
<meta name="description" content="A useful description of the new page that is long enough to be a real snippet.">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${canonical}">
<meta property="og:url" content="${canonical}">
<script type="application/ld+json">${jsonLd}</script>
</head><body><header><nav><a href="/">Home</a><a href="/services">Services</a></nav></header>
<main><h1>Our new service</h1><p>${words(200)}</p>
<a href="/services">See all services</a></main>
<footer><a href="/services">Services</a></footer></body></html>`;

const homeHtml = `<html><head><title>Home</title><link rel="canonical" href="${ORIGIN}/"></head><body>
<nav><a href="/">Home</a><a href="/services">Services</a></nav>
<main><p>Intro</p><a href="/new-page">our new service</a></main>
<footer><a href="/privacy">Privacy</a></footer></body></html>`;
const servicesHtml = `<html><head><title>Services</title></head><body><main>
<a href="https://example.com/new-page/"><img src="x.jpg" alt="New service card"></a></main></body></html>`;

const sitemapXml = (locs) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

function baseSite() {
  return {
    [PAGE_URL]: { body: pageHtml() },
    [`${ORIGIN}/`]: { body: homeHtml },
    [`${ORIGIN}/services`]: { body: servicesHtml },
    [`${ORIGIN}/robots.txt`]: {
      body: "User-agent: *\nDisallow: /admin\n\nSitemap: https://example.com/sitemap.xml\n",
    },
    [`${ORIGIN}/sitemap.xml`]: { body: sitemapXml([`${ORIGIN}/`, `${ORIGIN}/services`, PAGE_URL]) },
    "http://example.com/new-page": { status: 301, location: PAGE_URL },
    [`${PAGE_URL}/`]: { status: 308, location: PAGE_URL },
    "https://www.example.com/new-page": { status: 301, location: PAGE_URL },
  };
}

function fetchFrom(site) {
  return async (url) => {
    const p = site[url];
    const status = p ? (p.status ?? 200) : 404;
    const headers = { ...(p?.headers ?? {}), ...(p?.location ? { location: p.location } : {}) };
    return {
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => (p ? (p.body ?? "") : "Not found"),
    };
  };
}

const CONFIG = {
  website: ORIGIN,
  environments: { staging: "https://staging.example.com" },
  publication: {
    sitemapUrl: `${ORIGIN}/sitemap.xml`,
    robotsUrl: `${ORIGIN}/robots.txt`,
    stagingHosts: ["staging.example.com"],
  },
  analytics: {
    searchConsole: { property: "sc-domain:example.com", sitemapSubmission: "verified" },
  },
};
const PAGE = {
  id: "new-page",
  url: "/new-page",
  title: "New Page | Example",
  parent: "/",
  linksFrom: ["/", "/services"],
  relatedPages: ["/services"],
  verifyText: "Our new service",
};

const run = (site, extra = {}) =>
  checkPublication({
    fetchImpl: fetchFrom(site),
    config: extra.config ?? CONFIG,
    page: extra.page ?? PAGE,
    today: "2026-10-01",
    publishedOn: extra.publishedOn ?? "2026-10-01",
    expect: extra.expect,
  });
const check = (r, section, id) => r.checks.find((c) => c.section === section && c.id === id);

describe("post-publication checker — live, healthy page", () => {
  it("verifies everything and is READY, leaving only the Search Console step to the owner", async () => {
    const r = await run(baseSite());
    expect(r.live).toBe(true);
    expect(r.verdict).toBe(READY);
    for (const c of r.checks.filter((c) =>
      ["LIVE PAGE", "INDEXING", "SITEMAP", "INTERNAL LINKS"].includes(c.section),
    )) {
      expect(c.status, `${c.section} / ${c.label}: ${c.detail}`).toBe(c.id === "lastmod" ? "skip" : "pass");
    }
    expect(r.canonicalUrl).toBe(PAGE_URL);
    expect(r.inboundLinks.map((l) => [new URL(l.from).pathname, l.text, l.location])).toEqual([
      ["/", "our new service", "body"],
      ["/services", "New service card", "body"],
    ]);
    const gsc = r.manualActions.find((a) => typeof a === "object");
    expect(gsc.title).toBe("GOOGLE SEARCH CONSOLE — MANUAL ACTION REQUIRED");
    expect(gsc.steps[2]).toContain(PAGE_URL);
    expect(r.searchConsole.indexingRequest).toBe("UNKNOWN");
  });

  it("sets the 7/30/90-day review windows from the publication date", async () => {
    const r = await run(baseSite(), { publishedOn: "2026-10-01" });
    expect(r.monitoring).toMatchObject({
      publishedOn: "2026-10-01",
      review7: "2026-10-08",
      review30: "2026-10-31",
      review90: "2026-12-30",
    });
    expect(r.inventoryPatch).toMatchObject({
      status: "published",
      publishedOn: "2026-10-01",
      nextReview: "2026-10-08",
    });
    expect(r.inventoryPatch.postPublication).toMatchObject({
      result: "ready",
      sitemapStatus: "included",
      internalLinkStatus: "linked",
    });
  });

  it("prints the fixed report shape with a plain-language to-do list", async () => {
    const text = formatReport(await run(baseSite()));
    for (const heading of [
      "SEO POST-PUBLICATION CHECK",
      "LIVE PAGE",
      "INDEXING",
      "SITEMAP",
      "INTERNAL LINKS",
      "ON-PAGE SEO",
      "GOOGLE SEARCH CONSOLE",
      "MANUAL ACTIONS REQUIRED",
      "MONITORING",
      `OVERALL STATUS: ${READY}`,
      "WHAT YOU NEED TO DO",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain(`inspect ${PAGE_URL}`);
    expect(text).toContain("Everything else has been verified.");
    expect(text).not.toMatch(/guarantee/i);
  });

  it("drops the Search Console step once a REQUESTED status is on record, and flags an unverified sitemap submission", async () => {
    const r = await run(baseSite(), {
      page: {
        ...PAGE,
        postPublication: {
          searchConsole: {
            indexingRequest: "REQUESTED",
            requestedOn: "2026-10-02",
            requestSource: "owner:2026-10-02 chat",
            urlInspection: "verified",
          },
        },
      },
      config: {
        ...CONFIG,
        analytics: {
          searchConsole: { property: "sc-domain:example.com", sitemapSubmission: "not verified" },
        },
      },
    });
    expect(r.manualActions).toEqual([SITEMAP_SUBMISSION_UNVERIFIED]);
    expect(r.searchConsole).toMatchObject({
      indexingRequest: "REQUESTED",
      urlInspection: "verified",
      sitemapSubmission: "not verified",
    });
  });
});

describe("post-publication checker — page not live", () => {
  it("stops with PAGE NOT LIVE when production 404s, and says the page is only on staging", async () => {
    const site = baseSite();
    delete site[PAGE_URL];
    site["https://staging.example.com/new-page"] = { body: pageHtml() };
    const r = await run(site);
    expect(r.live).toBe(false);
    expect(r.verdict).toBe(NOT_LIVE_MESSAGE);
    expect(r.notes.join(" ")).toContain("exists on staging");
    expect(r.checks.every((c) => c.section === "LIVE PAGE")).toBe(true);
    const text = formatReport(r);
    expect(text).toContain("PAGE NOT LIVE — INDEXING STEPS CANNOT YET BE COMPLETED.");
    expect(text).not.toContain(READY);
  });

  it("a 5xx / 522 is UNAVAILABLE — a health failure, not 'not live' and not 'only on staging'", async () => {
    const site = baseSite();
    site[PAGE_URL] = { status: 522, body: "error code: 522" };
    site["https://staging.example.com/new-page"] = { body: pageHtml() };
    const r = await run(site);
    expect(r.live).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.verdict).toBe(UNAVAILABLE_MESSAGE);
    expect(r.verdict).not.toBe(NOT_LIVE_MESSAGE);
    expect(r.notes.join(" ")).toMatch(/health failure, not evidence that the page is unpublished/);
    expect(r.notes.join(" ")).not.toMatch(/exists on staging/);
    const text = formatReport(r);
    expect(text).toContain("PRODUCTION CHECK UNAVAILABLE");
    expect(text).not.toContain("PAGE NOT LIVE");
  });

  it("treats a redirect to another page as not live", async () => {
    const site = baseSite();
    site[PAGE_URL] = { status: 301, location: `${ORIGIN}/` };
    expect((await run(site)).verdict).toBe(NOT_LIVE_MESSAGE);
  });

  it("treats a different page (title mismatch) as not live", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml({ title: "Something else" }) };
    const r = await run(site);
    expect(r.verdict).toBe(NOT_LIVE_MESSAGE);
    expect(check(r, "LIVE PAGE", "available").detail).toMatch(/different page/);
  });

  it("never treats a staging URL as the live page — it gets the staging check instead", async () => {
    const site = { "https://staging.example.com/new-page": { body: pageHtml() } };
    const r = await checkPublication({
      fetchImpl: fetchFrom(site),
      config: CONFIG,
      page: PAGE,
      url: "https://staging.example.com/new-page",
      today: "2026-10-01",
    });
    expect(r.environment).toBe("STAGING");
    expect(r.verdict).not.toBe(READY);
    expect(r.indexingActions).toBe("disabled");
    expect(r.inventoryPatch).toBeUndefined();
  });
});

describe("post-publication checker — problems that block indexing", () => {
  it("flags an accidental noindex", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml({ robots: "noindex, nofollow" }) };
    const r = await run(site);
    expect(check(r, "INDEXING", "noindex").status).toBe("fail");
    expect(r.verdict).toBe(ACTION_REQUIRED);
    expect(r.manualActions.some((a) => typeof a === "object")).toBe(false);
  });

  it("flags a canonical that points at staging", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml({ canonical: "https://staging.example.com/new-page" }) };
    expect(check(await run(site), "INDEXING", "canonical").detail).toMatch(/staging/);
  });

  it("flags a canonical that points at another page", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml({ canonical: `${ORIGIN}/` }) };
    expect(check(await run(site), "INDEXING", "canonical").status).toBe("fail");
  });

  it("flags robots.txt blocking the page", async () => {
    const site = baseSite();
    site[`${ORIGIN}/robots.txt`] = { body: "User-agent: *\nDisallow: /new\n" };
    expect(check(await run(site), "INDEXING", "robots").status).toBe("fail");
  });

  it("flags a page missing from the sitemap, and staging URLs in it", async () => {
    const site = baseSite();
    site[`${ORIGIN}/sitemap.xml`] = {
      body: sitemapXml([`${ORIGIN}/`, "https://staging.example.com/services"]),
    };
    const r = await run(site);
    expect(check(r, "SITEMAP", "included").status).toBe("fail");
    expect(check(r, "SITEMAP", "no-staging").status).toBe("fail");
  });

  it("flags an orphaned page", async () => {
    const site = baseSite();
    site[`${ORIGIN}/`] = { body: "<html><body><main>No links here</main></body></html>" };
    site[`${ORIGIN}/services`] = { body: "<html><body>Nothing</body></html>" };
    const r = await run(site);
    expect(check(r, "INTERNAL LINKS", "orphan").status).toBe("fail");
    expect(r.inventoryPatch.postPublication.internalLinkStatus).toBe("orphaned");
    expect(r.verdict).toBe(ACTION_REQUIRED);
  });

  it("flags invalid JSON-LD", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml({ jsonLd: "{ not json" }) };
    expect(check(await run(site), "ON-PAGE SEO", "schema").status).toBe("fail");
  });

  it("blocks when http:// is served with no canonical pointing to the HTTPS page", async () => {
    const site = baseSite();
    site["http://example.com/new-page"] = {
      body: "<html><head><title>New Page | Example</title></head><body>copy</body></html>",
    };
    const r = await run(site);
    expect(check(r, "INDEXING", "indexable").status).toBe("fail");
    expect(r.verdict).toBe(ACTION_REQUIRED);
  });

  it("only warns when http:// is served but canonicalizes to the HTTPS page", async () => {
    const site = baseSite();
    site["http://example.com/new-page"] = { body: pageHtml() };
    const r = await run(site);
    expect(check(r, "INDEXING", "indexable").status).toBe("warn");
    expect(check(r, "INDEXING", "indexable").detail).toMatch(/HTTPS redirect should be enabled/);
    expect(r.verdict).toBe(READY);
  });
});

// ---------------------------------------------------------------- environments (engine 1.3.0)

const STG = "https://staging.example.com";
const ENV_CONFIG = {
  ...CONFIG,
  environments: {
    production: { url: ORIGIN, hosts: ["example.com", "www.example.com"] },
    staging: { status: "configured", url: STG, hosts: ["staging-example.workers.example.net"] },
    preview: { status: "configured", hostPatterns: ["*.preview.example.net"] },
  },
  publication: { sitemapUrl: `${ORIGIN}/sitemap.xml`, robotsUrl: `${ORIGIN}/robots.txt` },
};
const runEnv = (site, extra = {}) =>
  checkPublication({
    fetchImpl: extra.fetchImpl ?? fetchFrom(site),
    config: extra.config ?? ENV_CONFIG,
    page: PAGE,
    url: extra.url,
    environment: extra.environment,
    today: "2026-10-01",
    publishedOn: "2026-10-01",
  });
// The same page on staging, hidden from search engines the strong way.
function stagingSite({ noindexHeader = true, robots = "User-agent: *\nDisallow: /\n" } = {}) {
  const headers = noindexHeader ? { "x-robots-tag": "noindex, nofollow" } : {};
  const html = pageHtml({ canonical: PAGE_URL }).replace(
    '<a href="/services">',
    '<a href="/#contact">Get a quote</a> <a href="/services">',
  );
  return {
    [`${STG}/new-page`]: { body: html, headers },
    [`${STG}/services`]: { body: servicesHtml, headers },
    [`${STG}/`]: { body: homeHtml, headers },
    [`${STG}/robots.txt`]: { body: robots },
    [`${STG}/sitemap.xml`]: { body: sitemapXml([`${ORIGIN}/`, PAGE_URL]) },
  };
}

describe("post-publication checker — environments", () => {
  it("LOCAL PAGE → not applicable, no requests and no indexing actions", async () => {
    let calls = 0;
    const r = await runEnv(
      {},
      {
        url: "http://localhost:5173/new-page",
        fetchImpl: async () => {
          calls++;
          throw new Error("no network for a local page");
        },
      },
    );
    expect(r.verdict).toBe(NOT_APPLICABLE);
    expect(r.environment).toBe("LOCAL");
    expect(r.indexingActions).toBe("disabled");
    expect(calls).toBe(0);
    expect(r.manualActions).toEqual([]);
    expect(formatReport(r)).toMatch(/not available to search engines/);
  });

  it("STAGING PAGE → SEO testing allowed, indexing actions disabled", async () => {
    const r = await runEnv(stagingSite(), { environment: "staging" });
    expect(r.environment).toBe("STAGING");
    expect(r.url ?? r.page.url).toContain(STG);
    expect(r.verdict).toBe(STAGING_PASSED);
    expect(r.indexingActions).toBe("disabled");
    expect(r.notes).toContain(INDEXING_DISABLED);
    expect(r.notes).toContain("Do not request indexing for this URL.");
    // No Search Console step, no sitemap submission, no inventory "published" patch.
    expect(r.manualActions).toEqual([]);
    expect(r.inventoryPatch).toBeUndefined();
    expect(r.stagingReview).toMatchObject({ result: "pass", date: "2026-10-01" });
    for (const id of ["title", "description", "h1", "schema"]) {
      expect(check(r, "SEO", id).status, id).toBe("pass");
    }
    expect(check(r, "LINKS", "work").status).toBe("pass");
    expect(check(r, "LINKS", "cta").status).toBe("pass");
    expect(r.userChecks.length).toBeGreaterThan(0);
    const text = formatReport(r);
    expect(text).toMatch(/^STAGING PUBLICATION CHECK/);
    expect(text).toContain("ENVIRONMENT: STAGING");
    expect(text).toContain("SEARCH ENGINE INDEXING ACTIONS: DISABLED");
    expect(text).toContain("NEEDS YOUR CHECK");
    // It tells the owner NOT to request indexing, and never gives the Search Console steps.
    expect(text).not.toMatch(/URL Inspection|MANUAL ACTION REQUIRED/);
  });

  it("STAGING NOINDEX → acceptable and intended", async () => {
    const r = await runEnv(stagingSite(), { environment: "staging" });
    expect(check(r, "ENVIRONMENT", "hidden")).toMatchObject({ status: "pass" });
    expect(check(r, "ENVIRONMENT", "hidden").detail).toMatch(/X-Robots-Tag noindex/);
    expect(r.critical).toEqual([]);
  });

  it("staging protected by robots.txt only is a warning; with nothing at all it fails", async () => {
    const weak = await runEnv(stagingSite({ noindexHeader: false }), { environment: "staging" });
    expect(check(weak, "ENVIRONMENT", "hidden").status).toBe("warn");
    const none = await runEnv(stagingSite({ noindexHeader: false, robots: "User-agent: *\n" }), {
      environment: "staging",
    });
    expect(check(none, "ENVIRONMENT", "hidden").status).toBe("fail");
    expect(none.verdict).toBe(STAGING_PROBLEMS);
  });

  it("a staging canonical that points at another staging page fails; at production it passes", async () => {
    const site = stagingSite();
    site[`${STG}/new-page`].body = pageHtml({ canonical: `${ORIGIN}/services` });
    const r = await runEnv(site, { environment: "staging" });
    expect(check(r, "ENVIRONMENT", "canonical").detail).toMatch(/different production page/);
    const ok = await runEnv(stagingSite(), { environment: "staging" });
    expect(check(ok, "ENVIRONMENT", "canonical").status).toBe("pass");
  });

  it("a page missing from staging says so, and still offers no indexing step", async () => {
    const r = await runEnv({}, { environment: "staging" });
    expect(r.verdict).toBe(NOT_ON_STAGING);
    expect(r.indexingActions).toBe("disabled");
    expect(formatReport(r)).toMatch(/Deploy the current version to staging/);
  });

  it("a preview or unknown host is treated as non-production too", async () => {
    const r = await runEnv({}, { url: "https://pr-4.preview.example.net/new-page" });
    expect(r.environment).toBe("PREVIEW");
    expect(r.indexingActions).toBe("disabled");
    const u = await runEnv({}, { url: "https://example.org/new-page" });
    expect(u.environment).toBe("UNKNOWN");
    expect(u.indexingActions).toBe("disabled");
  });

  it("PRODUCTION PAGE → the full post-publication workflow, indexing allowed once it passes", async () => {
    const r = await runEnv(baseSite());
    expect(r.environment).toBe("PRODUCTION");
    expect(r.indexingActions).toBe("enabled");
    expect(r.verdict).toBe(READY);
    for (const c of r.checks.filter((c) => c.section === "ENVIRONMENT")) {
      expect(c.status, `${c.label}: ${c.detail}`).not.toBe("fail");
    }
    expect(r.manualActions.some((a) => typeof a === "object")).toBe(true);
    expect(formatReport(r)).toContain("ENVIRONMENT: PRODUCTION");
  });

  it("STAGING 200 / PRODUCTION 404 → production not deployed", async () => {
    const site = { ...baseSite(), ...stagingSite() };
    delete site[PAGE_URL];
    const r = await runEnv(site);
    expect(r.environment).toBe("PRODUCTION");
    expect(r.live).toBe(false);
    expect(r.verdict).toBe(NOT_LIVE_MESSAGE);
    expect(r.notes.join(" ")).toMatch(/production status: NOT DEPLOYED/);
  });

  it("PRODUCTION NOINDEX ON AN INTENDED PUBLIC PAGE → critical error", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml(), headers: { "x-robots-tag": "noindex" } };
    const r = await runEnv(site);
    expect(check(r, "INDEXING", "noindex").status).toBe("fail");
    expect(r.critical.map((c) => c.id)).toContain("noindex");
    expect(formatReport(r)).toContain("CRITICAL SEO ERRORS");
  });

  it("PRODUCTION CANONICAL POINTS TO STAGING → critical error", async () => {
    const site = baseSite();
    site[PAGE_URL] = { body: pageHtml({ canonical: `${STG}/new-page` }) };
    const r = await runEnv(site);
    expect(r.critical.map((c) => c.id)).toContain("canonical");
    expect(check(r, "INDEXING", "canonical").detail).toMatch(/^CRITICAL SEO ERROR/);
  });

  it("PRODUCTION SITEMAP CONTAINS A STAGING URL → critical error", async () => {
    const site = baseSite();
    site[`${ORIGIN}/sitemap.xml`] = {
      body: sitemapXml([`${ORIGIN}/`, PAGE_URL, "https://staging-example.workers.example.net/x"]),
    };
    const r = await runEnv(site);
    expect(check(r, "SITEMAP", "no-staging").status).toBe("fail");
    expect(r.critical.map((c) => c.id)).toContain("no-staging");
  });

  it("PRODUCTION INTERNAL LINK POINTS TO STAGING → error", async () => {
    const site = baseSite();
    site[PAGE_URL] = {
      body: pageHtml().replace(
        '<a href="/services">',
        `<a href="${STG}/pricing">Pricing</a><a href="/services">`,
      ),
    };
    const r = await runEnv(site);
    expect(check(r, "ENVIRONMENT", "links").status).toBe("fail");
    expect(check(r, "ENVIRONMENT", "links").detail).toContain(`${STG}/pricing`);
    expect(r.verdict).toBe(ACTION_REQUIRED);
  });

  it("flags staging, preview and localhost URLs in production schema and social metadata", async () => {
    const site = baseSite();
    site[PAGE_URL] = {
      body: pageHtml({
        jsonLd: `{"@context":"https://schema.org","@type":"Service","@id":"${STG}/new-page#service","image":"http://localhost:3000/a.png"}`,
      }).replace(
        "</head>",
        '<meta property="og:image" content="https://pr-1.preview.example.net/og.jpg"></head>',
      ),
    };
    const r = await runEnv(site);
    expect(check(r, "ENVIRONMENT", "schema").status).toBe("fail");
    expect(check(r, "ENVIRONMENT", "schema").detail).toMatch(/staging.*local|local.*staging/);
    expect(check(r, "ENVIRONMENT", "social").detail).toMatch(/og:image/);
    expect(r.verdict).toBe(ACTION_REQUIRED);
  });

  it("finds a staging hostname anywhere else in the production HTML", async () => {
    const site = baseSite();
    site[PAGE_URL] = {
      body: pageHtml().replace("</body>", "<p>Preview at staging.example.com</p></body>"),
    };
    const r = await runEnv(site);
    expect(check(r, "ENVIRONMENT", "contamination").status).toBe("fail");
  });
});

describe("post-publication checker — parsing helpers", () => {
  it("applies robots.txt the way crawlers do: a specific group replaces *", () => {
    const robots = parseRobots(
      "User-agent: *\nDisallow: /portal\n\nUser-agent: Bingbot\nCrawl-delay: 1\n",
    );
    expect(robotsAllows(robots, "googlebot", "/portal").allowed).toBe(false);
    expect(robotsAllows(robots, "bingbot", "/portal").allowed).toBe(true);
  });

  it("uses the longest matching rule, Allow winning ties, with * and $ wildcards", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\n");
    expect(robotsAllows(robots, "x", "/a/b/c").allowed).toBe(true);
    expect(robotsAllows(robots, "x", "/a/c").allowed).toBe(false);
    expect(robotsAllows(robots, "x", "/file.pdf").allowed).toBe(false);
    expect(robotsAllows(robots, "x", "/file.pdf?x=1").allowed).toBe(true);
  });

  it("reads head metadata and detects invalid JSON-LD", () => {
    const h = extractHead(
      `<title>T &amp; Co</title><meta content="d" name="description"><link href="https://x.test/a" rel="canonical"><h1>One</h1><script type="application/ld+json">{oops}</script>`,
    );
    expect(h).toMatchObject({
      title: "T & Co",
      metaDescription: "d",
      canonicals: ["https://x.test/a"],
      h1s: ["One"],
    });
    expect(h.jsonLd[0].ok).toBe(false);
  });

  it("records where each link sits and falls back to image alt text", () => {
    const links = extractLinks(
      `<nav><a href="/a">A</a></nav><main><a href="/b"><img alt="Bee"></a></main><footer><a href="/c">C</a></footer>`,
      "https://x.test/",
    );
    expect(links.map((l) => [l.href, l.text, l.location])).toEqual([
      ["https://x.test/a", "A", "nav"],
      ["https://x.test/b", "Bee", "body"],
      ["https://x.test/c", "C", "footer"],
    ]);
  });

  it("parses sitemaps, compares pages and adds days", () => {
    expect(parseSitemap(sitemapXml(["https://x.test/a"])).locs).toEqual(["https://x.test/a"]);
    expect(
      parseSitemap(
        "<sitemapindex><sitemap><loc>https://x.test/s1.xml</loc></sitemap></sitemapindex>",
      ).kind,
    ).toBe("index");
    expect(samePage("https://www.x.test/a/", "http://x.test/a")).toBe(true);
    expect(samePage("https://x.test/a", "https://x.test/b")).toBe(false);
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });
});

// ---------------------------------------------------------------- Google readiness inputs (engine 1.7.0)
describe("post-publication checker — sitemap structure, lastmod and staging visibility", () => {
  const urlset = (entries) =>
    `<?xml version="1.0"?><urlset>${entries.map(([loc, lm]) => `<url><loc>${loc}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ""}</url>`).join("")}</urlset>`;
  const withSitemap = (xml) => {
    const site = baseSite();
    site[`${ORIGIN}/sitemap.xml`] = { body: xml };
    return site;
  };

  it("parseSitemap returns entries with lastmod and flags malformed files", () => {
    const ok = parseSitemap(urlset([[`${ORIGIN}/`, "2026-10-01"], [PAGE_URL, null]]));
    expect(ok.entries).toEqual([
      { loc: `${ORIGIN}/`, lastmod: "2026-10-01" },
      { loc: PAGE_URL, lastmod: null },
    ]);
    expect(ok.malformed).toBe(false);
    expect(parseSitemap("<html>not a sitemap</html>").malformed).toBe(true);
    expect(parseSitemap("<urlset><url><loc>https://a.example/</loc></urlset>").malformed).toBe(true);
    expect(parseSitemap("<urlset></urlset>").malformed).toBe(true);
  });

  it("a malformed sitemap fails the 'well-formed' check", async () => {
    const r = await run(withSitemap("<urlset><url><loc>" + PAGE_URL + "</loc></urlset>"));
    expect(check(r, "SITEMAP", "valid").status).toBe("fail");
  });

  it("judges lastmod only when the site publishes it", async () => {
    const none = await run(baseSite());
    expect(check(none, "SITEMAP", "lastmod").status).toBe("skip");
    const good = await run(withSitemap(urlset([[`${ORIGIN}/`, "2026-10-01"], [PAGE_URL, "2026-10-01"]])));
    expect(check(good, "SITEMAP", "lastmod").status).toBe("pass");
    const missing = await run(withSitemap(urlset([[`${ORIGIN}/`, "2026-10-01"], [PAGE_URL, null]])));
    expect(check(missing, "SITEMAP", "lastmod").status).toBe("warn");
    const future = await run(withSitemap(urlset([[`${ORIGIN}/`, "2026-10-01"], [PAGE_URL, "2027-12-31"]])));
    expect(check(future, "SITEMAP", "lastmod").status).toBe("fail");
    const junk = await run(withSitemap(urlset([[`${ORIGIN}/`, "2026-10-01"], [PAGE_URL, "not-a-date"]])));
    expect(check(junk, "SITEMAP", "lastmod").status).toBe("fail");
  });

  it("checks that staging stays hidden — with evidence only", async () => {
    const hidden = baseSite();
    hidden["https://staging.example.com/robots.txt"] = { body: "User-agent: *\nDisallow: /" };
    hidden["https://staging.example.com/new-page"] = { body: pageHtml(), headers: { "x-robots-tag": "noindex, nofollow" } };
    const cfg = { ...CONFIG, environments: { staging: { status: "configured", url: "https://staging.example.com" } } };
    expect(check(await run(hidden, { config: cfg }), "ENVIRONMENT", "staging-hidden").status).toBe("pass");
    const exposed = baseSite();
    exposed["https://staging.example.com/robots.txt"] = { body: "User-agent: *\nAllow: /" };
    exposed["https://staging.example.com/new-page"] = { body: pageHtml() };
    expect(check(await run(exposed, { config: cfg }), "ENVIRONMENT", "staging-hidden").status).toBe("fail");
    // unreachable staging is not judged (never a false failure)
    expect(check(await run(baseSite(), { config: cfg }), "ENVIRONMENT", "staging-hidden").status).toBe("skip");
  });
});

// ---------------------------------------------------------------- page-quality checks (seo-page-checks.mjs)
describe("post-publication checker — page-quality checks", () => {
  const PQ = ["og-url-canonical", "social-image-size", "above-fold-visible", "nav-anchors", "site-navigation", "site-footer"];
  const pq = (r, section = "ON-PAGE SEO") => Object.fromEntries(PQ.map((id) => [id, check(r, section, id)?.status]));
  const withPage = (html) => ({ ...baseSite(), [PAGE_URL]: { body: html } });

  it("a healthy page passes or skips every one of them (production)", async () => {
    const r = await run(baseSite());
    const s = pq(r);
    for (const id of PQ) expect(["pass", "skip"], id).toContain(s[id]);
    expect(s["og-url-canonical"]).toBe("pass");
    expect(s["above-fold-visible"]).toBe("pass");
    expect(s["site-navigation"]).toBe("pass");
    expect(s["site-footer"]).toBe("pass");
    expect(r.verdict).toBe(READY);
  });

  it("reports an og:url that points at another page (the inherited-homepage bug), replacing the old note", async () => {
    const html = pageHtml().replace(`og:url" content="${PAGE_URL}"`, `og:url" content="${ORIGIN}/"`);
    const r = await run(withPage(html));
    const c = check(r, "ON-PAGE SEO", "og-url-canonical");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/differs in path/);
    expect(r.notes.join(" ")).not.toMatch(/differs from the canonical URL/);
  });

  it("does not flag an og:url that differs only by a trailing slash", async () => {
    const html = pageHtml().replace(`og:url" content="${PAGE_URL}"`, `og:url" content="${PAGE_URL}/"`);
    expect(check(await run(withPage(html)), "ON-PAGE SEO", "og-url-canonical").status).toBe("pass");
  });

  it("fails a hero that is server-rendered at opacity:0", async () => {
    const html = pageHtml().replace("<h1>Our new service</h1>", '<div style="opacity:0;transform:translateY(20px)"><h1>Our new service</h1></div>');
    const c = check(await run(withPage(html)), "ON-PAGE SEO", "above-fold-visible");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/opacity:0/);
  });

  it("fails a sub-page with no navigation and no footer when the home page has them, and flags dead footer anchors", async () => {
    const bare = pageHtml()
      .replace(/<header>[\s\S]*<\/header>/, "")
      .replace(/<footer>[\s\S]*<\/footer>/, '<footer><a href="#pricing">Pricing</a></footer>');
    const s = pq(await run(withPage(bare)));
    expect(s["site-navigation"]).toBe("fail");
    expect(s["nav-anchors"]).toBe("fail");
    const noFooter = pageHtml().replace(/<footer>[\s\S]*<\/footer>/, "");
    expect(pq(await run(withPage(noFooter)))["site-footer"]).toBe("fail");
  });

  it("checks the home page itself without comparing it to itself", async () => {
    const r = await run(baseSite(), { page: { ...PAGE, url: "/" } });
    expect(check(r, "ON-PAGE SEO", "site-navigation")?.status ?? "skip").toBe("skip");
  });

  it("a remote social image is not inspected and never fails the page", async () => {
    const html = pageHtml().replace("</head>", '<meta property="og:image" content="https://cdn.other.test/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"></head>');
    const c = check(await run(withPage(html)), "ON-PAGE SEO", "social-image-size");
    expect(c.status).toBe("skip");
    expect(c.detail).toMatch(/another site/);
  });

  it("a same-site social image with the wrong declared size fails", async () => {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(746, 16);
    png.writeUInt32BE(583, 20);
    const html = pageHtml().replace("</head>", `<meta property="og:image" content="${ORIGIN}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"></head>`);
    const site = withPage(html);
    const base = fetchFrom(site);
    const fetchImpl = async (url, o) =>
      url === `${ORIGIN}/og.png` ? { status: 200, headers: { get: () => null }, arrayBuffer: async () => png.buffer, text: async () => "" } : base(url, o);
    const r = await checkPublication({ fetchImpl, config: CONFIG, page: PAGE, today: "2026-10-01", publishedOn: "2026-10-01" });
    const c = check(r, "ON-PAGE SEO", "social-image-size");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/1200×630 but the image is 746×583/);
  });

  it("on staging the same defects produce STAGING CHECK FOUND PROBLEMS, and REVIEW REQUIRED prints with its own mark", async () => {
    const site = stagingSite();
    const reviewHtml = pageHtml({ canonical: PAGE_URL }).replace("<h1>Our new service</h1>", '<div class="opacity-0"><h1>Our new service</h1></div>').replace(
      '<a href="/services">',
      '<a href="/#contact">Get a quote</a> <a href="/services">',
    );
    site[`${STG}/new-page`] = { body: reviewHtml, headers: { "x-robots-tag": "noindex, nofollow" } };
    const r = await runEnv(site, { environment: "staging" });
    const c = check(r, "SEO", "above-fold-visible");
    expect(c.status).toBe("review");
    expect(r.verdict).toBe(STAGING_PASSED); // REVIEW REQUIRED never blocks
    expect(formatReport(r)).toMatch(/\? Above-the-fold content visible.*REVIEW REQUIRED/);

    const broken = stagingSite();
    broken[`${STG}/new-page`] = { body: pageHtml({ canonical: PAGE_URL }).replace(/<header>[\s\S]*<\/header>/, ""), headers: { "x-robots-tag": "noindex, nofollow" } };
    const r2 = await runEnv(broken, { environment: "staging" });
    expect(check(r2, "SEO", "site-navigation").status).toBe("fail");
    expect(r2.verdict).toBe(STAGING_PROBLEMS);
  });
});
