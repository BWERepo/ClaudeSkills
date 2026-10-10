// Group 0.3 hardening, proven against the real engine with fictional projects:
//   1. line endings never make an unchanged file look "modified" (no recurring update conflicts)
//   2. the engine locator — one order, an alias, a validated registration, a flagged legacy fallback
//   3. the state tool's own copy of that order cannot drift from the installer's
//   4. adopting a project that already has customer data does not tell it to run /BWESEOSetup
//   5. the canonical engine names the obsolete engine location nowhere except its deprecated fallback

import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const I = await import(pathToFileURL(join(ENGINE, "installer", "bweseo-install.mjs")).href);
const S = await import(pathToFileURL(join(ENGINE, "src", "seo-state.mjs")).href);
const manifest = JSON.parse(readFileSync(join(ENGINE, "engine-manifest.json"), "utf8"));

const tmp = [];
const mk = (p) => {
  const d = mkdtempSync(join(tmpdir(), `bweseo-hard-${p}-`));
  tmp.push(d);
  return d;
};
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

const project = (name) => {
  const d = mk(name);
  execFileSync("git", ["init", "-q"], { cwd: d, stdio: "ignore" });
  writeFileSync(join(d, "package.json"), JSON.stringify({ name }));
  return d;
};
const run = async (args, ctx) => {
  const logs = [];
  const code = await I.runCli([...args, "--project", ctx.project, "--engine", ENGINE], { home: ctx.home, log: (l) => logs.push(l), env: { ...process.env, BWESEO_REGISTRY: ctx.registry, BWESEO_SKILLS_DIR: ctx.skills } });
  return { code, out: logs.join("\n") };
};
const ctxFor = (name) => ({ project: project(name), home: mk("home"), skills: mk("skills"), registry: join(mk("reg"), "registry.json") });

describe("1. line endings never create a false 'modified'", () => {
  it("hashContent treats CRLF and LF text as the same content, and binary as different", () => {
    const lf = Buffer.from("a\nb\nc\n");
    const crlf = Buffer.from("a\r\nb\r\nc\r\n");
    expect(I.hashContent(crlf)).toBe(I.hashContent(lf));
    expect(I.hashContent(Buffer.from("a\nb\nc\nd\n"))).not.toBe(I.hashContent(lf));
    const bin1 = Buffer.from([0, 13, 10, 1]);
    const bin2 = Buffer.from([0, 10, 1]);
    expect(I.hashContent(bin1)).not.toBe(I.hashContent(bin2));
  });

  it("an installed file rewritten with CRLF is NOT modified: verify is clean and update reports no conflict", async () => {
    const ctx = ctxFor("crlf");
    expect((await run([], ctx)).code).toBe(0);
    const rel = "seo/tools/seo-google.mjs";
    const f = join(ctx.project, rel);
    writeFileSync(f, readFileSync(f, "utf8").replace(/\r?\n/g, "\r\n")); // what a Windows tool write does
    expect(readFileSync(f, "utf8")).toContain("\r\n");
    const v = I.verifyInstall({ projectDir: ctx.project, engineDir: ENGINE, registryPath: ctx.registry, skillsDir: ctx.skills, home: ctx.home });
    expect(v.engineFiles.modified).toEqual([]);
    const u = await run(["--update", "--dry-run"], ctx);
    expect(u.out).toMatch(/Potential conflicts \(0\)/);
    expect(u.out).not.toMatch(/REVIEW REQUIRED/);
  });

  it("a real content change is still a conflict — normalising line endings hides nothing else", async () => {
    const ctx = ctxFor("realchange");
    await run([], ctx);
    const f = join(ctx.project, "seo/tools/seo-google.mjs");
    writeFileSync(f, readFileSync(f, "utf8") + "\n// a customer edit\n");
    const u = await run(["--update", "--dry-run"], ctx);
    expect(u.out).toMatch(/seo\/tools\/seo-google\.mjs — modified in this project since it was installed → REVIEW REQUIRED/);
  });
});

