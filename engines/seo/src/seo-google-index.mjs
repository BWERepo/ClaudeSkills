#!/usr/bin/env node
// BWESEO Google Index Monitoring — the developer-side CLI (Node 18+). Engine 1.9.0.
//
// The monitor itself runs inside the website's own scheduler (index-monitor*.mjs). This tool only READS what it stored,
// so /BWESEO can describe the site's real Google indexing state:
//
//   node seo/tools/seo-google-index.mjs pull                  fetch the monitor's summary + registry and save them locally
//   node seo/tools/seo-google-index.mjs status                print the saved snapshot
//   node seo/tools/seo-google-index.mjs investigate           the URLs needing attention, with Google's own evidence
//   node seo/tools/seo-google-index.mjs explain <path>        one URL: state, plain-language explanation, checks, timeline
//
// Sites that do not run on Cloudflare set snapshot.source to "file": the site's own job writes summary.json (and registry.json)
// to a folder the developer can read, and "pull" copies them. (snapshot.dir, relative to the project.)
//
// "pull" uses the developer's OWN wrangler login against the production KV namespace named in
// seo-config.json -> analytics.searchConsole.indexMonitor.snapshot. No secret is stored in the project or read by
// this tool; the files it writes live in seo/data/google-index/ (ignored by git - they are the customer's own data).
// It never calls Google. It never changes the website.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexMonitorOf, googleIndexOf, indexSummaryLine } from "./seo-state-core.mjs";
import { describeState, recommendChecks, buildTimeline } from "./index-monitor.mjs";

const iso = (t = Date.now()) => new Date(t).toISOString();

export const dataDirOf = (config, project) => join(project, config?.paths?.data ?? "seo/data", "google-index");

