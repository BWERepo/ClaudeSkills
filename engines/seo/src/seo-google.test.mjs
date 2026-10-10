// Tests for the reusable Google workflow layer (seo/tools/seo-google.mjs). Everything runs against a
// simulated site on example.com and a fake Google — no network, no real credentials. Nothing here is
// specific to any customer: the property, sitemap and hosts all come from the config under test.

import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPublication } from "./post-publish-check.mjs";
import { findSecret, validateConfig } from "./validate-seo-data.mjs";
import {
  assertIndexingApiAllowed,
  createSearchConsoleClient,
  credentialStatus,
  googleReadinessFromCheck,
  guardProductionTarget,
  indexingApiEligibility,
  interpretInspection,
  parseCredentialsSource,
  planSitemapAction,
  reconcileSitemap,
  redact,
  searchConsoleApiConfig,
  siteUrlFor,
  submitViaIndexingApi,
  summarizePerformance,
} from "./seo-google.mjs";


// Fake credentials are ASSEMBLED AT RUN TIME so that no secret-looking literal exists in this file — the
// reusable engine payload is scanned for secrets and must contain none, not even test fixtures.
const PK_BEGIN = ["-----BEGIN ", "PRIVATE", " KEY-----"].join("");
const FAKE_TOKEN = ["ya", "29.", "a0AfH6SMB", "x".repeat(24)].join("");
const FAKE_JWT = ["eyJhbGciOiJSUzI1NiJ9", "eyJpc3MiOiJ4In0", "c2lnc2lnc2ln"].join(".");
const FAKE_FIELD = ['{"private', '_key":"', 'abc123abc123abc"}'].join("");

const ORIGIN = "https://example.com";
const PAGE_URL = `${ORIGIN}/new-page`;
const SITEMAP = `${ORIGIN}/sitemap.xml`;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

