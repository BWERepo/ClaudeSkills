#!/usr/bin/env node
// BWESEO search watch — developer CLI (Node 18+). The Google search monitoring workflow for one website, kept in the project's own data.
//
//   node seo/tools/seo-watch.mjs status [--json]                      on/off, pages tracked, inbox, last runs, quota used today
//   node seo/tools/seo-watch.mjs enable --by "<name>"                 switch the workflow on (it is ON by default after an install)
//   node seo/tools/seo-watch.mjs disable --by "<name>"                switch it off; nothing is deleted and no file is changed on the site
//   node seo/tools/seo-watch.mjs notify <url|path> --event published|changed|removed [--lastmod 2026-10-26] [--canonical <url>] [--noindex]
//        the call the website's publish step makes for every page it publishes, changes or removes (writes one inbox file; never fails a build when off)
//   node seo/tools/seo-watch.mjs seed --sitemap <file>                load the pages of an existing sitemap into the ledger (do this once, before the first sync)
//   node seo/tools/seo-watch.mjs sync [--dry-run] [--allow-shrink]    apply the inbox, then rewrite the sitemap atomically (refuses to drop more than maxShrinkPercent of it)
//   node seo/tools/seo-watch.mjs daily [--no-inspect] [--today YYYY-MM-DD]   check new pages and a rotating sample: crawl (read-only GETs of production) and URL Inspection; saves findings
//   node seo/tools/seo-watch.mjs weekly [--rows rows.json] [--today YYYY-MM-DD] [--json]   weekly report: traffic week on week, the three most useful fixes
//   node seo/tools/seo-watch.mjs findings [--json]                    the current findings, pages waiting for Google, and unconfirmed failures
//
// Data: <paths.data>/search-watch/ (ledger.json, state.json, findings.json, inbox/, reports/). Config: analytics.searchConsole.searchWatch
// { enabled (default true), sitemapPath (default public/sitemap.xml), sampleSize, newPerRun, dailyInspectionCap, graceDays, confirmAfter,
//   maxShrinkPercent, crawlDelayMs }. Only `daily` (and `weekly` without --rows) makes network requests: read-only GETs of the site's own
// production pages and the official Search Console API with the credential NAMED in the configuration. Nothing here deploys, requests indexing,
// or submits a URL. Exit codes: 0 ok, 1 refused / nothing to do / finished but set an unreadable inbox file aside, 2 not a BWESEO project, 3 usage error.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileAtomic, writeJsonAtomic, readJsonStrict, withFileLock } from "./safe-write.mjs";
import { fetchChain } from "./seo-site-checks.mjs";
import { extractHead } from "./post-publish-check.mjs";
import { normalizeUrl } from "./index-monitor.mjs";
import { createSearchConsoleClient } from "./gsc-client.mjs";
import { productionOrigin } from "./seo-state-core.mjs";
import {
  resolveWatchConfig, newLedger, migrateLedger, newState, migrateState, applyEvents, seedFromSitemap, buildSitemaps, shrinkCheck,
  selectTargets, crawlFacts, inspectionFacts, deriveFindings, quotaLeft, compareWeeks, topFixes, WATCH_SCHEMA_VERSION,
} from "./search-watch.mjs";

const MUTATING = new Set(["enable", "disable", "notify", "seed", "sync", "daily", "weekly"]);
const FATAL = new Set(["permission-denied", "auth-failed", "not-configured", "disabled", "quota"]);
const flagOf = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const iso = (t) => new Date(t).toISOString();

export const watchSettings = (config) => config?.analytics?.searchConsole?.searchWatch ?? {};
// ON unless the project says otherwise: installing the engine turns the workflow on.
export const isEnabled = (config) => watchSettings(config).enabled !== false;
export const watchDir = (project, config) => join(project, config?.paths?.data ?? "seo/data", "search-watch");

