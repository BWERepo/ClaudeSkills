#!/usr/bin/env node
// BWESEO SEO regression detection — developer CLI (Node 18+). Compares a saved observation of the site with the ACCEPTED baseline and
// reports unexpected technical changes that could damage organic visibility. It reports an observed technical state, never Google's
// indexing status. It never deploys, publishes, submits or changes the website.
//
// Read-only (nothing is written):
//   node seo/tools/seo-regression.mjs status [--observation obs.json] [--json]       baseline status, scope, coverage; validates an observation
//   node seo/tools/seo-regression.mjs compare --observation obs.json [--json]        compare with the baseline (exit 1 = regressions)
//   node seo/tools/seo-regression.mjs findings [--status open] [--severity high] [--type noindex-added] [--json]
//   node seo/tools/seo-regression.mjs explain <finding-id> [--json]                  one finding's evidence, impact, verification
//   node seo/tools/seo-regression.mjs read-model [--json]                            the dashboard read model
//   node seo/tools/seo-regression.mjs issues [--json]                                findings as issue-queue candidates
//   node seo/tools/seo-regression.mjs exception list [--json]                        approved intentional-change records
// Writes (explicit; only under seo/data/regression/):
//   node seo/tools/seo-regression.mjs init --observation obs.json --by "<name>"      first baseline (needs a complete, valid observation)
//   node seo/tools/seo-regression.mjs accept --observation obs.json --by "<name>" --reason "<why>" [--acknowledge-regressions]
//   node seo/tools/seo-regression.mjs record --observation obs.json                  compare AND update findings (no duplicates; recovery only when confirmed)
//   node seo/tools/seo-regression.mjs decision <finding-id> --state acknowledged|wont-fix|clear --by "<name>" [--note "<text>"]
//   node seo/tools/seo-regression.mjs exception add --kind removal|redirect|canonical|indexability (--url <url> | --path-prefix </dir/>) [--expect-status 404,410]
//        [--expect-target <url>] [--expect-canonical <url>] [--expect-via noindex|robots|any] --reason "<why>" --by "<name>" [--expires 2027-01-31]
//   node seo/tools/seo-regression.mjs exception remove <id> --by "<name>"
// Collects an observation (the ONLY command that makes network requests; read-only GETs of the site's own pages):
//   node seo/tools/seo-regression.mjs observe --env production [--out obs.json] [--max-pages 200] [--important /,/services] [--sitemap <url>]
//
// Exit codes: 0 no actionable regression (or no baseline yet) · 1 regressions detected · 2 not comparable (incompatible or invalid
// observation, environment/scope/project mismatch, refused baseline change) · 3 usage error or execution failure (unreadable file, I/O).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeJsonAtomic } from "./safe-write.mjs";
import { compareObservations, normalizeObservation, validateObservation } from "./regression-detect.mjs";
import {
  EXIT, actionable, addException, baselineSummary, buildReadModel, closeAcceptedFindings, explainFinding, formatComparison, isExpired, mergeFindings,
  planBaseline, removeException, setDecision, toIssueCandidates,
} from "./regression-workflow.mjs";
import { checkProject, openStore } from "./regression-store.mjs";
import { collectObservation } from "./regression-collect.mjs";

const flag = (a, n) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] !== undefined && !a[i + 1].startsWith("--") ? a[i + 1] : null; };
const has = (a, n) => a.includes(n);

