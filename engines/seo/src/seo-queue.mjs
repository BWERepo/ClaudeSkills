#!/usr/bin/env node
// BWESEO unified improvement queue — developer CLI (Node 18+). Makes no network call and changes no module's own records.
//
//   node seo/tools/seo-queue.mjs build [--regression report.json]    gather the modules' existing records into seo/data/improvement-queue.json (writes only that file)
//   node seo/tools/seo-queue.mjs list [--status open] [--category keyword] [--json]    the queue in priority order
//   node seo/tools/seo-queue.mjs next [--json]                       the next eligible action across all modules, and what was skipped and why
//   node seo/tools/seo-queue.mjs explain <id> [--json]               one item: evidence, freshness, priority factors, history, verification
//   node seo/tools/seo-queue.mjs decide <id> --to approved|in-progress|fixed|resolved|deferred|wont-fix|open --by "<name>" [--note "<why>"]
//   node seo/tools/seo-queue.mjs assign <id> --owner "<name>" --by "<name>"
//
// Sources read (all customer-local): seo/content-inventory.json issues, seo/data/local-gbp/recommendations.json, the stored keyword data
// (seo/data/keyword-performance/store.json), seo/data/landing/state.json, and the regression module's findings (seo/data/regression/findings.json), the search-watch daily findings (seo/data/search-watch/findings.json), or a saved report
// (--regression, or seo/data/regression/report.json). Exit codes: 0 ok, 1 refused or nothing to show, 2 not a BWESEO project, 3 usage error.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeJsonAtomic, readJsonStrict, withFileLock } from "./safe-write.mjs";
import { migrateQueue, reconcile, decide, readModel, nextAction } from "./improvement-queue.mjs";
import { fromInventoryIssues, fromGbpRecommendations, fromKeywordAnalyses, fromLandingState, fromRegressionReport, fromRegressionStore, fromSearchWatch } from "./improvement-sources.mjs";
import { regrade } from "./evidence.mjs";

const MUTATING = new Set(["build", "decide", "assign"]);
export const queuePath = (project, config) => join(project, config?.paths?.data ?? "seo/data", "improvement-queue.json");

export async function main(argv, opts = {}) {
  const project = resolve(opts.project ?? flagOf(argv, "--project") ?? opts.cwd ?? process.cwd());
  const err = opts.err ?? ((s) => console.error(s));
  const cfgPath = join(project, "seo", "seo-config.json");
  if (!existsSync(cfgPath)) { err("No seo/seo-config.json here - run this from the website project (or pass --project <dir>)."); return 2; }
  const config = readJsonStrict(cfgPath, {});
  if (!MUTATING.has(argv[0])) return run(argv, project, config, opts);
  try { return await withFileLock(queuePath(project, config), () => run(argv, project, config, opts)); } catch (e) { if (e.code === "BUSY") { err(e.message); return 1; } throw e; }
}

function flagOf(a, n) { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; }