// The wrangler command that reads one KV key from PRODUCTION. Arguments only - no shell, no secrets.
export function buildPullCommand(config, key, platform = process.platform) {
  const snap = indexMonitorOf(config).snapshot;
  if (!snap || snap.source !== "cloudflare-kv") return { ok: false, reason: "analytics.searchConsole.indexMonitor.snapshot.source is not cloudflare-kv" };
  if (!/^[0-9a-f]{32}$/.test(snap.kvNamespaceId ?? "")) return { ok: false, reason: "analytics.searchConsole.indexMonitor.snapshot.kvNamespaceId is missing or not a 32-character id" };
  const args = ["wrangler", "kv", "key", "get", key, "--namespace-id", snap.kvNamespaceId, "--remote"];
  if (snap.wranglerConfig) args.push("-c", snap.wranglerConfig);
  return { ok: true, command: platform === "win32" ? "npx.cmd" : "npx", args };
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}: the stored value is not valid JSON (is the monitor set up and has it run yet?)`);
  }
}

// Pull the monitor's summary and registry into seo/data/google-index/. `exec` is injectable for tests.
export function pullSnapshot(config, project, { exec = execFileSync, now = Date.now(), write = writeFileSync, readFile = readFileSync } = {}) {
  const snap = indexMonitorOf(config).snapshot;
  const dir = dataDirOf(config, project);
  const fileMode = snap?.source === "file";
  const get = (key) => {
    if (fileMode) {
      const from = join(project, snap.dir ?? "seo/data/google-index/source", key === (snap.registryKey ?? "gi:registry") ? "registry.json" : "summary.json");
      try {
        return String(readFile(from, "utf8") ?? "").trim();
      } catch {
        return "";
      }
    }
    const c = buildPullCommand(config, key);
    if (!c.ok) throw new Error(c.reason);
    const out = exec(c.command, c.args, { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, shell: process.platform === "win32" });
    return String(out ?? "").trim();
  };
  const summaryText = get(snap?.summaryKey ?? "gi:summary");
  if (!summaryText) throw new Error("the monitor has not stored a summary yet (it has not run, or Search Console is not connected)");
  const summary = parseJson(summaryText, "summary");
  let registry = null;
  try {
    registry = parseJson(get(snap?.registryKey ?? "gi:registry"), "registry");
  } catch {
    registry = null; // the summary alone is enough for /BWESEO; the registry only adds the per-URL detail
  }
  mkdirSync(dir, { recursive: true });
  const snapshot = { v: 1, pulledAt: iso(now), source: fileMode ? "file" : "cloudflare-kv", summary };
  write(join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
  if (registry) write(join(dir, "registry.json"), JSON.stringify({ v: 1, pulledAt: snapshot.pulledAt, records: registry.records ?? {} }, null, 2) + "\n");
  return { snapshot, hasRegistry: !!registry };
}

// One URL, explained from the stored record: Google's own words first, then the plain-language meaning and the checks.
export function explainRecord(record, origin = "https://invalid.example") {
  const d = describeState(record.indexState);
  const g = record.google ?? {};
  return {
    path: record.path,
    title: record.title ?? null,
    status: d.label,
    googleSays: g.coverageState ?? null,
    plainLanguage: d.plain,
    suggestedChecks: d.checks,
    observed: recommendChecks(record, origin).map((r) => r.text),
    lastCrawl: g.lastCrawlTime ?? null,
    lastCheckedAt: record.inspect?.at ?? null,
    checkStatus: record.inspect?.status ?? null,
    timeline: buildTimeline(record, record.history ?? []),
  };
}

export function investigationReport(registry, origin) {
  const recs = Object.values(registry?.records ?? {}).filter((r) => r.active !== false && r.attention);
  return recs.map((r) => explainRecord(r, origin));
}

function formatStatus(config, snap, today) {
  const g = googleIndexOf(config, snap, today);
  if (!g.applicable) return "Google index monitoring is not configured for this project (analytics.searchConsole.indexMonitor).";
  const out = ["GOOGLE INDEXING", `Search Console ... ${g.searchConsole}`, `Sitemap ......... ${g.sitemap}`, `Indexing ........ ${indexSummaryLine(g)}`];
  if (g.rate) out.push(`Indexing rate ... ${g.rate.indexed} / ${g.rate.of}`);
  if (g.hasSnapshot) out.push(`Last check ...... ${String(g.lastGoogleCheckAt ?? "none").slice(0, 10)} (pulled ${String(g.pulledAt).slice(0, 10)}${g.stale ? ", stale" : ""})`);
  if (g.timings?.toIndexed?.samples) out.push(`Typical time to indexed: ${g.timings.toIndexed.medianDays} days (median of ${g.timings.toIndexed.samples} page(s))`);
  return out.join("\n");
}

async function cli(argv) {
  const project = resolve(argv.find((a, i) => argv[i - 1] === "--project") ?? ".");
  const cmd = argv[0];
  const cfgPath = join(project, "seo", "seo-config.json");
  if (!existsSync(cfgPath)) {
    console.error("No seo/seo-config.json here - run this from the website project (or pass --project <dir>).");
    return 2;
  }
  const config = JSON.parse(readFileSync(cfgPath, "utf8"));
  const dir = dataDirOf(config, project);
  const readJson = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null);
  const origin = config.environments?.production?.url ?? config.website ?? undefined;
  try {
    if (cmd === "pull") {
      const r = pullSnapshot(config, project);
      console.log(`Saved ${join(dir, "snapshot.json")}${r.hasRegistry ? " and registry.json" : ""} (data pulled ${r.snapshot.pulledAt}).`);
      console.log(formatStatus(config, r.snapshot, r.snapshot.pulledAt.slice(0, 10)));
      return 0;
    }
    if (cmd === "status") {
      console.log(formatStatus(config, readJson("snapshot.json"), iso().slice(0, 10)));
      return 0;
    }
    if (cmd === "investigate" || cmd === "explain") {
      const reg = readJson("registry.json");
      if (!reg) {
        console.error("No registry saved yet - run: node seo/tools/seo-google-index.mjs pull");
        return 1;
      }
      if (cmd === "explain") {
        const rec = reg.records?.[argv[1]];
        if (!rec) {
          console.error(`No such URL in the registry: ${argv[1] ?? "(none given)"}`);
          return 1;
        }
        console.log(JSON.stringify(explainRecord(rec, origin), null, 2));
      } else console.log(JSON.stringify(investigationReport(reg, origin), null, 2));
      return 0;
    }
    console.error("Usage: seo-google-index.mjs pull | status | investigate | explain <path>   [--project <dir>]");
    return 2;
  } catch (e) {
    console.error(`Error: ${String(e?.message ?? e).slice(0, 300)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) cli(process.argv.slice(2)).then((c) => process.exit(c));
