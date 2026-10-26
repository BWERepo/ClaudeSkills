#!/usr/bin/env node
// BWESEO workflow state — zero dependencies, Node 18+ (global fetch).
//
// The state machine behind /BWESEO. It reads the current project's SEO evidence — seo/*.json,
// docs/seo/*.md, docs/seo/reports/, the Search Console export folder, the page source files and
// (unless --offline) read-only GETs of the production site — works out where the project and
// every page are in the lifecycle, and picks ONE recommended next action.
//
// It never changes anything: no deploys, no Search Console calls, no edits to any SEO record.
// The single exception is the explicit `--record-health` flag, which appends this run's live-site
// HEALTH observation to seo/data/live-health.json (gitignored) so consecutive failures and the
// last successful check can be tracked. It never touches lifecycle records. Every name, URL and
// date comes from the current project's own files — nothing about any business is hard-coded.
//
// Usage (from the project root):
//   node seo/tools/seo-state.mjs              status dashboard (with live production checks)
//   node seo/tools/seo-state.mjs --details    everything: every page, issue, blocker, evidence
//   node seo/tools/seo-state.mjs --json       machine-readable state
//   node seo/tools/seo-state.mjs --offline    skip the production checks
//   node seo/tools/seo-state.mjs --record-health   also record this run's live-site health observation
//   node seo/tools/seo-state.mjs --page <ref> the same state, focused on ONE page (an inventory id, a /path or a URL on this site)
//   node seo/tools/seo-state.mjs --hash <id>  the page's current source hash (for qa.sourceHash)
//   node <engine>/src/seo-state.mjs --project <dir>   a project with no seo/ folder yet
// Exit code 0 (the status is informational); 3 on a usage error.
//
// This file is the Node side: it gathers the evidence from disk (collectEvidence, sourceState,
// readDoc) and runs the CLI. The state machine itself — evaluateState, the dashboard text and the
// live checks — is in seo-state-core.mjs, which imports nothing so it also runs in a Worker; this
// file re-exports all of it.
//
// Vendored into each project as seo/tools/seo-state.mjs by /BWESEOSetup, next to
// seo-state-core.mjs, validate-seo-data.mjs and post-publish-check.mjs. The source of truth is
// $BWESEO_ENGINE/src/; the rules it implements are documented in
// docs/methodology/workflow-state.md.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeJsonAtomic } from "./safe-write.mjs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION, validateProject } from "./validate-seo-data.mjs";
import { credentialStatus } from "./seo-google.mjs";
import { migrateQueue, nextAction } from "./improvement-queue.mjs";
import {
  assessPage,
  evaluateState,
  formatDashboard,
  formatDetails,
  localToday,
  nextHealthHistory,
  probeLive,
  sourceFiles,
} from "./seo-state-core.mjs";

export * from "./seo-state-core.mjs";
export { ENGINE_VERSION };

const DOCS = {
  baseline: "SEO-BASELINE.md",
  strategy: "SEO-STRATEGY.md",
  pageMap: "SEO-PAGE-MAP.md",
  roadmap: "CONTENT-ROADMAP.md",
  internalLinking: "INTERNAL-LINKING.md",
  measurement: "SEO-MEASUREMENT.md",
};

const isStr = (v) => typeof v === "string" && v.trim() !== "";

// ---------------------------------------------------------------- evidence: files

// A page's current source fingerprint. /BWESEOQA records it as qa.sourceHash; if the files change
// afterwards the hash no longer matches and the QA result is stale. Line endings are normalized so
// a git autocrlf checkout doesn't look like an edit.
export function sourceState(projectDir, source) {
  const files = sourceFiles(source);
  const present = files.filter((f) => {
    const p = join(projectDir, f);
    return existsSync(p) && statSync(p).isFile();
  });
  const missing = files.filter((f) => !present.includes(f));
  if (!present.length) return { files, missing, hash: null, modifiedOn: null };
  const h = createHash("sha256");
  let latest = 0;
  for (const f of [...present].sort()) {
    const p = join(projectDir, f);
    h.update(`${f}\n${readFileSync(p, "utf8").replace(/\r\n/g, "\n")}\n`);
    latest = Math.max(latest, statSync(p).mtimeMs);
  }
  return {
    files,
    missing,
    hash: h.digest("hex").slice(0, 16),
    modifiedOn: localToday(new Date(latest)),
  };
}

