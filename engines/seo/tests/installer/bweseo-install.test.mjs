// Tests for /BWESEOInstall — the installer that puts the reusable BWESEO ENGINE into a customer project.
//
// These tests live INSIDE the canonical engine and exercise its installer in place. Almost everything runs
// against a SYNTHETIC engine built in a temp directory and fictional customers (Acme Plumbing, Jones Dental),
// so the tests control exactly what the payload contains. Nothing here touches the network, git history or
// any real project.

import { afterAll, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENGINE_HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLER = join(ENGINE_HOME, "installer", "bweseo-install.mjs");
const available = existsSync(INSTALLER) && existsSync(join(ENGINE_HOME, "engine-manifest.json"));
const I = available ? await import(pathToFileURL(INSTALLER).href) : null;

// Temp projects live under the OS temp dir, which may itself sit inside some larger repository on a
// developer machine: stop git's upward search there so a "project with no git" really has none.
process.env.GIT_CEILING_DIRECTORIES = tmpdir();

const tmp = [];
const mk = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), `bweseo-${prefix}-`));
  tmp.push(d);
  return d;
};
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

const write = (base, rel, text) => {
  mkdirSync(join(base, rel, ".."), { recursive: true });
  writeFileSync(join(base, rel), text);
};
const read = (base, rel) => readFileSync(join(base, rel), "utf8");
const listAll = (dir, base = dir, out = {}) => {
  for (const n of readdirSync(dir)) {
    if (n === ".git") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) listAll(p, base, out);
    else out[p.slice(base.length + 1).replace(/\\/g, "/")] = readFileSync(p, "utf8");
  }
  return out;
};
const snapshot = (dir) => JSON.stringify(listAll(dir));
const changedFiles = (a, b) => {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).sort();
};
const run = (cmd, cwd) => execFileSync("git", cmd, { cwd, stdio: "ignore" });

// ---------------------------------------------------------------- a synthetic engine
function makeEngine({ version = "1.0.0", schema = 1, tools = {}, extra = {}, skipManifest = false, skills = true } = {}) {
  const e = mk("engine");
  write(e, "src/validate-seo-data.mjs", `export const ENGINE_VERSION = "${version}";\nexport const SCHEMA_VERSION = ${schema};\n`);
  write(e, "src/seo-state-core.mjs", `// state core v${version}\nexport const CORE = "${version}";\n`);
  write(e, "src/seo-state.mjs", "// state\n");
  write(e, "config/isolation-allowlist.json", JSON.stringify({ allowedTerms: ["Example Agency"] }));
  write(e, "installer/bweseo-install.mjs", "// the installer itself is canonical-only\n");
  write(e, "schemas/seo-config.schema.json", '{ "type": "object" }\n');
  write(e, "src/generic.test.mjs", "// a generic engine test\n");
  write(e, "templates/docs/README.md", "# SEO docs\n\nGeneric documentation shell.\n");
  write(e, "templates/seo-config.template.json", '{ "schemaVersion": 1 }\n');
  write(e, "docs/methodology/workflow.md", "# Workflow\nGeneric methodology.\n");
  write(e, "adapters/astro.md", "# Astro adapter\n");
  write(e, "adapters/static-html.md", "# Static HTML adapter\n");
  write(e, "README.md", `# BWESEO engine v${version}\n`);
  if (skills) {
    write(e, "skills/BWESEOFoo/SKILL.md", "---\nname: BWESEOFoo\ndescription: a skill\n---\n# Foo\n");
    write(e, "skills/BWESEOBar/SKILL.md", "---\nname: BWESEOBar\ndescription: another skill\n---\n# Bar\n");
  }
  for (const [p, t] of Object.entries(tools)) write(e, p, t);
  for (const [p, t] of Object.entries(extra)) write(e, p, t);
  if (!skipManifest) {
    const { manifest, problems } = I.buildManifest(e);
    expect(problems).toEqual([]);
    writeFileSync(join(e, "engine-manifest.json"), JSON.stringify(manifest, null, 2));
  }
  return e;
}
const rebuild = (e) => writeFileSync(join(e, "engine-manifest.json"), JSON.stringify(I.buildManifest(e).manifest, null, 2));

// ---------------------------------------------------------------- fictional customers
const ACME = { id: "acme-plumbing", name: "Acme Plumbing", domain: "acme-plumbing.example", email: "office@acme-plumbing.example", phone: "865-555-0101", gtm: "GTM-ACME123" };
const JONES = { id: "jones-dental", name: "Jones Dental", domain: "jones-dental.example", email: "hello@jones-dental.example", phone: "423-555-0202", gtm: "GTM-JONES99" };

function seedCustomerData(dir, c) {
  write(dir, "seo/seo-config.json", JSON.stringify({
    schemaVersion: 1,
    projectId: c.id,
    website: `https://${c.domain}`,
    environments: { production: { url: `https://${c.domain}`, hosts: [c.domain] }, staging: { status: "configured", url: `https://staging.${c.domain}`, hosts: [`staging.${c.domain}`] } },
    analytics: { tagManager: c.gtm, searchConsole: { configured: "yes", verifiedProperty: c.domain, verifiedOn: "2026-10-01", propertyType: "Domain", sitemap: { url: `https://${c.domain}/sitemap.xml`, submitted: "yes", status: "Success", verifiedOn: "2026-10-01" } } },
  }, null, 2));
  write(dir, "seo/business-profile.json", JSON.stringify({ identity: { businessName: { value: c.name }, website: { value: `https://${c.domain}` } }, contact: { email: { value: c.email }, phone: { value: c.phone } }, competitors: [`${c.name} Rival`], keywords: [`${c.name.toLowerCase()} near me`] }, null, 2));
  write(dir, "seo/content-inventory.json", JSON.stringify({ schemaVersion: 1, projectId: c.id, pages: [{ id: "home", url: "/", status: "published", publishedOn: "2026-09-30", postPublication: { checkedOn: "2026-09-30", result: "ready", searchConsole: { indexingRequest: "REQUESTED", requestedOn: "2026-09-30" }, google: { discovered: { status: "DISCOVERED", at: "2026-10-02", source: "search-console-api:url-inspection" } } } }] }, null, 2));
  write(dir, "seo/data/live-health.json", JSON.stringify({ production: { consecutiveFailures: 2, lastSuccess: { checkedAt: "2026-10-01T00:00:00Z", httpStatus: 200 } } }));
  write(dir, "seo/data/search-console/2026-10-05/queries.csv", `query,clicks\n${c.name.toLowerCase()} near me,4\n`);
  write(dir, "docs/seo/reports/publish-home-2026-09-30.md", `# Report for ${c.name}\n`);
  write(dir, "docs/seo/SEO-STRATEGY.md", `# Strategy for ${c.name} (${c.domain})\n`);
}
const CUSTOMER_FILES = ["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json", "seo/data/live-health.json", "seo/data/search-console/2026-10-05/queries.csv", "docs/seo/reports/publish-home-2026-09-30.md", "docs/seo/SEO-STRATEGY.md"];
const customerState = (dir) => Object.fromEntries(CUSTOMER_FILES.map((f) => [f, read(dir, f)]));