export async function main(argv, { cwd = process.cwd(), out = (s) => console.log(s), fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const [cmd, ...rest] = argv;
  const iso = () => now().toISOString();
  const json = has(rest, "--json");
  const say = (human, data) => out(json ? JSON.stringify(data, null, 2) : human);
  const fail = (code, message, data = {}) => { say(message, { ok: false, exit: code, error: message, ...data }); return code; };
  let store;
  try { store = openStore(cwd); } catch (e) { return fail(EXIT.FAILURE, e.message); }

  const loadObservation = () => {
    const file = flag(rest, "--observation");
    if (!file) return { error: "this command needs --observation <file>" };
    const p = resolve(cwd, file);
    if (!existsSync(p)) return { error: `observation file not found: ${file}` };
    let raw;
    try { raw = JSON.parse(readFileSync(p, "utf8")); } catch (e) { return { error: `${file} is not valid JSON (${e.message})` }; }
    const v = validateObservation(raw);
    if (!v.usable) return { error: `${file} is not a usable observation: ${v.errors.join("; ")}`, notComparable: true };
    const proj = checkProject(store, raw);
    if (proj) return { error: proj, notComparable: true };
    return { raw, obs: normalizeObservation(raw), validation: v };
  };

  try {
    if (cmd === "status" || !cmd) {
      const baseline = store.loadBaseline(); const findings = store.loadFindings(); const ex = store.loadExceptions();
      const data = { baseline: baselineSummary(baseline), history: store.listHistory().length, findings: { total: findings.findings.length, open: findings.findings.filter((f) => f.status === "open").length, lastObservation: findings.lastObservation }, intentionalChanges: { total: ex.records.length, expired: ex.records.filter((r) => isExpired(r, iso())).length } };
      let human = baseline ? `Baseline #${baseline.seq} accepted ${baseline.acceptedAt} by ${baseline.acceptedBy}\n  ${baseline.observation.environment.name} ${baseline.observation.environment.origin} · observed ${baseline.observation.observedAt} · ${data.baseline.pages} pages · coverage ${baseline.observation.coverage.fetched}/${baseline.observation.coverage.discovered}\n  ${data.history} earlier baseline(s) kept in history` : "No baseline yet. Collect a complete observation, then run: init --observation <file> --by \"<name>\"";
      human += `\nFindings: ${data.findings.total} (${data.findings.open} open) · intentional-change records: ${ex.records.length}${data.intentionalChanges.expired ? ` (${data.intentionalChanges.expired} expired)` : ""}`;
      if (flag(rest, "--observation")) {
        const l = loadObservation();
        if (l.error) { data.observation = { usable: false, error: l.error }; human += `\nObservation: ${l.error}`; }
        else {
          const forBaseline = validateObservation(l.raw, { purpose: "baseline" });
          data.observation = { usable: true, status: l.obs.status, observedAt: l.obs.observedAt, environment: l.obs.environment, coverage: { ...l.obs.coverage, ratio: l.obs.coverage.discovered ? Number((l.obs.coverage.fetched / l.obs.coverage.discovered).toFixed(3)) : 0 }, acceptableAsBaseline: forBaseline.acceptable, incomplete: forBaseline.incomplete ?? [], warnings: l.validation.warnings };
          human += `\nObservation ${l.obs.observedAt}: ${l.obs.status}, coverage ${l.obs.coverage.fetched}/${l.obs.coverage.discovered}, ${forBaseline.acceptable ? "acceptable as a baseline" : "NOT acceptable as a baseline (" + (forBaseline.incomplete ?? []).join("; ") + ")"}`;
        }
      }
      say(human, data); return EXIT.OK;
    }

    if (cmd === "compare" || cmd === "record") {
      const l = loadObservation();
      if (l.error) return fail(l.notComparable ? EXIT.NOT_COMPARABLE : EXIT.FAILURE, l.error);
      const baseline = store.loadBaseline();
      if (!baseline) { say("No baseline yet, so nothing can be compared and nothing is reported as a regression. Establish one with: init --observation <file> --by \"<name>\"", { status: "no-baseline", comparable: false }); return EXIT.OK; }
      const cmp = compareObservations(baseline.observation, l.raw, { now: iso() });
      if (!cmp.comparable) return fail(EXIT.NOT_COMPARABLE, formatComparison(cmp), { ...cmp });
      const findings = store.loadFindings(); const exceptions = store.loadExceptions();
      const origin = l.obs.environment.origin;
      const verdicts = cmp.detections.map((d) => ({ d, a: actionable(d, findings, { exceptions, origin, now: iso() }) }));
      const actionableIds = new Set(verdicts.filter((v) => v.a.actionable).map((v) => v.d.id));
      let changes = null;
      if (cmd === "record") {
        try {
          changes = await store.lock(() => {
            const fs = store.loadFindings();
            const r = mergeFindings(fs, cmp, { baseline: baseline.observation, observation: l.raw, exceptions: store.loadExceptions(), now: iso() });
            store.saveFindings(r.store);
            return r.changes;
          });
        } catch (e) { return fail(e.code === "BUSY" ? EXIT.FAILURE : EXIT.NOT_COMPARABLE, e.message); }
      }
      const publicCmp = { ...cmp, detections: cmp.detections.map(({ _detail, ...rest2 }) => ({ ...rest2, actionable: actionableIds.has(rest2.id), intentionalChangeId: verdicts.find((v) => v.d.id === rest2.id).a.intentional?.id ?? null })) };
      const code = actionableIds.size ? EXIT.REGRESSIONS : EXIT.OK;
      say(formatComparison(cmp, { actionableIds }) + (changes ? `\nRecorded: ${changes.created.length} new, ${changes.updated.length} updated, ${changes.reopened.length} reopened, ${changes.resolved.length} resolved (recovery confirmed), ${changes.unchanged.length} unchanged` : "\n(read-only: nothing was written)"), { ...publicCmp, exit: code, ...(changes ? { recorded: changes } : {}) });
      return code;
    }

    if (cmd === "findings") {
      const fs = store.loadFindings();
      const want = { status: flag(rest, "--status"), severity: flag(rest, "--severity"), type: flag(rest, "--type") };
      const list = fs.findings.filter((f) => (!want.status || f.status === want.status) && (!want.severity || f.severity === want.severity) && (!want.type || f.type === want.type));
      say(list.length ? list.map((f) => `[${f.severity.toUpperCase()}] ${f.id}  ${f.status}${f.decision ? "/" + f.decision.state : ""}  ${f.title}  (last ${f.lastObservedAt})`).join("\n") : "No findings match.", { count: list.length, findings: list });
      return EXIT.OK;
    }
    if (cmd === "explain") {
      const f = store.loadFindings().findings.find((x) => x.id === rest[0]);
      if (!f) return fail(EXIT.FAILURE, `no finding ${rest[0] ?? ""} (run findings)`);
      say(explainFinding(f), f); return EXIT.OK;
    }
    if (cmd === "read-model") { const m = buildReadModel({ baseline: store.loadBaseline(), findings: store.loadFindings(), exceptions: store.loadExceptions(), audit: store.loadAudit(), now: iso() }); out(JSON.stringify(m, null, 2)); return EXIT.OK; }
    if (cmd === "issues") { const c = toIssueCandidates(store.loadFindings()); say(c.length ? c.map((i) => `[${i.severity}] ${i.id} ${i.title}`).join("\n") : "No open regression findings.", { count: c.length, issues: c }); return EXIT.OK; }

    if (cmd === "init" || cmd === "accept") {
      const l = loadObservation();
      if (l.error) return fail(l.notComparable ? EXIT.NOT_COMPARABLE : EXIT.FAILURE, l.error);
      let result;
      try {
        result = await store.lock(() => {
          const current = store.loadBaseline();
          const plan = planBaseline(current, l.raw, { kind: cmd, by: flag(rest, "--by"), reason: flag(rest, "--reason"), acknowledgeRegressions: has(rest, "--acknowledge-regressions"), exceptions: store.loadExceptions(), findings: store.loadFindings(), now: iso() });
          if (!plan.ok) return plan;
          store.saveBaseline(plan.record, plan.audit, current);
          if (plan.audit.acknowledgedFindings.length || plan.comparison?.detections.length) {
            const covered = (plan.comparison?.detections ?? []).map((d) => d.id);
            store.saveFindings(closeAcceptedFindings(store.loadFindings(), covered, { now: iso(), by: plan.record.acceptedBy, seq: plan.record.seq }));
          }
          return plan;
        });
      } catch (e) { return fail(EXIT.FAILURE, e.message); }
      if (!result.ok) return fail(EXIT.NOT_COMPARABLE, "refused: " + result.errors.join("\n  "), { errors: result.errors });
      say(`${cmd === "init" ? "Baseline initialized" : "Baseline accepted"}: #${result.record.seq} by ${result.record.acceptedBy} (observation ${l.obs.observedAt}, ${Object.keys(l.obs.pages).length} pages).${result.audit.acknowledgedFindings.length ? `\nAcknowledged regressions now part of the baseline: ${result.audit.acknowledgedFindings.join(", ")}` : ""}\nThe previous baseline is kept in history. Nothing on the website was changed.`, { ok: true, seq: result.record.seq, audit: result.audit });
      return EXIT.OK;
    }

    if (cmd === "decision") {
      const id = rest[0];
      try {
        const r = await store.lock(() => { const res = setDecision(store.loadFindings(), id, { state: flag(rest, "--state"), by: flag(rest, "--by"), note: flag(rest, "--note"), now: iso() }); if (res.ok) { store.saveFindings(res.store); store.appendAudit({ at: iso(), action: "decision", by: flag(rest, "--by"), findingId: id, state: flag(rest, "--state"), note: flag(rest, "--note") }); } return res; });
        if (!r.ok) return fail(EXIT.FAILURE, r.errors.join("; "));
        say(`${id}: decision ${flag(rest, "--state")} recorded.`, { ok: true }); return EXIT.OK;
      } catch (e) { return fail(EXIT.FAILURE, e.message); }
    }

    if (cmd === "exception") {
      const [sub, ...r2] = rest;
      if (sub === "list") { const ex = store.loadExceptions(); say(ex.records.length ? ex.records.map((r) => `${r.id} ${r.kind} ${r.url ?? r.pathPrefix}${isExpired(r, iso()) ? " (EXPIRED)" : r.expiresAt ? ` (expires ${r.expiresAt})` : ""} — ${r.reason} [${r.author}]`).join("\n") : "No intentional-change records.", { records: ex.records.map((r) => ({ ...r, expired: isExpired(r, iso()) })) }); return EXIT.OK; }
      if (sub === "add") {
        const kind = flag(r2, "--kind");
        const baseline = store.loadBaseline();
        const origin = baseline?.observation.environment.origin ?? store.config?.environments?.production?.url ?? null;
        if (!origin) return fail(EXIT.FAILURE, "no baseline origin to resolve the URL against; initialize a baseline first");
        const num = (s) => (s ? s.split(",").map((n) => Number(n)) : undefined);
        const input = { kind, url: flag(r2, "--url"), pathPrefix: flag(r2, "--path-prefix"), reason: flag(r2, "--reason"), author: flag(r2, "--by"), expiresAt: flag(r2, "--expires") ? new Date(flag(r2, "--expires")).toISOString() : null, expect: { status: num(flag(r2, "--expect-status")), target: flag(r2, "--expect-target"), canonical: flag(r2, "--expect-canonical"), indexable: kind === "indexability" ? false : undefined, via: flag(r2, "--expect-via") ?? undefined } };
        try {
          const res = await store.lock(() => { const r = addException(store.loadExceptions(), input, { origin, now: iso() }); if (r.ok) { store.saveExceptions(r.store); store.appendAudit({ at: iso(), action: "intentional-change-added", by: input.author, id: r.record.id, kind, scope: r.record.url ?? r.record.pathPrefix, reason: input.reason }); } return r; });
          if (!res.ok) return fail(EXIT.FAILURE, res.errors.join("; "), { errors: res.errors });
          say(`Recorded ${res.record.id}: ${res.record.kind} ${res.record.url ?? res.record.pathPrefix}. It only covers a change that matches its expected result.`, { ok: true, record: res.record }); return EXIT.OK;
        } catch (e) { return fail(EXIT.FAILURE, e.message); }
      }
      if (sub === "remove") {
        if (!flag(r2.slice(1), "--by")) return fail(EXIT.FAILURE, "remove needs --by \"<name>\"");
        try {
          const res = await store.lock(() => { const r = removeException(store.loadExceptions(), r2[0]); if (r.ok) { store.saveExceptions(r.store); store.appendAudit({ at: iso(), action: "intentional-change-removed", by: flag(r2, "--by"), id: r2[0] }); } return r; });
          if (!res.ok) return fail(EXIT.FAILURE, res.errors.join("; "));
          say(`Removed ${r2[0]}.`, { ok: true }); return EXIT.OK;
        } catch (e) { return fail(EXIT.FAILURE, e.message); }
      }
      return fail(EXIT.FAILURE, "exception needs list, add or remove");
    }

    if (cmd === "observe") {
      const env = flag(rest, "--env") ?? "production";
      const origin = flag(rest, "--origin") ?? store.config?.environments?.[env]?.url ?? (store.config?.environments?.[env]?.host ? `https://${store.config.environments[env].host}` : null) ?? (env === "production" ? store.config?.website?.url : null);
      if (!origin) return fail(EXIT.FAILURE, `no origin for environment "${env}": pass --origin <url> or set it in seo/seo-config.json`);
      if (!fetchImpl) return fail(EXIT.FAILURE, "no fetch available (Node 18+ required)");
      const obs = await collectObservation({ fetchImpl, origin, environment: env, projectId: store.projectId, sitemapUrls: flag(rest, "--sitemap") ? [flag(rest, "--sitemap")] : null, importantPaths: (flag(rest, "--important") ?? "/").split(","), maxPages: Number(flag(rest, "--max-pages") ?? 200), now: iso });
      const file = resolve(cwd, flag(rest, "--out") ?? join(store.paths.observations, `${obs.observedAt.replace(/[:.]/g, "-")}.json`));
      writeJsonAtomic(file, obs);
      say(`Observation saved: ${file}\n  ${obs.status} · coverage ${obs.coverage.fetched}/${obs.coverage.discovered} · ${obs.environment.name} ${obs.environment.origin}\nIt is NOT a baseline. Use init or accept to make it one.`, { ok: true, file, status: obs.status, coverage: obs.coverage });
      return EXIT.OK;
    }
    return fail(EXIT.FAILURE, `unknown command "${cmd}". Commands: status, compare, record, findings, explain, read-model, issues, init, accept, decision, exception, observe`);
  } catch (e) {
    return fail(EXIT.FAILURE, e.message);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2)).then((c) => process.exit(c));