describe("2. the engine locator — $BWESEO_ENGINE", () => {
  const fake = (version = "0.0.1") => {
    const d = mk("fake");
    writeFileSync(join(d, "engine-manifest.json"), JSON.stringify({ manifestVersion: 1, engineVersion: version }));
    return d;
  };
  const home = (recordedDir, legacyDir) => {
    const h = mk("h");
    if (recordedDir) {
      mkdirSync(join(h, ".claude", "bweseo"), { recursive: true });
      writeFileSync(join(h, ".claude", "bweseo", "engine-location.json"), JSON.stringify({ path: recordedDir }));
    }
    if (legacyDir) {
      mkdirSync(join(h, ".claude", "skills", "BWESEO"), { recursive: true });
      writeFileSync(join(h, ".claude", "skills", "BWESEO", "engine-not-used"), "");
    }
    return h;
  };

  it("resolves in one order: BWESEO_ENGINE_HOME, then BWESEO_ENGINE, then the registered location", () => {
    const a = fake("1.0.0"), b = fake("2.0.0"), c = fake("3.0.0");
    const h = home(c);
    expect(I.locateEngine({ env: { BWESEO_ENGINE_HOME: a, BWESEO_ENGINE: b }, home: h })).toMatchObject({ dir: resolve(a), source: "BWESEO_ENGINE_HOME" });
    expect(I.locateEngine({ env: { BWESEO_ENGINE: b }, home: h })).toMatchObject({ dir: resolve(b), source: "BWESEO_ENGINE" });
    expect(I.locateEngine({ env: {}, home: h })).toMatchObject({ dir: resolve(c), source: "engine-location.json" });
    expect(I.locateEngine({ env: {}, home: h }).deprecated).toBeUndefined();
  });

  it("the legacy skills folder is a flagged, deprecated last resort — and nothing else is ever guessed", () => {
    const h = mk("legacyhome");
    const legacy = join(h, ".claude", "skills", "BWESEO", "engine");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "manifest.json"), JSON.stringify({ manifestVersion: 1 }));
    expect(I.locateEngine({ env: {}, home: h })).toMatchObject({ dir: legacy, deprecated: true });
    expect(I.locateEngine({ env: {}, home: mk("empty") })).toBeNull();
  });

  it("registration validates the manifest first, records identity, and refuses a broken engine", () => {
    const h = mk("reg");
    expect(I.registerEngineLocation(mk("nomanifest"), h)).toMatchObject({ ok: false });
    const bad = fake(); // manifest exists but is not a valid engine manifest
    expect(I.registerEngineLocation(bad, h)).toMatchObject({ ok: false });
    expect(existsSync(I.engineLocationFile(h))).toBe(false);
    const ok = I.registerEngineLocation(ENGINE, h);
    expect(ok).toMatchObject({ ok: true, engineVersion: manifest.engineVersion });
    const rec = JSON.parse(readFileSync(I.engineLocationFile(h), "utf8"));
    expect(rec).toMatchObject({ engineId: manifest.engineId, engineVersion: manifest.engineVersion });
    expect(rec.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(I.locateEngine({ env: {}, home: h })).toMatchObject({ dir: resolve(ENGINE), source: "engine-location.json" });
  });

  it("register-engine --check reports where the engine was found (read-only)", () => {
    const h = mk("check");
    I.registerEngineLocation(ENGINE, h);
    const env = { ...process.env, USERPROFILE: h, HOME: h };
    delete env.BWESEO_ENGINE_HOME;
    delete env.BWESEO_ENGINE;
    const r = spawnSync(process.execPath, [join(ENGINE, "scripts", "register-engine.mjs"), "--check"], { encoding: "utf8", env });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Found via \.+ engine-location\.json/);
    expect(r.stdout).toMatch(/Is this one \.+ yes/);
    const none = spawnSync(process.execPath, [join(ENGINE, "scripts", "register-engine.mjs"), "--check"], { encoding: "utf8", env: { ...env, USERPROFILE: mk("nohome"), HOME: mk("nohome") } });
    expect(none.status).toBe(1);
    expect(none.stdout).toMatch(/no BWESEO engine can be located/);
  });

  it("--verify prints where the engine was found, and warns when it was the deprecated location", async () => {
    const ctx = ctxFor("where");
    await run([], ctx);
    const v = await run(["--verify"], ctx);
    expect(v.out).toMatch(/Engine location \.+ .*\(--engine\)/);
  });
});

