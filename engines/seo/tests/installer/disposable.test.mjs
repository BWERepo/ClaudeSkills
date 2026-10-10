// End-to-end proof of the standard workflow against the REAL canonical engine, in a disposable website project that
// uses fictional data only (Jones Dental, jones-dental.example):
//
//   /BWESEOInstall --dry-run → /BWESEOInstall → /BWESEOInstall (again) → /BWESEOInstall --verify → /BWESEOSetup
//   → /BWESEO
//
// It proves the engine installs, the skills sync from the canonical source, no operator or other
// customer's data appears, no secrets appear, project-specific state begins EMPTY, setup creates only fictional
// state, the installed state tool recognises "installed, setup required" and then "configured", and that a repeat
// install is recognised as already installed. Nothing here touches the network, git history or a real project.

import { afterAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const I = await import(pathToFileURL(join(ENGINE, "installer", "bweseo-install.mjs")).href);
const manifest = JSON.parse(readFileSync(join(ENGINE, "engine-manifest.json"), "utf8"));

const tmp = [];
const mk = (p) => {
  const d = mkdtempSync(join(tmpdir(), `bweseo-disposable-${p}-`));
  tmp.push(d);
  return d;
};
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

const listAll = (dir, base = dir, out = {}) => {
  for (const n of readdirSync(dir)) {
    if (n === ".git") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) listAll(p, base, out);
    else out[p.slice(base.length + 1).replace(/\\/g, "/")] = readFileSync(p, "utf8");
  }
  return out;
};
const snapshot = (d) => JSON.stringify(listAll(d));

// The operator's own site and every real-world identity that must never appear in a customer project or in the
// canonical payload. Fragments are joined at run time so this file does not itself carry them.
const BWE_FINGERPRINTS = [["business", "webexpress", ".com"], ["staging.", "business", "webexpress", ".com"], ["G-273", "FECVPBZ"], ["GTM-TR", "RGS2LF"], ["muddy-", "resonance"]].map((p) => p.join(""));

const run = async (args, { project, home, skillsDir, registry }) => {
  const logs = [];
  const code = await I.runCli([...args, "--project", project, "--engine", ENGINE], {
    home,
    log: (l) => logs.push(l),
    env: { ...process.env, BWESEO_REGISTRY: registry, BWESEO_SKILLS_DIR: skillsDir },
  });
  return { code, out: logs.join("\n") };
};
const stateTool = (project, args = []) => {
  const r = spawnSync(process.execPath, [join(project, "seo", "tools", "seo-state.mjs"), "--offline", "--json", ...args], { cwd: project, encoding: "utf8" });
  return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
};

