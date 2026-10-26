#!/usr/bin/env node
// BWESEO change-to-outcome history — developer CLI (Node 18+). Makes no network call; reads only the saved daily rows you give it.
//
//   node seo/tools/seo-outcomes.mjs record <id> --page /path --category content --published 2026-09-01 --by "<name>" [--hash <content hash> | --inventory-id <page id>] [--release <hash>] [--note "<text>"]
//   node seo/tools/seo-outcomes.mjs list [--json]                              the recorded changes and their review dates
//   node seo/tools/seo-outcomes.mjs due [--today YYYY-MM-DD]                   review dates that have arrived and are not yet recorded
//   node seo/tools/seo-outcomes.mjs compare <id> --rows rows.json [--today YYYY-MM-DD] [--json]   before/after over equal, complete periods (read-only)
//   node seo/tools/seo-outcomes.mjs review <id> --rows rows.json --review-date YYYY-MM-DD --by "<name>"   same comparison, and records it on the change
//
// rows.json: [{ "date": "YYYY-MM-DD", "clicks": 3, "impressions": 120, "conversions": 1, "position": 8.2 }] - only days the source reported; omit a
// field you do not have (it is then "unavailable", not 0). Data: seo/data/outcomes.json. Exit codes: 0 ok, 1 refused / nothing found, 2 not a BWESEO project, 3 usage error.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeJsonAtomic, readJsonStrict, withFileLock } from "./safe-write.mjs";
import { migrateOutcomes, recordChange, compareChange, dueReviews, recordReview, CAUSATION_NOTE } from "./outcome-history.mjs";

const flagOf = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
export const outcomesPath = (project, config) => join(project, config?.paths?.data ?? "seo/data", "outcomes.json");
const MUTATING = new Set(["record", "review"]);

export async function main(argv, opts = {}) {
  const project = resolve(opts.project ?? flagOf(argv, "--project") ?? opts.cwd ?? process.cwd());
  const err = opts.err ?? ((s) => console.error(s));
  const cfgPath = join(project, "seo", "seo-config.json");
  if (!existsSync(cfgPath)) { err("No seo/seo-config.json here - run this from the website project (or pass --project <dir>)."); return 2; }
  const config = readJsonStrict(cfgPath, {});
  if (!MUTATING.has(argv[0])) return run(argv, project, config, opts);
  try { return await withFileLock(outcomesPath(project, config), () => run(argv, project, config, opts)); } catch (e) { if (e.code === "BUSY") { err(e.message); return 1; } throw e; }
}

async function run(argv, project, config, { out = (s) => console.log(s), err = (s) => console.error(s), now = Date.now() } = {}) {
  const [cmd = "list", ...rest] = argv;
  const flag = (n) => flagOf(rest, n);
  const json = rest.includes("--json");
  const today = flag("--today") ?? new Date(now).toISOString().slice(0, 10);
  const cfg = config.analytics?.searchConsole?.outcomeHistory ?? {};
  const file = outcomesPath(project, config);
  let data;
  try { data = migrateOutcomes(readJsonStrict(file, null)); } catch (e) { err(e.message); return 1; }
  const show = (v, text) => out(json ? JSON.stringify(v, null, 2) : text);
  try {
    if (cmd === "record") {
      let contentHash = flag("--hash") ?? null;
      if (!contentHash && flag("--inventory-id")) {
        const inv = readJsonStrict(join(project, config.paths?.contentInventory ?? "seo/content-inventory.json"), { pages: [] });
        const page = inv.pages.find((p) => p.id === flag("--inventory-id"));
        if (!page) throw new Error(`no inventory page "${flag("--inventory-id")}"`);
        const { sourceState } = await import("./seo-state.mjs");
        contentHash = sourceState(project, page.source).hash;
        if (!contentHash) throw new Error("the page's source files were not found, so no content hash can be recorded; pass --hash or omit it");
      }
      data = { ...data, site: data.site ?? config.website ?? null };
      data = recordChange(data, { id: rest[0], page: flag("--page"), category: flag("--category") ?? "other", publishedAt: flag("--published"), contentHash, releaseHash: flag("--release") ?? null, by: flag("--by"), note: flag("--note") ?? "", now }, cfg);
      writeJsonAtomic(file, data);
      const c = data.changes.at(-1);
      show(c, `Recorded ${c.id} on ${c.page} (${c.category}), published ${c.publishedAt}. Baseline ${c.baseline.start}..${c.baseline.end}. Reviews on ${c.reviewDates.join(", ")}.${contentHash ? "" : " No content hash recorded."}`);
      return 0;
    }
    if (cmd === "list") {
      show(data, data.changes.length ? data.changes.map((c) => `${c.id}  ${c.page}  ${c.category}  ${c.publishedAt}  reviews ${new Set(c.reviews.map((r) => r.reviewDate)).size}/${c.reviewDates.length}  ${c.contentHash ?? "no hash"}`).join("\n") : "No changes recorded. Run: record <id> --page /path --published YYYY-MM-DD --by \"<name>\"");
      return 0;
    }
    if (cmd === "due") {
      const d = dueReviews(data, today);
      show(d, d.length ? d.map((x) => `${x.id} (${x.page}) review date ${x.reviewDate}`).join("\n") : "No reviews are due.");
      return 0;
    }
    if (cmd === "compare" || cmd === "review") {
      const c = data.changes.find((x) => x.id === rest[0]);
      if (!c) { err(`no change "${rest[0] ?? ""}"`); return 1; }
      const rowsFile = flag("--rows");
      if (!rowsFile) { err("needs --rows rows.json (saved daily rows)"); return 3; }
      const rows = readJsonStrict(resolve(project, rowsFile), null);
      if (!Array.isArray(rows)) { err("rows file must be a JSON array of daily rows"); return 3; }
      const r = compareChange(c, rows, { today, cfg, otherChanges: data.changes });
      if (cmd === "review") {
        if (r.status === "pending") { err(`not recorded: ${r.reason}`); show(r, ""); return 1; }
        data = recordReview(data, c.id, { reviewDate: flag("--review-date") ?? today, by: flag("--by"), comparison: r, now });
        writeJsonAtomic(file, data);
      }
      show(r, formatComparison(r));
      return 0;
    }
  } catch (e) { err(e.message); return 3; }
  err(`unknown command "${cmd}" (record, list, due, compare, review)`);
  return 3;
}

export function formatComparison(r) {
  const lines = [`${r.changeId} on ${r.page} (${r.category}), published ${r.publishedAt}`, `Before ${r.periods.before.start}..${r.periods.before.end}  |  After ${r.periods.after.start}..${r.periods.after.end}  |  status: ${r.status}`];
  if (r.status === "pending") return [...lines, r.reason].join("\n");
  for (const [k, m] of Object.entries(r.metrics)) lines.push(m.available ? `  ${k}: ${m.before} -> ${m.after}${m.change != null ? ` (${m.change >= 0 ? "+" : ""}${m.change}${m.changePercent != null ? `, ${m.changePercent >= 0 ? "+" : ""}${m.changePercent}%` : ""})` : ""}${m.note ? ` - ${m.note}` : ""}` : `  ${k}: unavailable - ${m.reason}`);
  if (r.flags?.length) lines.push("Limits:", ...r.limits.map((l) => `  - ${l}`), ...r.flags.map((f) => `  * ${f.id}: ${f.detail}`));
  lines.push(CAUSATION_NOTE);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e?.stack ?? e); process.exit(3); });
