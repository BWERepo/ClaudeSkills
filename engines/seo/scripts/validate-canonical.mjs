#!/usr/bin/env node
// Canonical engine validation. Reports READY only when the engine is a clean, customer-neutral, verifiable
// package: the manifest is valid and every file's hash matches; no secret material is present; no registered
// project's identity (domains, names, analytics ids, contact details, Search Console property) is present; no
// customer-data file exists anywhere in the tree; every skill has a canonical source; the installer loads.
// Never prints a secret or an identity value — file and category only.
//
//   node scripts/validate-canonical.mjs [--run-tests] [--json]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  NEVER_PATTERNS,
  defaultRegistryPath,
  loadManifest,
  loadRegistry,
  matchesAny,
  scanPayload,
  validateManifest,
} from "../installer/bweseo-install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
const norm = (p) => p.split("\\").join("/");
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === ".git") continue;
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(norm(relative(root, p)));
  }
  return out;
};

// ---- manifest
let manifest = null;
try {
  manifest = loadManifest(root);
  const v = validateManifest(root, manifest);
  check("Manifest", v.errors.length === 0, v.errors.length ? `${v.errors.length} problem(s): ${v.errors.slice(0, 3).join("; ")}` : `valid — ${manifest.files.length} files, sha256 verified, no unclassified files`);
} catch (e) {
  check("Manifest", false, e.message);
}

// ---- versions: the engine's own, independent of any website
const readConst = (f, name) => new RegExp(`${name}\\s*=\\s*"?([\\w.]+)"?`).exec(readFileSync(join(root, f), "utf8"))?.[1];
const version = existsSync(join(root, "VERSION")) ? readFileSync(join(root, "VERSION"), "utf8").trim() : null;
const engineConst = readConst("src/validate-seo-data.mjs", "ENGINE_VERSION");
const stateConst = readConst("src/seo-state-core.mjs", "STATE_VERSION");
const schemaConst = readConst("src/validate-seo-data.mjs", "SCHEMA_VERSION");
check(
  "Versions",
  !!version && /^\d+\.\d+\.\d+$/.test(version) && version === engineConst && version === stateConst && version === manifest?.engineVersion && Number(schemaConst) === manifest?.schemaVersion,
  `engine ${version} (VERSION / manifest / validator / state agree: ${version === engineConst && version === stateConst && version === manifest?.engineVersion}) · schema ${schemaConst} · manifest ${manifest?.manifestVersion}`,
);

