#!/usr/bin/env node
// BWESEO SEO Landing Page Generator — developer CLI (Node 18+). Makes no network call and never publishes anything.
//
//   node seo/tools/seo-landing.mjs import <keywords.csv>                 add keywords (metrics stay "unavailable" unless sourced and dated)
//   node seo/tools/seo-landing.mjs add "<keyword>"                       add one keyword
//   node seo/tools/seo-landing.mjs plan --pages site-pages.json [--offerings "a,b"] [--brand "<name>"]   group by intent, decide new vs improve, rank
//   node seo/tools/seo-landing.mjs check <id> --page page.json [--prices "$1,$2"] [--cta "<text>"]       run the quality gate on a draft
//   node seo/tools/seo-landing.mjs move <id> --to draft|proposed|published [--by "<name>"]               status change (published needs approval)
//   node seo/tools/seo-landing.mjs approve <id> --by "<name>"            approve the exact draft content (any later edit voids it)
//   node seo/tools/seo-landing.mjs status                                the opportunities table
//
// Data: seo/data/landing/state.json (private). Pages come from `pages` in site-pages.json: [{ path,title,h1,h2[],description }].
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeJsonAtomic, readJsonStrict, withFileLock } from "./safe-write.mjs";
import { importKeywordsCsv, groupKeywords, targetedKeywords } from "./landing-keywords.mjs";
import { planOpportunities, proposeBasics, reconcileOpportunities } from "./landing-opportunities.mjs";
import { checkPage, approve, canTransition, contentHash, approvalState } from "./landing-quality.mjs";
import { normalizeKeyword } from "./keyword-registry.mjs";

const flag = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
const readJson = (p, d) => readJsonStrict(p, d);

export function statePath(cwd) { return join(cwd, "seo", "data", "landing", "state.json"); }
export function loadState(cwd) { return readJson(statePath(cwd), { version: 1, keywords: [], opportunities: [] }); }
// The exact content an approval covers: the draft plus its destination path (the opportunity's target unless the draft sets one).
const draftOf = (o, approval, status) => ({ ...(o.draft ?? {}), path: o.draft?.path ?? o.target, ...(approval ? { approval } : {}), ...(status ? { status } : {}) });
function save(cwd, s) { writeJsonAtomic(statePath(cwd), s); }