export async function main(argv, opts = {}) {
  const project = resolve(opts.project ?? flagOf(argv, "--project") ?? opts.cwd ?? process.cwd());
  const err = opts.err ?? ((s) => console.error(s));
  const cfgPath = join(project, "seo", "seo-config.json");
  if (!existsSync(cfgPath)) { err("No seo/seo-config.json here - run this from the website project (or pass --project <dir>)."); return 2; }
  let config;
  try { config = readJsonStrict(cfgPath, {}); } catch (e) { err(e.message); return 1; }
  if (!MUTATING.has(argv[0])) return run(argv, project, config, opts);
  try { return await withFileLock(join(watchDir(project, config), "state"), () => run(argv, project, config, opts)); } catch (e) { if (e.code === "BUSY") { err(e.message); return 1; } throw e; }
}

function load(project, config) {
  const dir = watchDir(project, config);
  const ledger = migrateLedger(readJsonStrict(join(dir, "ledger.json"), null));
  const state = migrateState(readJsonStrict(join(dir, "state.json"), null));
  return { dir, ledger, state };
}

function sitemapTarget(project, config) {
  const rel = watchSettings(config).sitemapPath ?? "public/sitemap.xml";
  const abs = resolve(project, rel);
  if (abs !== project && !abs.startsWith(project + sep)) throw new Error(`searchWatch.sitemapPath "${rel}" is outside the project; refusing to write there`);
  return abs;
}

function inboxFiles(dir) {
  const inbox = join(dir, "inbox");
  return existsSync(inbox) ? readdirSync(inbox).filter((n) => n.endsWith(".json")).sort() : [];
}

// Plan a sitemap regeneration without writing. Returns what would be written and whether it matches the file on disk.
function planSitemap({ project, config, ledger, state, origin }) {
  const cfg = resolveWatchConfig(watchSettings(config));
  const target = sitemapTarget(project, config);
  const built = buildSitemaps(ledger, { origin, checks: state.pages, maxUrls: cfg.maxUrlsPerSitemap, sitemapName: target.split(sep).pop() });
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  const shrink = shrinkCheck(current, built.included, cfg.maxShrinkPercent);
  const dirOf = target.slice(0, target.length - built.files[0].name.length);
  const changed = built.files.filter((f) => !existsSync(dirOf + f.name) || readFileSync(dirOf + f.name, "utf8") !== f.xml).map((f) => f.name);
  return { built, shrink, changed, dirOf, target, current };
}

