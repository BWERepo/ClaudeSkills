#!/usr/bin/env node
// BWESEO installer — zero dependencies, Node 18+. Installs / updates / verifies the reusable BWESEO
// ENGINE in the CURRENT website project. It NEVER moves customer or business data.
//
//   CANONICAL ENGINE (read-only source, versioned by engine/manifest.json)
//        └──►  CUSTOMER PROJECT        (never the other way round)
//
// Design rules (each has a test):
//   • ALLOWLIST, default DENY. Only files the manifest explicitly classifies as ENGINE / TEMPLATE / TEST
//     (or OPTIONAL with --with-optional) are ever installed. A file in the engine directory that the
//     manifest does not list is an ERROR (unclassified), never a silent copy. There is no "copy the
//     folder and delete customer files afterwards" path.
//   • The payload is scanned BEFORE anything is written: for secrets (keys, tokens, verification
//     tokens, env values) and for project-identity leakage (the fingerprints of every project
//     registered on this machine — domains, names, analytics ids, contact details). Findings name the
//     file and the TYPE only, never the value. Any finding aborts the installation.
//   • The canonical engine is never modified. A tree hash is taken before and after every command.
//   • Existing target files are never overwritten unless they are byte-identical to what the receipt
//     says the engine installed (i.e. unmodified). Anything else is a CONFLICT: REVIEW REQUIRED.
//   • Customer data (profile, config, inventory, lifecycle/Search Console/analytics/health state,
//     reports, roadmap, research) is never read into the payload and never overwritten on update.
//   • No external actions: no network, no deploy, no commit, no push, no DNS/hosting/Google changes.
//
// Usage (from the customer project root; the engine is located as documented in the /BWESEOInstall skill):
//   node <engine>/installer/bweseo-install.mjs                 install (or adopt) the engine
//   node <engine>/installer/bweseo-install.mjs --dry-run       show exactly what would happen; change nothing
//   node <engine>/installer/bweseo-install.mjs --verify        report on the installation; change nothing
//   node <engine>/installer/bweseo-install.mjs --update        update the engine only; customer data preserved
//   node <engine>/installer/bweseo-install.mjs --sync-skills [--dry-run]   install / update the Claude skills from the canonical source
//   options: --project <dir>  --engine <dir>  --json  --with-tests  --with-optional  --allow-subdir
//   maintainer:  --register-project   record this project's identity fingerprints (for leakage checks)
//                --register-engine    record where the canonical engine lives on this machine
//                --build-manifest     regenerate engine-manifest.json (run against the canonical engine)
// Exit codes: 0 ok · 1 refused / verification problems · 2 completed but REVIEW REQUIRED · 3 usage error.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const INSTALLER_VERSION = "1.0.0";
// The canonical engine's manifest. (Older engine copies used "manifest.json"; both are read.)
export const MANIFEST_NAME = "engine-manifest.json";
export const LEGACY_MANIFEST_NAME = "manifest.json";
const MANIFEST_NAMES = [MANIFEST_NAME, LEGACY_MANIFEST_NAME];
export const manifestFile = (engineDir) => MANIFEST_NAMES.map((n) => join(engineDir, n)).find((f) => existsSync(f)) ?? null;
export const RECEIPT_PATH = "seo/bweseo-install.json";
export const CLASSES = ["ENGINE", "TEMPLATE", "OPTIONAL", "TEST"]; // may be installed (only when `install` names a target)
export const DEV_CLASSES = ["DEV"]; // canonical-engine development records: hashed and scanned, never installed
export const DENY_CLASSES = ["PROJECT-SPECIFIC", "GENERATED", "SECRET", "NEVER-COPY"]; // never installable
// Where an installed file may land in a customer project. Everything else is refused.
export const TARGET_ROOTS = ["seo/tools/", "seo/schema/", "docs/seo/"];
// Paths that are customer data or secrets by definition — never a valid install target and never valid payload.
export const NEVER_PATTERNS = [
  "seo/seo-config.json",
  "seo/business-profile.json",
  "seo/content-inventory.json",
  "seo/data/**",
  "seo/sources/**",
  "seo/.bweseo-backup/**",
  "seo/bweseo-install.json",
  "docs/seo/reports/**",
  "**/business-profile.json",
  "**/content-inventory.json",
  "**/seo-config.json",
  "**/live-health.json",
  "**/*.env",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*credentials*.json",
  "**/*service-account*.json",
  "**/registry.json",
  "**/engine-location.json",
  "**/skills-receipt.json",
  "**/node_modules/**",
  "**/.git/**",
];

const MANAGED_BEGIN = "<!-- BWESEO:BEGIN — managed by /BWESEOInstall; edit outside these markers -->";
const MANAGED_END = "<!-- BWESEO:END -->";
const GITIGNORE_RULES = ["seo/data/", "seo/sources/", "seo/.bweseo-backup/"];

// ================================================================ small utilities
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (p) => p.split(sep).join("/");
const isStr = (v) => typeof v === "string" && v.trim() !== "";
// A path in the form used to COMPARE two paths: resolved through the filesystem when it exists (which also fixes
// casing on Windows), and case-folded on Windows, where paths are case-insensitive.
export function foldPath(p) {
  let r;
  try {
    r = realpathSync.native(p);
  } catch {
    r = resolve(p);
  }
  return process.platform === "win32" ? r.toLowerCase() : r;
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}
export const matchesAny = (path, patterns) => patterns.some((g) => globToRegExp(g).test(norm(path)));

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(norm(relative(base, p)));
  }
  return out.sort();
}

// A hash over every file in a directory tree: taken before and after a command to prove the
// canonical engine was not modified.
export function treeHash(dir) {
  const h = createHash("sha256");
  for (const f of walk(dir)) h.update(f).update("\0").update(readFileSync(join(dir, f))).update("\0");
  return h.digest("hex");
}

// ================================================================ locating the canonical engine
// The canonical engine is a versioned directory containing engine-manifest.json (the standalone
// SEOEngine repository/folder). It is located, in order:
//   1. $BWESEO_ENGINE_HOME  (an explicit override — a checkout, a CI cache, another machine's path)
//   2. the path recorded in <home>/.claude/bweseo/engine-location.json  (written once per machine by
//      `node <engine>/scripts/register-engine.mjs`, so no path is hard-coded anywhere)
//   3. <home>/.claude/skills/BWESEO/engine  (DEPRECATED legacy location, kept only until migrated)
// Nothing else is guessed. If none holds a manifest, installation stops.
export function engineLocationFile(home = homedir()) {
  return join(home, ".claude", "bweseo", "engine-location.json");
}
export function locateEngine({ env = process.env, home = homedir() } = {}) {
  let recorded = null;
  try {
    recorded = JSON.parse(readFileSync(engineLocationFile(home), "utf8")).path ?? null;
  } catch {
    recorded = null;
  }
  // BWESEO_ENGINE_HOME is the variable; BWESEO_ENGINE is accepted as an alias so it matches the $BWESEO_ENGINE the
  // skills and docs use as their notation for "the resolved canonical engine directory".
  const override = env.BWESEO_ENGINE_HOME || env.BWESEO_ENGINE;
  const candidates = [
    override && { dir: resolve(override), source: env.BWESEO_ENGINE_HOME ? "BWESEO_ENGINE_HOME" : "BWESEO_ENGINE" },
    recorded && { dir: resolve(recorded), source: "engine-location.json" },
    { dir: join(home, ".claude", "skills", "BWESEO", "engine"), source: "legacy skills location (deprecated)", deprecated: true },
  ].filter(Boolean);
  for (const c of candidates) if (manifestFile(c.dir)) return c;
  return null;
}
// Records where this engine lives, but only after its manifest checks out — a broken or partial directory is never
// registered. The record holds a path plus identity for diagnostics; projects never store it.
export function registerEngineLocation(engineDir, home = homedir()) {
  if (!manifestFile(engineDir)) return { ok: false, reason: "that directory has no engine manifest" };
  let manifest;
  try {
    manifest = loadManifest(engineDir);
  } catch (e) {
    return { ok: false, reason: `the engine manifest cannot be read (${e.message})` };
  }
  const v = validateManifest(engineDir, manifest);
  if (v.errors.length) return { ok: false, reason: `the engine manifest failed validation (${v.errors.length} problem(s)) — rebuild it first: ${v.errors[0]}` };
  const f = engineLocationFile(home);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ path: resolve(engineDir).replace(/\\/g, "/"), engineId: manifest.engineId, engineVersion: manifest.engineVersion, registeredAt: new Date().toISOString() }, null, 2) + "\n");
  return { ok: true, engineVersion: manifest.engineVersion };
}