// Commands that read the state, change it and save it hold a file lock for the whole step, so two terminals (or a scheduled run
// and a manual one) cannot interleave and lose each other's changes; the file itself is replaced atomically on every save.
const MUTATING = new Set(["import", "add", "plan", "check", "approve", "move"]);
export async function main(argv, opts = {}) {
  const { cwd = process.cwd(), out = (s) => console.log(s) } = opts;
  if (!MUTATING.has(argv[0])) return run(argv, opts);
  try { return await withFileLock(statePath(cwd), () => run(argv, opts)); } catch (e) { if (e.code === "BUSY") { out(e.message); return 1; } throw e; }
}
async function run(argv, { cwd = process.cwd(), out = (s) => console.log(s), today = new Date().toISOString().slice(0, 10) } = {}) {
  const [cmd, ...rest] = argv;
  const s = loadState(cwd);
  const inv = readJson(join(cwd, "seo", "content-inventory.json"), { pages: [] });
  if (cmd === "import" || cmd === "add") {
    const text = cmd === "add" ? rest[0] ?? "" : readFileSync(resolve(cwd, rest[0] ?? ""), "utf8");
    const r = importKeywordsCsv(text);
    const have = new Set(s.keywords.map((k) => k.normalized));
    const fresh = r.keywords.filter((k) => !have.has(k.normalized));
    s.keywords.push(...fresh); save(cwd, s);
    out(`Added ${fresh.length} keyword(s); ${r.duplicates.length + r.keywords.length - fresh.length} duplicate(s); ${r.rejected.length} rejected. Metrics not backed by a source and date are "unavailable".`);
    return 0;
  }
  if (cmd === "plan") {
    const pagesFile = flag(rest, "--pages");
    const pages = pagesFile ? readJson(resolve(cwd, pagesFile), { pages: [] }).pages : [];
    if (!pages.length) { out("plan needs --pages site-pages.json (the existing pages: path, title, h1, h2, description) so overlap can be checked."); return 1; }
    const groups = groupKeywords(s.keywords, { locations: (flag(rest, "--locations") ?? "").split(",").filter(Boolean) });
    const targeted = targetedKeywords(inv);
    const plan = planOpportunities(groups, pages, { places: (flag(rest, "--locations") ?? "").split(",").filter(Boolean), offerings: (flag(rest, "--offerings") ?? "").split(",").filter(Boolean) });
    const places = (flag(rest, "--locations") ?? "").split(",").filter(Boolean);
    const planned = plan.map((r) => ({ ...proposeBasics(r, { brand: flag(rest, "--brand") ?? "" }), ...r, id: "lp-" + normalizeKeyword(r.primary).replace(/ /g, "-"), status: "proposed", alreadyTargeted: [...targeted.keys()].filter((k) => normalizeKeyword(r.primary) === k), performance: "unavailable" }));
    const rec = reconcileOpportunities(planned, s.opportunities, s.retired ?? [], { places, today });
    s.opportunities = rec.opportunities; if (rec.retired.length || s.retired) s.retired = rec.retired;
    save(cwd, s);
    out(`${groups.length} keyword group(s) -> ${s.opportunities.length} opportunit${s.opportunities.length === 1 ? "y" : "ies"}. Nothing is created or published.`);
    const touched = rec.events.filter((e) => e.invalidated?.length || e.event === "replan-differs-from-published");
    for (const e of touched) out(`${e.id}: ${e.event}${e.invalidated?.length ? ` - ${e.invalidated.join(" and ")} voided; run check and approve again` : " - the published page is unchanged; see pendingChange"}`);
    if (rec.retired.length) out(`${rec.retired.length} earlier opportunit${rec.retired.length === 1 ? "y" : "ies"} with work no longer in the plan kept under "retired" in the state file (restored automatically if a later plan matches again).`);
    return 0;
  }
  if (cmd === "status" || !cmd) {
    if (!s.opportunities.length) { out(`${s.keywords.length} keyword(s), no plan yet. Run: plan --pages site-pages.json`); return 0; }
    for (const o of s.opportunities) out(`${o.id} [${o.status}${o.approval ? (approvalState(draftOf(o, o.approval)) === "valid" ? "" : `, approval ${approvalState(draftOf(o, o.approval))} - approve again`) : ""}] ${o.score.priority} ${o.action} ${o.target}  "${o.primary}" (${o.intent})  +${o.secondary.length} secondary`);
    return 0;
  }
  const id = rest[0]; const o = s.opportunities.find((x) => x.id === id);
  if (!o) { out(`unknown opportunity "${id ?? ""}"`); return 1; }
  if (cmd === "check") {
    const page = readJson(resolve(cwd, flag(rest, "--page") ?? ""), null);
    if (!page) { out("check needs --page page.json"); return 1; }
    const others = readJson(resolve(cwd, flag(rest, "--others") ?? "none.json"), { pages: [] }).pages;
    const cfg = readJson(join(cwd, "seo", "seo-config.json"), {});
    const r = checkPage({ primary: o.primary, ...page }, { others, verifiedPrices: flag(rest, "--prices")?.split(","), requiredCta: flag(rest, "--cta") ?? undefined, thresholds: cfg.landing?.qualityThresholds });
    o.draft = page; o.checks = { ok: r.ok, errors: r.errors, warnings: r.warnings, reviews: r.reviews, findings: r.findings, contentHash: contentHash(draftOf(o)) };
    if (o.approval && approvalState(draftOf(o, o.approval)) !== "valid") { delete o.approval; if (o.status === "approved") o.status = "draft"; } // changed content voids the approval
    save(cwd, s);
    out(r.findings.map((f) => `${f.level.toUpperCase()} ${f.id}: ${f.msg}`).join("\n") || "no findings");
    if (r.reviews) out(`${r.reviews} item(s) marked REVIEW are signals for a person to judge; they do not block approval.`);
    out(r.ok ? "PASS" : "FAIL"); return r.ok ? 0 : 1;
  }
  if (cmd === "approve") {
    const by = flag(rest, "--by");
    try {
      if (!o.draft) throw new Error("no draft to approve (run check --page page.json)");
      if (!o.checks?.ok) throw new Error("the quality gate must pass first (run check)");
      if (o.checks.contentHash !== contentHash(draftOf(o))) throw new Error("the draft changed since the last quality check; run check again");
      const a = approve(draftOf(o, undefined, o.status), by); o.status = a.status; o.approval = a.approval;
    } catch (e) { out(e.message); return 1; }
    save(cwd, s); out(`${id} approved by ${by}. This does not publish it.`); return 0;
  }
  if (cmd === "move") {
    const to = flag(rest, "--to"); const t = canTransition(draftOf(o, o.approval, o.status), to);
    if (!t.ok) { out(`refused: ${t.reason}`); return 1; }
    if (to === "published" && o.checks?.contentHash !== contentHash(draftOf(o))) { out("refused: the draft changed since the last quality check; run check and approve again"); return 1; }
    if (to === "draft" || to === "proposed") delete o.approval;
    o.status = to; save(cwd, s); out(`${id} -> ${to}. Moving to "published" only records it; the website change itself is made and deployed by you.`); return 0;
  }
  out(`unknown command "${cmd}"`); return 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2)).then((c) => process.exit(c));