function makeProject(prefix = "site", { framework = "astro", git = true, files = {} } = {}) {
  const d = mk(prefix);
  write(d, "package.json", JSON.stringify({ name: prefix, dependencies: framework === "astro" ? { astro: "^4" } : framework === "next" ? { next: "^14" } : {} }));
  for (const [p, t] of Object.entries(files)) write(d, p, t);
  if (git) {
    run(["init", "-q"], d);
    run(["add", "-A"], d);
    run(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"], d);
  }
  return d;
}

const plan = (engine, project, over = {}) =>
  I.planInstall({ engineDir: engine, projectDir: project, registryPath: join(mk("reg"), "registry.json"), ...over });
const install = async (engine, project, over = {}) => {
  const p = plan(engine, project, over);
  expect(p.failures, JSON.stringify(p.failures)).toEqual([]);
  const res = await I.applyPlan(p, { engineDir: engine, projectDir: project, migrations: over.migrations ?? [] });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return { p, res };
};

describe.skipIf(!available)("/BWESEOInstall — installer", () => {
  // ------------------------------------------------------------ 1–4: clean install
  describe("clean install", () => {
    it("installs the reusable engine only, from an explicit allowlist", async () => {
      const engine = makeEngine();
      const project = makeProject();
      const { p } = await install(engine, project);
      expect(p.engine).toMatchObject({ version: "1.0.0", schemaVersion: 1, manifestVersion: 1 });
      for (const f of ["seo/tools/seo-state-core.mjs", "seo/tools/seo-state.mjs", "seo/tools/validate-seo-data.mjs", "seo/schema/seo-config.schema.json", "seo/tools/generic.test.mjs", "docs/seo/README.md"])
        expect(existsSync(join(project, f)), f).toBe(true);
      expect(read(project, "seo/tools/seo-state-core.mjs")).toBe(read(engine, "src/seo-state-core.mjs"));
      // canonical-only files are never copied: the installer itself, methodology, adapters, templates, allowlist
      for (const f of ["seo/tools/bweseo-install.mjs", "seo/tools/isolation-allowlist.json", "seo/methodology", "seo/seo-config.template.json"])
        expect(existsSync(join(project, f)), f).toBe(false);
    });

    it("project data starts blank — the installer creates no profile, config, inventory or data", async () => {
      const project = makeProject();
      await install(makeEngine(), project);
      for (const f of ["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json"]) expect(existsSync(join(project, f)), f).toBe(false);
      expect(readdirSync(join(project, "seo/data"))).toEqual([]);
      expect(readdirSync(join(project, "docs/seo"))).toEqual(["README.md"]); // a generic shell, no reports
    });

    it("writes a receipt with metadata and file hashes only — no secrets, no customer data", async () => {
      const project = makeProject();
      await install(makeEngine(), project);
      const r = JSON.parse(read(project, "seo/bweseo-install.json"));
      expect(Object.keys(r).sort()).toEqual(["adapter", "engineId", "engineVersion", "files", "installationMode", "installedAt", "manifestVersion", "schemaVersion", "updatedAt"]);
      expect(r).toMatchObject({ engineVersion: "1.0.0", schemaVersion: 1, manifestVersion: 1, installationMode: "install", adapter: "astro" });
      for (const meta of Object.values(r.files)) expect(Object.keys(meta).sort()).toEqual(["class", "sha256"]);
      expect(I.scanTextForSecrets(JSON.stringify(r), "seo/bweseo-install.json")).toEqual([]);
    });

    it("adds .gitignore rules for runtime/private data and never removes existing rules", async () => {
      const project = makeProject("site", { files: { ".gitignore": "node_modules\n.env\n" } });
      const { p } = await install(makeEngine(), project);
      expect(p.gitignore.add).toEqual(["seo/data/", "seo/sources/", "seo/.bweseo-backup/"]);
      const gi = read(project, ".gitignore");
      expect(gi).toContain("node_modules\n.env\n");
      expect(gi).toContain("seo/data/");
      // idempotent: a second install adds nothing
      expect(plan(makeEngine(), project).gitignore.add).toEqual([]);
    });
  });

  // ------------------------------------------------------------ 27: the manifest is an allowlist
  describe("manifest — default DENY", () => {
    it("rejects any unclassified file in the engine", () => {
      const engine = makeEngine();
      write(engine, "src/extra-notes.txt", "not classified");
      const v = I.validateManifest(engine, JSON.parse(read(engine, "engine-manifest.json")));
      expect(v.unclassified).toEqual(["src/extra-notes.txt"]);
      expect(v.errors.join("\n")).toMatch(/unclassified file: src\/extra-notes\.txt.*default is DENY/);
      const p = plan(engine, makeProject());
      expect(p.failures[0]).toMatchObject({ gate: "manifest" });
      expect(p.create).toEqual([]);
    });

    it("the manifest builder refuses files it has no rule for (nothing is guessed)", () => {
      const engine = makeEngine({ skipManifest: true, extra: { "mystery/data.bin": "x" } });
      const { problems } = I.buildManifest(engine);
      expect(problems.join("\n")).toMatch(/no classification rule for mystery\/data\.bin/);
    });

    it("rejects tampering (hash mismatch), traversal, deny classes and never-copy paths", () => {
      const engine = makeEngine();
      write(engine, "src/seo-state.mjs", "// tampered after the manifest was built\n");
      expect(I.validateManifest(engine, JSON.parse(read(engine, "engine-manifest.json"))).errors.join("\n")).toMatch(/does not match its recorded hash/);
      const m = JSON.parse(read(makeEngine(), "engine-manifest.json"));
      const engine2 = makeEngine();
      const bad = { ...m, files: [...m.files, { path: "../outside.txt", class: "ENGINE", install: null, sha256: "0".repeat(64) }, { path: "src/x.mjs", class: "SECRET", install: null, sha256: "0".repeat(64) }, { path: "seo/business-profile.json", class: "ENGINE", install: "seo/business-profile.json", sha256: "0".repeat(64) }, { path: "src/y.mjs", class: "ENGINE", install: "src/pages/y.mjs", sha256: "0".repeat(64) }] };
      const errs = I.validateManifest(engine2, bad).errors.join("\n");
      expect(errs).toMatch(/escapes the engine directory/);
      expect(errs).toMatch(/class SECRET can never be part of the payload/);
      expect(errs).toMatch(/never-copy pattern/);
      expect(errs).toMatch(/install target src\/pages\/y\.mjs is outside/);
    });

    it("refuses an engine with no manifest — the canonical source cannot be verified", () => {
      const engine = makeEngine({ skipManifest: true });
      const p = plan(engine, makeProject());
      expect(p.failures[0]).toMatchObject({ gate: "engine" });
      expect(p.failures[0].action).toMatch(/BWESEO_ENGINE_HOME/);
    });
  });

  // ------------------------------------------------------------ 6–7: secret scanning
  describe("secret scan — aborts, and never prints the value", () => {
    const PK = ["-----BEGIN ", "PRIVATE", " KEY-----"].join("");
    const cases = [
      ["a private key", { "src/seo-state.mjs": `// ${PK}\n// MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n` }, "private key"],
      ["a Google verification token", { "templates/docs/README.md": `google-site-verification=${"AbCdEfGhIj".repeat(3)}\n` }, "Google verification token"],
      ["an HTML verification meta tag", { "docs/methodology/workflow.md": `<meta name="google-site-verification" content="${"Zz9Yy8Xx7W".repeat(3)}">` }, "Google verification token"],
      ["a Bing verification token", { "docs/methodology/workflow.md": ["msvalid", 'ate.01" content="', "89E7999F", "480779AA72FE", '"'].join("") }, "Bing verification token"],
      ["an OAuth refresh token field", { "templates/seo-config.template.json": `{ "${["refresh", "_token"].join("")}": "${["1//0gAbCd", "EfGhIjKlMn"].join("")}" }` }, "credential field"],
      ["an access token", { "src/seo-state-core.mjs": `const t = "${["ya", "29."].join("")}${"a0AfH6SMB".repeat(3)}";\n` }, "Google access token"],
      ["an authorization header", { "docs/methodology/workflow.md": ["Author", "ization: Bea", "rer abcdef0123456789abcdef"].join("") }, "authorization header"],
      ["an environment value", { "docs/methodology/workflow.md": ["CLOUDFLARE_API_", "TOKEN=abcd1234", "efgh5678"].join("") }, "environment-variable value"],
      ["an API key", { "templates/seo-config.template.json": `{ "key": "${["AI", "za"].join("")}${"SyA".repeat(12)}" }` }, "Google API key"],
    ];
    for (const [name, files, type] of cases) {
      it(`aborts when the payload contains ${name}`, () => {
        const engine = makeEngine({ skipManifest: true });
        for (const [p, t] of Object.entries(files)) write(engine, p, t);
        rebuild(engine);
        const project = makeProject();
        const before = snapshot(project);
        const p = plan(engine, project);
        const f = p.failures.find((x) => x.gate === "secrets");
        expect(f, JSON.stringify(p.failures)).toBeTruthy();
        expect(f.reason).toMatch(/installation stopped because the reusable engine payload contains possible secret material/);
        expect(f.reason).toContain(type);
        expect(f.reason).toContain(Object.keys(files)[0]); // names the FILE and the TYPE …
        for (const v of Object.values(files)) for (const bit of v.split(/[\s"=]+/).filter((x) => x.length > 14)) expect(f.reason).not.toContain(bit); // … never the value
        expect(p.create).toEqual([]);
        expect(snapshot(project)).toBe(before);
      });
    }

    it("refuses to apply a plan that has safety failures", async () => {
      const engine = makeEngine({ skipManifest: true });
      write(engine, "docs/methodology/workflow.md", `${["-----BEGIN ", "PRIVATE", " KEY-----"].join("")}\nabc\n`);
      rebuild(engine);
      const p = plan(engine, makeProject());
      await expect(I.applyPlan(p, { engineDir: engine, projectDir: p.target.dir })).rejects.toThrow(/safety failures/);
    });

    it("does not flag ordinary generic code or documentation", () => {
      expect(I.scanTextForSecrets("const token = await getToken(scope); // the access token is short lived", "x.mjs")).toEqual([]);
      expect(I.scanTextForSecrets("credentialsSource: env:BWESEO_GSC_SERVICE_ACCOUNT_JSON", "x.md")).toEqual([]);
      expect(I.scanTextForSecrets('"private_key":"[redacted]"', "x.json")).toEqual([]);
    });
  });

  // ------------------------------------------------------------ 4, 5, 28: no project-specific data
  describe("project-identity leakage scan — data-driven, never hard-coded", () => {
    it("aborts when the payload carries any registered project's identity, and names the type only", () => {
      const reg = join(mk("reg"), "registry.json");
      const a = makeProject("acme", { git: false });
      seedCustomerData(a, ACME);
      expect(I.registerProject(a, reg).ok).toBe(true);
      const engine = makeEngine({ skipManifest: true, extra: { "docs/methodology/example.md": `Example: see https://${ACME.domain}/services and call ${ACME.phone}.\n` } });
      rebuild(engine);
      const p = I.planInstall({ engineDir: engine, projectDir: makeProject("b"), registryPath: reg });
      const f = p.failures.find((x) => x.gate === "project-data");
      expect(f.reason).toMatch(/possible project-specific information/);
      expect(f.reason).toContain("docs/methodology/example.md");
      expect(f.reason).toMatch(/domain of a registered project/);
      expect(f.reason).toMatch(/phone of a registered project/);
      expect(f.reason).not.toContain(ACME.domain);
      expect(f.reason).not.toContain(ACME.phone);
      expect(p.create).toEqual([]);
    });

    it("checks names, emails, analytics ids and the Search Console property too", () => {
      const reg = join(mk("reg"), "registry.json");
      const a = makeProject("acme", { git: false });
      seedCustomerData(a, ACME);
      I.registerProject(a, reg);
      for (const [needle, type] of [[ACME.name, "business-name"], [ACME.email, "email"], [ACME.gtm, "analytics-id"], [`sc-domain:${ACME.domain}`, "search-console-property"], [ACME.id, "project-id"]]) {
        const engine = makeEngine({ skipManifest: true, extra: { "docs/methodology/x.md": `Leaked: ${needle}\n` } });
        rebuild(engine);
        const f = I.planInstall({ engineDir: engine, projectDir: makeProject("b"), registryPath: reg }).failures.find((x) => x.gate === "project-data");
        expect(f, needle).toBeTruthy();
        expect(f.reason).not.toContain(needle);
        void type;
      }
    });

    it("allows the agency's own name (isolation-allowlist) and generic references", () => {
      const reg = join(mk("reg"), "registry.json");
      const agency = makeProject("agency", { git: false });
      seedCustomerData(agency, { ...ACME, name: "Example Agency", domain: "exampleagency.test", id: "example-agency", email: "hi@exampleagency.test", phone: "865-555-0999", gtm: "GTM-AGENCY1" });
      I.registerProject(agency, reg);
      const engine = makeEngine({ skipManifest: true, extra: { "docs/methodology/x.md": "Operated by Example Agency, the agency behind BWESEO.\n" } });
      rebuild(engine);
      expect(I.planInstall({ engineDir: engine, projectDir: makeProject("b"), registryPath: reg }).failures).toEqual([]);
    });

    it("CUSTOMER ISOLATION: install/update in both directions — Project B never contains Project A (and vice versa)", async () => {
      const reg = join(mk("reg"), "registry.json");
      const engine = makeEngine({ version: "1.0.0" });
      const A = makeProject("acme", { git: false });
      const B = makeProject("jones", { git: false });
      seedCustomerData(A, ACME);
      seedCustomerData(B, JONES);
      I.registerProject(A, reg);
      I.registerProject(B, reg);
      const aData = customerState(A);
      const bData = customerState(B);
      const opts = { registryPath: reg };
      for (const project of [A, B]) {
        const p = I.planInstall({ engineDir: engine, projectDir: project, registryPath: reg });
        expect(p.failures, JSON.stringify(p.failures)).toEqual([]);
        expect((await I.applyPlan(p, { engineDir: engine, projectDir: project })).ok).toBe(true);
      }
      // update both with a newer engine
      write(engine, "src/seo-state-core.mjs", "// state core v1.1.0\nexport const CORE = '1.1.0';\n");
      write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.1.0";\nexport const SCHEMA_VERSION = 1;\n');
      rebuild(engine);
      for (const project of [A, B]) {
        const p = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", ...opts });
        expect(p.failures, JSON.stringify(p.failures)).toEqual([]);
        expect((await I.applyPlan(p, { engineDir: engine, projectDir: project })).ok).toBe(true);
      }
      const leaked = (dir, c) => Object.entries(listAll(dir)).filter(([, text]) => [c.name, c.domain, c.email, c.phone, c.gtm, c.id].some((n) => text.toLowerCase().includes(n.toLowerCase()))).map(([p]) => p);
      expect(leaked(B, ACME)).toEqual([]); // Project B has ZERO Project A
      expect(leaked(A, JONES)).toEqual([]); // and the reverse
      // each project's own data is untouched
      expect(customerState(A)).toEqual(aData);
      expect(customerState(B)).toEqual(bData);
      // …and a project's engine files carry nobody's identity
      const eng = ["seo/tools/seo-state-core.mjs", "seo/tools/seo-state.mjs", "seo/tools/validate-seo-data.mjs", "seo/schema/seo-config.schema.json", "docs/seo/README.md"];
      for (const project of [A, B]) for (const f of eng) for (const c of [ACME, JONES]) expect(read(project, f).toLowerCase()).not.toContain(c.domain);
    });

    it("verify flags another project's identity found in an installed engine file", async () => {
      const reg = join(mk("reg"), "registry.json");
      const engine = makeEngine();
      const A = makeProject("acme", { git: false });
      seedCustomerData(A, ACME);
      I.registerProject(A, reg);
      const B = makeProject("jones", { git: false });
      await install(engine, B, { registryPath: reg });
      write(B, "seo/tools/seo-state.mjs", `// copied from another customer: ${ACME.domain}\n`);
      const v = I.verifyInstall({ projectDir: B, engineDir: engine, registryPath: reg });
      expect(v.leakageCheck).toMatch(/FAILED/);
      expect(v.problems.join("\n")).toMatch(/another project's identity found in installed engine files/);
    });

    it("BWESEO's own registered identities can be checked against the real engine (skips without one)", () => {
      const reg = I.defaultRegistryPath();
      const manifest = JSON.parse(readFileSync(join(ENGINE_HOME, "engine-manifest.json"), "utf8"));
      const scan = I.scanPayload(ENGINE_HOME, manifest, I.loadRegistry(reg));
      expect(scan.secrets).toEqual([]);
      expect(scan.leaks).toEqual([]);
    });
  });

  // ------------------------------------------------------------ 13, 14: dry run and verify change nothing
  describe("dry-run and verify are read-only", () => {
    it("dry run changes nothing — not the project, not the engine — and reports everything it would do", async () => {
      const engine = makeEngine();
      const project = makeProject();
      const before = snapshot(project);
      const eBefore = I.treeHash(engine);
      const logs = [];
      const code = await I.runCli(["--dry-run", "--project", project, "--engine", engine], { log: (s) => logs.push(s), env: { ...process.env, BWESEO_REGISTRY: join(mk("reg"), "r.json") } });
      expect(code).toBe(0);
      expect(snapshot(project)).toBe(before);
      expect(I.treeHash(engine)).toBe(eBefore);
      const out = logs.join("\n");
      for (const h of ["DRY RUN", "Files to create", "Files to update", "Files preserved", "Files excluded", "Potential conflicts", "Schema migrations", ".gitignore additions", "CLAUDE.md:", "Recommended action: /BWESEOInstall"]) expect(out).toContain(h);
      expect(existsSync(join(project, "seo"))).toBe(false);
    });

    it("dry run reports safety failures without changing anything", async () => {
      const engine = makeEngine({ skipManifest: true });
      write(engine, "docs/methodology/workflow.md", `${["-----BEGIN ", "PRIVATE", " KEY-----"].join("")}\n`);
      rebuild(engine);
      const project = makeProject();
      const before = snapshot(project);
      const logs = [];
      const code = await I.runCli(["--dry-run", "--project", project, "--engine", engine], { log: (s) => logs.push(s), env: { ...process.env, BWESEO_REGISTRY: join(mk("reg"), "r.json") } });
      expect(code).toBe(1);
      expect(logs.join("\n")).toMatch(/SAFETY FAILURES/);
      expect(snapshot(project)).toBe(before);
    });

    it("verify changes nothing and reports the installation", async () => {
      const engine = makeEngine();
      const project = makeProject();
      await install(engine, project);
      const before = snapshot(project);
      const eBefore = I.treeHash(engine);
      const logs = [];
      const skillsDir = mk("skills");
      const home = mk("home");
      I.applySkills(I.planSkills({ engineDir: engine, skillsDir, home }), { engineDir: engine, skillsDir, home }); // the Claude skills are installed separately (--sync-skills)
      const code = await I.runCli(["--verify", "--project", project, "--engine", engine], { log: (s) => logs.push(s), env: { ...process.env, BWESEO_REGISTRY: join(mk("reg"), "r.json"), BWESEO_SKILLS_DIR: skillsDir } });
      expect(snapshot(project)).toBe(before);
      expect(I.treeHash(engine)).toBe(eBefore);
      const out = logs.join("\n");
      for (const h of ["BWESEO installed ........ yes", "Engine version .......... 1.0.0", "Schema version .......... 1", "Required skills", "Engine files ............ ", "Configuration ........... missing", "Customer profile ........ missing", "Manifest integrity ...... ok", "Secret leakage check .... passed", "Project leakage check ... passed", "Documentation ........... CLAUDE.md section v1.0.0", "Update available ........ no", "Recommended next action: /BWESEOSetup"]) expect(out).toContain(h);
      expect(code).toBe(0);
    });

    it("verify with the Claude skills not installed points at --sync-skills, not at a generic update", async () => {
      const engine = makeEngine();
      const project = makeProject();
      await install(engine, project);
      const v = I.verifyInstall({ projectDir: project, engineDir: engine, registryPath: join(mk("reg"), "r.json"), skillsDir: mk("skills") });
      expect(v.installed).toBe(true);
      expect(v.problems.join(" ")).toMatch(/required skill\(s\) missing/);
      expect(v.next).toMatch(/^\/BWESEOInstall --sync-skills --dry-run/);
    });

    it("verify on a project with no installation says so and recommends /BWESEOInstall", () => {
      const v = I.verifyInstall({ projectDir: makeProject(), engineDir: makeEngine(), registryPath: join(mk("reg"), "r.json"), skillsDir: mk("skills") });
      expect(v.installed).toBe(false);
      expect(v.next).toBe("/BWESEOInstall");
    });

    it("verify detects modified and missing engine files, and an available update", async () => {
      const engine = makeEngine({ version: "1.0.0" });
      const project = makeProject();
      await install(engine, project);
      write(project, "seo/tools/seo-state.mjs", "// hand-edited\n");
      rmSync(join(project, "seo/tools/seo-state-core.mjs"));
      write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.2.0";\nexport const SCHEMA_VERSION = 1;\n');
      rebuild(engine);
      const v = I.verifyInstall({ projectDir: project, engineDir: engine, registryPath: join(mk("reg"), "r.json"), skillsDir: mk("skills") });
      expect(v.engineFiles.modified).toEqual(["seo/tools/seo-state.mjs"]);
      expect(v.engineFiles.missing).toEqual(["seo/tools/seo-state-core.mjs"]);
      expect(v.updateAvailable).toBe("yes — 1.0.0 → 1.2.0");
      expect(v.problems.length).toBeGreaterThanOrEqual(2);
      expect(v.next).toMatch(/--dry-run --update/);
    });
  });

  // ------------------------------------------------------------ 8–12, 15–17: update
  describe("update — engine only, customer data preserved", () => {
    const setup = async ({ engineOpts = {}, files = {} } = {}) => {
      const engine = makeEngine(engineOpts);
      const project = makeProject("acme", { files });
      seedCustomerData(project, ACME);
      run(["add", "-A"], project);
      run(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "data"], project);
      await install(engine, project);
      return { engine, project };
    };
    const newerEngine = (engine, extra = {}) => {
      write(engine, "src/seo-state-core.mjs", "// state core v1.1.0\nexport const CORE = '1.1.0';\n");
      write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.1.0";\nexport const SCHEMA_VERSION = 1;\n');
      for (const [p, t] of Object.entries(extra)) write(engine, p, t);
      rebuild(engine);
    };

    it("updates the engine and preserves the profile, lifecycle, Search Console, analytics and health state byte-for-byte", async () => {
      const { engine, project } = await setup();
      const before = customerState(project);
      newerEngine(engine);
      const p = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json") });
      expect(p.failures).toEqual([]);
      expect(p.update.map((u) => u.path).sort()).toEqual(["seo/tools/seo-state-core.mjs", "seo/tools/validate-seo-data.mjs"]);
      const res = await I.applyPlan(p, { engineDir: engine, projectDir: project });
      expect(res.ok).toBe(true);
      expect(customerState(project)).toEqual(before); // profile, config (GSC + analytics), inventory (lifecycle), health, exports, reports, docs
      expect(read(project, "seo/tools/seo-state-core.mjs")).toContain("v1.1.0");
      const rc = JSON.parse(read(project, "seo/bweseo-install.json"));
      expect(rc).toMatchObject({ engineVersion: "1.1.0", installationMode: "update" });
      expect(rc.updatedAt >= rc.installedAt).toBe(true);
    });

    it("an update changes the engine files, the receipt and the managed section — nothing else", async () => {
      const { engine, project } = await setup();
      const before = snapshot(project);
      newerEngine(engine);
      await I.applyPlan(I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json") }), { engineDir: engine, projectDir: project });
      const changed = changedFiles(before, snapshot(project)).filter((f) => !f.startsWith("seo/.bweseo-backup/"));
      expect(changed).toEqual(["CLAUDE.md", "seo/bweseo-install.json", "seo/tools/seo-state-core.mjs", "seo/tools/validate-seo-data.mjs"]);
    });

    it("requires an installation receipt, and refuses to update across projects or from a newer schema", async () => {
      const engine = makeEngine();
      const none = plan(engine, makeProject(), { mode: "update" });
      expect(none.failures[0]).toMatchObject({ gate: "update" });
      const { engine: e2, project } = await setup();
      const r = JSON.parse(read(project, "seo/bweseo-install.json"));
      write(project, "seo/bweseo-install.json", JSON.stringify({ ...r, projectId: "some-other-customer" }));
      expect(plan(e2, project, { mode: "update" }).failures.map((f) => f.gate)).toContain("identity");
      write(project, "seo/bweseo-install.json", JSON.stringify({ ...r, schemaVersion: 9 }));
      expect(plan(e2, project, { mode: "update" }).failures.map((f) => f.gate)).toContain("compatibility");
      write(project, "seo/bweseo-install.json", JSON.stringify({ ...r, engineVersion: "9.0.0" }));
      expect(plan(e2, project, { mode: "update" }).failures.map((f) => f.gate)).toContain("compatibility");
    });

    it("a file the customer modified is a conflict — REVIEW REQUIRED, left untouched, never overwritten", async () => {
      const { engine, project } = await setup();
      write(project, "seo/tools/seo-state.mjs", "// customized by the customer\n");
      newerEngine(engine, { "src/seo-state.mjs": "// state v1.1.0\n" });
      const p = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json") });
      expect(p.conflicts).toEqual([{ path: "seo/tools/seo-state.mjs", reason: "modified in this project since it was installed", resolution: "REVIEW REQUIRED" }]);
      await I.applyPlan(p, { engineDir: engine, projectDir: project });
      expect(read(project, "seo/tools/seo-state.mjs")).toBe("// customized by the customer\n");
    });

    it("SCHEMA MIGRATION preserves customer state: backed up, migrated, validated, never fabricated", async () => {
      const { engine, project } = await setup();
      const before = customerState(project);
      newerEngine(engine);
      write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.1.0";\nexport const SCHEMA_VERSION = 2;\n');
      rebuild(engine);
      const migrations = [{
        from: 1, to: 2, description: "add config.schemaNotes (empty)",
        migrate: async (dir) => {
          const f = join(dir, "seo/seo-config.json");
          const c = JSON.parse(readFileSync(f, "utf8"));
          c.schemaVersion = 2;
          writeFileSync(f, JSON.stringify(c, null, 2));
        },
        validate: async (dir) => JSON.parse(readFileSync(join(dir, "seo/seo-config.json"), "utf8")).schemaVersion === 2,
      }];
      const p = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json"), migrations });
      expect(p.migrations).toEqual([{ from: 1, to: 2, description: "add config.schemaNotes (empty)" }]);
      const res = await I.applyPlan(p, { engineDir: engine, projectDir: project, migrations });
      expect(res.ok).toBe(true);
      expect(res.backup).toMatch(/^seo\/\.bweseo-backup\//);
      const cfg = JSON.parse(read(project, "seo/seo-config.json"));
      expect(cfg.schemaVersion).toBe(2);
      const orig = JSON.parse(before["seo/seo-config.json"]);
      expect({ ...cfg, schemaVersion: 1 }).toEqual(orig); // every other value preserved, nothing added or invented
      for (const f of CUSTOMER_FILES.filter((x) => x !== "seo/seo-config.json")) expect(read(project, f)).toBe(before[f]);
      expect(read(project, `${res.backup}/seo/seo-config.json`)).toBe(before["seo/seo-config.json"]);
      expect(JSON.parse(read(project, "seo/bweseo-install.json")).schemaVersion).toBe(2);
    });

    it("a FAILED migration rolls everything back — data, engine files and receipt", async () => {
      const { engine, project } = await setup();
      const all = snapshot(project);
      newerEngine(engine);
      write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.1.0";\nexport const SCHEMA_VERSION = 2;\n');
      rebuild(engine);
      const migrations = [{
        from: 1, to: 2, description: "breaks halfway",
        migrate: async (dir) => {
          const f = join(dir, "seo/seo-config.json");
          writeFileSync(f, "{ corrupted");
          throw new Error("boom");
        },
      }];
      const p = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json"), migrations });
      const res = await I.applyPlan(p, { engineDir: engine, projectDir: project, migrations });
      expect(res).toMatchObject({ ok: false, rolledBack: true });
      expect(changedFiles(all, snapshot(project)).filter((f) => !f.startsWith("seo/.bweseo-backup/"))).toEqual([]);
      expect(JSON.parse(read(project, "seo/seo-config.json")).projectId).toBe(ACME.id);
      expect(read(project, "seo/tools/seo-state-core.mjs")).toContain("v1.0.0");
      // and a migration that produces invalid data is rolled back by validation
      const bad = [{ from: 1, to: 2, description: "invalid", migrate: async (dir) => writeFileSync(join(dir, "seo/seo-config.json"), "{}"), validate: async () => false }];
      const p2 = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json"), migrations: bad });
      expect((await I.applyPlan(p2, { engineDir: engine, projectDir: project, migrations: bad })).rolledBack).toBe(true);
      expect(JSON.parse(read(project, "seo/seo-config.json")).projectId).toBe(ACME.id);
    });
  });

  // ------------------------------------------------------------ 17–21: existing customer files
  describe("existing customer files are never destroyed", () => {
    it("CLAUDE.md is preserved; only the BWESEO-managed section is added, then updated safely", async () => {
      const original = "# Acme Plumbing site\n\nAlways use tabs. Never touch /legacy.\n\n## Deploy\nnpm run ship\n";
      const engine = makeEngine({ version: "1.0.0" });
      const project = makeProject("acme", { files: { "CLAUDE.md": original } });
      const p = plan(engine, project);
      expect(p.claudeMd).toMatchObject({ action: "append", file: "CLAUDE.md" });
      await install(engine, project);
      const t = read(project, "CLAUDE.md");
      expect(t.startsWith(original)).toBe(true);
      expect(t).toContain("BWESEO:BEGIN");
      expect(t).toContain("v1.0.0, schema 1");
      // a later engine version rewrites only the managed part
      const edited = t.replace("## Deploy", "## Deploy (edited by the customer)");
      write(project, "CLAUDE.md", edited);
      write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.3.0";\nexport const SCHEMA_VERSION = 1;\n');
      rebuild(engine);
      const up = I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json") });
      expect(up.claudeMd.action).toBe("update-managed-section");
      await I.applyPlan(up, { engineDir: engine, projectDir: project });
      const t2 = read(project, "CLAUDE.md");
      expect(t2).toContain("v1.3.0, schema 1");
      expect(t2).not.toContain("v1.0.0, schema 1");
      expect(t2).toContain("## Deploy (edited by the customer)");
      expect(t2.startsWith(original.replace("## Deploy", "## Deploy (edited by the customer)"))).toBe(true);
      expect((t2.match(/BWESEO:BEGIN/g) ?? []).length).toBe(1);
    });

    it("a differently-cased claude.md is found and merged, not duplicated", async () => {
      const project = makeProject("site", { files: { "Claude.md": "# Notes\n" } });
      const p = plan(makeEngine(), project);
      expect(p.claudeMd.file).toBe("Claude.md");
      await install(makeEngine(), project);
      expect(readdirSync(project).filter((f) => f.toLowerCase() === "claude.md")).toEqual(["Claude.md"]);
    });

    it("existing sitemap and robots implementations are reported and never touched", async () => {
      const files = {
        "public/sitemap.xml": "<urlset><url><loc>https://acme-plumbing.example/</loc></url></urlset>",
        "public/robots.txt": "User-agent: *\nDisallow: /private\n",
        "src/pages/sitemap.xml.ts": "export const GET = () => new Response('custom sitemap');\n",
        "src/pages/robots.txt.ts": "export const GET = () => new Response('custom robots');\n",
      };
      const project = makeProject("acme", { files });
      const p = plan(makeEngine(), project);
      expect(p.notes.join("\n")).toMatch(/existing sitemap implementation preserved/);
      expect(p.notes.join("\n")).toMatch(/existing robots implementation preserved/);
      await install(makeEngine(), project);
      for (const [f, t] of Object.entries(files)) expect(read(project, f)).toBe(t);
    });

    it("an existing different SEO tool is a conflict (REVIEW REQUIRED); an identical one is adopted", async () => {
      const engine = makeEngine();
      const project = makeProject("acme", { files: { "seo/tools/seo-state.mjs": "// my own, different tool\n", "seo/tools/seo-state-core.mjs": read(engine, "src/seo-state-core.mjs") } });
      const p = plan(engine, project);
      expect(p.conflicts).toEqual([{ path: "seo/tools/seo-state.mjs", reason: "an existing file differs from the engine version (unmanaged or customized)", resolution: "REVIEW REQUIRED" }]);
      expect(p.preserve.find((x) => x.path === "seo/tools/seo-state-core.mjs")).toMatchObject({ adopt: true });
      const res = await I.applyPlan(p, { engineDir: engine, projectDir: project });
      expect(res.ok).toBe(true);
      expect(read(project, "seo/tools/seo-state.mjs")).toBe("// my own, different tool\n");
      expect(JSON.parse(read(project, "seo/bweseo-install.json")).files["seo/tools/seo-state-core.mjs"]).toBeTruthy(); // adopted into the receipt
    });

    it("templates are never overwritten", async () => {
      const project = makeProject("acme", { files: { "docs/seo/README.md": "# Acme's own SEO docs\n" } });
      const p = plan(makeEngine(), project);
      expect(p.preserve.find((x) => x.path === "docs/seo/README.md")).toMatchObject({ reason: "template — an existing file is never overwritten" });
      await install(makeEngine(), project);
      expect(read(project, "docs/seo/README.md")).toBe("# Acme's own SEO docs\n");
    });

    it("existing customer data is listed as preserved, and an install over it changes none of it", async () => {
      const project = makeProject("acme");
      seedCustomerData(project, ACME);
      const before = customerState(project);
      const p = plan(makeEngine(), project);
      expect(p.preserve.map((x) => x.path)).toEqual(expect.arrayContaining(["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json", "seo/data/", "docs/seo/reports/"]));
      await install(makeEngine(), project);
      expect(customerState(project)).toEqual(before);
    });
  });

  // ------------------------------------------------------------ 22: frameworks
  describe("framework detection — an adapter is only reported if the engine ships one", () => {
    it("astro → astro adapter", () => expect(plan(makeEngine(), makeProject("a", { framework: "astro", git: false })).target).toMatchObject({ framework: "astro", adapter: "astro" }));
    it("plain index.html → static-html adapter", () => {
      const d = mk("static");
      write(d, "index.html", "<html></html>");
      expect(plan(makeEngine(), d).target).toMatchObject({ framework: "static-html", adapter: "static-html" });
    });
    it("a framework with no shipped adapter installs the core only and says 'Website adapter requires configuration'", async () => {
      const project = makeProject("n", { framework: "next", git: false }); // the synthetic engine ships no nextjs adapter
      const p = plan(makeEngine(), project);
      expect(p.target).toMatchObject({ framework: "nextjs", adapter: null });
      expect(p.warnings.join("\n")).toMatch(/Website adapter requires configuration/);
      await install(makeEngine(), project);
      expect(JSON.parse(read(project, "seo/bweseo-install.json")).adapter).toBeNull(); // never fabricated
      expect(existsSync(join(project, "seo/tools/seo-state-core.mjs"))).toBe(true);
    });
    it("an unknown project installs the core without inventing an adapter", async () => {
      const d = mk("unknown");
      write(d, "README.md", "# something\n");
      const p = plan(makeEngine(), d);
      expect(p.target.framework).toBe("unknown");
      expect(p.target.adapter).toBeNull();
      expect(p.warnings.join("\n")).toMatch(/Website adapter requires configuration/);
    });
    it("detects Cloudflare / Vercel / Netlify hosting hints without acting on them", () => {
      const d = makeProject("h", { git: false, files: { "wrangler.jsonc": "{}", "vercel.json": "{}", "netlify.toml": "" } });
      expect(plan(makeEngine(), d).target.hosting.sort()).toEqual(["cloudflare-workers", "netlify", "vercel"]);
    });
  });

  // ------------------------------------------------------------ 24: gates
  describe("safety gates abort rather than guess", () => {
    it("refuses when the target is the canonical engine, inside it, or does not exist", () => {
      const engine = makeEngine();
      expect(plan(engine, engine).failures[0]).toMatchObject({ gate: "target" });
      expect(plan(engine, join(engine, "tools")).failures[0]).toMatchObject({ gate: "target" });
      expect(plan(engine, join(tmpdir(), "definitely-not-a-project-dir-xyz")).failures[0]).toMatchObject({ gate: "target" });
    });

    it("refuses an ambiguous target inside a larger repository unless --allow-subdir", () => {
      const repo = makeProject("mono");
      const sub = join(repo, "packages", "site");
      mkdirSync(sub, { recursive: true });
      const p = plan(makeEngine(), sub);
      expect(p.failures[0]).toMatchObject({ gate: "target" });
      expect(p.failures[0].reason).toMatch(/inside a larger repository/);
      expect(plan(makeEngine(), sub, { allowSubdir: true }).failures).toEqual([]);
    });

    it("warns about uncommitted work and non-git projects, but does not block", () => {
      const dirty = makeProject("dirty");
      write(dirty, "wip.txt", "uncommitted");
      expect(plan(makeEngine(), dirty).warnings.join("\n")).toMatch(/uncommitted change/);
      expect(plan(makeEngine(), makeProject("nogit", { git: false })).warnings.join("\n")).toMatch(/not a git repository/);
    });

    it("locates the canonical engine from an override, the recorded location or the legacy directory — nowhere else, in that order", () => {
      const engine = makeEngine();
      expect(I.locateEngine({ env: { BWESEO_ENGINE_HOME: engine }, home: "/nonexistent" })).toMatchObject({ dir: engine, source: "BWESEO_ENGINE_HOME" });
      expect(I.locateEngine({ env: {}, home: "/nonexistent" })).toBeNull();
      // 2. the location recorded once per machine (no path is hard-coded anywhere)
      const home = mk("home");
      expect(I.registerEngineLocation(mk("not-an-engine"), home).ok).toBe(false);
      expect(I.registerEngineLocation(engine, home).ok).toBe(true);
      expect(JSON.parse(read(home, ".claude/bweseo/engine-location.json")).path).toBe(engine.replace(/\\/g, "/"));
      expect(I.locateEngine({ env: {}, home })).toMatchObject({ dir: engine, source: "engine-location.json" });
      // the override wins over the recorded location
      const other = makeEngine();
      expect(I.locateEngine({ env: { BWESEO_ENGINE_HOME: other }, home })).toMatchObject({ dir: other, source: "BWESEO_ENGINE_HOME" });
      // 3. the deprecated legacy skills location, only when nothing else is set
      const oldHome = mk("oldhome");
      cpSync(engine, join(oldHome, ".claude", "skills", "BWESEO", "engine"), { recursive: true });
      expect(I.locateEngine({ env: {}, home: oldHome })).toMatchObject({ source: "legacy skills location (deprecated)" });
      // a recorded location whose manifest disappeared is not used
      rmSync(join(engine, "engine-manifest.json"));
      expect(I.locateEngine({ env: {}, home })).toBeNull();
    });

    it("the CLI refuses with a corrective action when the engine cannot be found", async () => {
      const logs = [];
      const code = await I.runCli(["--project", makeProject()], { env: { BWESEO_REGISTRY: join(mk("reg"), "r.json") }, home: "/nonexistent", log: (s) => logs.push(s) });
      expect(code).toBe(1);
      expect(logs.join("\n")).toMatch(/cannot be located.*\n.*BWESEO_ENGINE_HOME/s);
    });
  });

  // ------------------------------------------------------------ 29–30: source protection, no external actions
  describe("source protection and no external actions", () => {
    it("never modifies the canonical engine — install, update, verify and dry-run all leave it byte-identical", async () => {
      const engine = makeEngine();
      const before = I.treeHash(engine);
      const project = makeProject();
      await install(engine, project);
      write(project, "seo/tools/seo-state.mjs", "// the customer edits their copy\n"); // customer changes never flow back
      I.verifyInstall({ projectDir: project, engineDir: engine, registryPath: join(mk("reg"), "r.json"), skillsDir: mk("skills") });
      I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json") });
      expect(I.treeHash(engine)).toBe(before);
      expect(read(engine, "src/seo-state.mjs")).toBe("// state\n");
    });

    it("the installer contains no network, deploy, commit, push, DNS or Google calls", () => {
      const code = readFileSync(INSTALLER, "utf8");
      const noComments = code.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      expect(noComments).not.toMatch(/\bfetch\s*\(|https?\.request|XMLHttpRequest|node:https?|node:net|WebSocket/);
      // the only process it ever starts is git, asking for read-only facts — no deploy tools, no shell
      expect([...noComments.matchAll(/execFileSync\(\s*"([^"]+)"/g)].map((m) => m[1])).toEqual(["git"]);
      expect(noComments).not.toMatch(/spawn(Sync)?\(|exec(Sync)?\(|child_process\.exec|shell:\s*true/);
      expect(noComments).not.toMatch(/npm publish|deploy\s*\(|sendmail|nodemailer/i);
      // git is only ever asked for read-only facts
      const gitCalls = [...noComments.matchAll(/git\(dir,\s*([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ""));
      expect(gitCalls.sort()).toEqual(['"rev-parse","--show-toplevel"', '"status","--porcelain"']);
      expect(noComments).not.toMatch(/"(commit|push|add|checkout|reset|clean|remote|config)"/);
    });

    it("installing, updating and verifying make no network request", async () => {
      const realFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        throw new Error("network used");
      };
      try {
        const engine = makeEngine();
        const project = makeProject();
        await install(engine, project);
        I.verifyInstall({ projectDir: project, engineDir: engine, registryPath: join(mk("reg"), "r.json"), skillsDir: mk("skills") });
        write(engine, "src/validate-seo-data.mjs", 'export const ENGINE_VERSION = "1.0.1";\nexport const SCHEMA_VERSION = 1;\n');
        rebuild(engine);
        await I.applyPlan(I.planInstall({ engineDir: engine, projectDir: project, mode: "update", registryPath: join(mk("reg"), "r.json") }), { engineDir: engine, projectDir: project });
      } finally {
        globalThis.fetch = realFetch;
      }
      expect(calls).toBe(0);
    });

    it("does not commit: the project's git history is unchanged and the work is left for the owner", async () => {
      const project = makeProject();
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" });
      await install(makeEngine(), project);
      expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" })).toBe(head);
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: project, encoding: "utf8" })).toMatch(/seo\//);
    });
  });

  // ------------------------------------------------------------ Claude skills: canonical source → installed skills
  describe("skills — installed from the canonical source, never the other way", () => {
    const setup = () => {
      const engine = makeEngine();
      const home = mk("home");
      return { engine, home, skillsDir: join(home, ".claude", "skills") };
    };

    it("dry run shows what would be installed and changes nothing", async () => {
      const { engine, home, skillsDir } = setup();
      const logs = [];
      const code = await I.runCli(["--sync-skills", "--dry-run", "--engine", engine], { home, env: { BWESEO_SKILLS_DIR: skillsDir }, log: (l) => logs.push(l) });
      expect(code).toBe(0);
      expect(logs.join("\n")).toMatch(/DRY RUN[\s\S]*install: BWESEOBar, BWESEOFoo/);
      expect(existsSync(skillsDir)).toBe(false);
      expect(existsSync(join(home, ".claude", "bweseo", "skills-receipt.json"))).toBe(false);
    });

    it("installs every skill from the canonical source and records a receipt (hashes only)", () => {
      const { engine, home, skillsDir } = setup();
      const before = I.treeHash(engine);
      const plan = I.planSkills({ engineDir: engine, skillsDir, home });
      expect(plan.install.map((s) => s.name).sort()).toEqual(["BWESEOBar", "BWESEOFoo"]);
      I.applySkills(plan, { engineDir: engine, skillsDir, home });
      expect(read(skillsDir, "BWESEOFoo/SKILL.md")).toBe(read(engine, "skills/BWESEOFoo/SKILL.md"));
      const r = JSON.parse(read(home, ".claude/bweseo/skills-receipt.json"));
      expect(Object.keys(r.skills).sort()).toEqual(["BWESEOBar", "BWESEOFoo"]);
      expect(I.scanTextForSecrets(JSON.stringify(r), "skills-receipt.json")).toEqual([]);
      expect(I.treeHash(engine)).toBe(before); // the canonical source is never modified
    });

    it("a second sync is a no-op; a new canonical version updates unmodified skills", () => {
      const { engine, home, skillsDir } = setup();
      I.applySkills(I.planSkills({ engineDir: engine, skillsDir, home }), { engineDir: engine, skillsDir, home });
      const again = I.planSkills({ engineDir: engine, skillsDir, home });
      expect([again.install.length, again.update.length, again.conflicts.length, again.unchanged.length]).toEqual([0, 0, 0, 2]);
      write(engine, "skills/BWESEOFoo/SKILL.md", "---\nname: BWESEOFoo\ndescription: a skill v2\n---\n# Foo v2\n");
      rebuild(engine);
      const up = I.planSkills({ engineDir: engine, skillsDir, home });
      expect(up.update.map((s) => s.name)).toEqual(["BWESEOFoo"]);
      I.applySkills(up, { engineDir: engine, skillsDir, home });
      expect(read(skillsDir, "BWESEOFoo/SKILL.md")).toContain("Foo v2");
    });

    it("a skill edited by hand is a conflict (REVIEW REQUIRED) and is never overwritten; customer edits never flow back", async () => {
      const { engine, home, skillsDir } = setup();
      I.applySkills(I.planSkills({ engineDir: engine, skillsDir, home }), { engineDir: engine, skillsDir, home });
      write(skillsDir, "BWESEOFoo/SKILL.md", "# hand-edited locally\n");
      write(engine, "skills/BWESEOFoo/SKILL.md", "---\nname: BWESEOFoo\ndescription: v3\n---\n# v3\n");
      rebuild(engine);
      const plan = I.planSkills({ engineDir: engine, skillsDir, home });
      expect(plan.conflicts).toEqual([{ name: "BWESEOFoo", reason: expect.stringMatching(/differs from the canonical source/), resolution: "REVIEW REQUIRED" }]);
      const logs = [];
      const code = await I.runCli(["--sync-skills", "--engine", engine], { home, env: { BWESEO_SKILLS_DIR: skillsDir }, log: (l) => logs.push(l) });
      expect(code).toBe(2);
      expect(read(skillsDir, "BWESEOFoo/SKILL.md")).toBe("# hand-edited locally\n"); // untouched
      expect(read(engine, "skills/BWESEOFoo/SKILL.md")).toContain("v3"); // and the source did not absorb the edit
    });

    it("verify reports missing skills and drift from the canonical source", async () => {
      const { engine, home, skillsDir } = setup();
      const project = makeProject();
      await install(engine, project);
      let v = I.verifyInstall({ projectDir: project, engineDir: engine, registryPath: join(mk("reg"), "r.json"), skillsDir });
      expect(v.requiredSkills.missing.sort()).toEqual(["BWESEOBar", "BWESEOFoo"]);
      I.applySkills(I.planSkills({ engineDir: engine, skillsDir, home }), { engineDir: engine, skillsDir, home });
      write(skillsDir, "BWESEOBar/SKILL.md", "# drifted\n");
      v = I.verifyInstall({ projectDir: project, engineDir: engine, registryPath: join(mk("reg"), "r.json"), skillsDir });
      expect(v.requiredSkills).toMatchObject({ missing: [], drift: ["BWESEOBar"] });
      expect(I.formatVerify(v)).toMatch(/1 differ from the canonical source \(run \/BWESEOInstall --sync-skills --dry-run\)/);
    });
  });

  // ------------------------------------------------------------ registration
  describe("project identity registration", () => {
    it("registers fingerprints (values are never printed) and pins the project id in the receipt", async () => {
      const reg = join(mk("reg"), "registry.json");
      const project = makeProject("acme", { git: false });
      await install(makeEngine(), project);
      seedCustomerData(project, ACME);
      const logs = [];
      const code = await I.runCli(["--register-project", "--project", project], { env: { ...process.env, BWESEO_REGISTRY: reg }, log: (s) => logs.push(s) });
      expect(code).toBe(0);
      expect(logs.join("\n")).toMatch(/registered this project's identity fingerprints \(\d+\); values are not shown/);
      expect(logs.join("\n")).not.toContain(ACME.domain);
      const kinds = I.loadRegistry(reg).projects[ACME.id].fingerprints.map((f) => f.kind);
      expect(kinds).toEqual(expect.arrayContaining(["project-id", "domain", "search-console-property", "analytics-id", "business-name", "email", "phone"]));
      expect(JSON.parse(read(project, "seo/bweseo-install.json")).projectId).toBe(ACME.id);
    });
  });

  // ------------------------------------------------------------ the real canonical engine
  describe("the real canonical engine", () => {
    it("has a valid, complete manifest — every file classified, hashes match, no unclassified files", () => {
      const manifest = JSON.parse(readFileSync(join(ENGINE_HOME, "engine-manifest.json"), "utf8"));
      const v = I.validateManifest(ENGINE_HOME, manifest);
      expect(v.errors).toEqual([]);
      expect(v.unclassified).toEqual([]);
      expect(manifest).toMatchObject({ manifestVersion: 1, engineId: "bweseo-engine", schemaVersion: 1 });
      expect(manifest.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
      // the engine has its own version (the VERSION file) — it is not any website's version
      expect(manifest.engineVersion).toBe(readFileSync(join(ENGINE_HOME, "VERSION"), "utf8").trim());
      expect(manifest.schemaVersion).toBe(1);
    });

    it("installs cleanly into a blank project (secret + isolation scans pass)", async () => {
      const project = makeProject("blank", { git: false });
      const reg = I.defaultRegistryPath();
      const p = I.planInstall({ engineDir: ENGINE_HOME, projectDir: project, registryPath: reg });
      expect(p.failures, JSON.stringify(p.failures)).toEqual([]);
      const res = await I.applyPlan(p, { engineDir: ENGINE_HOME, projectDir: project });
      expect(res.ok).toBe(true);
      expect(existsSync(join(project, "seo/tools/seo-google.mjs"))).toBe(true);
      expect(existsSync(join(project, "seo/tools/bweseo-install.mjs"))).toBe(false);
      for (const f of ["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json"]) expect(existsSync(join(project, f))).toBe(false);
      // the installed engine files carry no identity of any registered project
      // a hermetic skills directory, populated from the canonical SOURCE by the installer's own skill sync
      const home = mk("home");
      const skillsDir = join(home, ".claude", "skills");
      const sp = I.planSkills({ engineDir: ENGINE_HOME, skillsDir, home });
      expect(sp.conflicts).toEqual([]);
      expect(sp.install.length).toBe(JSON.parse(readFileSync(join(ENGINE_HOME, "engine-manifest.json"), "utf8")).requiredSkills.length);
      I.applySkills(sp, { engineDir: ENGINE_HOME, skillsDir, home });
      const v = I.verifyInstall({ projectDir: project, engineDir: ENGINE_HOME, registryPath: reg, skillsDir });
      expect(v.requiredSkills).toMatchObject({ missing: [], drift: [] });
      expect(v.problems).toEqual([]);
      expect(v.secretCheck).toBe("passed");
      expect(v.leakageCheck).toMatch(/^passed/);
      expect(v.next).toBe("/BWESEOSetup");
    });
  });
});