// A doc counts as done only when it has real content, not just the empty shell /BWESEOSetup makes.
export function readDoc(file) {
  if (!existsSync(file)) return { exists: false, updated: null, hasContent: false };
  const text = readFileSync(file, "utf8");
  const updated =
    text.match(/Last updated:?\**:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ??
    localToday(statSync(file).mtime);
  const body = text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*#/.test(l) && !/last updated/i.test(l))
    .join(" ")
    .replace(/\s+/g, " ");
  return { exists: true, updated, hasContent: body.length > 200 };
}

function datedEntries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => ({
      name,
      date:
        name.match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
        name.match(/\d{4}-\d{2}/)?.[0] ??
        localToday(statSync(join(dir, name)).mtime),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function gitInfo(dir) {
  const git = (...args) => {
    try {
      return execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  const top = git("rev-parse", "--show-toplevel");
  return { remote: git("remote", "get-url", "origin"), folderName: basename(top ?? resolve(dir)) };
}

// The installation receipt written by /BWESEOInstall (metadata only — never its file hashes into the
// state), whether the installed engine files still match it, and — when the canonical engine is
// reachable on this machine — the latest engine version, so an update can be flagged.
function installEvidence(projectDir, read) {
  const receipt = read(join(projectDir, "seo", "bweseo-install.json"));
  if (!receipt) return { receipt: null, integrity: "unknown", latestKnown: null };
  let integrity = "verified";
  for (const [rel, meta] of Object.entries(receipt.files ?? {})) {
    const f = join(projectDir, rel);
    if (!existsSync(f)) {
      integrity = "missing";
      break;
    }
    if (createHash("sha256").update(readFileSync(f)).digest("hex") !== meta.sha256) integrity = "modified";
  }
  let latestKnown = null;
  try {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    let recorded = null;
    try {
      recorded = JSON.parse(readFileSync(join(home, ".claude", "bweseo", "engine-location.json"), "utf8")).path ?? null;
    } catch {
      recorded = null;
    }
    // Same order as the installer's locateEngine (a test keeps them identical): BWESEO_ENGINE_HOME (alias
    // BWESEO_ENGINE), the registered location, then the DEPRECATED legacy folder.
    for (const dir of [process.env.BWESEO_ENGINE_HOME || process.env.BWESEO_ENGINE, recorded, join(home, ".claude", "skills", "BWESEO", "engine")].filter(Boolean)) {
      const m = ["engine-manifest.json", "manifest.json"].map((n) => join(dir, n)).find((f) => existsSync(f));
      if (m) {
        latestKnown = JSON.parse(readFileSync(m, "utf8")).engineVersion ?? null;
        break;
      }
    }
  } catch {
    latestKnown = null;
  }
  const { files: _files, ...meta } = receipt;
  return { receipt: meta, integrity, latestKnown };
}

// ---------------------------------------------------------------- evidence: collect

export async function collectEvidence(
  projectDir,
  { live = true, fetchImpl = globalThis.fetch, today = localToday(), timeoutMs = 8000 } = {},
) {
  const seoDir = join(projectDir, "seo");
  const ev = { projectDir, today, parseErrors: [], repo: gitInfo(projectDir) };
  const read = (file) => {
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      ev.parseErrors.push(`${file}: ${e.message}`);
      return null;
    }
  };
  ev.config = read(join(seoDir, "seo-config.json"));
  ev.install = installEvidence(projectDir, read);
  if (!ev.config) return ev;
  const paths = ev.config.paths ?? {};
  // Live-health history: observations only, kept apart from every lifecycle record.
  ev.healthHistory = read(join(projectDir, paths.data ?? "seo/data", "live-health.json"));
  ev.profile = read(join(projectDir, paths.businessProfile ?? "seo/business-profile.json"));
  ev.inventory = read(join(projectDir, paths.contentInventory ?? "seo/content-inventory.json"));
  const { errors, warnings } = validateProject(projectDir, { today });
  ev.validation = { errors, warnings };

  const docsDir = join(projectDir, paths.docs ?? "docs/seo");
  ev.docs = Object.fromEntries(
    Object.entries(DOCS).map(([k, f]) => [k, readDoc(join(docsDir, f))]),
  );
  ev.reports = datedEntries(join(docsDir, "reports"));
  const scDir =
    ev.config.analytics?.searchConsole?.dataDir ?? join(paths.data ?? "seo/data", "search-console");
  ev.searchConsoleExports = datedEntries(join(projectDir, scDir)).map((e) => e.date);
  // Google index monitoring snapshot (engine 1.9.0): pulled by seo-google-index.mjs, never committed (seo/data is ignored).
  // Absent until the first pull; /BWESEO then recommends pulling it.
  ev.googleIndex = read(join(projectDir, paths.data ?? "seo/data", "google-index", "snapshot.json"));

  // Keyword performance summary (engine 1.10.0): written by seo-keywords.mjs pull/refresh, never committed (seo/data is ignored).
  ev.keywordPerformance = read(join(projectDir, paths.data ?? "seo/data", "keyword-performance", "summary.json"));

  // Unified improvement queue (seo-queue.mjs): only its single next eligible item is passed to the state machine.
  try {
    const qf = read(join(projectDir, paths.data ?? "seo/data", "improvement-queue.json"));
    if (qf) {
      const { queue } = migrateQueue(qf);
      const n = nextAction(queue, { now: Date.parse(`${today}T12:00:00Z`) });
      if (n.item) ev.queueNext = { id: n.item.id, title: n.item.title, action: n.action, reason: n.reason, why: n.why.join("; "), severity: n.item.severity, source: n.item.source.module, waiting: n.skipped.length };
    }
  } catch (e) {
    ev.parseErrors.push(`improvement queue: ${e.message}`);
  }

  ev.sources = {};
  for (const p of ev.inventory?.pages ?? []) {
    if (p.status !== "rejected" && isStr(p.source))
      ev.sources[p.id] = sourceState(projectDir, p.source);
  }
  ev.live =
    live && ev.inventory
      ? await probeLive(ev.config, ev.inventory, { fetchImpl, timeoutMs })
      : { checked: false, reason: live ? "no inventory" : "skipped (--offline)" };
  return ev;
}

// ---------------------------------------------------------------- CLI

async function cli(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const project = resolve(arg("--project") ?? process.cwd());
  if (argv.includes("--hash")) {
    const id = arg("--hash");
    const invFile = join(project, "seo", "content-inventory.json");
    if (!id || !existsSync(invFile)) {
      console.error(
        "Usage: seo-state.mjs --hash <inventory id>   (needs seo/content-inventory.json)",
      );
      return 3;
    }
    const page = JSON.parse(readFileSync(invFile, "utf8")).pages.find((p) => p.id === id);
    if (!page) {
      console.error(`No inventory entry "${id}"`);
      return 3;
    }
    console.log(
      JSON.stringify(
        {
          id,
          sourceHash: sourceState(project, page.source).hash,
          ...sourceState(project, page.source),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const ev = await collectEvidence(project, { live: !argv.includes("--offline") });
  // Is the Search Console API credential present in THIS environment? A boolean only — the value is
  // never read into the state. (The Admin card can't know; it treats availability as unknown.)
  if (ev.config?.analytics?.searchConsole?.enabled === true)
    ev.googleApi = { available: credentialStatus(ev.config, process.env).available };
  const state = evaluateState(ev);
  if (argv.includes("--record-health")) {
    const file = join(project, ev.config?.paths?.data ?? "seo/data", "live-health.json");
    mkdirSync(join(file, ".."), { recursive: true });
    writeJsonAtomic(file, nextHealthHistory(state.liveHealth, ev.healthHistory));
  }
  if (argv.includes("--page")) {
    const ref = arg("--page");
    const res = assessPage(state, ref);
    console.log(argv.includes("--json") ? JSON.stringify({ ok: res.ok, error: res.error ?? null, page: res.page ?? null, actions: res.actions ?? [] }, null, 2) : res.text);
    return res.ok ? 0 : 1;
  }
  if (argv.includes("--json")) console.log(JSON.stringify(state, null, 2));
  else
    console.log(
      argv.includes("--details")
        ? formatDetails(state)
        : formatDashboard(state, { color: !!process.stdout.isTTY || !!process.env.FORCE_COLOR }),
    );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e?.stack ?? e);
      process.exit(3);
    },
  );
}
