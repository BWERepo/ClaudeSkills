#!/usr/bin/env node
// BWESEO diagnostics — read-only health report for ONE customer project (Node 18+). Changes nothing, makes no network call and
// never performs a live authentication. Credentials are reported by NAME and presence only; their values are never read into the report.
//
//   node seo/tools/seo-doctor.mjs [--json] [--max-age-days 14] [--project <dir>]
//
// Each check is PASS, WARN, FAIL or UNKNOWN with a next step. UNKNOWN means "no evidence either way", never "fine".
// "Recorded scheduler success" is a timestamp the engine's own files recorded earlier; it is NOT a live check that the scheduler
// is running now. Exit codes: 0 no FAIL, 1 at least one FAIL, 2 not a BWESEO project.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION, validateProject } from "./validate-seo-data.mjs";
import { credentialStatus } from "./gsc-client.mjs";
import { ageInDays } from "./evidence.mjs";

export const MIN_NODE_MAJOR = 18;
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };
const c = (id, label, status, detail, next = null) => ({ id, label, status, detail, next });
const relTo = (project, text) => String(text).split(project).join("<project>");

export function runDiagnostics({ project, env = process.env, nodeVersion = process.versions.node, now = Date.now(), maxAgeDays = 14 } = {}) {
  const checks = [];
  const seo = join(project, "seo");
  const config = readJson(join(seo, "seo-config.json"));
  const data = join(project, config?.paths?.data ?? "seo/data");

  // 1. installation integrity (receipt written by the installer; compares recorded hashes with the files on disk)
  const receiptFile = join(seo, "bweseo-install.json");
  const receipt = existsSync(receiptFile) ? readJson(receiptFile) : null;
  if (receipt === undefined) checks.push(c("install", "Installation integrity", "FAIL", "seo/bweseo-install.json exists but is not valid JSON.", "Re-run the BWESEO installer in verify mode, then update."));
  else if (!receipt) checks.push(c("install", "Installation integrity", "UNKNOWN", "No installation receipt (seo/bweseo-install.json); the installed files cannot be verified.", "Run /BWESEOInstall (dry run first)."));
  else {
    const missing = [], modified = [];
    for (const [rel, meta] of Object.entries(receipt.files ?? {})) {
      const f = join(project, rel);
      if (!existsSync(f)) missing.push(rel); else if (createHash("sha256").update(readFileSync(f)).digest("hex") !== meta.sha256) modified.push(rel);
    }
    const ver = receipt.engineVersion ?? receipt.version ?? null;
    checks.push(missing.length ? c("install", "Installation integrity", "FAIL", `${missing.length} installed file(s) missing: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}.`, "Run /BWESEOUpdate (or the installer in repair mode).")
      : modified.length ? c("install", "Installation integrity", "WARN", `${modified.length} installed file(s) differ from the receipt: ${modified.slice(0, 3).join(", ")}${modified.length > 3 ? ", ..." : ""}.`, "If you did not edit them, reinstall; engine files are not meant to be edited in a project.")
      : c("install", "Installation integrity", "PASS", `All ${Object.keys(receipt.files ?? {}).length} recorded files match${ver ? ` (engine ${ver}; this copy is ${ENGINE_VERSION})` : ""}.`));
  }

  // 2. configuration and schema validity
  if (!config) checks.push(c("config", "Configuration and data files", "FAIL", config === undefined ? "seo/seo-config.json is not valid JSON." : "seo/seo-config.json is missing.", "Run /BWESEOSetup."));
  else {
    const v = validateProject(project, { today: new Date(now).toISOString().slice(0, 10) });
    checks.push(v.errors.length ? c("config", "Configuration and data files", "FAIL", `${v.errors.length} validation error(s); first: ${relTo(project, v.errors[0])}`, "Run: node seo/tools/validate-seo-data.mjs for the full list.")
      : v.warnings.length ? c("config", "Configuration and data files", "WARN", `Valid, with ${v.warnings.length} warning(s); first: ${relTo(project, v.warnings[0])}`, "Run: node seo/tools/validate-seo-data.mjs")
      : c("config", "Configuration and data files", "PASS", "Profile, config and inventory validate against the current schema."));
  }

  // 3. runtime compatibility
  const major = Number(String(nodeVersion).split(".")[0]);
  checks.push(major >= MIN_NODE_MAJOR ? c("runtime", "Runtime compatibility", "PASS", `Node ${nodeVersion} (the engine needs ${MIN_NODE_MAJOR}+).`) : c("runtime", "Runtime compatibility", "FAIL", `Node ${nodeVersion} is older than the required ${MIN_NODE_MAJOR}.`, `Install Node ${MIN_NODE_MAJOR} or newer.`));

  // 4. adapter and what the configuration enables (declared capabilities, not tested ones)
  if (config) {
    const caps = [];
    if (config.analytics?.searchConsole?.enabled === true) caps.push("Search Console");
    if (config.analytics?.searchConsole?.keywordPerformance?.enabled === true) caps.push("keyword performance");
    caps.push(config.analytics?.searchConsole?.searchWatch?.enabled === false ? "search watch (switched off)" : "search watch");
    if (existsSync(join(data, "local-gbp"))) caps.push("Google Business Profile data");
    const engineAdapters = join(fileURLToPath(new URL(".", import.meta.url)), "..", "adapters");
    const known = existsSync(engineAdapters) ? existsSync(join(engineAdapters, `${config.adapter}.md`)) : null;
    checks.push(!config.adapter ? c("adapter", "Adapter and declared capabilities", "WARN", "No adapter is named in seo-config.json.", "Set \"adapter\" to one of the engine's adapter names.")
      : known === false ? c("adapter", "Adapter and declared capabilities", "WARN", `Adapter "${config.adapter}" is not one this engine ships.`, "Check the spelling or update the engine.")
      : c("adapter", "Adapter and declared capabilities", known ? "PASS" : "UNKNOWN", `Adapter "${config.adapter}"${known === null ? " (the adapter list is not available in an installed project, so it was not checked)" : ""}; enabled by configuration: ${caps.join(", ") || "none"}. These are declared settings, not tested connections.`, known === null ? "Run diagnostics from the engine checkout to verify the adapter name." : null));
  }

  // 5. credentials, by name only
  if (config?.analytics?.searchConsole?.enabled === true) {
    const s = credentialStatus(config, env);
    const name = s.credentialsSource ? String(s.credentialsSource).split(":").slice(1).join(":") || String(s.credentialsSource) : null;
    checks.push(s.available ? c("credentials", "Credential availability (by name)", "PASS", `The credential named ${name} is set in this environment and has the expected shape. No authentication was attempted.`)
      : c("credentials", "Credential availability (by name)", s.present ? "FAIL" : "WARN", `${name ? `The credential named ${name}` : "The Search Console credential"}: ${s.reason ?? "not configured"}.`, "Set the named environment variable (the value is never shown here) or ask the owner to provide it."));
  } else checks.push(c("credentials", "Credential availability (by name)", "UNKNOWN", "Search Console is not enabled in this project's configuration, so no credential is required or checked.", null));

  // 6. stored-data freshness (age of the engine's own stored files; says nothing about whether the site changed)
  const stored = [["keyword-performance/summary.json", "keyword data", (j) => j?.summary?.lastUpdated ?? j?.pulledAt], ["google-index/snapshot.json", "Google index data", (j) => j?.pulledAt], ["improvement-queue.json", "improvement queue", (j) => j?.updatedAt], ["live-health.json", "live-site health history", (j) => j?.production?.lastCheck?.checkedAt]];
  for (const [rel, label, pick] of stored) {
    const f = join(data, rel);
    if (!existsSync(f)) { checks.push(c(`fresh:${rel}`, `Stored ${label}`, "UNKNOWN", "Not present in this project.", null)); continue; }
    const j = readJson(f);
    const at = j === undefined ? null : pick(j) ?? new Date(statSync(f).mtimeMs).toISOString();
    const age = ageInDays(at, now);
    checks.push(j === undefined ? c(`fresh:${rel}`, `Stored ${label}`, "FAIL", `${rel} is not valid JSON.`, "Restore it from backup or regenerate it with its command.")
      : age == null ? c(`fresh:${rel}`, `Stored ${label}`, "UNKNOWN", "No usable date in the file.", null)
      : age > maxAgeDays ? c(`fresh:${rel}`, `Stored ${label}`, "WARN", `Last updated ${age} day(s) ago (limit ${maxAgeDays}).`, "Refresh it with the command for that module.")
      : c(`fresh:${rel}`, `Stored ${label}`, "PASS", `Last updated ${age} day(s) ago.`));
  }

  // 7. last RECORDED scheduler success. Evidence only: it is what an earlier run wrote down.
  const gi = readJson(join(data, "google-index", "snapshot.json"));
  const lastRun = gi?.lastRun ?? gi?.meta?.lastRun ?? null;
  const health = readJson(join(data, "live-health.json"));
  const successes = [lastRun?.at && lastRun.errors === 0 ? { at: lastRun.at, what: "Google index monitor run" } : null, health?.production?.lastSuccess?.checkedAt ? { at: health.production.lastSuccess.checkedAt, what: "live-site health check" } : null].filter(Boolean).sort((a, b) => b.at.localeCompare(a.at));
  if (!successes.length) checks.push(c("scheduler", "Last recorded scheduler success", "UNKNOWN", "No scheduled-run success is recorded in this project's files. That does not show the scheduler is stopped or running.", "Pull the latest monitor data, or check the scheduler in your hosting dashboard."));
  else {
    const age = ageInDays(successes[0].at, now);
    checks.push(c("scheduler", "Last recorded scheduler success", age != null && age > maxAgeDays ? "WARN" : "PASS", `Recorded: ${successes[0].what} succeeded ${successes[0].at}${age != null ? ` (${age} day(s) ago)` : ""}. This is a stored record, not a live check that the scheduler is running now.`, age != null && age > maxAgeDays ? "Check the scheduler in your hosting dashboard." : null));
  }

  const order = { FAIL: 3, WARN: 2, UNKNOWN: 1, PASS: 0 };
  const worst = checks.reduce((m, k) => (order[k.status] > order[m] ? k.status : m), "PASS");
  return { engineVersion: ENGINE_VERSION, project: "this project", generatedAt: new Date(now).toISOString(), overall: worst, counts: Object.fromEntries(["PASS", "WARN", "FAIL", "UNKNOWN"].map((s) => [s, checks.filter((k) => k.status === s).length])), checks };
}

export function formatDiagnostics(r) {
  return [`BWESEO diagnostics (engine ${r.engineVersion}) - overall ${r.overall}`, ...r.checks.map((k) => `${k.status.padEnd(7)} ${k.label}: ${k.detail}${k.next ? `\n        Next: ${k.next}` : ""}`), "", "Read-only: nothing was changed, no network call or live authentication was made."].join("\n");
}

export function main(argv, { out = console.log, err = console.error, env = process.env, now = Date.now(), nodeVersion } = {}) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const project = resolve(opt("--project") ?? ".");
  if (!existsSync(join(project, "seo", "seo-config.json")) && !existsSync(join(project, "seo"))) { err("No seo/ folder here - run this from the website project (or pass --project <dir>)."); return 2; }
  const maxAgeDays = Number(opt("--max-age-days") ?? 14);
  const r = runDiagnostics({ project, env, now, maxAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays : 14, ...(nodeVersion ? { nodeVersion } : {}) });
  out(argv.includes("--json") ? JSON.stringify(r, null, 2) : formatDiagnostics(r));
  return r.counts.FAIL ? 1 : 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) process.exit(main(process.argv.slice(2)));