async function run(argv, project, config, { out = (s) => console.log(s), err = (s) => console.error(s), now = Date.now(), fetchImpl, client, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const [cmd = "status", ...rest] = argv;
  const flag = (n) => flagOf(rest, n);
  const json = rest.includes("--json");
  const show = (v, text) => out(json ? JSON.stringify(v, null, 2) : text);
  const today = flag("--today") ?? iso(now).slice(0, 10);
  const origin = productionOrigin(config) || config.website || null;
  const settings = watchSettings(config);
  const cfgPath = join(project, "seo", "seo-config.json");

  if (cmd === "enable" || cmd === "disable") {
    const by = flag("--by");
    if (!by || !by.trim()) { err(`${cmd} needs --by "<name>"`); return 3; }
    const next = JSON.parse(JSON.stringify(config));
    next.analytics = next.analytics ?? {}; next.analytics.searchConsole = next.analytics.searchConsole ?? {};
    next.analytics.searchConsole.searchWatch = { ...settings, enabled: cmd === "enable", changedBy: by, changedOn: today };
    writeJsonAtomic(cfgPath, next);
    show({ enabled: cmd === "enable" }, cmd === "enable" ? "Search watch is ON. Sitemap sync, the daily check and the weekly report may run." : "Search watch is OFF. Existing data is kept; nothing runs until you enable it again.");
    return 0;
  }

  if (cmd === "notify" && !isEnabled(config)) { out("Search watch is off; the event was not recorded (this is not an error)."); return 0; }
  if (!["status", "findings"].includes(cmd) && !isEnabled(config)) { err("Search watch is switched off for this project. Turn it on with: node seo/tools/seo-watch.mjs enable --by \"<name>\""); return 1; }
  if (!origin && cmd !== "status") { err("No production URL is configured (environments.production.url); the workflow needs one."); return 1; }

  let data;
  try { data = load(project, config); } catch (e) { err(e.message); return 1; }
  const { dir, ledger, state } = data;
  const cfg = resolveWatchConfig(settings);

  if (cmd === "status") {
    const live = Object.values(ledger.pages).filter((p) => p.status === "live").length;
    const s = { enabled: isEnabled(config), pagesLive: live, pagesRemoved: Object.keys(ledger.pages).length - live, inboxPending: inboxFiles(dir).length, cursor: state.cursor, quotaUsedToday: state.quota?.date === iso(now).slice(0, 10) ? state.quota.used : 0, dailyInspectionCap: cfg.dailyInspectionCap, lastRun: state.runs.at(-1) ?? null, schema: WATCH_SCHEMA_VERSION };
    show(s, [`Search watch: ${s.enabled ? "ON" : "OFF"}${settings.enabled === undefined ? " (default after install)" : ""}`, `Pages tracked: ${live} live, ${s.pagesRemoved} removed`, `Inbox: ${s.inboxPending} event file(s) waiting for sync`, `Rotation cursor: ${s.cursor ?? "start"}  |  Inspections used today: ${s.quotaUsedToday}/${cfg.dailyInspectionCap}`, `Last daily run: ${s.lastRun ? `${s.lastRun.at} (${s.lastRun.status}, ${s.lastRun.checked} checked)` : "never"}`].join("\n"));
    return 0;
  }

  if (cmd === "notify") {
    const target = rest.find((a, i) => !a.startsWith("--") && !["--event", "--lastmod", "--canonical", "--project"].includes(rest[i - 1]));
    const ev = { event: flag("--event"), url: target, lastmod: flag("--lastmod") ?? null, canonical: flag("--canonical") ?? null, noindex: rest.includes("--noindex") };
    const { normalizeEvent } = await import("./search-watch.mjs");
    const r = normalizeEvent(ev, origin);
    if (!r.ok) { err(`event not recorded: ${r.reason}`); return 3; }
    const name = `${iso(now).replace(/[-:.]/g, "")}-${randomBytes(3).toString("hex")}.json`;
    writeJsonAtomic(join(dir, "inbox", name), ev);
    show({ file: name, event: r.entry }, `Recorded ${r.entry.event} for ${r.entry.path}. The next sync ${r.entry.event === "removed" ? "takes it out of" : "updates"} the sitemap.`);
    return 0;
  }

  if (cmd === "seed") {
    const f = flag("--sitemap");
    if (!f) { err("seed needs --sitemap <file>"); return 3; }
    const xml = readFileSync(resolve(project, f), "utf8");
    const { ledger: next, report } = seedFromSitemap(ledger, xml, { origin, now });
    writeJsonAtomic(join(dir, "ledger.json"), { ...next, site: origin });
    show(report, `Seeded ${report.added.length} page(s) from ${f}; ${report.rejected.length} entr${report.rejected.length === 1 ? "y" : "ies"} ignored (off-origin or unreadable).`);
    return 0;
  }

  if (cmd === "sync") {
    const files = inboxFiles(dir);
    const events = [], bad = [];
    for (const n of files) {
      try { const v = JSON.parse(readFileSync(join(dir, "inbox", n), "utf8")); events.push(...(Array.isArray(v) ? v : [v])); } catch (e) { bad.push({ file: n, reason: `not valid JSON (${e.message})` }); }
    }
    const { ledger: next, report } = applyEvents({ ...ledger, site: ledger.site ?? origin }, events, { origin, now });
    if (!Object.keys(next.pages).length) { err("The ledger has no pages. Load the current sitemap first: seed --sitemap <file>, or notify the pages."); return 1; }
    const plan = planSitemap({ project, config, ledger: next, state, origin });
    const result = { events: events.length, ...report, badFiles: bad, sitemap: { included: plan.built.included, excluded: plan.built.excluded, wouldWrite: plan.changed, shrink: plan.shrink, path: relative(project, plan.target) } };
    if (!plan.shrink.ok && !rest.includes("--allow-shrink")) {
      err(`Refused: the new sitemap has ${plan.shrink.next} URL(s) and the current file has ${plan.shrink.current} (${plan.shrink.percent}% fewer; the limit is ${plan.shrink.limit}%). Nothing was written and the inbox is untouched. If the pages are really gone, run again with --allow-shrink; if the ledger is incomplete, run seed --sitemap <file>.`);
      return 1;
    }
    if (rest.includes("--dry-run")) { show({ ...result, dryRun: true }, formatSync(result, true)); return 0; }
    for (const f of plan.built.files) if (plan.changed.includes(f.name)) writeFileAtomic(plan.dirOf + f.name, f.xml);
    writeJsonAtomic(join(dir, "ledger.json"), next);
    for (const n of files) {
      const isBad = bad.some((b) => b.file === n);
      const to = join(dir, "inbox", isBad ? "rejected" : "processed");
      mkdirSync(to, { recursive: true });
      renameSync(join(dir, "inbox", n), join(to, n));
    }
    show(result, formatSync(result, false));
    return bad.length ? 1 : 0; // completed, but a file had to be set aside: a scheduler should notice
  }

  if (cmd === "findings") {
    const f = readJsonStrict(join(dir, "findings.json"), null);
    if (!f) { err("No findings yet. Run: daily"); return 1; }
    show(f, formatFindings(f));
    return 0;
  }

  if (cmd === "daily") {
    if (!Object.keys(ledger.pages).length) { err("The ledger has no pages. Load the current sitemap first: seed --sitemap <file>."); return 1; }
    const noInspect = rest.includes("--no-inspect");
    let inspector = null, inspectorNote = null;
    if (noInspect) inspectorNote = "inspection was switched off for this run";
    else {
      inspector = client ?? createSearchConsoleClient({ config, env: process.env });
      if (!inspector.available) { inspectorNote = inspector.status?.reason ?? "the Search Console API is not available"; inspector = null; }
    }
    const f = fetchImpl ?? ((url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }));
    const sel = selectTargets(ledger, state, cfg, { now, inspector: !!inspector });
    const order = [...sel.newPaths.map((p) => ({ p, kind: "new" })), ...sel.samplePaths.map((p) => ({ p, kind: "sample" }))];
    const todayKey = iso(now).slice(0, 10);
    let quota = state.quota?.date === todayKey ? { ...state.quota } : { date: todayKey, used: 0 };
    const pages = { ...state.pages };
    const checked = [], problems = [];
    let stopped = null, consecutive = 0, cursor = state.cursor, sampleOk = true;
    for (const [i, t] of order.entries()) {
      if (i > 0 && cfg.crawlDelayMs) await sleep(cfg.crawlDelayMs);
      const page = ledger.pages[t.p];
      const res = await fetchChain(f, page.url);
      const crawl = crawlFacts(res, page, { parseHead: extractHead, now });
      const prev = pages[t.p] ?? {};
      let rec = { ...prev, crawl, crawlFailures: crawl.ok ? 0 : (prev.crawlFailures ?? 0) + 1 };
      let inspected = !inspector;
      if (inspector) {
        quota.used += 1;
        const r = await inspector.inspectUrl(page.url);
        if (r.ok) {
          const facts = inspectionFacts(r.data, origin, now);
          rec = { ...rec, inspect: facts };
          inspected = facts.ok; consecutive = facts.ok ? 0 : consecutive + 1;
          if (!facts.ok) problems.push({ path: t.p, stage: "inspect", kind: "malformed", message: facts.message });
        } else {
          problems.push({ path: t.p, stage: "inspect", kind: r.kind, message: String(r.message ?? "").slice(0, 160) });
          consecutive += 1;
          if (FATAL.has(r.kind) || consecutive >= 3) stopped = { kind: r.kind, message: r.message ?? "three inspections in a row failed" };
        }
      }
      if (inspected) { rec.lastCheckedAt = iso(now); checked.push({ path: t.p, kind: t.kind }); if (t.kind === "sample" && sampleOk) cursor = t.p; }
      else if (t.kind === "sample") sampleOk = false;
      pages[t.p] = rec;
      if (stopped) break;
    }
    const nextState = { ...state, site: state.site ?? origin, cursor, quota, pages, runs: [...state.runs, { at: iso(now), status: stopped || sel.quotaBlocked ? "partial" : "complete", checked: checked.length, newChecked: checked.filter((c) => c.kind === "new").length, sampled: checked.filter((c) => c.kind === "sample").length, stopped: stopped?.kind ?? null, inspector: inspector ? "used" : inspectorNote }].slice(-30) };
    const d = deriveFindings(ledger, nextState, cfg, { now });
    const live = new Set(Object.values(ledger.pages).filter((p) => p.status === "live").map((p) => p.path));
    // Findings are derived from the latest stored evidence for every page that has been checked, so a page that is no longer reported
    // has newer evidence saying it is fine; pages never checked, and runs that stopped early (status partial), resolve nothing.
    const covered = [...new Set([...Object.keys(nextState.pages).filter((p) => nextState.pages[p].lastCheckedAt), ...Object.keys(ledger.pages).filter((p) => !live.has(p))])];
    const run = nextState.runs.at(-1);
    const report = { watchSchemaVersion: WATCH_SCHEMA_VERSION, run: { observedAt: iso(now), status: run.status, coveredRefs: covered, checked: checked.length, inspector: run.inspector, stopped: stopped ?? null, quotaBlocked: sel.quotaBlocked, backlogNew: sel.backlog, quotaLeft: inspector ? quotaLeft(nextState, now, cfg.dailyInspectionCap) : null }, ...d, problems };
    const sm = planSitemap({ project, config, ledger, state: nextState, origin });
    report.sitemapInSync = sm.changed.length === 0;
    writeJsonAtomic(join(dir, "state.json"), nextState);
    writeJsonAtomic(join(dir, "findings.json"), report);
    show(report, formatDaily(report, inspectorNote));
    return stopped ? 1 : 0;
  }

  if (cmd === "weekly") {
    let rows;
    const rowsFile = flag("--rows");
    let source;
    if (rowsFile) {
      const v = readJsonStrict(resolve(project, rowsFile), null);
      if (!Array.isArray(v)) { err("the rows file must be a JSON array of { date, page, clicks, impressions, position? }"); return 3; }
      rows = v; source = `saved rows (${rowsFile})`;
    } else {
      const c = client ?? createSearchConsoleClient({ config, env: process.env });
      if (!c.available) { err(`No rows given and Search Console is not available (${c.status?.reason ?? "not configured"}). Pass --rows rows.json with saved daily page rows.`); return 1; }
      const { weeklyPeriods } = await import("./search-watch.mjs");
      const p = weeklyPeriods(today, 2);
      const got = await c.searchAnalytics({ startDate: p.before.start, endDate: p.after.end, dimensions: ["page", "date"], rowLimit: 25000, type: "web" });
      if (!got.ok) { err(`Search Console did not return rows (${got.kind}: ${got.message}). No report was written.`); return 1; }
      rows = (got.data?.rows ?? []).map((r) => ({ page: r.keys[0], date: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position }));
      source = "Search Console API (live)";
    }
    const norm = rows.map((r) => { const n = normalizeUrl(String(r.page ?? ""), origin); return n ? { ...r, page: n.path } : null; }).filter(Boolean);
    const comparison = compareWeeks(norm, today, { cfg: settings.outcomes ?? {}, origin });
    const findingsFile = readJsonStrict(join(dir, "findings.json"), null);
    const all = findingsFile?.findings ?? [];
    const outcomes = readJsonStrict(join(project, config.paths?.data ?? "seo/data", "outcomes.json"), null);
    const lo = comparison.periods.before.start;
    const recentChanges = (outcomes?.changes ?? []).filter((c) => (c.publishedAt ?? "").slice(0, 10) >= lo).map((c) => ({ id: c.id, page: c.page, publishedAt: c.publishedAt.slice(0, 10) }));
    const fixes = topFixes(all, comparison);
    const evidenceAgeDays = findingsFile ? Math.floor((now - Date.parse(findingsFile.run.observedAt)) / 86_400_000) : null;
    const report = { generatedOn: today, source, periods: comparison.periods, site: comparison.site, pages: comparison.pages, fixes, findingsCount: all.length, waiting: findingsFile?.waiting?.length ?? 0, unconfirmed: findingsFile?.unconfirmed?.length ?? 0, evidenceAgeDays, recentChanges, note: comparison.note, thresholds: comparison.cfg };
    const md = formatWeekly(report);
    writeFileAtomic(join(dir, "reports", `weekly-${today}.md`), md);
    writeJsonAtomic(join(dir, "reports", `weekly-${today}.json`), report);
    show(report, md);
    return 0;
  }

  err(`unknown command "${cmd}" (status, enable, disable, notify, seed, sync, daily, weekly, findings)`);
  return 3;
}

