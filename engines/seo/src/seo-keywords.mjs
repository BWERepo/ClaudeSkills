#!/usr/bin/env node
// BWESEO Keyword Performance — the developer-side CLI (Node 18+). Engine 1.10.0.
//
// Answers, for this website: "If someone searches Google for a keyword we target, which page is meant to rank, has Google indexed it,
// is Google showing it for that query, and how is it performing?" — from the site's OWN Search Console data. It is NOT a Google
// search and never scrapes or simulates one.
//
//   node seo/tools/seo-keywords.mjs validate                       check the keyword registry in seo/content-inventory.json (offline)
//   node seo/tools/seo-keywords.mjs list                           the registered keywords and their target pages (offline)
//   node seo/tools/seo-keywords.mjs add <page-id> "<keyword>" [--primary [--replace]] [--intent <intent>]
//   node seo/tools/seo-keywords.mjs remove <page-id> "<keyword>"   (add/remove edit seo/content-inventory.json: running them IS the approval)
//   node seo/tools/seo-keywords.mjs refresh [--range 7d|28d|3m|YYYY-MM-DD:YYYY-MM-DD] [--force] [--targets]
//                                                                  call Search Console directly (production only; credential from the environment)
//   node seo/tools/seo-keywords.mjs pull                           copy the site's stored keyword data from its production KV (wrangler login)
//   node seo/tools/seo-keywords.mjs status                         the summary /BWESEO reads
//   node seo/tools/seo-keywords.mjs analyze "<keyword>"            the full plain-language analysis of one phrase
//   node seo/tools/seo-keywords.mjs table [--filter <f>] [--sort <s>] [--q <text>]
//   node seo/tools/seo-keywords.mjs page <path>                    one page: indexing, performance, top queries, issues
//   node seo/tools/seo-keywords.mjs discovered [--query "<q>" --action ignore|monitor|investigate|add-secondary|add-primary [--page <id>]]
//   node seo/tools/seo-keywords.mjs investigate                    keywords that need attention, with the evidence
//
// Local data lives in seo/data/keyword-performance/ (ignored by git: it is the customer's own data). No credential is stored there;
// `refresh` reads the service-account key from the environment variable NAMED by analytics.searchConsole.credentialsSource.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSearchConsoleClient, redact } from "./gsc-client.mjs";
import { environmentsOf } from "./seo-state-core.mjs";
import { buildPullCommand } from "./seo-google-index.mjs";
import { registryOf, addKeyword, removeKeyword, validateRegistry, applyDiscoveredAction } from "./keyword-registry.mjs";
import { TABLE_FILTERS, tableRows, queryTable, pageView, formatKeywordAnalysis } from "./keyword-performance.mjs";
import { refreshKeywordPerformance, refreshTargets, getKeywordPerformance, lookupKeyword, memoryStore, KW_KEYS } from "./keyword-performance-run.mjs";
import { KEYS as GI_KEYS } from "./index-monitor-run.mjs";

const iso = (t = Date.now()) => new Date(t).toISOString();
export const dataDirOf = (config, project) => join(project, config?.paths?.data ?? "seo/data", "keyword-performance");

// ---------------------------------------------------------------- local copy of the site's stored data

export function loadLocalStore(config, project) {
  const dir = dataDirOf(config, project);
  const f = join(dir, "store.json");
  const initial = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  // The Google index monitor's pulled registry (seo-google-index.mjs pull) is reused as-is: one source of indexing truth.
  const gi = join(project, config?.paths?.data ?? "seo/data", "google-index", "registry.json");
  if (!initial[GI_KEYS.registry] && existsSync(gi)) initial[GI_KEYS.registry] = JSON.parse(readFileSync(gi, "utf8"));
  return memoryStore(initial);
}

export function saveLocalStore(config, project, store) {
  const dir = dataDirOf(config, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "store.json"), JSON.stringify(store._dump(), null, 2) + "\n");
}