export function loadManifest(engineDir) {
  const f = manifestFile(engineDir);
  if (!f) throw new Error(`no ${MANIFEST_NAME} in the engine directory`);
  return JSON.parse(readFileSync(f, "utf8"));
}

// ================================================================ manifest validation (DENY by default)
export function validateManifest(engineDir, manifest) {
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== "object") return { errors: ["manifest is not an object"], warnings, unclassified: [] };
  if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1");
  if (!isStr(manifest.engineId)) errors.push("engineId is required");
  if (!/^(\d{4}\.\d{2}\.\d{2}\.\d{2}|\d+\.\d+\.\d+)$/.test(manifest.engineVersion ?? "")) errors.push("engineVersion must be yyyy.mm.dd.nn (date plus a two-digit daily sequence); the older x.y.z form is still read");
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) errors.push("schemaVersion must be an integer >= 1");
  if (!Array.isArray(manifest.files) || !manifest.files.length) errors.push("files must be a non-empty array");
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const listed = new Set();
  const targets = new Set();
  for (const f of files) {
    const at = `files[${f?.path}]`;
    if (!isStr(f?.path)) {
      errors.push("a manifest entry has no path");
      continue;
    }
    if (f.path.includes("..") || f.path.startsWith("/") || /^[A-Za-z]:/.test(f.path)) errors.push(`${at}: path escapes the engine directory`);
    if (listed.has(f.path)) errors.push(`${at}: listed twice`);
    listed.add(f.path);
    if (DENY_CLASSES.includes(f.class)) {
      errors.push(`${at}: class ${f.class} can never be part of the payload`);
      continue;
    }
    if (![...CLASSES, ...DEV_CLASSES].includes(f.class)) errors.push(`${at}: class must be one of ${[...CLASSES, ...DEV_CLASSES].join(", ")}`);
    if (DEV_CLASSES.includes(f.class) && f.install != null) errors.push(`${at}: a DEV file can never have an install target`);
    if (matchesAny(f.path, NEVER_PATTERNS)) errors.push(`${at}: matches a never-copy pattern (customer data or secret)`);
    if (f.install != null) {
      const inst = norm(String(f.install));
      if (inst.includes("..") || inst.startsWith("/") || /^[A-Za-z]:/.test(inst)) errors.push(`${at}: install target escapes the project`);
      else if (!TARGET_ROOTS.some((r) => inst.startsWith(r))) errors.push(`${at}: install target ${inst} is outside ${TARGET_ROOTS.join(", ")}`);
      else if (matchesAny(inst, NEVER_PATTERNS)) errors.push(`${at}: install target ${inst} is customer data / a secret path`);
      if (targets.has(inst)) errors.push(`${at}: install target ${inst} used twice`);
      targets.add(inst);
    }
    const abs = join(engineDir, f.path);
    if (!existsSync(abs)) {
      // DEV files (the engine's own CLAUDE.md, maintenance skills, workflows) are never installed, so a bundled copy of the engine
      // may omit them. Missing is fine; if one is present its hash must still match.
      if (!DEV_CLASSES.includes(f.class)) errors.push(`${at}: listed but missing from the engine`);
    } else if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? "")) errors.push(`${at}: sha256 missing`);
    else if (hashContent(readFileSync(abs)) !== f.sha256) errors.push(`${at}: content does not match its recorded hash (engine changed since the manifest was built)`);
  }
  // DENY by default: anything in the engine directory that the manifest does not list is unclassified.
  const unclassified = existsSync(engineDir)
    ? walk(engineDir).filter((p) => !MANIFEST_NAMES.includes(p) && !listed.has(p))
    : [];
  for (const u of unclassified) errors.push(`unclassified file: ${u} — every engine file must be explicitly classified (default is DENY)`);
  return { errors, warnings, unclassified };
}