// ---------------------------------------------------------------- formatting

function formatSync(r, dry) {
  const l = [`${dry ? "Would sync" : "Synced"} ${r.events} event(s): ${r.added.length} added, ${r.changed.length} changed, ${r.removed.length} removed, ${r.unchanged.length} unchanged, ${r.rejected.length} rejected.`];
  l.push(`Sitemap ${r.sitemap.path}: ${r.sitemap.included} URL(s)${r.sitemap.wouldWrite.length ? `; ${dry ? "would write" : "wrote"} ${r.sitemap.wouldWrite.join(", ")}` : "; already up to date, nothing written"}.`);
  if (r.sitemap.excluded.length) l.push(`Left out: ${r.sitemap.excluded.map((e) => `${e.url} (${e.reason})`).join(", ")}.`);
  for (const x of r.rejected) l.push(`Rejected event ${x.index}${x.input ? ` (${x.input})` : ""}: ${x.reason}`);
  for (const b of r.badFiles) l.push(`Unreadable inbox file ${b.file}: ${b.reason}; moved to inbox/rejected.`);
  l.push("Google reads the new sitemap on its own schedule. To check or register it with Search Console: node seo/tools/seo-google.mjs sitemap (dry run first).");
  return l.join("\n");
}

function formatFindings(f) {
  const l = [`Daily check ${f.run.observedAt.slice(0, 10)}: ${f.run.status}, ${f.run.checked} page(s) checked.`];
  for (const x of f.findings) l.push(`  [${x.severity}] ${x.type} ${x.path} - ${x.detail} (${x.basis})`);
  if (!f.findings.length) l.push("  No findings.");
  for (const w of f.waiting) l.push(`  waiting: ${w.path} is ${w.ageDays} day(s) old and Google reports "${w.indexState}"; flagged after ${w.graceDays} days`);
  for (const u of f.unconfirmed) l.push(`  unconfirmed: ${u.path} ${u.detail} (${u.failures}/${u.confirmAfter} failed checks)`);
  return l.join("\n");
}

