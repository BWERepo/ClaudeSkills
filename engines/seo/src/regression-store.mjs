// BWESEO regression detection — local persistence (Node only; never imported by Worker code).
// Everything lives in the CUSTOMER project, under <paths.data>/regression/ (default seo/data/regression/, git-ignored customer data):
//   baseline.json            the ACCEPTED baseline (observation + who accepted it, why, hash, sequence number)
//   baseline-history/        every superseded baseline, one file each (never deleted, never rewritten)
//   findings.json            findings and their lifecycle / human decisions
//   exceptions.json          approved intentional-change records
//   audit.json               append-only record of baseline initializations/acceptances and decisions
//   observations/            default place for collected observations (the LATEST observation is never the baseline)
// Writes are atomic (temp file + rename, src/safe-write.mjs) and serialized by a lock file. The engine never writes outside the
// project it is run in, and refuses an observation that belongs to a different project.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonStrict, withFileLock, writeJsonAtomic } from "./safe-write.mjs";
import { BASELINE_FORMAT, EXCEPTIONS_FORMAT, FINDINGS_FORMAT, FORMAT_VERSION } from "./regression-detect.mjs";
import { emptyExceptions, emptyFindings } from "./regression-workflow.mjs";

export function readConfig(cwd) {
  const p = join(cwd, "seo", "seo-config.json");
  return existsSync(p) ? readJsonStrict(p, {}) : null;
}
export const regressionDir = (cwd, config = readConfig(cwd)) => join(cwd, config?.paths?.data ?? "seo/data", "regression");

function checked(value, format, file) {
  if (value.format !== format || value.version !== FORMAT_VERSION) throw new Error(`${file} is not a ${format} v${FORMAT_VERSION} file (found ${JSON.stringify(value.format)} v${JSON.stringify(value.version)}); it was not changed. Restore or migrate it.`);
  return value;
}

export function openStore(cwd) {
  const config = readConfig(cwd);
  const dir = regressionDir(cwd, config);
  const f = (n) => join(dir, n);
  return {
    cwd, config, dir, projectId: config?.projectId ?? null,
    paths: { baseline: f("baseline.json"), history: f("baseline-history"), findings: f("findings.json"), exceptions: f("exceptions.json"), audit: f("audit.json"), observations: f("observations") },
    loadBaseline() { const v = readJsonStrict(f("baseline.json"), null); return v ? checked(v, BASELINE_FORMAT, "baseline.json") : null; },
    loadFindings() { const v = readJsonStrict(f("findings.json"), null); return v ? checked(v, FINDINGS_FORMAT, "findings.json") : emptyFindings(); },
    loadExceptions() { const v = readJsonStrict(f("exceptions.json"), null); return v ? checked(v, EXCEPTIONS_FORMAT, "exceptions.json") : emptyExceptions(); },
    loadAudit() { const v = readJsonStrict(f("audit.json"), null); return Array.isArray(v?.entries) ? v.entries : []; },
    listHistory() { return existsSync(f("baseline-history")) ? readdirSync(f("baseline-history")).filter((n) => n.endsWith(".json")).sort() : []; },
    saveFindings(v) { writeJsonAtomic(f("findings.json"), v); },
    saveExceptions(v) { writeJsonAtomic(f("exceptions.json"), v); },
    appendAudit(entry) { writeJsonAtomic(f("audit.json"), { version: FORMAT_VERSION, entries: [...this.loadAudit(), entry] }); },
    // Replace the baseline. Order matters for crash safety: the outgoing baseline is copied to history FIRST (same file name on a
    // retry, so it is idempotent), then the new baseline replaces it atomically, then the audit entry is appended.
    saveBaseline(record, audit, outgoing) {
      if (outgoing) writeJsonAtomic(join(f("baseline-history"), `${String(outgoing.seq).padStart(4, "0")}-${outgoing.observationHash.slice(0, 10)}.json`), outgoing);
      writeJsonAtomic(f("baseline.json"), record);
      this.appendAudit(audit);
    },
    lock: (fn) => withFileLock(join(dir, "state"), fn),
  };
}

// An observation must belong to this project. Observations without a project id are refused when the project has one.
export function checkProject(store, observation) {
  const mine = store.projectId;
  const theirs = observation?.project?.id ?? null;
  if (mine && theirs !== mine) return `the observation belongs to project ${JSON.stringify(theirs)}, but this project is ${JSON.stringify(mine)}; customer data is never mixed`;
  return null;
}