export function summaryFile(data, now = Date.now()) {
  return { v: 1, pulledAt: iso(now), source: "seo-keywords.mjs", summary: { ...data.summary, range: data.snapshot?.range ?? null, lastUpdated: data.lastUpdated } };
}

const ctxOf = (config, store, extra = {}) => {
  const envs = environmentsOf(config);
  return {
    store, site: { productionUrl: envs.production?.url ?? config.website, stagingUrl: envs.staging?.url ?? null, sitemapUrl: config.analytics?.searchConsole?.sitemap?.url ?? config.publication?.sitemapUrl ?? null },
    cfg: config.analytics?.searchConsole?.keywordPerformance?.thresholds, ...extra,
  };
};

async function rebuildSummary(config, project, store, inventory) {
  const data = await getKeywordPerformance(ctxOf(config, store), { inventory });
  const dir = dataDirOf(config, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summaryFile(data), null, 2) + "\n");
  return data;
}

const rangeArg = (v, dflt) => {
  if (!v) return dflt ?? "28d";
  const m = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(v);
  return m ? { startDate: m[1], endDate: m[2] } : v;
};

// Pull the site's stored keyword data from its production KV with the developer's own wrangler login. `exec` is injectable.
export function pullFromKv(config, project, { exec = execFileSync } = {}) {
  const got = {};
  for (const key of [KW_KEYS.snapshot, KW_KEYS.targets, KW_KEYS.meta, GI_KEYS.registry, GI_KEYS.links]) {
    const c = buildPullCommand(config, key);
    if (!c.ok) throw new Error(c.reason);
    try {
      const out = String(exec(c.command, c.args, { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, shell: process.platform === "win32" }) ?? "").trim();
      if (out) got[key] = JSON.parse(out);
    } catch (e) {
      if (key === KW_KEYS.snapshot) throw new Error(`could not read ${key}: ${redact(e?.message ?? e).slice(0, 200)} (has the site's keyword refresh run yet?)`);
    }
  }
  if (!got[KW_KEYS.snapshot]) throw new Error("the site has not stored keyword performance yet (its refresh has not run, or Search Console is not connected)");
  return got;
}

// ---------------------------------------------------------------- CLI

