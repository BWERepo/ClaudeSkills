// The canonical engine's own package tests: is this directory a clean, customer-neutral, verifiable engine?
// (The installer's behaviour is in tests/installer; the state machine, validator, checker and Google layer are
// tested by the co-located src/*.test.mjs files.) Fixtures are fictional and use reserved .test domains.

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const I = await import(pathToFileURL(join(ROOT, "installer", "bweseo-install.mjs")).href);
const core = await import(pathToFileURL(join(ROOT, "src", "seo-state-core.mjs")).href);
const validator = await import(pathToFileURL(join(ROOT, "src", "validate-seo-data.mjs")).href);
const manifest = JSON.parse(readFileSync(join(ROOT, "engine-manifest.json"), "utf8"));
const norm = (p) => p.split("\\").join("/");
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === ".git") continue;
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(norm(relative(ROOT, p)));
  }
  return out;
};

describe("canonical engine — manifest is an allowlist", () => {
  it("is valid: every file classified, every hash matches, nothing unlisted", () => {
    const v = I.validateManifest(ROOT, manifest);
    expect(v.errors).toEqual([]);
    expect(v.unclassified).toEqual([]);
    expect(manifest.files.length).toBeGreaterThan(50);
  });

  it("contains only allowlisted classes — no project-specific, generated, secret or never-copy material", () => {
    const classes = new Set(manifest.files.map((f) => f.class));
    for (const c of classes) expect(["ENGINE", "TEMPLATE", "OPTIONAL", "TEST", "DEV"]).toContain(c);
    for (const c of I.DENY_CLASSES) expect(classes.has(c)).toBe(false);
    for (const f of manifest.files) expect(I.matchesAny(f.path, I.NEVER_PATTERNS.filter((p) => !p.startsWith("seo/") && !p.startsWith("docs/seo/")))).toBe(false);
  });

  it("installs only into seo/tools, seo/schema and docs/seo — everything else stays in the engine", () => {
    for (const f of manifest.files.filter((x) => x.install)) expect(I.TARGET_ROOTS.some((r) => f.install.startsWith(r)), f.install).toBe(true);
    const installed = manifest.files.filter((x) => x.install).map((x) => x.path);
    expect(installed.every((p) => /^(src|schemas|templates)\//.test(p))).toBe(true);
    for (const f of manifest.files.filter((x) => /^(skills|installer|docs|adapters|scripts|config|tests)\//.test(x.path))) expect(f.install).toBeNull();
  });

  it("no customer-data or secret-shaped file exists anywhere in the package tree", () => {
    const stray = walk(ROOT).filter((f) => I.matchesAny(f, I.NEVER_PATTERNS) && !/^tests\//.test(f));
    expect(stray).toEqual([]);
  });

  it("detects tampering: a changed file breaks the manifest, and an added file is unclassified", () => {
    const dir = mkdtempSync(join(tmpdir(), "bweseo-canon-"));
    for (const f of walk(ROOT).filter((x) => !x.startsWith("docs/refactor/") && !x.startsWith("tests/"))) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), readFileSync(join(ROOT, f)));
    }
    const m = JSON.parse(readFileSync(join(dir, "engine-manifest.json"), "utf8"));
    m.files = m.files.filter((f) => !f.path.startsWith("docs/refactor/") && !f.path.startsWith("tests/"));
    expect(I.validateManifest(dir, m).errors).toEqual([]);
    writeFileSync(join(dir, "src", "seo-state.mjs"), "// tampered\n");
    expect(I.validateManifest(dir, m).errors.join("\n")).toMatch(/src\/seo-state\.mjs.*does not match its recorded hash/);
    writeFileSync(join(dir, "src", "extra.mjs"), "// unlisted\n");
    expect(I.validateManifest(dir, m).unclassified).toContain("src/extra.mjs");
  });
});

describe("canonical engine — identity and versions", () => {
  it("has its own date-based version (yyyy.mm.dd.nn), independent of any website, plus schema and manifest versions", () => {
    const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
    expect(version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/);
    expect(manifest.engineVersion).toBe(version);
    expect(validator.ENGINE_VERSION).toBe(version);
    expect(core.STATE_VERSION).toBe(version);
    expect(validator.SCHEMA_VERSION).toBe(1);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.manifestVersion).toBe(1);
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version).toBe(version);
  });
});