// ================================================================ scanning (never prints values)
const CODE_EXT = /\.(mjs|cjs|js|ts|tsx|mts)$/i;
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bya29\.[\w.-]{20,}/, "Google access token"],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/, "signed token (JWT)"],
  [/"(private_key|client_secret|refresh_token|access_token|private_key_id)"\s*:\s*"[^"\s\[]{8,}/i, "credential field"],
  [/\bGOCSPX-[\w-]{10,}/, "OAuth client secret"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, "Slack token"],
  [/\b(ghp_|github_pat_)[0-9A-Za-z_]{20,}/, "GitHub token"],
  [/\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{16,}/, "payment-provider key"],
  [/[Aa]uthorization["']?\s*[:=]\s*["']?(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/, "authorization header"],
  [/google-site-verification[=:"'\s]+(content=)?["']?[A-Za-z0-9_-]{20,}/i, "Google verification token"],
  [/msvalidate\.01["'\s]*(content=)?["']?[0-9A-Fa-f]{16,}/i, "Bing verification token"],
  [/\b[A-Z][A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*["']?[^\s"'#$<{]{8,}/, "environment-variable value"],
];
// Looser patterns for data-like files only (code legitimately names variables "token", "secret"…).
const DATA_SECRET_PATTERNS = [
  [/["']?(api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{16,}["']/i, "secret-looking value"],
];
const PATH_PATTERNS = [
  [/[A-Za-z]:\\Users\\[^\\\s"']+\\/, "personal Windows path"],
  [/\/Users\/[^/\s"']+\//, "personal macOS path"],
  [/\/home\/[^/\s"']+\//, "personal Linux path"],
];

const isBinary = (buf) => buf.subarray(0, 4096).includes(0);
// The hash that identifies a file's CONTENT. Text is hashed with CRLF normalised to LF, so a copy that a Windows
// tool or checkout rewrote with CRLF is the same file, not a "modified" one (which would make every update report
// a conflict). Binary files are hashed as they are.
export const hashContent = (buf) => (isBinary(buf) ? sha256(buf) : sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"))));

// Scan one file's text. Returns finding TYPES only.
export function scanTextForSecrets(text, file = "") {
  const found = new Set();
  for (const [re, type] of SECRET_PATTERNS) if (re.test(text)) found.add(type);
  if (!CODE_EXT.test(file)) for (const [re, type] of DATA_SECRET_PATTERNS) if (re.test(text)) found.add(type);
  return [...found];
}
export function scanTextForPersonalPaths(text) {
  return PATH_PATTERNS.filter(([re]) => re.test(text)).map(([, t]) => t);
}

// ---------------------------------------------------------------- project identity registry
// Each project on this machine can register the fingerprints of its identity (domains, name,
// analytics ids, contact details). Before an engine is packaged or installed, the payload is checked
// against EVERY registered identity, so Customer A's data can never travel to Customer B — and the
// check is data-driven, not hard-coded to any one business.
export function defaultRegistryPath({ env = process.env, home = homedir() } = {}) {
  return env.BWESEO_REGISTRY ? resolve(env.BWESEO_REGISTRY) : join(home, ".claude", "bweseo", "registry.json");
}
export function loadRegistry(path) {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return j && typeof j === "object" && j.projects ? j : { version: 1, projects: {} };
  } catch {
    return { version: 1, projects: {} };
  }
}
const digits = (s) => String(s).replace(/\D/g, "");
const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9-]+\.)+[A-Z]{2,}/gi;
const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const ANALYTICS_ID = /\b(GTM-[A-Z0-9]{4,}|G-[A-Z0-9]{6,}|UA-\d{4,}-\d+|AW-\d{6,}|GT-[A-Z0-9]{5,})\b/g;

function collectStrings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}
const hostOf = (u) => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

// The identity fingerprints of a project, read from ITS OWN seo files (never printed).
export function fingerprintsForProject(projectDir) {
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(join(projectDir, f), "utf8"));
    } catch {
      return null;
    }
  };
  const config = read("seo/seo-config.json");
  const profile = read("seo/business-profile.json");
  const fp = [];
  const add = (kind, value) => {
    const v = String(value ?? "").trim();
    if (v.length >= 4 && !fp.some((x) => x.kind === kind && x.value.toLowerCase() === v.toLowerCase())) fp.push({ kind, value: v });
  };
  if (config) {
    add("project-id", config.projectId);
    add("domain", hostOf(config.website ?? ""));
    const env = config.environments ?? {};
    for (const side of [env.production, env.staging]) {
      if (typeof side === "string") add("domain", hostOf(side));
      else if (side) {
        add("domain", hostOf(side.url ?? ""));
        for (const h of side.hosts ?? []) add("domain", hostOf(h));
      }
    }
    for (const h of config.publication?.stagingHosts ?? []) add("domain", hostOf(h));
    add("domain", hostOf(config.publication?.sitemapUrl ?? ""));
    const sc = config.analytics?.searchConsole ?? {};
    add("search-console-property", String(sc.verifiedProperty ?? "").replace(/^sc-domain:/, ""));
    for (const s of collectStrings(config.analytics ?? {})) for (const m of s.matchAll(ANALYTICS_ID)) add("analytics-id", m[0]);
  }
  if (profile) {
    add("business-name", profile.identity?.businessName?.value);
    for (const s of collectStrings(profile)) {
      for (const m of s.matchAll(EMAIL)) add("email", m[0]);
      for (const m of s.matchAll(PHONE)) add("phone", m[0]);
    }
    add("domain", hostOf(profile.identity?.website?.value ?? ""));
  }
  return { projectId: config?.projectId ?? null, fingerprints: fp };
}

export function registerProject(projectDir, registryPath) {
  const { projectId, fingerprints } = fingerprintsForProject(projectDir);
  if (!projectId || !fingerprints.length) return { ok: false, reason: "the project has no seo/seo-config.json identity to register yet" };
  const reg = loadRegistry(registryPath);
  reg.projects[projectId] = { registeredAt: new Date().toISOString().slice(0, 10), fingerprints };
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(reg, null, 2) + "\n");
  // Also pin the project id in the receipt, so an update can tell it is the same project.
  const rp = join(projectDir, RECEIPT_PATH);
  if (existsSync(rp)) {
    const r = JSON.parse(readFileSync(rp, "utf8"));
    if (r.projectId !== projectId) {
      r.projectId = projectId;
      writeFileSync(rp, JSON.stringify(r, null, 2) + "\n");
    }
  }
  return { ok: true, projectId, count: fingerprints.length };
}

function allowedTerms(engineDir) {
  // config/ is the canonical location; tools/ is the pre-refactor location, still read so an older engine works.
  for (const rel of ["config/isolation-allowlist.json", "tools/isolation-allowlist.json"]) {
    try {
      const j = JSON.parse(readFileSync(join(engineDir, rel), "utf8"));
      return (j.allowedTerms ?? []).map((t) => String(t).toLowerCase());
    } catch {
      /* try the next location */
    }
  }
  return [];
}

// Scan the installable payload (only manifest-listed files) for secrets and identity leakage.
export function scanPayload(engineDir, manifest, registry) {
  const secrets = [];
  const leaks = [];
  const paths = [];
  const allow = new Set(allowedTerms(engineDir));
  const prints = [];
  for (const [label, p] of Object.entries(registry?.projects ?? {}))
    for (const f of p.fingerprints ?? []) if (!allow.has(String(f.value).toLowerCase())) prints.push({ label, ...f });
  for (const f of manifest.files ?? []) {
    const abs = join(engineDir, f.path);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (isBinary(buf)) continue;
    const text = buf.toString("utf8");
    for (const type of scanTextForSecrets(text, f.path)) secrets.push({ file: f.path, type });
    for (const type of scanTextForPersonalPaths(text)) paths.push({ file: f.path, type });
    const lower = text.toLowerCase();
    const dig = digits(text);
    for (const p of prints) {
      const v = p.value.toLowerCase();
      const hit = p.kind === "phone" ? digits(v).length >= 10 && dig.includes(digits(v)) : lower.includes(v);
      if (hit) leaks.push({ file: f.path, project: p.label, type: p.kind });
    }
  }
  return { secrets, leaks, paths };
}

// ================================================================ project detection
const git = (dir, ...args) => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

export function detectProject(dir, engineDir = null) {
  const info = {
    dir,
    exists: existsSync(dir) && statSync(dir).isDirectory(),
    gitRoot: null,
    gitClean: null,
    gitDirty: 0,
    framework: "unknown",
    adapter: null,
    hosting: [],
    claudeMd: null,
    existing: { config: false, profile: false, inventory: false, receipt: false, tools: [], sitemap: [], robots: [], docs: false },
  };
  if (!info.exists) return info;
  const has = (f) => existsSync(join(dir, f));
  const root = git(dir, "rev-parse", "--show-toplevel");
  if (root) {
    info.gitRoot = resolve(root);
    const st = git(dir, "status", "--porcelain");
    info.gitClean = st === "";
    info.gitDirty = st ? st.split("\n").length : 0;
  }
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    pkg = null;
  }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const anyDep = (...names) => names.some((n) => Object.keys(deps).some((d) => d === n || d.startsWith(n)));
  if (anyDep("next")) info.framework = "nextjs";
  else if (anyDep("astro")) info.framework = "astro";
  else if (anyDep("@tanstack/react-start", "@tanstack/start")) info.framework = "tanstack-start";
  else if (anyDep("react-router", "react-router-dom")) info.framework = "react-router-spa";
  else if (anyDep("vite") && has("index.html")) info.framework = "vite-spa-index-html";
  else if (has("wp-config.php") || has("wp-content")) info.framework = "wordpress";
  else if (has("composer.json") || readdirSync(dir).some((f) => f.endsWith(".php"))) info.framework = "php";
  else if (!pkg && has("index.html")) info.framework = "static-html";
  // an adapter is only "installed" if the engine really ships one — never fabricated
  if (engineDir && existsSync(join(engineDir, "adapters", `${info.framework}.md`))) info.adapter = info.framework;
  if (has("wrangler.toml") || has("wrangler.json") || has("wrangler.jsonc")) info.hosting.push("cloudflare-workers");
  if (has("vercel.json")) info.hosting.push("vercel");
  if (has("netlify.toml")) info.hosting.push("netlify");
  if (has(".htaccess")) info.hosting.push("apache/shared-hosting");
  const claude = readdirSync(dir).find((f) => f.toLowerCase() === "claude.md");
  info.claudeMd = claude ?? null;
  const ex = info.existing;
  ex.config = has("seo/seo-config.json");
  ex.profile = has("seo/business-profile.json");
  ex.inventory = has("seo/content-inventory.json");
  ex.receipt = has(RECEIPT_PATH);
  ex.docs = has("docs/seo");
  if (has("seo/tools")) ex.tools = readdirSync(join(dir, "seo", "tools")).filter((f) => /\.(mjs|mts)$/.test(f));
  const look = (base, re, depth = 3) => {
    const out = [];
    const rec = (d, n) => {
      if (n > depth || !existsSync(d)) return;
      for (const name of readdirSync(d)) {
        if (name === "node_modules" || name === ".git" || name === ".output" || name === "dist") continue;
        const p = join(d, name);
        if (statSync(p).isDirectory()) rec(p, n + 1);
        else if (re.test(name)) out.push(norm(relative(dir, p)));
      }
    };
    rec(base, 0);
    return out;
  };
  ex.sitemap = look(dir, /sitemap.*\.(xml|ts|js|mjs|tsx|php)$/i);
  ex.robots = look(dir, /^robots.*\.(txt|ts|js|mjs|tsx|php)$/i);
  return info;
}

// ================================================================ planning
function readReceipt(projectDir) {
  try {
    return JSON.parse(readFileSync(join(projectDir, RECEIPT_PATH), "utf8"));
  } catch {
    return null;
  }
}

function managedSection(manifest) {
  return [
    MANAGED_BEGIN,
    "# BWESEO",
    "",
    `This project uses the BWESEO engine (v${manifest.engineVersion}, schema ${manifest.schemaVersion}).`,
    "",
    "- Run `/BWESEO` — it reads this project's SEO state and says the one next step. You do not need to remember other commands.",
    "- New project: `/BWESEOInstall` (engine) → `/BWESEOSetup` (this customer's profile) → `/BWESEO`.",
    "- The engine (`seo/tools/`, `seo/schema/`) is managed by `/BWESEOInstall --update`; do not edit it here. Customer data (`seo/*.json`, `docs/seo/`) is this project's own and is never overwritten by an update.",
    "- Never put credentials or verification tokens in this repository. Search Console API credentials are referenced by NAME only (`credentialsSource`).",
    "- Nothing is published, deployed, submitted to Google or committed without the owner's explicit approval.",
    MANAGED_END,
    "",
  ].join("\n");
}

export function planInstall({
  engineDir,
  projectDir,
  mode = "install",
  registryPath = defaultRegistryPath(),
  migrations = [],
  withOptional = false,
  allowSubdir = false,
  now = () => new Date(),
} = {}) {
  const plan = {
    mode,
    ok: false,
    engine: null,
    target: { dir: projectDir },
    create: [],
    update: [],
    preserve: [],
    exclude: [],
    conflicts: [],
    migrations: [],
    gitignore: { file: ".gitignore", add: [] },
    claudeMd: { action: "none", file: null },
    receipt: null,
    warnings: [],
    failures: [],
    notes: [],
  };
  const fail = (gate, reason, action) => plan.failures.push({ gate, reason, action });

  // ---- gate: the target
  const target = detectProject(projectDir, engineDir);
  plan.target = { dir: projectDir, framework: target.framework, adapter: target.adapter, hosting: target.hosting, gitRoot: target.gitRoot, gitClean: target.gitClean, existing: target.existing };
  // Compared as the filesystem sees them: Windows paths are case-insensitive (git may report `Websites` where the
  // shell says `websites`), so a casing difference must never make a project look like a subfolder of itself.
  const engAbs = foldPath(engineDir ?? "");
  const tgtAbs = foldPath(projectDir ?? "");
  if (!target.exists) fail("target", `the target project directory does not exist: ${projectDir}`, "open the customer's website project in Claude Code and run the installer there");
  else if (tgtAbs === engAbs || tgtAbs.startsWith(engAbs + sep) || engAbs.startsWith(tgtAbs + sep))
    fail("target", "the target is (or contains, or is inside) the canonical BWESEO engine", "run the installer from the customer's website project, never from the engine directory");
  else if (target.gitRoot && foldPath(target.gitRoot) !== tgtAbs && !allowSubdir)
    fail("target", `the target is inside a larger repository (${basename(target.gitRoot)}) — the install location is ambiguous`, "run from the repository root, or pass --allow-subdir if this subfolder really is the website project");
  if (target.exists && target.gitRoot && target.gitClean === false)
    plan.warnings.push(`the repository has ${target.gitDirty} uncommitted change(s) — commit or back up existing work first`);
  if (target.exists && !target.gitRoot) plan.warnings.push("the target is not a git repository — there is no automatic backup of existing work");

  // ---- gate: the canonical engine
  let manifest = null;
  if (!engineDir || !manifestFile(engineDir)) {
    fail("engine", "the canonical BWESEO engine cannot be located or has no manifest", "set BWESEO_ENGINE_HOME to the engine directory, or restore $BWESEO_ENGINE");
  } else {
    try {
      manifest = loadManifest(engineDir);
    } catch (e) {
      fail("engine", `the engine manifest cannot be read (${e.message})`, "restore the engine from its source");
    }
  }
  if (manifest) {
    plan.engine = { id: manifest.engineId, version: manifest.engineVersion, schemaVersion: manifest.schemaVersion, manifestVersion: manifest.manifestVersion };
    const v = validateManifest(engineDir, manifest);
    if (v.errors.length) fail("manifest", `manifest validation failed (${v.errors.length} problem(s)): ${v.errors.slice(0, 4).join("; ")}${v.errors.length > 4 ? "; …" : ""}`, "rebuild the engine manifest in the canonical engine (--build-manifest) after classifying every file; do not install from a failing manifest");
    // ---- gates: secrets and identity leakage in the payload
    if (!v.errors.length) {
      const registry = loadRegistry(registryPath);
      const scan = scanPayload(engineDir, manifest, registry);
      if (scan.secrets.length)
        fail("secrets", `installation stopped because the reusable engine payload contains possible secret material: ${scan.secrets.map((s) => `${s.file} (${s.type})`).join(", ")}`, "remove the secret from the engine source and rebuild the manifest; rotate it if it was ever real");
      if (scan.leaks.length)
        fail("project-data", `installation stopped because the reusable engine payload contains possible project-specific information: ${scan.leaks.map((l) => `${l.file} (${l.type} of a registered project)`).join(", ")}`, "make the engine file generic (placeholders / configuration) and rebuild the manifest");
      if (scan.paths.length) plan.warnings.push(`personal filesystem paths in the payload: ${scan.paths.map((p) => `${p.file} (${p.type})`).join(", ")}`);
      plan.notes.push(`secret scan and project-isolation scan ran over ${manifest.files.length} manifest file(s) against ${Object.keys(registry.projects).length} registered project identit${Object.keys(registry.projects).length === 1 ? "y" : "ies"}`);
    }
  }

  // ---- gate: update mode, identity and compatibility
  const receipt = readReceipt(projectDir);
  if (mode === "update") {
    if (!receipt) fail("update", "this project has no BWESEO installation receipt — it was not installed by /BWESEOInstall", "run /BWESEOInstall (it adopts identical files and never overwrites different ones)");
    else {
      let cfg = null;
      try {
        cfg = JSON.parse(readFileSync(join(projectDir, "seo/seo-config.json"), "utf8"));
      } catch {
        cfg = null;
      }
      if (receipt.projectId && cfg?.projectId && receipt.projectId !== cfg.projectId)
        fail("identity", "the project identity is unclear: seo/seo-config.json names a different project than the installation receipt", "confirm this is the right repository; do not update across projects");
      if (receipt.projectId && !cfg && target.existing.config === false) plan.warnings.push("the receipt names a project but seo/seo-config.json is missing");
    }
  }
  if (receipt && manifest) {
    if (Number.isInteger(receipt.schemaVersion) && receipt.schemaVersion > manifest.schemaVersion)
      fail("compatibility", `the project uses schema ${receipt.schemaVersion}, newer than this engine (${manifest.schemaVersion})`, "update the canonical engine; never downgrade a project");
    const major = (v) => Number(String(v ?? "0").split(".")[0]);
    if (major(receipt.engineVersion) > major(manifest.engineVersion))
      fail("compatibility", `the project's engine (${receipt.engineVersion}) is newer than the canonical engine (${manifest.engineVersion})`, "update the canonical engine first");
  }

  if (plan.failures.length || !manifest) return plan;

  // ---- file actions (allowlist only)
  const recFiles = receipt?.files ?? {};
  for (const f of manifest.files) {
    if (!CLASSES.includes(f.class)) continue;
    if (f.class === "OPTIONAL" && !withOptional) {
      plan.exclude.push({ path: f.path, reason: "optional (not requested)" });
      continue;
    }
    if (f.install == null) {
      plan.exclude.push({ path: f.path, reason: "canonical reference only — stays in the engine" });
      continue;
    }
    const abs = join(projectDir, f.install);
    if (!existsSync(abs)) {
      plan.create.push({ path: f.install, from: f.path, class: f.class, sha256: f.sha256 });
      continue;
    }
    const cur = hashContent(readFileSync(abs));
    if (cur === f.sha256) plan.preserve.push({ path: f.install, reason: "already identical to the engine", adopt: true, sha256: f.sha256, class: f.class });
    else if (f.class === "TEMPLATE") plan.preserve.push({ path: f.install, reason: "template — an existing file is never overwritten", class: f.class });
    else if (mode === "update" && recFiles[f.install]?.sha256 === cur)
      plan.update.push({ path: f.install, from: f.path, class: f.class, sha256: f.sha256, resolution: "SAFE AUTO-MERGE" });
    else
      plan.conflicts.push({
        path: f.install,
        reason: mode === "update" ? "modified in this project since it was installed" : "an existing file differs from the engine version (unmanaged or customized)",
        resolution: "REVIEW REQUIRED",
      });
  }
  // directories
  for (const d of ["seo", "seo/data", "docs/seo"]) if (!existsSync(join(projectDir, d))) plan.create.push({ path: `${d}/`, dir: true });
  // project-specific data is never created by the installer
  plan.preserve.push(
    ...["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json", "seo/data/", "docs/seo/reports/"]
      .filter((p) => existsSync(join(projectDir, p)))
      .map((p) => ({ path: p, reason: "customer data — never touched by the installer" })),
  );
  // .gitignore
  const gi = join(projectDir, ".gitignore");
  const giText = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const have = new Set(giText.split(/\r?\n/).map((l) => l.trim()));
  plan.gitignore.add = GITIGNORE_RULES.filter((r) => !have.has(r) && !have.has(r.replace(/\/$/, "")));
  if (!target.gitRoot && !existsSync(gi)) plan.gitignore.add = [];
  // CLAUDE.md
  const section = managedSection(manifest);
  const cm = target.claudeMd ? join(projectDir, target.claudeMd) : null;
  plan.claudeMd.file = target.claudeMd ?? "CLAUDE.md";
  if (!cm) plan.claudeMd.action = "create";
  else {
    const t = readFileSync(cm, "utf8");
    const b = t.indexOf("<!-- BWESEO:BEGIN");
    const e = t.indexOf(MANAGED_END);
    if (b === -1) plan.claudeMd.action = "append";
    else if (e > b && t.slice(b, e + MANAGED_END.length).trim() === section.trim()) plan.claudeMd.action = "none";
    else plan.claudeMd.action = "update-managed-section";
  }
  // migrations
  const from = receipt?.schemaVersion ?? manifest.schemaVersion;
  plan.migrations = migrations.filter((m) => m.from >= from && m.to <= manifest.schemaVersion).sort((a, b) => a.from - b.from).map((m) => ({ from: m.from, to: m.to, description: m.description }));
  // adapter
  if (!target.adapter) plan.warnings.push("Website adapter requires configuration — no reusable adapter matches this project's framework; the core engine is installed without one");
  if (target.existing.sitemap.length) plan.notes.push(`existing sitemap implementation preserved: ${target.existing.sitemap.slice(0, 3).join(", ")}`);
  if (target.existing.robots.length) plan.notes.push(`existing robots implementation preserved: ${target.existing.robots.slice(0, 3).join(", ")}`);
  if (mode === "install" && target.existing.tools.length && !receipt) plan.notes.push("existing SEO tooling found in seo/tools — identical files are adopted, different ones are reported as conflicts and left alone");
  // A plain install over an existing installation is recognised, not repeated blindly: it is idempotent (identical
  // files are adopted, different ones are conflicts) and it says so.
  if (mode === "install" && receipt) {
    const older = String(receipt.engineVersion) !== String(manifest.engineVersion);
    plan.alreadyInstalled = { engineVersion: receipt.engineVersion, installedAt: receipt.installedAt ?? null, updatedAt: receipt.updatedAt ?? null, canonicalVersion: manifest.engineVersion, updateAvailable: older };
    plan.notes.push(`BWESEO is already installed here (engine ${receipt.engineVersion}${receipt.installedAt ? `, installed ${String(receipt.installedAt).slice(0, 10)}` : ""})${older ? ` — the canonical engine is ${manifest.engineVersion}; run /BWESEOInstall --dry-run --update` : " — nothing needs installing"}`);
  }
  plan.receipt = {
    engineId: manifest.engineId,
    engineVersion: manifest.engineVersion,
    schemaVersion: manifest.schemaVersion,
    manifestVersion: manifest.manifestVersion,
    installedAt: receipt?.installedAt ?? now().toISOString(),
    updatedAt: now().toISOString(),
    installationMode: mode,
    adapter: target.adapter,
    ...(receipt?.projectId ? { projectId: receipt.projectId } : {}),
  };
  plan.ok = true;
  return plan;
}

// ================================================================ applying
function backupFiles(projectDir, rels, stamp) {
  const dir = join(projectDir, "seo", ".bweseo-backup", stamp);
  mkdirSync(dir, { recursive: true });
  const kept = [];
  for (const rel of rels) {
    const src = join(projectDir, rel);
    if (!existsSync(src) || statSync(src).isDirectory()) continue;
    const dst = join(dir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    kept.push(rel);
  }
  return { dir, kept };
}
function restoreBackup(projectDir, backup) {
  for (const rel of backup.kept) copyFileSync(join(backup.dir, rel), join(projectDir, rel));
}

export async function applyPlan(plan, { engineDir, projectDir, migrations = [], now = () => new Date() } = {}) {
  if (plan.failures.length) throw new Error("refusing to apply a plan that has safety failures");
  const before = treeHash(engineDir);
  const written = [];
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const mustBackup = plan.mode === "update" || plan.migrations.length > 0;
  const stateFiles = ["seo/seo-config.json", "seo/business-profile.json", "seo/content-inventory.json", RECEIPT_PATH];
  const backup = mustBackup
    ? backupFiles(projectDir, [...stateFiles, ...plan.update.map((u) => u.path)], stamp)
    : null;
  const manifest = loadManifest(engineDir);
  const bySrc = new Map(manifest.files.map((f) => [f.path, f]));
  try {
    for (const c of plan.create) {
      if (c.dir) {
        mkdirSync(join(projectDir, c.path), { recursive: true });
        continue;
      }
      const f = bySrc.get(c.from);
      const buf = readFileSync(join(engineDir, c.from));
      if (hashContent(buf) !== f.sha256) throw new Error(`integrity failure while reading ${c.from}`);
      mkdirSync(dirname(join(projectDir, c.path)), { recursive: true });
      writeFileSync(join(projectDir, c.path), buf);
      written.push(c.path);
    }
    for (const u of plan.update) {
      const f = bySrc.get(u.from);
      const buf = readFileSync(join(engineDir, u.from));
      if (hashContent(buf) !== f.sha256) throw new Error(`integrity failure while reading ${u.from}`);
      writeFileSync(join(projectDir, u.path), buf);
      written.push(u.path);
    }
    // migrations: customer data is migrated, never regenerated; validated, and rolled back on failure
    for (const m of migrations.filter((x) => plan.migrations.some((p) => p.from === x.from && p.to === x.to))) {
      await m.migrate(projectDir);
      if (typeof m.validate === "function") {
        const res = await m.validate(projectDir);
        if (res !== true && !(res && res.ok)) throw new Error(`migration ${m.from}→${m.to} failed validation`);
      }
    }
    // .gitignore
    if (plan.gitignore.add.length) {
      const gi = join(projectDir, ".gitignore");
      const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
      const nl = cur && !cur.endsWith("\n") ? "\n" : "";
      writeFileSync(gi, `${cur}${nl}${cur ? "\n" : ""}# BWESEO: runtime / private data (never committed)\n${plan.gitignore.add.join("\n")}\n`);
      written.push(".gitignore");
    }
    // CLAUDE.md — only the BWESEO-managed section
    if (plan.claudeMd.action !== "none") {
      const file = join(projectDir, plan.claudeMd.file);
      const section = managedSection(manifest);
      if (plan.claudeMd.action === "create") writeFileSync(file, section);
      else {
        const t = readFileSync(file, "utf8");
        if (plan.claudeMd.action === "append") writeFileSync(file, `${t}${t.endsWith("\n") ? "" : "\n"}\n${section}`);
        else {
          const b = t.indexOf("<!-- BWESEO:BEGIN");
          const e = t.indexOf(MANAGED_END) + MANAGED_END.length;
          writeFileSync(file, `${t.slice(0, b)}${section.trimEnd()}${t.slice(e)}`);
        }
      }
      written.push(plan.claudeMd.file);
    }
    // receipt: metadata and file hashes only — no secrets, no customer data
    const prev = readReceipt(projectDir);
    const files = { ...(prev?.files ?? {}) };
    for (const c of plan.create.filter((x) => !x.dir)) files[c.path] = { sha256: c.sha256, class: c.class };
    for (const u of plan.update) files[u.path] = { sha256: u.sha256, class: u.class };
    for (const p of plan.preserve.filter((x) => x.adopt)) files[p.path] = { sha256: p.sha256, class: p.class };
    mkdirSync(join(projectDir, "seo"), { recursive: true });
    writeFileSync(join(projectDir, RECEIPT_PATH), JSON.stringify({ ...plan.receipt, files }, null, 2) + "\n");
    written.push(RECEIPT_PATH);
  } catch (e) {
    if (backup) restoreBackup(projectDir, backup);
    // remove what a failed install created (files that did not exist before)
    for (const c of plan.create.filter((x) => !x.dir)) if (written.includes(c.path)) rmSync(join(projectDir, c.path), { force: true });
    return { ok: false, rolledBack: !!backup, error: String(e?.message ?? e), written: [] };
  }
  if (treeHash(engineDir) !== before) throw new Error("the canonical engine was modified during installation — this must never happen");
  return { ok: true, written, backup: backup ? norm(relative(projectDir, backup.dir)) : null };
}

// ================================================================ verify (read-only)
export function verifyInstall({ projectDir, engineDir = null, registryPath = defaultRegistryPath(), skillsDir = null, env = process.env, home = homedir() } = {}) {
  const r = {
    installed: false,
    engineVersion: null,
    schemaVersion: null,
    manifestVersion: null,
    adapter: null,
    requiredSkills: { present: [], missing: [], checked: false },
    engineFiles: { expected: 0, present: 0, missing: [], modified: [] },
    configuration: "missing",
    profile: "missing",
    manifestIntegrity: "not checked",
    secretCheck: "not run",
    leakageCheck: "not run",
    state: { ran: false, errors: [], warnings: [] },
    documentation: null,
    updateAvailable: "unknown",
    problems: [],
    next: null,
  };
  const receipt = readReceipt(projectDir);
  const has = (f) => existsSync(join(projectDir, f));
  r.configuration = has("seo/seo-config.json") ? "present" : "missing";
  r.profile = has("seo/business-profile.json") ? "present" : "missing";
  if (!receipt) {
    r.next = has("seo/seo-config.json") && has("seo/tools/seo-state-core.mjs") ? "/BWESEOInstall (adopt: this project has SEO tooling but no installation receipt)" : "/BWESEOInstall";
    r.problems.push("BWESEO is not installed (no installation receipt)");
    return r;
  }
  r.installed = true;
  r.engineVersion = receipt.engineVersion;
  r.schemaVersion = receipt.schemaVersion;
  r.manifestVersion = receipt.manifestVersion;
  r.adapter = receipt.adapter ?? null;
  // engine files vs the receipt
  const files = Object.entries(receipt.files ?? {});
  r.engineFiles.expected = files.length;
  for (const [p, meta] of files) {
    const abs = join(projectDir, p);
    if (!existsSync(abs)) r.engineFiles.missing.push(p);
    else {
      r.engineFiles.present++;
      if (hashContent(readFileSync(abs)) !== meta.sha256) r.engineFiles.modified.push(p);
    }
  }
  if (r.engineFiles.missing.length) r.problems.push(`${r.engineFiles.missing.length} engine file(s) missing`);
  if (r.engineFiles.modified.length) r.problems.push(`${r.engineFiles.modified.length} engine file(s) modified since installation`);
  // required skills
  const canon = engineDir ?? locateEngine({ env, home })?.dir ?? null;
  let manifest = null;
  if (canon) {
    try {
      manifest = loadManifest(canon);
    } catch {
      manifest = null;
    }
  }
  const sdir = skillsDir ?? env.BWESEO_SKILLS_DIR ?? join(home, ".claude", "skills");
  if (manifest?.requiredSkills) {
    r.requiredSkills.checked = true;
    r.requiredSkills.drift = [];
    for (const s of manifest.requiredSkills) {
      const inst = join(sdir, s, "SKILL.md");
      (existsSync(inst) ? r.requiredSkills.present : r.requiredSkills.missing).push(s);
      const src = manifest.files.find((x) => x.path === `skills/${s}/SKILL.md`);
      if (existsSync(inst) && src && hashContent(readFileSync(inst)) !== src.sha256) r.requiredSkills.drift.push(s);
    }
    if (r.requiredSkills.missing.length) r.problems.push(`required skill(s) missing: ${r.requiredSkills.missing.join(", ")}`);
  }
  // canonical manifest integrity + update availability
  if (manifest) {
    const v = validateManifest(canon, manifest);
    r.manifestIntegrity = v.errors.length ? `FAILED (${v.errors.length} problem(s))` : "ok";
    if (v.errors.length) r.problems.push("the canonical engine manifest failed validation");
    const cmp = (a, b) => {
      const x = a.split(".").map(Number);
      const y = b.split(".").map(Number);
      for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    };
    r.updateAvailable = cmp(manifest.engineVersion, receipt.engineVersion) > 0 ? `yes — ${receipt.engineVersion} → ${manifest.engineVersion}` : "no";
  }
  // secret + project-leakage checks over the INSTALLED engine files
  const sec = [];
  const leaks = [];
  const registry = loadRegistry(registryPath);
  const allow = new Set(canon ? allowedTerms(canon) : []);
  const prints = [];
  for (const [label, p] of Object.entries(registry.projects))
    if (!receipt.projectId || label !== receipt.projectId)
      for (const f of p.fingerprints ?? []) if (!allow.has(String(f.value).toLowerCase())) prints.push({ label, ...f });
  for (const [p] of files) {
    const abs = join(projectDir, p);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (isBinary(buf)) continue;
    const text = buf.toString("utf8");
    for (const type of scanTextForSecrets(text, p)) sec.push({ file: p, type });
    const lower = text.toLowerCase();
    for (const f of prints) if (lower.includes(f.value.toLowerCase())) leaks.push({ file: p, type: f.kind, project: f.label });
  }
  r.secretCheck = sec.length ? `FAILED: ${sec.map((s) => `${s.file} (${s.type})`).join(", ")}` : "passed";
  r.leakageCheck = leaks.length ? `FAILED: ${leaks.map((l) => `${l.file} (${l.type} of another project)`).join(", ")}` : `passed (${Object.keys(registry.projects).length} registered identit${Object.keys(registry.projects).length === 1 ? "y" : "ies"} checked)`;
  if (sec.length) r.problems.push("possible secret material in installed engine files");
  if (leaks.length) r.problems.push("another project's identity found in installed engine files");
  // documentation version: the managed CLAUDE.md section
  const cm = readdirSync(projectDir).find((f) => f.toLowerCase() === "claude.md");
  if (cm) {
    const t = readFileSync(join(projectDir, cm), "utf8");
    const m = /BWESEO engine \(v(\d+\.\d+\.\d+), schema (\d+)\)/.exec(t);
    r.documentation = m ? `CLAUDE.md section v${m[1]}` : "no BWESEO section in CLAUDE.md";
  } else r.documentation = "no CLAUDE.md";
  // state validity (read-only): the project's own validator, when it has a configuration
  if (r.configuration === "present" && has("seo/tools/validate-seo-data.mjs")) {
    r.state.ran = true;
    r.state.pending = "run `node seo/tools/validate-seo-data.mjs` for the full report";
  }
  const onlyMissingSkills = r.problems.length > 0 && r.problems.every((p) => p.startsWith("required skill(s) missing"));
  r.next = onlyMissingSkills
    ? "/BWESEOInstall --sync-skills --dry-run (install the missing Claude skills from the canonical source)"
    : r.problems.length ? "/BWESEOInstall --dry-run --update (review the problems above)" : r.configuration === "missing" || r.profile === "missing" ? "/BWESEOSetup" : "/BWESEO";
  return r;
}

// ================================================================ manifest builder (maintainer only)
const RULES = [
  [/^installer\/bweseo-install\.mjs$/, "ENGINE", () => null],
  [/^installer\/migrations\/[^/]+$/, "ENGINE", () => null],
  [/^src\/[^/]+\.test\.mjs$/, "TEST", (p) => `seo/tools/${basename(p)}`], // co-located: the same file runs here and, installed, in a project
  [/^src\/[^/]+\.(mjs|mts)$/, "ENGINE", (p) => `seo/tools/${basename(p)}`],
  [/^schemas\/[^/]+\.json$/, "ENGINE", (p) => `seo/schema/${basename(p)}`],
  [/^templates\/docs\/README\.md$/, "TEMPLATE", () => "docs/seo/README.md"],
  [/^templates\/[^/]+\.json$/, "TEMPLATE", () => null],
  [/^templates\/landing-dashboard\.html$/, "TEMPLATE", () => "docs/seo/landing-dashboard.html"],
  [/^skills\/BWESEO[A-Za-z]*\/SKILL\.md$/, "ENGINE", () => null], // canonical SKILL source; installed by --sync-skills
  [/^(adapters|docs\/industries|docs\/methodology)\/[^/]+\.md$/, "ENGINE", () => null],
  [/^docs\/[^/]+\.md$/, "ENGINE", () => null],
  [/^docs\/refactor\/.+$/, "DEV", () => null],
  [/^docs\/[^/]+\.json$/, "ENGINE", () => null], // curated per-skill reference data used to generate the manual
  [/^\.claude\/skills\/[^/]+\/SKILL\.md$/, "DEV", () => null], // the engine's OWN maintenance skills (repository-local) — hashed, never installed
  [/^PROJECT_STATUS\.md$/, "DEV", () => null], // the session briefing for working on the engine itself — hashed, never installed
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, "DEV", () => null], // the repository's own GitHub Actions (e.g. the "Show operating guide" button, "Show user manual" Pages publisher) — hashed, never installed
  [/^CLAUDE\.md$/, "DEV", () => null], // instructions for working on the engine itself — hashed, never installed
  [/^BWESEO-SKILLS-AND-PROCEDURES\.md$/, "ENGINE", () => null], // the generated master manual
  [/^tests\/.+\.mjs$/, "TEST", () => null], // the engine's own installer / canonical regression tests
  [/^scripts\/[^/]+\.mjs$/, "ENGINE", () => null],
  [/^config\/isolation-allowlist\.json$/, "ENGINE", () => null],
  [/^(README\.md|VERSION|package\.json|package-lock\.json|vitest\.config\.mjs|\.gitignore|\.gitattributes)$/, "ENGINE", () => null],
];
export function buildManifest(engineDir, { requiredSkills = null } = {}) {
  const files = [];
  const problems = [];
  for (const p of walk(engineDir)) {
    if (MANIFEST_NAMES.includes(p)) continue;
    const rule = RULES.find(([re]) => re.test(p));
    if (!rule) {
      problems.push(`no classification rule for ${p} — classify it explicitly (or remove it); the default is DENY`);
      continue;
    }
    const [, klass, target] = rule;
    files.push({ path: p, class: klass, install: target(p), sha256: hashContent(readFileSync(join(engineDir, p))) });
  }
  const readConst = (name) => new RegExp(`${name}\\s*=\\s*"?([\\w.]+)"?`).exec(readFileSync(join(engineDir, "src", "validate-seo-data.mjs"), "utf8"))?.[1];
  const version = existsSync(join(engineDir, "VERSION")) ? readFileSync(join(engineDir, "VERSION"), "utf8").trim() : readConst("ENGINE_VERSION");
  if (readConst("ENGINE_VERSION") && readConst("ENGINE_VERSION") !== version)
    problems.push(`VERSION (${version}) and ENGINE_VERSION in src/validate-seo-data.mjs (${readConst("ENGINE_VERSION")}) disagree`);
  const skills = requiredSkills ?? (existsSync(join(engineDir, "skills")) ? readdirSync(join(engineDir, "skills")).filter((n) => existsSync(join(engineDir, "skills", n, "SKILL.md"))).sort() : []);
  const manifest = {
    manifestVersion: 1,
    engineId: "bweseo-engine",
    engineVersion: version,
    schemaVersion: Number(readConst("SCHEMA_VERSION") ?? 1),
    installer: INSTALLER_VERSION,
    requiredSkills: skills,
    targets: TARGET_ROOTS,
    files,
  };
  return { manifest, problems };
}

// ================================================================ Claude skills (canonical source → installed skills)
// The canonical SOURCE of every BWESEO skill lives in the engine (skills/<name>/SKILL.md). Claude Code
// needs installed copies in its skills directory. `--sync-skills` installs / updates them from the source,
// never the other way round, and records what it installed in <home>/.claude/bweseo/skills-receipt.json so
// a skill someone edited by hand is reported as a conflict instead of being silently overwritten.
export const skillsReceiptFile = (home = homedir()) => join(home, ".claude", "bweseo", "skills-receipt.json");
export function planSkills({ engineDir, skillsDir, home = homedir() }) {
  const out = { install: [], update: [], unchanged: [], conflicts: [] };
  const manifest = loadManifest(engineDir);
  let receipt = { skills: {} };
  try {
    receipt = JSON.parse(readFileSync(skillsReceiptFile(home), "utf8"));
  } catch {
    receipt = { skills: {} };
  }
  for (const f of manifest.files.filter((x) => /^skills\/[^/]+\/SKILL\.md$/.test(x.path))) {
    const name = f.path.split("/")[1];
    const dst = join(skillsDir, name, "SKILL.md");
    if (!existsSync(dst)) out.install.push({ name, sha256: f.sha256, from: f.path });
    else {
      const cur = hashContent(readFileSync(dst));
      if (cur === f.sha256) out.unchanged.push({ name });
      else if (receipt.skills?.[name]?.sha256 === cur) out.update.push({ name, sha256: f.sha256, from: f.path });
      else out.conflicts.push({ name, reason: "the installed skill differs from the canonical source and was not installed by this tool (or was edited since)", resolution: "REVIEW REQUIRED" });
    }
  }
  return out;
}
export function applySkills(plan, { engineDir, skillsDir, home = homedir() }) {
  let receipt = { skills: {} };
  try {
    receipt = JSON.parse(readFileSync(skillsReceiptFile(home), "utf8"));
  } catch {
    receipt = { skills: {} };
  }
  const before = treeHash(engineDir);
  for (const s of [...plan.install, ...plan.update]) {
    const buf = readFileSync(join(engineDir, s.from));
    if (hashContent(buf) !== s.sha256) throw new Error(`integrity failure while reading ${s.from}`);
    mkdirSync(join(skillsDir, s.name), { recursive: true });
    writeFileSync(join(skillsDir, s.name, "SKILL.md"), buf);
    receipt.skills[s.name] = { sha256: s.sha256 };
  }
  for (const s of plan.unchanged) {
    const f = loadManifest(engineDir).files.find((x) => x.path === `skills/${s.name}/SKILL.md`);
    if (f) receipt.skills[s.name] = { sha256: f.sha256 };
  }
  receipt.engineVersion = loadManifest(engineDir).engineVersion;
  receipt.updatedAt = new Date().toISOString();
  mkdirSync(dirname(skillsReceiptFile(home)), { recursive: true });
  writeFileSync(skillsReceiptFile(home), JSON.stringify(receipt, null, 2) + "\n");
  if (treeHash(engineDir) !== before) throw new Error("the canonical engine was modified — this must never happen");
  return { ok: true, installed: plan.install.length, updated: plan.update.length };
}

// ================================================================ presentation
export function formatPlan(plan, { title = "BWESEO INSTALL — DRY RUN" } = {}) {
  const out = [title, ""];
  if (plan.engine) out.push(`Engine ........ v${plan.engine.version} · schema ${plan.engine.schemaVersion} · manifest ${plan.engine.manifestVersion}`);
  out.push(`Mode .......... ${plan.mode}`);
  out.push(`Framework ..... ${plan.target.framework ?? "n/a"}${plan.target.adapter ? ` (adapter: ${plan.target.adapter})` : " (no adapter — website adapter requires configuration)"}`);
  if (plan.target.hosting?.length) out.push(`Hosting hints . ${plan.target.hosting.join(", ")}`);
  out.push("");
  const list = (label, items, fmt) => {
    out.push(`${label} (${items.length})`);
    items.slice(0, 40).forEach((i) => out.push(`  ${fmt(i)}`));
    if (items.length > 40) out.push(`  … and ${items.length - 40} more`);
    out.push("");
  };
  if (plan.failures.length) {
    out.push("SAFETY FAILURES — nothing was changed");
    plan.failures.forEach((f) => out.push(`  ✗ [${f.gate}] ${f.reason}`, `    → ${f.action}`));
    out.push("");
  }
  list("Files to create", plan.create.filter((c) => !c.dir), (c) => `+ ${c.path}`);
  list("Directories to create", plan.create.filter((c) => c.dir), (c) => `+ ${c.path}`);
  list("Files to update", plan.update, (u) => `~ ${u.path}`);
  list("Files preserved (never overwritten)", plan.preserve, (p) => `= ${p.path} — ${p.reason}`);
  list("Files excluded", plan.exclude.slice(0, 12), (e) => `- ${e.path} — ${e.reason}`);
  if (plan.exclude.length > 12) out.push(`  (${plan.exclude.length - 12} more canonical-reference files excluded)`, "");
  list("Potential conflicts", plan.conflicts, (c) => `! ${c.path} — ${c.reason} → ${c.resolution}`);
  list("Schema migrations", plan.migrations, (m) => `${m.from} → ${m.to}: ${m.description}`);
  out.push(`.gitignore additions: ${plan.gitignore.add.length ? plan.gitignore.add.join(", ") : "none"}`);
  out.push(`CLAUDE.md: ${plan.claudeMd.action === "none" ? "no change" : `${plan.claudeMd.action} — BWESEO-managed section only (${plan.claudeMd.file})`}`, "");
  if (plan.warnings.length) {
    out.push("Warnings");
    plan.warnings.forEach((w) => out.push(`  ⚠ ${w}`));
    out.push("");
  }
  if (plan.notes.length) {
    plan.notes.forEach((n) => out.push(`  ✓ ${n}`));
    out.push("");
  }
  out.push(
    plan.failures.length
      ? "Recommended action: fix the safety failures above, then run /BWESEOInstall --dry-run again."
      : plan.conflicts.length
        ? "Recommended action: review the conflicts, then run /BWESEOInstall (conflicting files are left untouched)."
        : plan.mode === "update"
          ? "Recommended action: /BWESEOInstall --update, then /BWESEOInstall --verify."
          : "Recommended action: /BWESEOInstall, then /BWESEOInstall --verify, then /BWESEOSetup.",
  );
  return out.join("\n");
}

export function formatVerify(r) {
  const yn = (b) => (b ? "yes" : "no");
  const out = ["BWESEO INSTALL — VERIFY (read-only)", ""];
  out.push(`BWESEO installed ........ ${yn(r.installed)}`);
  if (r.engineLocation) out.push(`Engine location ......... ${r.engineLocation}${r.engineLocationWarning ? `  ⚠ ${r.engineLocationWarning}` : ""}`);
  out.push(`Engine version .......... ${r.engineVersion ?? "n/a"}`);
  out.push(`Schema version .......... ${r.schemaVersion ?? "n/a"}`);
  out.push(`Adapter ................. ${r.adapter ?? (r.installed ? "none — website adapter requires configuration" : "n/a")}`);
  out.push(`Required skills ......... ${r.requiredSkills.checked ? (r.requiredSkills.missing.length ? `missing: ${r.requiredSkills.missing.join(", ")}` : `all ${r.requiredSkills.present.length} present`) : "not checked (canonical engine not found)"}`);
  if (r.requiredSkills.drift?.length) out.push(`Installed skills ........ ${r.requiredSkills.drift.length} differ from the canonical source (run /BWESEOInstall --sync-skills --dry-run)`);
  out.push(`Engine files ............ ${r.engineFiles.present}/${r.engineFiles.expected} present${r.engineFiles.modified.length ? `, ${r.engineFiles.modified.length} modified` : ""}${r.engineFiles.missing.length ? `, ${r.engineFiles.missing.length} missing` : ""}`);
  out.push(`Configuration ........... ${r.configuration}`);
  out.push(`Customer profile ........ ${r.profile}`);
  out.push(`Manifest integrity ...... ${r.manifestIntegrity}`);
  out.push(`Secret leakage check .... ${r.secretCheck}`);
  out.push(`Project leakage check ... ${r.leakageCheck}`);
  out.push(`State validity .......... ${r.state.ran ? r.state.pending : "not applicable yet"}`);
  out.push(`Documentation ........... ${r.documentation ?? "n/a"}`);
  out.push(`Update available ........ ${r.updateAvailable}`);
  if (r.problems.length) {
    out.push("", "Problems");
    r.problems.forEach((p) => out.push(`  ✗ ${p}`));
  }
  out.push("", `Recommended next action: ${r.next}`);
  return out.join("\n");
}

// ================================================================ CLI
async function loadMigrations(engineDir) {
  const f = join(engineDir, "migrations", "index.mjs");
  if (!existsSync(f)) return [];
  const m = await import(pathToFileURL(f).href);
  return m.migrations ?? [];
}

export async function runCli(argv, { cwd = process.cwd(), env = process.env, home = homedir(), log = console.log, err = console.error } = {}) {
  const flag = (n) => argv.includes(n);
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const projectDir = resolve(arg("--project") ?? cwd);
  const registryPath = defaultRegistryPath({ env, home });
  const located = arg("--engine") ? { dir: resolve(arg("--engine")), source: "--engine" } : locateEngine({ env, home });
  const json = flag("--json");
  const out = (o, text) => log(json ? JSON.stringify(o, null, 2) : text);

  if (flag("--register-engine")) {
    const r = registerEngineLocation(resolve(arg("--engine") ?? arg("--register-engine") ?? cwd), home);
    out(r, r.ok ? `✓ engine location recorded in ${engineLocationFile(home)}` : `✗ ${r.reason}`);
    return r.ok ? 0 : 1;
  }
  if (flag("--sync-skills")) {
    if (!located) {
      err("✗ the canonical BWESEO engine cannot be located (set BWESEO_ENGINE_HOME or run register-engine)");
      return 1;
    }
    const skillsDir = env.BWESEO_SKILLS_DIR ?? join(home, ".claude", "skills");
    const plan = planSkills({ engineDir: located.dir, skillsDir, home });
    if (!flag("--dry-run") && !plan.conflicts.length) applySkills(plan, { engineDir: located.dir, skillsDir, home });
    out(plan, [
      flag("--dry-run") ? "BWESEO SKILLS — DRY RUN" : "BWESEO SKILLS — SYNC (canonical source → installed skills)",
      `install: ${plan.install.map((s) => s.name).join(", ") || "none"}`,
      `update:  ${plan.update.map((s) => s.name).join(", ") || "none"}`,
      `already identical: ${plan.unchanged.length}`,
      ...plan.conflicts.map((c) => `! ${c.name} — ${c.reason} → ${c.resolution}`),
    ].join("\n"));
    return plan.conflicts.length ? 2 : 0;
  }
  if (flag("--register-project")) {
    const r = registerProject(projectDir, registryPath);
    out(r, r.ok ? `✓ registered this project's identity fingerprints (${r.count}); values are not shown` : `✗ ${r.reason}`);
    return r.ok ? 0 : 1;
  }
  if (flag("--build-manifest")) {
    const dir = resolve(arg("--engine") ?? located?.dir ?? cwd);
    const { manifest, problems } = buildManifest(dir, { requiredSkills: arg("--skills") ? arg("--skills").split(",").filter(Boolean) : null });
    if (problems.length) {
      problems.forEach((p) => err(`✗ ${p}`));
      return 1;
    }
    writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
    log(`✓ manifest written: ${manifest.files.length} files, engine v${manifest.engineVersion}, schema ${manifest.schemaVersion}`);
    return 0;
  }
  if (flag("--verify")) {
    const r = verifyInstall({ projectDir, engineDir: located?.dir ?? null, registryPath, env, home });
    r.engineLocation = located ? `${located.dir} (${located.source})` : "not located";
    if (located?.deprecated) r.engineLocationWarning = "DEPRECATED legacy location — run: node <engine>/scripts/register-engine.mjs";
    out(r, formatVerify(r));
    return r.installed && !r.problems.length ? 0 : 1;
  }
  const mode = flag("--update") ? "update" : "install";
  const engineDir = located?.dir ?? null;
  const before = engineDir && existsSync(engineDir) ? treeHash(engineDir) : null;
  const migrations = engineDir ? await loadMigrations(engineDir) : [];
  const plan = planInstall({ engineDir, projectDir, mode, registryPath, migrations, withOptional: flag("--with-optional"), allowSubdir: flag("--allow-subdir") });
  if (located?.deprecated) plan.warnings.push("the engine was found at the DEPRECATED legacy location — run node <engine>/scripts/register-engine.mjs so it is located without it");
  if (flag("--dry-run") || plan.failures.length) {
    out(plan, formatPlan(plan, { title: plan.failures.length && !flag("--dry-run") ? "BWESEO INSTALL — REFUSED" : "BWESEO INSTALL — DRY RUN" }));
    if (before && treeHash(engineDir) !== before) throw new Error("canonical engine changed");
    return plan.failures.length ? 1 : 0;
  }
  const res = await applyPlan(plan, { engineDir, projectDir, migrations });
  if (!res.ok) {
    err(`✗ ${res.error}${res.rolledBack ? " — rolled back; no project data was changed" : ""}`);
    return 1;
  }
  const lines = [
    `✓ Manifest verified`,
    `✓ ${plan.engine.version} engine: ${plan.create.filter((c) => !c.dir).length} file(s) installed, ${plan.update.length} updated, ${plan.preserve.filter((p) => p.adopt).length} adopted`,
    `✓ Secret scan passed`,
    `✓ Project-isolation scan passed`,
    `✓ Project data directories initialized (empty)`,
    `${plan.target.adapter ? "✓" : "⚠"} ${plan.target.adapter ? `${plan.target.adapter} adapter detected` : "Website adapter requires configuration"}`,
    ...(plan.conflicts.length ? [`⚠ ${plan.conflicts.length} conflict(s) left untouched — REVIEW REQUIRED`] : []),
    "",
    ...(plan.alreadyInstalled
      ? [
          `BWESEO is already installed in this project (engine ${plan.alreadyInstalled.engineVersion}${plan.alreadyInstalled.installedAt ? `, installed ${String(plan.alreadyInstalled.installedAt).slice(0, 10)}` : ""}).`,
          plan.create.some((c) => !c.dir) || plan.update.length ? "Missing engine files were restored; nothing else was changed." : "Nothing needed changing.",
          "",
          plan.alreadyInstalled.updateAvailable
            ? `A newer canonical engine exists (${plan.alreadyInstalled.canonicalVersion}).\n\nNext recommended action:\n\n/BWESEOInstall --dry-run --update`
            : existsSync(join(projectDir, "seo/seo-config.json"))
              ? "Next recommended action:\n\n/BWESEOInstall --verify   (or /BWESEO to continue the SEO workflow)"
              : "No customer-specific SEO profile exists yet.\n\nNext recommended action:\n\n/BWESEOSetup",
        ]
      : [
          "BWESEO engine installed successfully.",
          "",
          plan.mode === "install" && !existsSync(join(projectDir, "seo/seo-config.json"))
            ? "No customer-specific SEO profile exists yet.\n\nNext recommended action:\n\n/BWESEOSetup"
            : "Existing customer SEO data was preserved.\n\nNext recommended action:\n\n/BWESEOInstall --verify   (then /BWESEO)",
        ]),
  ];
  out({ ...res, plan: { engine: plan.engine, conflicts: plan.conflicts } }, lines.join("\n"));
  return plan.conflicts.length ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`✗ ${String(e?.message ?? e)}`);
      process.exit(3);
    },
  );
}