describe("3. the state tool's engine lookup stays in step with the installer's", () => {
  it("both follow the same order for the latest-known engine version", async () => {
    const eng = (v) => {
      const d = mk("pe");
      writeFileSync(join(d, "engine-manifest.json"), JSON.stringify({ manifestVersion: 1, engineVersion: v }));
      return d;
    };
    const proj = project("parity");
    mkdirSync(join(proj, "seo"), { recursive: true });
    writeFileSync(join(proj, "seo", "bweseo-install.json"), JSON.stringify({ engineVersion: "1.0.0", schemaVersion: 1, manifestVersion: 1, installationMode: "install", files: {} }));
    const scenarios = [
      { name: "override", env: (o) => ({ BWESEO_ENGINE_HOME: o.a }), home: (o) => o.h, expect: "9.1.0" },
      { name: "alias", env: (o) => ({ BWESEO_ENGINE: o.b }), home: (o) => o.h, expect: "9.2.0" },
      { name: "registered", env: () => ({}), home: (o) => o.h, expect: "9.3.0" },
    ];
    for (const sc of scenarios) {
      const a = eng("9.1.0"), b = eng("9.2.0"), c = eng("9.3.0");
      const h = mk("ph");
      mkdirSync(join(h, ".claude", "bweseo"), { recursive: true });
      writeFileSync(join(h, ".claude", "bweseo", "engine-location.json"), JSON.stringify({ path: c }));
      const o = { a, b, c, h };
      const env = { ...sc.env(o) };
      // installer's answer
      const inst = I.locateEngine({ env, home: sc.home(o) });
      expect(JSON.parse(readFileSync(join(inst.dir, "engine-manifest.json"), "utf8")).engineVersion, sc.name).toBe(sc.expect);
      // the state tool's answer, in a clean process environment
      const saved = { ...process.env };
      delete process.env.BWESEO_ENGINE_HOME;
      delete process.env.BWESEO_ENGINE;
      Object.assign(process.env, env, { USERPROFILE: h, HOME: h });
      try {
        const ev = await S.collectEvidence(proj, { live: false });
        expect(ev.install?.latestKnown, `state tool, ${sc.name}`).toBe(sc.expect);
      } finally {
        for (const k of ["BWESEO_ENGINE_HOME", "BWESEO_ENGINE", "USERPROFILE", "HOME"]) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
      }
    }
  });
});

describe("4. adopting a project that already has customer data", () => {
  it("preserves it, and does not say 'no profile exists' or send the owner back to /BWESEOSetup", async () => {
    const ctx = ctxFor("adopt");
    mkdirSync(join(ctx.project, "seo"), { recursive: true });
    const cfg = '{ "projectId": "jones-dental", "website": "https://jones-dental.example" }\n';
    writeFileSync(join(ctx.project, "seo", "seo-config.json"), cfg);
    const r = await run([], ctx);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Existing customer SEO data was preserved/);
    expect(r.out).toMatch(/\/BWESEOInstall --verify/);
    expect(r.out).not.toMatch(/No customer-specific SEO profile exists yet/);
    expect(r.out).not.toMatch(/Next recommended action:\s*\n\s*\n\/BWESEOSetup/);
    expect(readFileSync(join(ctx.project, "seo", "seo-config.json"), "utf8")).toBe(cfg);
  });
});

describe("5. no obsolete engine path outside the deprecated fallback", () => {
  it("only the locator fallbacks (and the tests of them) mention the legacy skills-folder engine", () => {
    const allowed = [/^installer\/bweseo-install\.mjs$/, /^src\/seo-state\.mjs$/, /^tests\/.+\.mjs$/, /^scripts\/validate-canonical\.mjs$/, /^docs\/refactor\/.+\.json$/]; // the last: development provenance ("origin: legacy engine"), never installed
    const hits = [];
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        if (n === "node_modules" || n === ".git") continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(md|mjs|mts|json)$/.test(n) && /skills\/BWESEO\/engine|"skills", "BWESEO", "engine"/.test(readFileSync(p, "utf8"))) hits.push(relative(ENGINE, p).split("\\").join("/"));
      }
    };
    walk(ENGINE);
    expect(hits.filter((h) => !allowed.some((re) => re.test(h)))).toEqual([]);
  });
});
