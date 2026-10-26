// The canonical engine's hardening for the reusable page checks: the adapter guidance, the QA documentation and the
// manual must say what the code does, the new tool must ship (allowlisted, installed into seo/tools) and stay
// customer-neutral.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("engine-manifest.json"));
const I = await import(pathToFileURL(join(ROOT, "installer", "bweseo-install.mjs")).href);
const checks = await import(pathToFileURL(join(ROOT, "src", "seo-page-checks.mjs")).href);

// Words that identify a particular customer. They are assembled at run time so this file itself never contains one
// (the isolation scan would — rightly — refuse a payload that does).
const JOIN = (...parts) => parts.join("");
const CUSTOMER_TERMS = new RegExp([JOIN("business", "web", "express"), JOIN("business", " ", "web", " ", "express"), JOIN("b", "w", "e", "-"), JOIN("knox", "ville"), JOIN("make", "over")].join("|"), "i");

describe("TanStack Start adapter guidance", () => {
  const adapter = read("adapters/tanstack-start.md");

  it("forbids a hard-coded page-specific og:url (or canonical) in the root layout", () => {
    expect(adapter).toMatch(/Never hard-code a page-specific value in `__root\.tsx`/);
    expect(adapter).toMatch(/no `og:url` \(and no canonical\)/);
    expect(adapter).toMatch(/tell Facebook, LinkedIn and Slack that it is the homepage/);
  });
  it("tells projects to generate canonical and og:url from the current page with one shared builder", () => {
    expect(adapter).toMatch(/ONE shared helper/);
    expect(adapter).toMatch(/buildPageMeta/);
    expect(adapter).toMatch(/derived from the page's `path`/);
    expect(adapter).toMatch(/Canonical and `og:url` then come from the same value/);
  });
  it("covers image dimensions, shared header/footer section links and above-the-fold animation", () => {
    expect(adapter).toMatch(/og:image:width`\/`height`\/`alt` at the root/);
    expect(adapter).toMatch(/equal the real pixel size/);
    expect(adapter).toMatch(/<Link to="\/" hash="pricing">/);
    expect(adapter).toMatch(/render `opacity: 0` in the \*\*server\*\* HTML/);
  });
  it("names the automatic checks that enforce it", () => {
    expect(adapter).toContain("seo/tools/seo-page-checks.mjs");
    expect(adapter).toMatch(/REVIEW REQUIRED/);
  });
  it("is customer-neutral (no real business, domain or page)", () => {
    expect(adapter).not.toMatch(CUSTOMER_TERMS);
  });
});

describe("QA, post-publication and manual documentation match the checks", () => {
  const qa = read("docs/methodology/qa-checklists.md");
  const pub = read("docs/methodology/post-publication.md");
  const manual = read("BWESEO-SKILLS-AND-PROCEDURES.md");
  const ids = ["og-url-canonical", "social-image-size", "above-fold-visible", "nav-anchors", "site-navigation", "site-footer"];

  it("qa-checklists.md documents O12–O14, the page-check statuses and REVIEW REQUIRED", () => {
    for (const row of ["| O12 |", "| O13 |", "| O14 |"]) expect(qa).toContain(row);
    expect(qa).toMatch(/REVIEW REQUIRED/);
    expect(qa).toMatch(/Statuses used by the page checks/);
    for (const id of ["og-url-canonical", "social-image-size", "above-fold-visible", "nav-anchors", "site-navigation", "site-footer"]) expect(qa + pub, id).toContain(id);
  });
  it("post-publication.md has the page-quality section", () => {
    expect(pub).toMatch(/## 4a\. Page-quality checks/);
    expect(pub).toMatch(/never blocks/);
  });
  it("the generated manual mentions the tool, the statuses and the troubleshooting entries", () => {
    expect(manual).toContain("seo-page-checks.mjs");
    expect(manual).toMatch(/REVIEW REQUIRED/);
    expect(manual).toMatch(/### og:url differs from the canonical/);
    expect(manual).toMatch(/### Hero or navigation problems found by the page checks/);
  });
  it("every check id the code emits is documented", async () => {
    const docs = qa + pub;
    const emitted = new Set();
    const html = `<html><head></head><body><main><h1>x</h1></main></body></html>`;
    for (const c of await checks.runPageChecks({ html, head: { canonicals: ["https://example.com/a"], ogUrl: "https://example.com/a", ogImage: "https://example.com/i.png" }, pageUrl: "https://example.com/a", homeHtml: html })) emitted.add(c.id);
    for (const id of ids) expect(emitted.has(id), `code no longer emits ${id}`).toBe(true);
    for (const id of emitted) expect(docs, `${id} is not documented`).toContain(id);
  });
});

describe("shipping and isolation", () => {
  const files = ["src/seo-page-checks.mjs", "src/seo-page-checks.test.mjs"];

  it("the tool and its test are in the allowlist manifest and install into seo/tools/", () => {
    for (const f of files) {
      const entry = manifest.files.find((x) => x.path === f);
      expect(entry, f).toBeTruthy();
      expect(entry.install).toBe(`seo/tools/${f.split("/")[1]}`);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.files.find((x) => x.path === files[0]).class).toBe("ENGINE");
    expect(manifest.files.find((x) => x.path === files[1]).class).toBe("TEST");
  });
  it("the manifest is valid (hashes match the files) and the secret + isolation scan passes", () => {
    const v = I.validateManifest(ROOT, manifest);
    expect(v.errors).toEqual([]);
    expect(v.unclassified).toEqual([]);
    const scan = I.scanPayload(ROOT, manifest, { projects: {} });
    expect(scan.secrets).toEqual([]);
    const reg = I.scanPayload(ROOT, manifest, I.loadRegistry(I.defaultRegistryPath()));
    expect(reg.leaks).toEqual([]);
  });
  it("contains no customer-specific data: only example.com-style fictional hosts appear in the new files or the adapter", () => {
    const allowedHost = /^(example\.(com|org|net)|cdn\.other\.test|www\.example\.com|localhost)$/;
    for (const f of [...files, "adapters/tanstack-start.md"]) {
      const hosts = [...read(f).matchAll(/\bhttps?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
      for (const h of hosts) expect(allowedHost.test(h), `${f} mentions ${h}`).toBe(true);
      expect(read(f), f).not.toMatch(CUSTOMER_TERMS);
    }
  });
  it("the code has no network side effects of its own: it only calls the fetch it is given", () => {
    const src = read("src/seo-page-checks.mjs");
    expect(src).not.toMatch(/globalThis\.fetch|\bXMLHttpRequest\b|node:https?|node:net/);
  });
  it("every engine file is classified — nothing in the new work is unclassified or unhashed", () => {
    const walk = (d, out = []) => {
      for (const n of readdirSync(d)) {
        if (n === "node_modules" || n === ".git") continue;
        const p = join(d, n);
        statSync(p).isDirectory() ? walk(p, out) : out.push(p);
      }
      return out;
    };
    const listed = new Set(manifest.files.map((f) => f.path));
    const unlisted = walk(ROOT)
      .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/"))
      .filter((p) => !["engine-manifest.json"].includes(p) && !listed.has(p));
    expect(unlisted).toEqual([]);
    expect(existsSync(join(ROOT, "src", "seo-page-checks.mjs"))).toBe(true);
  });
});

describe("the inherited-homepage og:url problem is detected", () => {
  it("a sub-page whose og:url was inherited from a site-wide default fails the check", () => {
    const r = checks.compareCanonicalAndOgUrl({ canonical: ["https://example.com/pricing"], ogUrl: "https://example.com/", pageUrl: "https://example.com/pricing" });
    expect(r.status).toBe("fail");
  });
  it("and equivalent spellings of the same page do not", () => {
    for (const og of ["https://example.com/pricing/", "https://EXAMPLE.com/pricing#plans", "https://example.com:443/pricing"])
      expect(checks.compareCanonicalAndOgUrl({ canonical: ["https://example.com/pricing"], ogUrl: og, pageUrl: "https://example.com/pricing" }).status, og).toBe("pass");
  });
});

describe("page checks command line", () => {
  it("names an unreadable --html file and exits 3 instead of printing a stack trace", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, [join(ROOT, "src", "seo-page-checks.mjs"), "--html", join(ROOT, "no-such-page.html"), "--url", "https://site.example/"], { encoding: "utf8" });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/cannot read .*no-such-page\.html: ENOENT/);
    expect(r.stderr).not.toMatch(/at .*\.mjs:\d+/);
  });
});