describe("canonical engine — skills have a canonical source", () => {
  const dirs = readdirSync(join(ROOT, "skills")).filter((n) => statSync(join(ROOT, "skills", n)).isDirectory()).sort();
  it("every required skill has skills/<name>/SKILL.md with matching frontmatter", () => {
    expect(dirs).toEqual([...manifest.requiredSkills].sort());
    for (const name of ["BWESEO", "BWESEOInstall", "BWESEOSetup", "BWESEOAudit", "BWESEOTechnical", "BWESEOSchema", "BWESEOLocal", "BWESEOOpportunities", "BWESEOCompetitors", "BWESEOContentPlan", "BWESEOCreatePage", "BWESEOInternalLinks", "BWESEOQA", "BWESEOSearchConsole", "BWESEORefresh", "BWESEOReport", "BWESEOPublish"])
      expect(dirs).toContain(name);
    for (const n of dirs) {
      const t = readFileSync(join(ROOT, "skills", n, "SKILL.md"), "utf8");
      const fm = /^---\nname:\s*(.+)\ndescription:\s*(.+)\n---/.exec(t);
      expect(fm, n).toBeTruthy();
      expect(fm[1].trim()).toBe(n);
    }
  });

  it("no skill hard-codes a machine path — they locate the engine through $BWESEO_ENGINE", () => {
    for (const n of dirs) {
      const t = readFileSync(join(ROOT, "skills", n, "SKILL.md"), "utf8");
      expect(t, n).not.toMatch(/\.claude\/skills\/BWESEO\/engine|[A-Za-z]:\\Users\\|\/Users\/[a-z]+\//);
      if (n !== "BWESEOInstall") expect(t, n).toContain("`$BWESEO_ENGINE` =");
    }
  });

  it("the engine's own maintenance skills are repository-local, portable and well-formed", () => {
    const dir = join(ROOT, ".claude", "skills");
    const names = readdirSync(dir).sort();
    expect(names).toEqual(["BWESEOAll", "BWESEOBegin", "BWESEOCheckpoint", "BWESEOEnd", "BWESEORelease"]);
    for (const n of names) {
      const t = readFileSync(join(dir, n, "SKILL.md"), "utf8");
      expect(t, n).toMatch(new RegExp(`^---\\nname: ${n}\\ndescription: `));
      expect(t, n).not.toMatch(/\r/); // LF
      expect(t, n).not.toMatch(/\b[A-Za-z]:[\\/]/); // no drive-letter path
    }
  });

  it("/BWESEO stays the state-aware front door: installation, setup, lifecycle, live health, Google and page targeting", () => {
    const t = readFileSync(join(ROOT, "skills", "BWESEO", "SKILL.md"), "utf8");
    for (const needle of ["/BWESEOInstall", "/BWESEOSetup", "LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT", "--page", "Google"]) expect(t, needle).toContain(needle);
  });
});

describe("canonical engine — preserved architecture rules", () => {
  const docs = ["docs/ENGINE.md", "docs/methodology/workflow-state.md", "docs/methodology/search-console.md"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");

  it("documents lifecycle vs live health, and the Google stages as separate facts", () => {
    expect(docs).toContain("LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT");
    expect(docs).toMatch(/PUBLISHED does not mean DISCOVERED/);
    expect(docs).toMatch(/CRAWLED does not mean INDEXED/);
    expect(docs).toMatch(/never use(d)? .*Indexing API|Indexing API.*never/is);
  });

  // a compact, fully fictional project to prove the rules hold in the packaged code
  const evidence = (page, live) => ({
    today: "2026-11-02",
    repo: { remote: "https://example.test/acme/site.git", folderName: "site" },
    config: {
      schemaVersion: 1, projectId: "acme-plumbing", website: "https://www.example-plumbing.test",
      repo: { gitRemote: "acme/site" }, engine: { version: manifest.engineVersion },
      environments: { production: { url: "https://www.example-plumbing.test", hosts: ["www.example-plumbing.test"] }, staging: { status: "not-configured" } },
      analytics: { searchConsole: { configured: "yes", verifiedProperty: "example-plumbing.test", verifiedOn: "2026-10-01", propertyType: "Domain", sitemap: { url: "https://www.example-plumbing.test/sitemap.xml", submitted: "yes", status: "Success", verifiedOn: "2026-10-01" } } },
    },
    profile: { identity: { businessName: { value: "Acme Plumbing" } }, lastReviewed: "2026-09-01", openQuestions: [] },
    inventory: { schemaVersion: 1, projectId: "acme-plumbing", pages: [{ id: "home", url: "/", type: "home", topic: "Home", status: "published", indexable: true }, page] },
    validation: { errors: [], warnings: [] },
    docs: { baseline: { exists: true, updated: "2026-09-01", hasContent: true }, roadmap: { exists: true, updated: "2026-09-01", hasContent: true } },
    searchConsoleExports: [],
    sources: {},
    ...(live ? { live } : {}),
  });
  const published = (extra = {}) => ({
    id: "drains", url: "/drain-cleaning", name: "Drain Cleaning", type: "service", topic: "Drains", status: "published", priority: "P1", indexable: true,
    approvedOn: "2026-10-01", approvedBy: "user", publishedOn: "2026-10-30", qa: { result: "pass", date: "2026-10-05" },
    postPublication: {
      checkedOn: "2026-10-30", result: "ready",
      google: { readiness: { status: "PASSED", checkedAt: "2026-10-30", source: "post-publication check" }, sitemap: { included: "yes", verifiedAt: "2026-10-30", source: "post-publication check" } },
      searchConsole: { indexingRequest: "REQUESTED", requestedOn: "2026-10-30", requestSource: "owner:2026-10-30 chat", liveUrlTest: { result: "passed", testedOn: "2026-10-30" }, indexed: { status: "NOT VERIFIED" } },
      monitoring: { review7: "2026-11-06", review30: "2026-11-29", review90: "2027-01-28" }, ...extra,
    },
  });
  const row = (state, key) => state.pages.find((p) => p.id === "drains").rows.find((r) => r.key === key);

  it("a temporary 522 / 503 / timeout / DNS / connection failure never reverses a completed Production milestone", async () => {
    const baseline = core.evaluateState(evidence(published()), { today: "2026-11-02" });
    for (const failure of [new Response("boom", { status: 522 }), new Response("x", { status: 503 }), new Error("The operation was aborted due to timeout"), new Error("getaddrinfo ENOTFOUND www.example-plumbing.test"), new Error("connect ECONNREFUSED 203.0.113.9:443")]) {
      const ev = evidence(published());
      ev.live = await core.probeLive(ev.config, ev.inventory, { retryDelayMs: 0, fetchImpl: async () => { if (failure instanceof Error) throw failure; return failure.clone(); } });
      const state = core.evaluateState(ev, { today: "2026-11-02" });
      expect(state.liveHealth.production.status).toBe("CHECK_FAILED");
      for (const k of ["deployment", "postPublication", "googleReadiness", "sitemapIncluded", "scSetup", "sitemap", "indexingRequest"]) expect(row(state, k).status, k).toBe(core.S.COMPLETE);
      expect(row(baseline, "deployment").status).toBe(core.S.COMPLETE);
      expect(state.conflicts).toEqual([]);
      expect(state.actions.some((a) => a.skill === "BWESEOPublish")).toBe(false);
      expect(state.recommendation.kind).toBe("investigate-health");
    }
  });

  it("Google stages never imply each other: submitted / registered / requested / test-passed / discovered / crawled ≠ indexed", () => {
    const state = core.evaluateState(evidence(published({ google: { readiness: { status: "PASSED", checkedAt: "2026-10-30", source: "check" }, sitemap: { included: "yes", verifiedAt: "2026-10-30", source: "check" }, discovered: { status: "DISCOVERED", at: "2026-11-01", source: "search-console-api:url-inspection" }, crawled: { status: "CRAWLED", at: "2026-11-01", source: "search-console-api:url-inspection" } } })), { today: "2026-11-02" });
    for (const k of ["sitemap", "liveUrlTest", "indexingRequest", "googleDiscovered", "googleCrawled"]) expect(row(state, k).status, k).toBe(core.S.COMPLETE);
    expect(row(state, "indexed").status).not.toBe(core.S.COMPLETE);
    expect(row(state, "monitoring").status).not.toBe(core.S.COMPLETE);
  });

  it("/BWESEO detects installation and setup state, and a page argument focuses one page", () => {
    expect(core.evaluateState({ today: "2026-11-02", config: null }).recommendation).toMatchObject({ kind: "install", command: "/BWESEOInstall" });
    expect(core.evaluateState({ today: "2026-11-02", config: null, install: { receipt: { engineVersion: manifest.engineVersion, schemaVersion: 1 } } }).recommendation).toMatchObject({ kind: "setup", command: "/BWESEOSetup" });
    const state = core.evaluateState(evidence(published()), { today: "2026-11-02" });
    for (const ref of ["drains", "/drain-cleaning", "https://www.example-plumbing.test/drain-cleaning"]) expect(core.assessPage(state, ref)).toMatchObject({ ok: true, page: { id: "drains" } });
    expect(core.assessPage(state, "https://other.test/drain-cleaning").ok).toBe(false);
    expect(core.assessPage(state, "/nope").ok).toBe(false);
    expect(core.assessPage(state, "/drain-cleaning").text).toMatch(/PAGE ASSESSMENT — Drain Cleaning/);
  });

  it("the core runs without a framework adapter: nothing in it names a stack, host or business", () => {
    const code = readFileSync(join(ROOT, "src", "seo-state-core.mjs"), "utf8");
    expect(code).not.toMatch(/^\s*import\s/m); // runs in a Worker or a browser
    expect(code.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")).not.toMatch(/cloudflare|wrangler|next\.js|(?<![|.])astro|wordpress/i); // `astro` inside the generic source-file-extension list is not a stack name
  });
});

describe("canonical engine — no secrets, no customer data", () => {
  it("passes the secret scan (no registry needed)", () => {
    const scan = I.scanPayload(ROOT, manifest, { projects: {} });
    expect(scan.secrets).toEqual([]);
  });

  it("passes the project-data scan against every project identity registered on this machine (when there are any)", () => {
    const reg = I.loadRegistry(I.defaultRegistryPath());
    const scan = I.scanPayload(ROOT, manifest, reg);
    expect(scan.leaks).toEqual([]);
  });

  it("catches a planted identity: the scan is data-driven, so it protects whichever customers exist", () => {
    const reg = { projects: { "jones-dental": { fingerprints: [{ kind: "domain", value: "jones-dental.test" }, { kind: "business-name", value: "Jones Dental" }] } } };
    const dir = mkdtempSync(join(tmpdir(), "bweseo-plant-"));
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "note.md"), "Copied from Jones Dental at jones-dental.test\n");
    const m = { files: [{ path: "docs/note.md" }] };
    const scan = I.scanPayload(dir, m, reg);
    expect(scan.leaks.map((l) => l.type).sort()).toEqual(["business-name", "domain"]);
    expect(JSON.stringify(scan)).not.toContain("jones-dental.test");
  });

  it("ships fictional fixtures only: reserved test domains, no real-looking customer", () => {
    const text = manifest.files.filter((f) => /^(tests|src)\//.test(f.path) && /\.test\.mjs$/.test(f.path)).map((f) => readFileSync(join(ROOT, f.path), "utf8")).join("\n");
    const hosts = new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()));
    const allowedSuffix = /(\.test|\.example|\.invalid|\.localhost)$|^(example\.(com|org|net)|[a-z0-9.-]+\.example\.(com|org|net)|schema\.org|www\.w3\.org|www\.sitemaps\.org|github\.com|.*\.googleapis\.com|oauth2\.googleapis\.com|search\.google\.com|.*\.google\.com|.*\.dev|.*\.gserviceaccount\.com)$/;
    expect([...hosts].filter((h) => !allowedSuffix.test(h))).toEqual([]);
  });
});