async function gather(project, config, { regression, now }) {
  const data = join(project, config.paths?.data ?? "seo/data");
  const observedAt = new Date(now).toISOString().slice(0, 10);
  const batches = [];
  const invPath = join(project, config.paths?.contentInventory ?? "seo/content-inventory.json");
  if (existsSync(invPath)) batches.push(fromInventoryIssues(readJsonStrict(invPath, {}), { observedAt, now }));
  const gbp = join(data, "local-gbp", "recommendations.json");
  if (existsSync(gbp)) batches.push(fromGbpRecommendations(readJsonStrict(gbp, []), { observedAt, now }));
  const landing = join(data, "landing", "state.json");
  if (existsSync(landing)) batches.push(fromLandingState(readJsonStrict(landing, {}), { observedAt, now }));
  const kwStore = join(data, "keyword-performance", "store.json");
  if (existsSync(kwStore)) {
    const [{ loadLocalStore }, { getKeywordPerformance }, { productionOrigin }] = await Promise.all([import("./seo-keywords.mjs"), import("./keyword-performance-run.mjs"), import("./seo-state-core.mjs")]);
    const inventory = existsSync(invPath) ? readJsonStrict(invPath, { pages: [] }) : { pages: [] };
    const kp = await getKeywordPerformance({ store: loadLocalStore(config, project), site: { productionUrl: productionOrigin(config) || config.website || null }, cfg: config.analytics?.searchConsole?.keywordPerformance?.thresholds, now: () => now }, { inventory });
    batches.push(fromKeywordAnalyses(kp.analyses, { observedAt, snapshot: kp.snapshot, now, siteHasData: !!kp.snapshot }));
  }
  const watch = join(data, "search-watch", "findings.json");
  if (existsSync(watch) && config.analytics?.searchConsole?.searchWatch?.enabled !== false) batches.push(fromSearchWatch(readJsonStrict(watch, {}), { now }));
  const regStore = join(data, "regression", "findings.json");
  if (!regression && existsSync(regStore)) batches.push(fromRegressionStore(readJsonStrict(regStore, {}), { now }));
  const regPath = regression ? resolve(project, regression) : join(data, "regression", "report.json");
  if (regression || (!existsSync(regStore) && existsSync(regPath))) {
    if (!existsSync(regPath)) throw new Error(`regression report not found: ${regression}`);
    batches.push(fromRegressionReport(readJsonStrict(regPath, {}), { now }));
  }
  return batches;
}