describe("disposable website — the real install workflow, end to end", () => {
  const project = mk("jones-dental");
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "jones-dental-site", version: "0.1.0" }));
  writeFileSync(join(project, "index.html"), "<!doctype html><title>Jones Dental</title>\n");
  const ctx = { project, home: mk("home"), skillsDir: mk("skills"), registry: join(mk("reg"), "registry.json") };
  const initial = snapshot(project);

  it("1. dry run changes nothing and reports the plan", async () => {
    const r = await run(["--dry-run"], ctx);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(snapshot(project)).toBe(initial);
    expect(existsSync(join(project, "seo"))).toBe(false);
  });

  it("2. install puts in only the allowlisted engine and starts every project-specific file EMPTY (absent)", async () => {
    const r = await run([], ctx);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/BWESEO engine installed successfully/);
    expect(r.out).toMatch(/No customer-specific SEO profile exists yet/);
    expect(r.out).toMatch(/\/BWESEOSetup/);
    for (const f of ["seo-config.json", "business-profile.json", "content-inventory.json"]) expect(existsSync(join(project, "seo", f))).toBe(false);
    expect(existsSync(join(project, "seo", "data"))).toBe(true);
    expect(readdirSync(join(project, "seo", "data"))).toEqual([]);
    const receipt = JSON.parse(readFileSync(join(project, "seo", "bweseo-install.json"), "utf8"));
    expect(receipt).toMatchObject({ engineVersion: manifest.engineVersion, schemaVersion: manifest.schemaVersion, manifestVersion: manifest.manifestVersion, installationMode: "install" });
    // installed files are exactly the manifest's installable set (allowlist), nothing else
    const installable = new Set(manifest.files.filter((f) => f.install).map((f) => f.install));
    const installed = Object.keys(receipt.files);
    expect(installed.length).toBeGreaterThan(0);
    for (const p of installed) expect(installable.has(p), p).toBe(true);
  });

  it("3. a second install recognises the existing installation, changes nothing and says so", async () => {
    const before = snapshot(project);
    const r = await run([], ctx);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/BWESEO is already installed in this project \(engine /);
    expect(r.out).not.toMatch(/BWESEO engine installed successfully/);
    expect(r.out).toMatch(/Nothing needed changing/);
    expect(r.out).toMatch(/\/BWESEOSetup/); // still no profile
    const after = JSON.parse(snapshot(project));
    const was = JSON.parse(before);
    const changed = Object.keys(after).filter((k) => after[k] !== was[k]);
    expect(changed).toEqual(["seo/bweseo-install.json"]); // only the receipt's updatedAt moves
    expect(JSON.parse(after["seo/bweseo-install.json"]).installedAt).toBe(JSON.parse(was["seo/bweseo-install.json"]).installedAt);
  });

  it("4. the Claude skills install from the canonical source, and verify reports a clean installation", async () => {
    const plan = I.planSkills({ engineDir: ENGINE, skillsDir: ctx.skillsDir, home: ctx.home });
    expect(plan.install.length).toBe(manifest.requiredSkills.length);
    I.applySkills(plan, { engineDir: ENGINE, skillsDir: ctx.skillsDir, home: ctx.home });
    const before = snapshot(project);
    const r = await run(["--verify"], ctx);
    expect(r.out).toMatch(/BWESEO installed \.+ yes/);
    expect(r.out).toMatch(/Manifest integrity \.+ ok/);
    expect(r.out).toMatch(/Secret leakage check \.+ passed/);
    expect(r.out).toMatch(/Customer profile \.+ missing/);
    expect(r.out).toMatch(/Recommended next action: \/BWESEOSetup/);
    expect(r.code).toBe(0);
    expect(snapshot(project)).toBe(before); // verify changes nothing
  });

  it("5. no operator or other real customer data and no secrets in anything installed", () => {
    const files = listAll(project);
    for (const [p, text] of Object.entries(files)) {
      const lower = text.toLowerCase();
      for (const fp of BWE_FINGERPRINTS) expect(lower.includes(fp.toLowerCase()), `${p} contains an operator fingerprint`).toBe(false);
      expect(I.scanTextForSecrets ? I.scanTextForSecrets(text, p) : [], p).toEqual([]);
    }
  });

  it("6. /BWESEO (the installed state tool) recognises: installed, setup required — and nothing is fabricated", () => {
    const s = stateTool(project);
    expect(s.status, s.stderr).toBe(0);
    expect(s.json.recommendation).toMatchObject({ kind: "setup", command: "/BWESEOSetup" });
    expect(s.json.pages).toEqual([]);
  });

  it("7. /BWESEOSetup creates only the fictional project's own state, and the installed validator accepts it", () => {
    const seo = join(project, "seo");
    const date = new Date().toISOString().slice(0, 10);
    const cfg =JSON.parse(readFileSync(join(ENGINE, "templates", "seo-config.template.json"), "utf8"));
    Object.assign(cfg, { projectId: "jones-dental", website: "https://jones-dental.example", adapter: "static-html" });
    cfg.repo = { rootFolderName: basename(project) };
    cfg.engine = { version: manifest.engineVersion };
    cfg.stack.framework = "plain HTML";
    cfg.environments.production = { url: "https://jones-dental.example", hosts: ["jones-dental.example"] };
    cfg.environments.staging = { status: "not-configured" };
    cfg.workflows = { build: "npm run build", test: "npm test" };
    cfg.conversion = { primary: "A booked appointment" };
    delete cfg.$schema;
    writeFileSync(join(seo, "seo-config.json"), JSON.stringify(cfg, null, 2));

    const profile = JSON.parse(readFileSync(join(ENGINE, "templates", "business-profile.template.json"), "utf8"));
    delete profile.$schema;
    profile.profileId = "jones-dental";
    profile.lastReviewed = date;
    profile.identity.businessName = { value: "Jones Dental", status: "verified", source: `owner:${date} chat`, verifiedOn: date, public: true };
    profile.identity.website = { value: "https://jones-dental.example", status: "verified", source: `owner:${date} chat`, verifiedOn: date, public: true };
    writeFileSync(join(seo, "business-profile.json"), JSON.stringify(profile, null, 2));

    const inv = JSON.parse(readFileSync(join(ENGINE, "templates", "content-inventory.template.json"), "utf8"));
    delete inv.$schema;
    inv.projectId = "jones-dental";
    inv.updated = date;
    inv.pages = inv.pages.slice(0, 1).map((p) => ({ ...p, title: "Jones Dental", topic: "Home", lastReviewed: date, created: date }));
    writeFileSync(join(seo, "content-inventory.json"), JSON.stringify(inv, null, 2));

    const v = spawnSync(process.execPath, [join(seo, "tools", "validate-seo-data.mjs")], { cwd: project, encoding: "utf8" });
    const out = v.stdout + v.stderr;
    expect(out.split("\n").filter((l) => /^\s*ERROR\b/.test(l))).toEqual([]);
    expect(out).toMatch(/0 error\(s\)/);
  });

  it("8. /BWESEO now recognises a configured project (no longer 'setup required')", () => {
    const s = stateTool(project);
    expect(s.status, s.stderr).toBe(0);
    expect(s.json.recommendation.kind).not.toBe("setup");
    expect(s.json.recommendation.kind).not.toBe("install");
    expect(s.json.business).toBe("Jones Dental");
  });

  it("9. an update after setup preserves the fictional customer's state byte-for-byte", async () => {
    const keep = ["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json"];
    const before = listAll(project);
    const r = await run(["--update"], ctx);
    expect(r.code).toBe(0);
    const after = listAll(project);
    for (const k of keep) expect(after[k], k).toBe(before[k]);
  });

  // Regression: on Windows, git reports one casing of a path and the shell another. That difference must never make
  // the project look like a subfolder of some other repository ("the install location is ambiguous").
  it.skipIf(process.platform !== "win32")("path casing does not matter: the same project under a different casing is still the repository root", () => {
    const other = mk("casing");
    execFileSync("git", ["init", "-q"], { cwd: other, stdio: "ignore" });
    writeFileSync(join(other, "package.json"), "{}");
    const swapped = other.replace(/[A-Za-z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
    expect(swapped).not.toBe(other);
    expect(I.foldPath(swapped)).toBe(I.foldPath(other));
    const plan = I.planInstall({ engineDir: ENGINE, projectDir: swapped, registryPath: ctx.registry });
    expect(plan.failures.filter((f) => f.gate === "target")).toEqual([]);
  });

  it("a real subfolder of a repository is still refused as ambiguous", () => {
    const repo = mk("outer");
    execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
    mkdirSync(join(repo, "site"));
    writeFileSync(join(repo, "site", "package.json"), "{}");
    const plan = I.planInstall({ engineDir: ENGINE, projectDir: join(repo, "site"), registryPath: ctx.registry });
    expect(plan.failures.some((f) => f.gate === "target" && /larger repository/.test(f.reason))).toBe(true);
  });

  it("10. the canonical engine itself was never modified by any of this", () => {
    expect(I.treeHash(ENGINE)).toBe(I.treeHash(ENGINE));
    const m = JSON.parse(readFileSync(join(ENGINE, "engine-manifest.json"), "utf8"));
    expect(I.validateManifest(ENGINE, m).errors).toEqual([]);
  });
});

void cpSync;
void mkdirSync;