export async function cli(argv, { out = console.log, err = console.error, exec = execFileSync, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const flag = (n) => argv.includes(n);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const project = resolve(opt("--project") ?? ".");
  const cmd = argv[0];
  const cfgPath = join(project, "seo", "seo-config.json");
  if (!existsSync(cfgPath)) { err("No seo/seo-config.json here - run this from the website project (or pass --project <dir>)."); return 2; }
  const config = JSON.parse(readFileSync(cfgPath, "utf8"));
  const invPath = join(project, config.paths?.contentInventory ?? "seo/content-inventory.json");
  const inventory = existsSync(invPath) ? JSON.parse(readFileSync(invPath, "utf8")) : { pages: [] };
  const saveInventory = (inv) => writeFileSync(invPath, JSON.stringify(inv, null, 2) + "\n");
  const siteId = config.projectId ?? null;
  const store = loadLocalStore(config, project);
  try {
    if (cmd === "validate") {
      const v = validateRegistry(inventory);
      v.errors.forEach((e) => out(`ERROR   ${e}`));
      v.warnings.forEach((w) => out(`WARNING ${w}`));
      v.groups.forEach((g) => out(`NOTE    ${g.pageId}: "${g.phrases.join('", "')}" - ${g.note}`));
      out(v.errors.length ? `${v.errors.length} error(s).` : "Keyword registry is valid.");
      return v.errors.length ? 1 : 0;
    }
    if (cmd === "list") {
      const reg = registryOf(inventory, { siteId });
      if (!reg.length) { out("No keywords are registered. Add one: seo-keywords.mjs add <page-id> \"<keyword>\" --primary"); return 0; }
      for (const r of reg) out(`${r.role === "primary" ? "PRIMARY  " : "secondary"}  ${r.keyword}  ->  ${r.targetUrl}${r.status !== "published" ? `  (${r.status})` : ""}`);
      return 0;
    }
    if (cmd === "add" || cmd === "remove") {
      const [, pageId, keyword] = argv;
      if (!pageId || !keyword) { err(`Usage: seo-keywords.mjs ${cmd} <page-id> "<keyword>"`); return 2; }
      const r = cmd === "add" ? addKeyword(inventory, { pageId, keyword, role: flag("--primary") ? "primary" : "secondary", replace: flag("--replace"), allowDuplicate: flag("--allow-duplicate"), searchIntent: opt("--intent") ?? null, on: iso().slice(0, 10) }) : removeKeyword(inventory, { pageId, keyword });
      if (!r.ok) { err(r.error); return 1; }
      if (r.changed !== false) saveInventory(r.inventory);
      out(r.changed === false ? r.note : `${cmd === "add" ? "Registered" : "Removed"} "${keyword}" on ${pageId}. No page was created or changed.`);
      return 0;
    }
    if (cmd === "refresh") {
      const client = createSearchConsoleClient({ config, env, fetchImpl });
      const site = ctxOf(config, store).site;
      const origin = (site.productionUrl ?? "").replace(/\/+$/, "");
      const fetchPage = async (path) => { const r = await fetchImpl(origin + path, { redirect: "manual" }); return { status: r.status, redirectedTo: r.headers.get("location"), xRobotsTag: r.headers.get("x-robots-tag"), html: r.status >= 200 && r.status < 300 ? await r.text() : null }; };
      const fetchText = async (url) => { const r = await fetchImpl(url); return r.ok ? await r.text() : null; };
      const ctx = ctxOf(config, store, { client, fetchPage, fetchText, environment: "production" });
      const r = await refreshKeywordPerformance(ctx, { range: rangeArg(opt("--range"), config.analytics?.searchConsole?.keywordPerformance?.defaultRange), force: flag("--force") });
      out(r.ok ? `${r.message}${r.cached ? ` (data from ${r.fetchedAt})` : ""}` : `Not refreshed (${r.kind}): ${r.message}${r.stale ? " The previous data is kept." : ""}`);
      if (flag("--targets") || !(await store.get(KW_KEYS.targets))) {
        const t = await refreshTargets(ctx, registryOf(inventory, { siteId }), { force: flag("--force") });
        out(t.ok ? (t.cached ? "Target pages: served from cache." : `Target pages checked: ${t.checked}.`) : `Target pages not checked (${t.kind}): ${t.message}`);
      }
      saveLocalStore(config, project, store);
      await rebuildSummary(config, project, store, inventory);
      return r.ok ? 0 : 1;
    }
    if (cmd === "pull") {
      const got = pullFromKv(config, project, { exec });
      for (const [k, v] of Object.entries(got)) await store.put(k, v);
      saveLocalStore(config, project, store);
      const d = await rebuildSummary(config, project, store, inventory);
      out(`Saved ${join(dataDirOf(config, project), "store.json")} and summary.json (data from ${d.lastUpdated}).`);
      return 0;
    }
    // everything below reads the local copy only
    const data = await getKeywordPerformance(ctxOf(config, store), { inventory, siteId });
    if (!data.snapshot && !["status", "discovered", "table", "analyze", "page", "investigate"].includes(cmd)) { err("Unknown command."); return 2; }
    if (cmd === "status") {
      await rebuildSummary(config, project, store, inventory); // refreshes what /BWESEO reads from the local copy
      const s = data.summary;
      out(["KEYWORD PERFORMANCE", `Keywords ........ ${s.keywords} registered`, `Period .......... ${data.snapshot?.range?.label ?? "no data pulled yet"}`, `Last updated .... ${data.lastUpdated ?? "never"}${data.stale ? " (stale)" : ""}`, ...(data.lastError ? [`Last error ...... ${data.lastError.kind}: ${data.lastError.message}`] : []), "", ...Object.entries(s.byPriority).map(([k, v]) => `${k.padEnd(18, " ")} ${v}`), "", `Google shows another page: ${s.mismatches} · competing pages: ${s.cannibalization} · new queries: ${s.discovered}`].join("\n"));
      return 0;
    }
    if (cmd === "analyze") {
      if (!argv[1]) { err('Usage: seo-keywords.mjs analyze "<keyword>"'); return 2; }
      const r = await lookupKeyword(ctxOf(config, store), { inventory, keyword: argv[1] });
      out(`Source: ${r.source}${r.lastUpdated ? ` - last updated ${r.lastUpdated}` : " - no data has been pulled yet"}\n`);
      out(formatKeywordAnalysis(r.analysis));
      return 0;
    }
    if (cmd === "table") {
      const f = opt("--filter") ?? "all";
      if (!TABLE_FILTERS.includes(f)) { err(`filter must be one of ${TABLE_FILTERS.join(", ")}`); return 2; }
      for (const r of queryTable(tableRows(data.analyses), { filter: f, sort: opt("--sort"), q: opt("--q") ?? "" })) out(`${r.priority.padEnd(18)} ${r.keyword.padEnd(34)} ${String(r.targetPage ?? "-").padEnd(36)} impr ${String(r.impressions).padStart(6)}  clicks ${String(r.clicks).padStart(4)}  pos ${r.position ?? "-"}  ${r.indexStatus}${r.issue ? "  [" + r.issue + "]" : ""}`);
      return 0;
    }
    if (cmd === "page") {
      if (!argv[1]) { err("Usage: seo-keywords.mjs page <path>"); return 2; }
      const rec = (await store.get(GI_KEYS.registry))?.records?.[argv[1]] ?? null;
      out(JSON.stringify(pageView({ path: argv[1], index: data.index, prevIndex: data.prevIndex, registry: data.registry, validation: data.analyses.find((a) => a.target?.path === argv[1])?.validation ?? null, indexRecord: rec, range: data.snapshot?.range ?? null, inventory }), null, 2));
      return 0;
    }
    if (cmd === "investigate") {
      const hot = data.analyses.filter((a) => ["FIX NOW"].includes(a.status.priority) || a.signals.includes("target-mismatch") || a.signals.includes("cannibalization"));
      if (!hot.length) out("Nothing needs investigating from the data pulled so far.");
      for (const a of hot) out(`${a.status.priority}  "${a.keyword}" -> ${a.target?.path}\n  ${a.status.headline}\n${a.status.actions.slice(0, 3).map((x) => `  - ${x.text} (${x.because})`).join("\n")}\n`);
      return 0;
    }
    if (cmd === "discovered") {
      if (opt("--action")) {
        const r = applyDiscoveredAction(inventory, { query: opt("--query"), action: opt("--action"), pageId: opt("--page"), on: iso().slice(0, 10) });
        if (!r.ok) { err(r.error); return 1; }
        if (r.changed !== false) saveInventory(r.inventory);
        out(`Recorded: ${opt("--action")} "${opt("--query")}". No page was created.${r.note ? " " + r.note : ""}`);
        return 0;
      }
      if (!data.discovered.length) out("No unregistered queries with enough impressions yet.");
      for (const d of data.discovered) out(`"${d.query}"  impressions ${d.impressions}  clicks ${d.clicks}  position ${d.position}  page ${d.rankingPage}${d.decision ? "  [" + d.decision + "]" : ""}\n  suggestion: ${d.suggestion.action} - ${d.suggestion.because}`);
      return 0;
    }
    err("Usage: seo-keywords.mjs validate | list | add | remove | refresh | pull | status | analyze | table | page | discovered | investigate   [--project <dir>]");
    return 2;
  } catch (e) {
    err(`Error: ${redact(e?.message ?? e).slice(0, 300)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) cli(process.argv.slice(2)).then((c) => process.exit(c));