async function run(argv, project, config, { out = (s) => console.log(s), err = (s) => console.error(s), now = Date.now() } = {}) {
  const [cmd = "list", ...rest] = argv;
  const flag = (n) => flagOf(rest, n);
  const json = rest.includes("--json");
  const file = queuePath(project, config);
  let queue, notes;
  try { ({ queue, notes } = migrateQueue(readJsonStrict(file, null))); } catch (e) { err(e.message); return 1; }
  const site = (config.environments?.production?.url ?? config.website ?? null) || null;
  if (!queue.scope.site && site) queue.scope.site = site;
  const show = (v, text) => out(json ? JSON.stringify(v, null, 2) : text);

  if (cmd === "build") {
    let batches;
    try { batches = await gather(project, config, { regression: flag("--regression"), now }); } catch (e) { err(e.message); return 1; }
    let next, changes;
    try { ({ queue: next, changes } = reconcile(queue, batches, { now, site })); } catch (e) { err(e.message); return 1; }
    writeJsonAtomic(file, next);
    const count = (ev) => changes.filter((c) => c.event === ev || (ev === "resolved" && c.event === "status-from-source" && c.to === "resolved")).length;
    show({ file, sources: batches.map((b) => `${b.module}/${b.check}:${b.status}`), changes, migrated: notes }, `Queue updated: ${next.items.length} item(s) - ${count("found")} new, ${count("resolved")} resolved, ${count("unconfirmed")} unconfirmed (a check did not complete), ${count("reappeared")} reappeared.\nSources: ${batches.map((b) => `${b.module}/${b.check} ${b.status}`).join(", ") || "none found"}.\nNothing in the source records was changed.`);
    return 0;
  }
  if (cmd === "list") {
    const m = readModel(queue, { now });
    let items = m.items;
    if (flag("--status")) items = items.filter((i) => i.status === flag("--status"));
    if (flag("--category")) items = items.filter((i) => i.category === flag("--category"));
    if (json) { out(JSON.stringify({ ...m, items }, null, 2)); return 0; }
    if (!items.length) { out(queue.items.length ? "No items match." : "The queue is empty. Run: build"); return 0; }
    for (const i of items) out(`${String(i.priority.position).padStart(3)}. ${i.id} [${i.status}] ${i.severity.toUpperCase()} ${i.category} - ${i.title}${i.eligibility.eligible ? "" : `  (waiting: ${i.eligibility.reason})`}`);
    return 0;
  }
  if (cmd === "next") {
    const n = nextAction(queue, { now });
    show({ action: n.action, reason: n.reason, item: n.item, why: n.why, skipped: n.skipped }, n.item ? `Next: ${n.action.toUpperCase()} ${n.item.id} - ${n.item.title}\nWhy this one: ${n.why.join("; ")}\nWhat it needs: ${n.reason}${n.skipped.length ? `\nHigher-ranked items not yet actionable:\n${n.skipped.map((s) => `  ${s.id}: ${s.reason}`).join("\n")}` : ""}` : `Nothing to do: ${n.reason}.`);
    return n.item ? 0 : 1;
  }
  const id = rest[0];
  if (cmd === "explain") {
    const it = readModel(queue, { now }).items.find((i) => i.id === id);
    if (!it) { err(`no queue item "${id ?? ""}"`); return 1; }
    const graded = it.evidence.map((e) => regrade(e, now));
    show({ ...it, evidence: graded }, [
      `${it.id} [${it.status}] ${it.severity} ${it.category} - ${it.title}`, `Where: ${it.target.kind} ${it.target.ref}  |  Source: ${it.source.module}${it.source.check ? `/${it.source.check}` : ""}`,
      `Seen: first ${it.firstObservedOn ?? "unknown"}, last ${it.lastObservedOn ?? "unknown"}  |  Last check: ${it.check ? `${it.check.status} on ${it.check.on}` : "unknown"}`,
      `Do: ${it.recommendation.action}${it.recommendation.reason ? `\nWhy: ${it.recommendation.reason}` : ""}`,
      `Priority #${it.priority.position}: ${it.priority.factors.join("; ")}`, `Effort: ${it.effort.level} | Owner: ${it.owner ?? "unassigned"} | Depends on: ${it.dependencies.join(", ") || "nothing recorded"}`,
      `Can it be acted on now? ${it.eligibility.eligible ? `yes - ${it.eligibility.action}: ${it.eligibility.reason}` : `no - ${it.eligibility.reason}`}`,
      `Evidence:\n${graded.map((e) => `  - ${e.source}: observed ${e.observedAt ?? "unknown"}, coverage ${e.coverage}, ${e.freshness}, confidence ${e.confidence}${e.unavailable ? `, unavailable: ${e.unavailable}` : ""}`).join("\n") || "  none recorded"}`,
      `Missing information: ${it.missingInformation.join("; ") || "none recorded"}`,
      `Verify by:\n${it.verification.criteria.map((c) => `  - ${c}`).join("\n") || "  - no criteria recorded by the source"}${it.verification.result ? `\nLast verification: ${JSON.stringify(it.verification.result)}` : ""}`,
      `History:\n${it.history.map((h) => `  ${h.at} ${h.event}${h.from ? ` ${h.from} -> ${h.to}` : ""}${h.by ? ` by ${h.by}` : ""}${h.note ? ` (${h.note})` : ""}`).join("\n")}`,
    ].join("\n"));
    return 0;
  }
  if (cmd === "decide" || cmd === "assign") {
    try {
      const next = cmd === "decide" ? decide(queue, id, { to: flag("--to"), by: flag("--by"), note: flag("--note") ?? "", owner: flag("--owner"), now }) : decide(queue, id, { owner: flag("--owner") ?? "", by: flag("--by"), now });
      writeJsonAtomic(file, next);
      const it = next.items.find((x) => x.id === id);
      show({ id, status: it.status, owner: it.owner }, `${id} is now ${it.status}${it.owner ? `, owner ${it.owner}` : ""}. Recorded in its history.`);
      return 0;
    } catch (e) { err(e.message); return e.message.startsWith("no queue item") || e.message.includes("not allowed") ? 1 : 3; }
  }
  err(`unknown command "${cmd}" (build, list, next, explain, decide, assign)`);
  return 3;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e?.stack ?? e); process.exit(3); });