// ---------------------------------------------------------------- a simulated production site
const pageHtml = ({ robots = "index, follow", canonical = PAGE_URL } = {}) => `<!doctype html><html><head>
<title>New Page | Example</title>
<meta name="description" content="A useful description of the new page that is long enough to be a real snippet.">
<meta name="robots" content="${robots}"><link rel="canonical" href="${canonical}">
</head><body><main><h1>Our new service</h1><p>${words(200)}</p><a href="/services">Services</a></main></body></html>`;
const homeHtml = `<html><head><title>Home</title><link rel="canonical" href="${ORIGIN}/"></head><body>
<nav><a href="/">Home</a></nav><main><a href="/new-page">our new service</a></main></body></html>`;
const servicesHtml = `<html><head><title>Services</title></head><body><main><a href="/new-page">the new service</a></main></body></html>`;
const sitemapXml = (locs) =>
  `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const site = () => ({
  [PAGE_URL]: { body: pageHtml() },
  [`${ORIGIN}/`]: { body: homeHtml },
  [`${ORIGIN}/services`]: { body: servicesHtml },
  [`${ORIGIN}/robots.txt`]: { body: "User-agent: *\nAllow: /\n" },
  [SITEMAP]: { body: sitemapXml([`${ORIGIN}/`, `${ORIGIN}/services`, PAGE_URL]) },
  "http://example.com/new-page": { status: 301, location: PAGE_URL },
  [`${PAGE_URL}/`]: { status: 308, location: PAGE_URL },
  "https://www.example.com/new-page": { status: 301, location: PAGE_URL },
});
const fetchFrom = (s) => async (url) => {
  const p = s[url];
  const headers = { ...(p?.headers ?? {}), ...(p?.location ? { location: p.location } : {}) };
  return { status: p ? (p.status ?? 200) : 404, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (p ? (p.body ?? "") : "Not found") };
};
const CONFIG = {
  website: ORIGIN,
  environments: { production: { url: ORIGIN, hosts: ["example.com", "www.example.com"] }, staging: "https://staging.example.com" },
  publication: { sitemapUrl: SITEMAP, stagingHosts: ["staging.example.com"] },
  analytics: { searchConsole: { configured: "yes", propertyType: "Domain", verifiedProperty: "example.com", verifiedOn: "2026-10-01" } },
};
const PAGE = { id: "new-page", url: "/new-page", title: "New Page | Example", parent: "/", linksFrom: ["/", "/services"], verifyText: "Our new service" };
const readiness = async (s) =>
  googleReadinessFromCheck(await checkPublication({ fetchImpl: fetchFrom(s), config: CONFIG, page: PAGE, today: "2026-10-01", publishedOn: "2026-10-01" }), { checkedAt: "2026-10-01" });
const failedItems = (r) => r.items.filter((i) => i.status === "fail").map((i) => i.id);

describe("Google readiness — technically ready, never 'indexed'", () => {
  it("a healthy new production page passes, and says nothing about indexing", async () => {
    const r = await readiness(site());
    expect(r.status).toBe("PASSED");
    expect(r.checkedAt).toBe("2026-10-01");
    expect(r.source).toMatch(/post-publication check/);
    expect(failedItems(r)).toEqual([]);
    for (const id of ["productionResponse", "indexable", "robots", "canonical", "sitemapIncluded", "internalLinks", "notOrphan", "title", "description", "h1"])
      expect(r.items.find((i) => i.id === id).status, id).toBe("pass");
    expect(JSON.stringify(r)).not.toMatch(/INDEXED|indexed by google/i);
  });

  it("a URL missing from the sitemap is detected", async () => {
    const s = site();
    s[SITEMAP] = { body: sitemapXml([`${ORIGIN}/`, `${ORIGIN}/services`]) };
    const r = await readiness(s);
    expect(r.status).toBe("FAILED");
    expect(failedItems(r)).toContain("sitemapIncluded");
    expect(r.failures).toContain("Sitemap includes the production URL");
  });

  it("a staging URL in the sitemap fails readiness", async () => {
    const s = site();
    s[SITEMAP] = { body: sitemapXml([`${ORIGIN}/`, PAGE_URL, "https://staging.example.com/new-page"]) };
    const r = await readiness(s);
    expect(r.status).toBe("FAILED");
    expect(failedItems(r)).toContain("sitemapProductionOnly");
  });

  it("a noindex production page fails readiness", async () => {
    const s = site();
    s[PAGE_URL] = { body: pageHtml({ robots: "noindex, nofollow" }) };
    const r = await readiness(s);
    expect(r.status).toBe("FAILED");
    expect(failedItems(r)).toContain("indexable");
  });

  it("a robots.txt-blocked production page fails readiness", async () => {
    const s = site();
    s[`${ORIGIN}/robots.txt`] = { body: "User-agent: *\nDisallow: /\n" };
    const r = await readiness(s);
    expect(r.status).toBe("FAILED");
    expect(failedItems(r)).toContain("robots");
  });

  it("an incorrect canonical fails readiness", async () => {
    const s = site();
    s[PAGE_URL] = { body: pageHtml({ canonical: "https://staging.example.com/new-page" }) };
    const r = await readiness(s);
    expect(r.status).toBe("FAILED");
    expect(failedItems(r)).toContain("canonical");
  });

  it("a malformed sitemap fails; a production 522 is UNKNOWN (health), not FAILED", async () => {
    const s = site();
    s[SITEMAP] = { body: "<urlset><url><loc>" + PAGE_URL + "</loc></urlset>" };
    expect(failedItems(await readiness(s))).toContain("sitemapValid");
    const down = site();
    down[PAGE_URL] = { status: 522, body: "error code: 522" };
    const r = await readiness(down);
    expect(r.status).toBe("UNKNOWN");
    expect(r.note).toMatch(/live-site health problem, not a readiness failure/);
  });

  it("staging that is not hidden is reported; staging never receives any Google action", async () => {
    const s = site();
    const cfg = { ...CONFIG, environments: { production: { url: ORIGIN, hosts: ["example.com"] }, staging: { status: "configured", url: "https://staging.example.com", hosts: ["staging.example.com"] } } };
    s["https://staging.example.com/robots.txt"] = { body: "User-agent: *\nAllow: /" };
    s["https://staging.example.com/new-page"] = { body: pageHtml() };
    const r = googleReadinessFromCheck(await checkPublication({ fetchImpl: fetchFrom(s), config: cfg, page: PAGE, today: "2026-10-01", publishedOn: "2026-10-01" }));
    expect(failedItems(r)).toContain("stagingHidden");
    expect(() => guardProductionTarget("https://staging.example.com/new-page", CONFIG, "Sitemap submission")).toThrow(/never submitted to Google/);
    expect(guardProductionTarget(PAGE_URL, CONFIG)).toBe(true);
  });
});

// ---------------------------------------------------------------- credentials: pointers only
describe("credentials are referenced by NAME, never stored, never exposed", () => {
  const SECRET_JSON = () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    return { pem, json: JSON.stringify({ client_email: "svc@example.com", private_key: pem }), privateKey };
  };
  const cfg = (extra = {}) => ({ ...CONFIG, analytics: { searchConsole: { ...CONFIG.analytics.searchConsole, enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON", ...extra } } });

  it("accepts only a NAME pointer", () => {
    expect(parseCredentialsSource("env:BWESEO_GSC_SERVICE_ACCOUNT_JSON")).toMatchObject({ valid: true, kind: "env" });
    expect(parseCredentialsSource("secret:GSC_KEY").valid).toBe(true);
    for (const bad of ["", null, `${PK_BEGIN}abc`, FAKE_FIELD, "lowercase:name", "env:lower_case", FAKE_TOKEN])
      expect(parseCredentialsSource(bad).valid).toBe(false);
    expect(parseCredentialsSource(`${PK_BEGIN}abc`).reason).not.toContain("abc");
  });

  it("credentialStatus returns booleans only — never the value, the email or the key", () => {
    const { json, pem } = SECRET_JSON();
    const on = credentialStatus(cfg(), { BWESEO_GSC_SERVICE_ACCOUNT_JSON: json });
    expect(on).toMatchObject({ enabled: true, available: true, present: true });
    const dump = JSON.stringify(on);
    expect(dump).not.toContain(pem.slice(40, 90));
    expect(dump).not.toContain("svc@example.com");
    expect(credentialStatus(cfg(), {})).toMatchObject({ available: false, present: false });
    expect(credentialStatus(cfg(), { BWESEO_GSC_SERVICE_ACCOUNT_JSON: "not json" })).toMatchObject({ available: false, present: true });
    expect(credentialStatus(CONFIG, {})).toMatchObject({ enabled: false, available: false });
  });

  it("redact strips keys, tokens and bearer headers", () => {
    const { pem } = SECRET_JSON();
    const noisy = `boom ${pem} and Bearer ${FAKE_TOKEN} and ${FAKE_FIELD} ${FAKE_JWT}`;
    const out = redact(noisy);
    expect(out).not.toMatch(/BEGIN PRIVATE KEY|ya29\.|abc123abc123|eyJhbGci/);
    expect(out).toContain("[redacted");
  });

  it("the validator refuses credentials in the SEO data, and a non-NAME credentialsSource", () => {
    expect(findSecret({ a: { b: `x ${PK_BEGIN} y` } })).toBe("a private key");
    expect(findSecret({ token: FAKE_TOKEN })).toBe("a Google access token");
    expect(findSecret({ note: "the property is verified" })).toBeNull();
    const base = {
      schemaVersion: 1,
      projectId: "example-site",
      website: ORIGIN,
      repo: { gitRemote: "acme/site" },
      engine: { version: "1.7.0" },
      adapter: "static-html",
      stack: { framework: "static" },
      workflows: { build: "npm run build", test: "npm test" },
      conversion: { primary: "contact form" },
      paths: { businessProfile: "seo/business-profile.json", contentInventory: "seo/content-inventory.json", docs: "docs/seo" },
      environments: { production: { url: ORIGIN }, staging: { status: "not-configured" } },
      analytics: { searchConsole: { configured: "yes", verifiedProperty: "example.com", verifiedOn: "2026-10-01" } },
    };
    const errs = (mutate) => {
      const c = JSON.parse(JSON.stringify(base));
      mutate(c.analytics.searchConsole);
      return validateConfig(c).errors.join("\n");
    };
    expect(errs((sc) => { sc.enabled = true; sc.credentialsSource = "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON"; })).toBe("");
    expect(errs((sc) => { sc.credentialsSource = `${PK_BEGIN} abc`; })).toMatch(/must be a NAME/);
    expect(errs((sc) => { sc.private_key = "x"; })).toMatch(/never store/);
    expect(errs((sc) => { sc.refresh_token = "x"; })).toMatch(/never store/);
    expect(errs((sc) => { sc.requestIndexing = "always"; })).toMatch(/requestIndexing/);
  });

  it("a real service-account JWT is signed with RS256 and carries only the expected claims (Search Console API mocked)", async () => {
    const { json, privateKey } = SECRET_JSON();
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(JSON.stringify({ access_token: "tok-test", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ path: SITEMAP, errors: "0", isPending: false, lastDownloaded: "2026-10-02T00:00:00Z", contents: [{ type: "web", submitted: "15" }] }), { status: 200 });
    };
    const client = createSearchConsoleClient({ config: cfg(), env: { BWESEO_GSC_SERVICE_ACCOUNT_JSON: json }, fetchImpl, now: () => Date.UTC(2026, 9, 2) });
    expect(client.available).toBe(true);
    expect(client.siteUrl).toBe("sc-domain:example.com");
    const r = await client.getSitemap(SITEMAP);
    expect(r.ok).toBe(true);
    const token = calls[0];
    const assertion = new URLSearchParams(token.init.body).get("assertion");
    const [h, c, sig] = assertion.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url"))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url"));
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "iss", "scope"]);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${c}`), createPublicKey(privateKey), Buffer.from(sig, "base64url"))).toBe(true);
    // the API call carries the bearer token, and the bearer token is not returned to the caller
    expect(calls[1].init.headers.authorization).toBe("Bearer tok-test");
    expect(JSON.stringify(r)).not.toMatch(/tok-test|BEGIN PRIVATE KEY/);
  });

  it("errors are graceful and never leak credentials", async () => {
    const { json, pem } = SECRET_JSON();
    const leaky = async (url) =>
      String(url).includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: `denied for ${pem} using Bearer ${FAKE_TOKEN}` } }), { status: 403 });
    const client = createSearchConsoleClient({ config: cfg(), env: { BWESEO_GSC_SERVICE_ACCOUNT_JSON: json }, fetchImpl: leaky });
    const r = await client.getSitemap(SITEMAP);
    expect(r).toMatchObject({ ok: false, kind: "permission-denied" });
    expect(r.message).not.toMatch(/BEGIN PRIVATE KEY|ya29\./);
    const quota = createSearchConsoleClient({ config: cfg(), env: { BWESEO_GSC_SERVICE_ACCOUNT_JSON: json }, fetchImpl: async (u) => (String(u).includes("oauth2") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : new Response("{}", { status: 429 })) });
    expect((await quota.listSitemaps()).kind).toBe("quota");
    const down = createSearchConsoleClient({ config: cfg(), env: { BWESEO_GSC_SERVICE_ACCOUNT_JSON: json }, fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com"); } });
    expect((await down.getSitemap(SITEMAP)).kind).toBe("network");
  });

  it("with no API configured every call degrades — nothing is sent", async () => {
    let sent = 0;
    const off = createSearchConsoleClient({ config: CONFIG, env: {}, fetchImpl: async () => { sent++; return new Response("{}"); } });
    expect(off.available).toBe(false);
    for (const call of [() => off.getSitemap(SITEMAP), () => off.submitSitemap(SITEMAP), () => off.inspectUrl(PAGE_URL), () => off.searchAnalytics({})])
      expect(await call()).toMatchObject({ ok: false, kind: "disabled" });
    const noCred = createSearchConsoleClient({ config: cfg(), env: {}, fetchImpl: async () => { sent++; return new Response("{}"); } });
    expect((await noCred.getSitemap(SITEMAP)).kind).toBe("not-configured");
    expect(sent).toBe(0);
    expect(searchConsoleApiConfig(CONFIG).reason).toMatch(/not enabled/);
    expect(siteUrlFor({ ...CONFIG, analytics: { searchConsole: { ...CONFIG.analytics.searchConsole, propertyType: "URL-prefix" } } })).toBe(`${ORIGIN}/`);
  });
});