describe("portable — the repository requires no particular machine or location", () => {
  const files = walk(ROOT).filter((f) => /^(README\.md|PROJECT_STATUS\.md|BWESEO-SKILLS-AND-PROCEDURES\.md|docs\/.+\.md|skills\/.+\.md|\.claude\/.+\.md|adapters\/.+\.md)$/.test(f));
  it("committed documentation and skills contain no drive-letter or user-profile paths", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/\b[A-Za-z]:\\(?!n|t|r)|\b[A-Za-z]:\/(?:Users|Backup|Program)|\/Users\/[A-Za-z]|\\Users\\/);
  });
  it("BWESEO_ENGINE_HOME is the documented way to locate the engine, in the README, the manual and the cloud setup guide", () => {
    for (const f of ["README.md", "BWESEO-SKILLS-AND-PROCEDURES.md", "docs/CLOUD-SETUP.md"]) expect(readFileSync(join(ROOT, f), "utf8"), f).toContain("BWESEO_ENGINE_HOME");
    const guide = readFileSync(join(ROOT, "docs", "CLOUD-SETUP.md"), "utf8");
    for (const needle of ["npm ci", "--sync-skills", "BWESEO_SKILLS_DIR", ".claude/skills"]) expect(guide, needle).toContain(needle);
  });
  it("the engine runs from any directory: it is located through BWESEO_ENGINE_HOME, whatever the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "bweseo-anywhere-"));
    mkdirSync(join(dir, "deep", "any place"), { recursive: true });
    writeFileSync(join(dir, "deep", "any place", "engine-manifest.json"), "{}");
    const found = I.locateEngine({ env: { BWESEO_ENGINE_HOME: join(dir, "deep", "any place") }, home: join(dir, "no-home") });
    expect(found).toMatchObject({ source: "BWESEO_ENGINE_HOME" });
    expect(norm(found.dir)).toContain("deep/any place");
  });
  it("no committed source file hard-codes a machine path", () => {
    const src = walk(ROOT).filter((f) => /^(src|installer|scripts|schemas|templates|config|adapters)\/.+\.(mjs|mts|json|md)$/.test(f));
    for (const f of src) expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/\b[A-Za-z]:\\(?:Users|Backup|Program|Windows)|[A-Za-z]:\/(?:Users|Backup)|\/home\/[a-z]+\//i);
  });
});