if (manifest) {
  // ---- secrets (registry-free) and project data (every registered identity on this machine)
  const clean = scanPayload(root, manifest, { projects: {} });
  check("Secret scan", clean.secrets.length === 0, clean.secrets.length ? clean.secrets.map((s) => `${s.file} (${s.type})`).join(", ") : "passed — no keys, tokens, verification values or env secrets in the payload");
  const registry = loadRegistry(defaultRegistryPath());
  const ids = Object.keys(registry.projects).length;
  const dirty = scanPayload(root, manifest, registry);
  check("Project-data scan", dirty.leaks.length === 0, dirty.leaks.length ? dirty.leaks.map((l) => `${l.file} (${l.type} of a registered project)`).join(", ") : `passed — checked against ${ids} registered project identit${ids === 1 ? "y" : "ies"}`);
  // ---- customer isolation (structural): no customer-data file anywhere in the tree
  const stray = walk(root).filter((f) => matchesAny(f, NEVER_PATTERNS) && !/^tests\//.test(f));
  check("Customer isolation", stray.length === 0, stray.length ? `customer-data / secret-shaped files present: ${stray.join(", ")}` : "passed — no profile, config, inventory, state, export or credential file in the package");
  // ---- skills
  const skillDirs = existsSync(join(root, "skills")) ? readdirSync(join(root, "skills")).filter((n) => statSync(join(root, "skills", n)).isDirectory()).sort() : [];
  const bad = [];
  for (const n of skillDirs) {
    const f = join(root, "skills", n, "SKILL.md");
    if (!existsSync(f)) {
      bad.push(`${n}: no SKILL.md`);
      continue;
    }
    const t = readFileSync(f, "utf8");
    const fm = /^---\r?\nname:\s*(.+)\r?\ndescription:\s*(.+)\r?\n---/.exec(t);
    if (!fm) bad.push(`${n}: bad frontmatter`);
    else if (fm[1].trim() !== n) bad.push(`${n}: name mismatch`);
    if (/\.claude\/skills\/BWESEO\/engine/.test(t)) bad.push(`${n}: references the legacy engine location`);
  }
  const missing = (manifest.requiredSkills ?? []).filter((n) => !skillDirs.includes(n));
  if (missing.length) bad.push(`required skills without a canonical source: ${missing.join(", ")}`);
  check("Skills", bad.length === 0 && skillDirs.length > 0, bad.length ? bad.join("; ") : `valid — ${skillDirs.length} canonical skill sources`);
}

// ---- installer
try {
  const I = await import(pathToFileURL(join(root, "installer", "bweseo-install.mjs")).href);
  const need = ["planInstall", "applyPlan", "verifyInstall", "planSkills", "applySkills", "buildManifest", "validateManifest", "locateEngine", "scanPayload", "registerProject"];
  const missing = need.filter((n) => typeof I[n] !== "function");
  const found = I.locateEngine({ env: { ...process.env, BWESEO_ENGINE_HOME: root }, home: "/nonexistent" });
  check("Installer", missing.length === 0 && resolve(found?.dir ?? "") === root, missing.length ? `missing exports: ${missing.join(", ")}` : `valid — v${I.INSTALLER_VERSION}, finds this engine via BWESEO_ENGINE_HOME`);
} catch (e) {
  check("Installer", false, e.message);
}

// ---- architecture rules that must stay in the engine: lifecycle vs live health, and the Google stages
try {
  const core = readFileSync(join(root, "src", "seo-state-core.mjs"), "utf8");
  const skill = readFileSync(join(root, "skills", "BWESEO", "SKILL.md"), "utf8");
  const health = ["liveHealth", "classifyProbe", "HEALTH_ESCALATE_AFTER", "investigate-health"].filter((t) => !core.includes(t));
  if (!/LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT/.test(skill)) health.push("the /BWESEO skill's independence rule");
  check("Lifecycle/health model", health.length === 0, health.length ? `missing: ${health.join(", ")}` : "present — lifecycle state and live site health are separate models; a failed probe is never a lifecycle change");
  const google = readFileSync(join(root, "src", "seo-google.mjs"), "utf8");
  const gMissing = ["indexingApiEligible", "discovered", "crawled", "indexed"].filter((t) => !(core + google).includes(t));
  check("Google state model", gMissing.length === 0, gMissing.length ? `missing: ${gMissing.join(", ")}` : "present — readiness, sitemap, Live URL Test, discovered, crawled and indexed are separate facts; Indexing API off for ordinary pages");
} catch (e) {
  check("Lifecycle/health model", false, e.message);
}

// ---- documentation: the master manual, its consistency with the actual skills, and the README
try {
  const { checkManual, checkConsistency, MANUAL_NAME } = await import(pathToFileURL(join(root, "scripts", "build-manual.mjs")).href);
  const consistency = checkConsistency(root);
  const all = checkManual(root);
  const manualProblems = all.filter((p) => !consistency.includes(p) && !/^README/.test(p));
  const readmeProblems = all.filter((p) => /^README/.test(p));
  check("Master manual", manualProblems.length === 0 && existsSync(join(root, MANUAL_NAME)), manualProblems.length ? manualProblems.join("; ") : `${MANUAL_NAME} present, current and generated from the actual skills`);
  check("Documentation/skill consistency", consistency.length === 0, consistency.length ? consistency.slice(0, 4).join("; ") : "every skill is documented, no nonexistent skill is documented, documented syntax matches the skills");
  check("README", readmeProblems.length === 0, readmeProblems.length ? readmeProblems.join("; ") : `present and links to ${MANUAL_NAME}`);
} catch (e) {
  check("Master manual", false, e.message);
}

// ---- the operating guide (docs/OPERATING-GUIDE.md) must match what a person can actually run, in both directions
try {
  const { checkGuide, GUIDE_PATH } = await import(pathToFileURL(join(root, "scripts", "show-guide.mjs")).href);
  const guideProblems = checkGuide(root);
  check("Operating guide", guideProblems.length === 0, guideProblems.length ? guideProblems.join("; ") : `${GUIDE_PATH} matches the engine's scripts, seo/tools commands, installer flags and skills`);
} catch (e) {
  check("Operating guide", false, e.message);
}

// ---- no hard-coded obsolete engine location: only the deprecated locator fallbacks (and their tests / provenance) may
// mention the legacy skills-folder engine. Skills, docs, the manual and the README use $BWESEO_ENGINE.
{
  const allowed = [/^installer\/bweseo-install\.mjs$/, /^src\/seo-state\.mjs$/, /^tests\/.+\.mjs$/, /^scripts\/validate-canonical\.mjs$/, /^docs\/refactor\/.+\.json$/];
  const offenders = walk(root).filter((f) => /\.(md|mjs|mts|json)$/.test(f) && /skills\/BWESEO\/engine|"skills", "BWESEO", "engine"/.test(readFileSync(join(root, f), "utf8")) && !allowed.some((re) => re.test(f)));
  check("Engine location", offenders.length === 0, offenders.length ? `obsolete engine path in: ${offenders.join(", ")}` : "no hard-coded obsolete engine path — engine located via $BWESEO_ENGINE (BWESEO_ENGINE_HOME / engine-location.json); the legacy folder is only a flagged fallback");
}

// ---- the disposable end-to-end installation test ships with the engine and is part of the hashed package
{
  const rel = "tests/installer/disposable.test.mjs";
  const listed = !!manifest?.files?.some((f) => f.path === rel);
  check("Disposable installation", existsSync(join(root, rel)) && listed, listed ? `${rel} is part of the package and runs with the engine tests (dry run → install → repeat install → verify → setup → /BWESEO, fictional data only)` : `${rel} is missing from the package`);
}

// ---- tests (optional: they take a minute)
if (argv.includes("--run-tests")) {
  const bin = join(root, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(bin)) check("Engine tests", false, "vitest is not installed here (run npm install, or link node_modules)");
  else {
    try {
      const out = execFileSync(process.execPath, [bin, "run", "--reporter=dot"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const m = /Tests\s+(\d+) passed/.exec(out);
      check("Engine tests", true, `passed — ${m?.[1] ?? "all"} tests`);
    } catch (e) {
      check("Engine tests", false, String(e.stdout ?? e.message).split("\n").filter((l) => /FAIL|failed|×/.test(l)).slice(0, 4).join(" | ") || "tests failed");
    }
  }
}

const ready = results.every((r) => r.ok);
if (argv.includes("--json")) console.log(JSON.stringify({ location: root, engineVersion: version, ready, results }, null, 2));
else {
  console.log("BWESEO CANONICAL ENGINE\n");
  console.log(`Location:        ${root}`);
  console.log(`Engine version:  ${version}`);
  console.log(`Schema version:  ${schemaConst}\n`);
  for (const r of results) console.log(`${r.name}: ${r.ok ? "✓" : "✗"} ${r.detail}`);
  if (!argv.includes("--run-tests")) console.log("Engine tests: (not run in this invocation — pass --run-tests)");
  console.log(`\nCanonical engine: ${ready ? "READY" : "NOT READY"}`);
}
process.exit(ready ? 0 : 1);