// ---------------------------------------------------------------- sitemap reconciliation is idempotent
describe("sitemap registration — idempotent, official API, production only", () => {
  const cfg = { ...CONFIG, analytics: { searchConsole: { ...CONFIG.analytics.searchConsole, enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON", sitemap: { url: SITEMAP } } } };
  // a fake Search Console that remembers what was submitted
  const fakeClient = ({ registered = false, errors = 0, pending = false, available = true, failGet = null } = {}) => {
    const state = { registered, puts: 0, gets: 0 };
    return {
      state,
      available,
      status: { enabled: true, available, reason: available ? null : "the credential is not set in this environment" },
      getSitemap: async () => {
        state.gets++;
        if (failGet) return { ok: false, kind: failGet, message: "boom" };
        return state.registered
          ? { ok: true, data: { path: SITEMAP, errors: String(errors), isPending: pending, lastDownloaded: "2026-10-02T00:00:00Z", contents: [{ type: "web", submitted: "15" }] } }
          : { ok: false, kind: "not-found", message: "Not found" };
      },
      submitSitemap: async () => {
        state.puts++;
        state.registered = true;
        return { ok: true, data: null };
      },
    };
  };

  it("an already-registered sitemap is reported, not resubmitted — and that is not a failure", async () => {
    const c = fakeClient({ registered: true });
    const r = await reconcileSitemap({ client: c, config: cfg, dryRun: false });
    expect(r).toMatchObject({ ok: true, action: "none", message: "Sitemap already registered with Google Search Console." });
    expect(c.state.puts).toBe(0);
    expect(r.sitemap).toMatchObject({ status: "success", discoveredPages: 15, lastRead: "2026-10-02" });
  });

  it("a missing sitemap is submitted once; running again submits nothing (idempotent)", async () => {
    const c = fakeClient();
    const dry = await reconcileSitemap({ client: c, config: cfg, dryRun: true });
    expect(dry).toMatchObject({ ok: true, action: "would-submit" });
    expect(c.state.puts).toBe(0);
    const first = await reconcileSitemap({ client: c, config: cfg, dryRun: false });
    expect(first).toMatchObject({ ok: true, action: "submitted" });
    expect(first.sitemap).toMatchObject({ submitted: "yes", submissionMethod: "api", status: "success" });
    const second = await reconcileSitemap({ client: c, config: cfg, dryRun: false });
    expect(second.action).toBe("none");
    expect(c.state.puts).toBe(1);
  });

  it("planSitemapAction: errors resubmit, pending waits, force resubmits, otherwise nothing", () => {
    expect(planSitemapAction({ remote: null }).action).toBe("submit");
    expect(planSitemapAction({ remote: { errors: "2" } }).action).toBe("resubmit");
    expect(planSitemapAction({ remote: { isPending: true } }).action).toBe("none");
    expect(planSitemapAction({ remote: { errors: "0" } }).action).toBe("none");
    expect(planSitemapAction({ remote: { errors: "0" }, force: true }).action).toBe("resubmit");
  });

  it("API unavailable degrades gracefully; API errors are returned, never thrown", async () => {
    const noApi = await reconcileSitemap({ client: fakeClient({ available: false }), config: cfg, dryRun: false });
    expect(noApi).toMatchObject({ ok: false, action: "none" });
    expect(noApi.message).toMatch(/credential is not set/);
    for (const kind of ["permission-denied", "quota", "network", "api-error"]) {
      const c = fakeClient({ failGet: kind });
      const r = await reconcileSitemap({ client: c, config: cfg, dryRun: false });
      expect(r).toMatchObject({ ok: false, kind });
      expect(c.state.puts).toBe(0);
    }
  });

  it("never submits a staging sitemap — production URLs only", async () => {
    const c = fakeClient();
    const stagingCfg = { ...cfg, analytics: { searchConsole: { ...cfg.analytics.searchConsole, sitemap: { url: "https://staging.example.com/sitemap.xml" } } } };
    await expect(reconcileSitemap({ client: c, config: stagingCfg, dryRun: false })).rejects.toThrow(/never submitted to Google/);
    expect(c.state.puts).toBe(0);
  });
});

// ---------------------------------------------------------------- evidence: discovery / crawl / index / performance
describe("Google evidence is interpreted stage by stage — indexed only from Google's own verdict", () => {
  const api = (coverageState, extra = {}) => ({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState, ...extra } } });

  it("'Submitted and indexed' is the only route to INDEXED", () => {
    const i = interpretInspection(api("Submitted and indexed", { lastCrawlTime: "2026-10-05T10:00:00Z" }), { at: "2026-10-06" });
    expect(i.indexed).toMatchObject({ status: "INDEXED", verifiedOn: "2026-10-06", source: "search-console-api:url-inspection" });
    expect(i.discovered.status).toBe("DISCOVERED");
    expect(i.crawled.status).toBe("CRAWLED");
    expect(interpretInspection(api("Indexed, not submitted in sitemap"), { at: "2026-10-06" }).indexed.status).toBe("INDEXED");
  });

  it("discovered but not crawled ≠ indexed", () => {
    const i = interpretInspection({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" } } }, { at: "2026-10-06" });
    expect(i.discovered.status).toBe("DISCOVERED");
    expect(i.crawled.status).toBe("PENDING");
    expect(i.indexed.status).toBe("NOT VERIFIED");
  });

  it("crawled but not indexed ≠ indexed", () => {
    const i = interpretInspection({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-05T10:00:00Z" } } }, { at: "2026-10-06" });
    expect(i.discovered.status).toBe("DISCOVERED");
    expect(i.crawled.status).toBe("CRAWLED");
    expect(i.indexed).toMatchObject({ status: "NOT VERIFIED", lastCheckedOn: "2026-10-06" });
  });

  it("unknown to Google, or no result, proves nothing", () => {
    const u = interpretInspection({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } } }, { at: "2026-10-06" });
    expect(u.discovered.status).toBe("PENDING");
    expect(u.indexed.status).toBe("NOT VERIFIED");
    const none = interpretInspection({}, { at: "2026-10-06" });
    expect(none.indexed.status).toBe("NOT VERIFIED");
    expect(none.discovered.status).toBe("UNKNOWN");
  });

  it("a PASS verdict on a page Google reports as not indexed is still not indexed", () => {
    expect(interpretInspection({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Crawled - currently not indexed" } } }).indexed.status).toBe("NOT VERIFIED");
  });

  it("zero impressions is a valid result; numbers are only ever summed from Google's rows", () => {
    const zero = summarizePerformance({ rows: [] }, { windowDays: 28, at: "2026-11-01" });
    expect(zero).toMatchObject({ hasData: false, impressions: 0, clicks: 0, ctr: 0, position: null, windowDays: 28 });
    expect(summarizePerformance({}, {})).toMatchObject({ hasData: false });
    const some = summarizePerformance({ rows: [{ clicks: 3, impressions: 60, position: 5 }, { clicks: 1, impressions: 40, position: 15 }] }, { windowDays: 30, at: "2026-11-01", queryRows: { rows: [{ keys: ["website redesign"], clicks: 3, impressions: 60 }] } });
    expect(some).toMatchObject({ hasData: true, impressions: 100, clicks: 4, ctr: 0.04, position: 9 });
    expect(some.queries).toEqual([{ query: "website redesign", clicks: 3, impressions: 60 }]);
    expect(some).not.toHaveProperty("conversions"); // never invented
  });
});

// ---------------------------------------------------------------- guardrail: Google's Indexing API
describe("Google's Indexing API is never used for ordinary pages", () => {
  const ordinary = [{ url: "/website-redesign" }, { url: "/hvac-website-design" }, { url: "/pricing" }, { url: "/ecommerce-websites" }];

  it("ordinary SEO pages are not eligible, whatever the record says", () => {
    for (const p of ordinary) {
      expect(indexingApiEligibility(p).eligible).toBe(false);
      expect(() => assertIndexingApiAllowed(p)).toThrow(/Indexing API refused/);
    }
    expect(indexingApiEligibility({ url: "/x", google: { indexingApi: { eligible: true } } }).eligible).toBe(false); // no qualified type
    expect(indexingApiEligibility({ url: "/x", google: { indexingApi: { eligible: true, contentType: "Article" } } }).eligible).toBe(false);
    expect(indexingApiEligibility(ordinary[0]).reason).toMatch(/JobPosting \/ BroadcastEvent/);
  });

  it("only an explicit qualified content type is eligible — and even then no adapter is installed", async () => {
    const job = { url: "/jobs/1", google: { indexingApi: { eligible: true, contentType: "JobPosting" } } };
    expect(indexingApiEligibility(job)).toMatchObject({ eligible: true, contentType: "JobPosting" });
    await expect(submitViaIndexingApi(job)).rejects.toThrow(/no qualified-content Indexing API adapter/);
    for (const p of ordinary) await expect(submitViaIndexingApi(p)).rejects.toThrow(/refused/);
  });

  it("the module contains no Indexing API endpoint at all", () => {
    const code = readFileSync(join(__dirname, "seo-google.mjs"), "utf8");
    const noComments = code.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(noComments).not.toMatch(/indexing\.googleapis\.com|urlNotifications/);
  });

  it("the module never simulates the Request Indexing button", () => {
    const code = readFileSync(join(__dirname, "seo-google.mjs"), "utf8");
    const noComments = code.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(noComments).not.toMatch(/requestIndexing\(|request-indexing|inspect\/index:request|:publish/i);
  });

  it("never writes a project file", () => {
    const code = readFileSync(join(__dirname, "seo-google.mjs"), "utf8");
    expect(code).not.toMatch(/writeFile|appendFile|unlink|rmSync/);
  });
});