function formatDaily(r, note) {
  const l = [formatFindings(r)];
  if (note) l.push(`Indexing evidence: not collected this run - ${note}. No page was marked not indexed.`);
  if (r.run.stopped) l.push(`Stopped early: ${r.run.stopped.kind}. Pages not reached stay due and are picked up next run.`);
  if (r.run.quotaBlocked) l.push("The daily inspection allowance limited this run; the rest continue tomorrow.");
  if (r.run.backlogNew > 0) l.push(`${r.run.backlogNew} new page(s) are still waiting for their first check.`);
  if (r.problems.length) l.push(`Problems: ${r.problems.map((p) => `${p.path} ${p.stage} ${p.kind}`).join("; ")}`);
  if (!r.sitemapInSync) l.push("The sitemap on disk no longer matches the ledger and the latest crawl results. Run: sync");
  return l.join("\n");
}

const sign = (n) => (n > 0 ? `+${n}` : String(n));
function formatWeekly(r) {
  const p = r.periods;
  const m = (x) => (x.available ? `${x.before} -> ${x.after} (${sign(x.change)}${x.changePercent != null ? `, ${sign(x.changePercent)}%` : ""})` : `unavailable - ${x.reason}`);
  const l = [`# Weekly search report - ${r.generatedOn}`, "", `This week ${p.after.start} to ${p.after.end}, compared with ${p.before.start} to ${p.before.end}. Source: ${r.source}.`, "", "## Traffic", `- Clicks: ${m(r.site.clicks)}`, `- Impressions: ${m(r.site.impressions)}`];
  if (r.site.lowSample) l.push(`- Low sample: volumes are under ${r.thresholds.minImpressions} impressions or ${r.thresholds.minClicks} clicks in a week, so ordinary variation can look like a change.`);
  const movers = r.pages.filter((x) => x.clicks.available && !x.lowSample && x.clicks.change !== 0).sort((a, b) => Math.abs(b.clicks.change) - Math.abs(a.clicks.change)).slice(0, 5);
  if (movers.length) { l.push("", "Biggest page movers (clicks, pages above the low-sample limits):"); for (const x of movers) l.push(`- ${x.page}: ${m(x.clicks)}`); }
  const skipped = r.pages.filter((x) => x.lowSample).length, incomplete = r.pages.filter((x) => !x.clicks.available).length;
  if (skipped || incomplete) l.push("", `Not compared: ${skipped} page(s) with low volume, ${incomplete} page(s) with missing days.`);
  l.push("", "## The three most useful fixes");
  if (!r.fixes.fixes.length) l.push("No fix is supported by the evidence this week.");
  for (const f of r.fixes.fixes) { l.push(`${f.rank}. ${f.title}`, `   Pages: ${f.pages.slice(0, 8).join(", ")}${f.pages.length > 8 ? ` and ${f.pages.length - 8} more` : ""}`, ...f.reasons.map((x) => `   - ${x}`), `   Confidence: ${f.confidence}`); }
  if (r.fixes.shortfall) l.push("", `Note: ${r.fixes.shortfall}.`);
  l.push("", "## Evidence behind the fixes", r.evidenceAgeDays == null ? "- No daily check has run yet, so crawl and indexing evidence is missing." : `- Last daily check ${r.evidenceAgeDays} day(s) ago; ${r.findingsCount} open finding(s); ${r.waiting} new page(s) still waiting for Google; ${r.unconfirmed} failure(s) not yet confirmed.`);
  if (r.evidenceAgeDays != null && r.evidenceAgeDays > 3) l.push("- The daily check is more than 3 days old; the fixes may be out of date.");
  if (r.recentChanges.length) l.push(`- Page changes recorded in these two weeks (they may explain part of any movement): ${r.recentChanges.map((c) => `${c.id} ${c.page} ${c.publishedAt}`).join("; ")}.`);
  l.push("", `${r.note} Search Console is final about 2 days late, so the latest 2 days are left out.`);
  return l.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e?.stack ?? e); process.exit(3); });
