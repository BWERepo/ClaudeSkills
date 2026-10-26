// BWESEO regression detection — workflow rules on top of the comparison core (still pure: no I/O, Worker-safe).
// Intentional-change records, findings lifecycle (no duplicates, human decisions kept, recovery only when confirmed), baseline
// acceptance rules, the dashboard read model and the human-readable summaries. The file-system side is regression-store.mjs.
import { sha256hex } from "./landing-hash.mjs";
import {
  BASELINE_FORMAT, EXCEPTIONS_FORMAT, FINDINGS_FORMAT, FORMAT_VERSION, INDEXING_STATEMENT, REGRESSION_ENGINE_VERSION,
  checkCompatibility, compareObservations, normalizeObservation, recoveryCheck, severityRank, urlKey, validateObservation,
} from "./regression-detect.mjs";

const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const pathOf = (key) => { const u = new URL(key); return u.pathname + u.search; };

// Stable JSON text (sorted keys) so a hash never depends on property order.
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const hashObservation = (obs) => sha256hex(stableStringify(obs));

// ---------------------------------------------------------------- intentional-change records

export const EXCEPTION_KINDS = ["removal", "redirect", "canonical", "indexability"];
export const emptyExceptions = () => ({ format: EXCEPTIONS_FORMAT, version: FORMAT_VERSION, records: [] });

// A record is narrow on purpose: one exact URL or one path prefix (never the whole site), one expected result, a reason and an author.
export function validateException(rec, { origin, now = new Date().toISOString() } = {}) {
  const errors = [];
  if (!EXCEPTION_KINDS.includes(rec?.kind)) errors.push(`kind must be one of ${EXCEPTION_KINDS.join(", ")}`);
  const hasUrl = !!rec?.url; const hasPrefix = !!rec?.pathPrefix;
  if (hasUrl === hasPrefix) errors.push("give exactly one of url or pathPrefix");
  if (hasUrl && !urlKey(rec.url, origin)) errors.push("url must be a valid http(s) URL (or a path)");
  if (hasPrefix && (!/^\/.+/.test(rec.pathPrefix) || rec.pathPrefix.length < 2)) errors.push('pathPrefix must start with "/" and be narrower than the whole site (for example "/old-section/")');
  if (!rec?.reason?.trim()) errors.push("reason is required");
  if (!rec?.author?.trim()) errors.push("author is required");
  if (!isIso(rec?.createdAt)) errors.push("createdAt must be an ISO-8601 time");
  if (rec?.expiresAt != null && (!isIso(rec.expiresAt) || Date.parse(rec.expiresAt) <= Date.parse(rec.createdAt ?? now))) errors.push("expiresAt must be an ISO-8601 time after createdAt");
  const x = rec?.expect ?? {};
  if (rec?.kind === "removal" && x.status != null && !(Array.isArray(x.status) && x.status.length && x.status.every((n) => Number.isInteger(n) && n >= 400 && n < 600))) errors.push("expect.status must list 4xx/5xx codes (default [404, 410])");
  if (rec?.kind === "redirect") {
    if (!x.target || !urlKey(x.target, origin)) errors.push("expect.target (the URL the redirect must reach) is required");
    if (x.status != null && !(Array.isArray(x.status) && x.status.every((n) => [301, 302, 303, 307, 308].includes(n)))) errors.push("expect.status must list redirect codes (default [301, 308])");
  }
  if (rec?.kind === "canonical" && (!x.canonical || !urlKey(x.canonical, origin))) errors.push("expect.canonical (the URL the page must declare) is required");
  if (rec?.kind === "indexability") {
    if (x.indexable !== false) errors.push("expect.indexable must be false (only approved loss of indexability is recorded)");
    if (x.via != null && !["noindex", "robots", "any"].includes(x.via)) errors.push('expect.via must be "noindex", "robots" or "any"');
  }
  return errors;
}

export function addException(store, input, { origin, now }) {
  const createdAt = input.createdAt ?? now;
  const rec = { kind: input.kind, ...(input.url ? { url: urlKey(input.url, origin) } : {}), ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}), expect: normalizeExpect(input.kind, input.expect ?? {}, origin), reason: input.reason?.trim(), author: input.author?.trim(), createdAt, expiresAt: input.expiresAt ?? null };
  const errors = validateException(rec, { origin, now });
  if (errors.length) return { ok: false, errors };
  rec.id = `ex-${sha256hex(stableStringify({ ...rec, createdAt })).slice(0, 8)}`;
  if (store.records.some((r) => r.id === rec.id)) return { ok: false, errors: [`an identical record already exists (${rec.id})`] };
  return { ok: true, record: rec, store: { ...store, records: [...store.records, rec] } };
}
const normalizeExpect = (kind, x, origin) => {
  if (kind === "removal") return { status: x.status ?? [404, 410] };
  if (kind === "redirect") return { status: x.status ?? [301, 308], target: x.target ? urlKey(x.target, origin) ?? x.target : undefined };
  if (kind === "canonical") return { canonical: x.canonical ? urlKey(x.canonical, origin) ?? x.canonical : undefined };
  return { indexable: x.indexable, via: x.via ?? "any" };
};
export const removeException = (store, id) => (store.records.some((r) => r.id === id) ? { ok: true, store: { ...store, records: store.records.filter((r) => r.id !== id) } } : { ok: false, errors: [`no intentional-change record ${id}`] });
export const isExpired = (rec, now) => rec.expiresAt != null && Date.parse(rec.expiresAt) <= Date.parse(now);

const covers = (rec, url, origin) => {
  const k = urlKey(url, origin);
  if (!k) return false;
  if (rec.url) return urlKey(rec.url, origin) === k;
  const o = new URL(origin); const u = new URL(k);
  return u.host === o.host && pathOf(k).startsWith(rec.pathPrefix);
};
const viaOf = (detection) => { const v = detection._detail?.evidence?.via; return Array.isArray(v) ? "noindex" : null; };

// Does an approved record match what was actually observed? A record covers a URL AND must predict the observed result;
// approval of one change never covers a different result on the same URL, nor another URL.
export function matchIntentional(d, records, { origin, now }) {
  const notes = []; const matched = [];
  const ev = d._detail?.evidence ?? {};
  const test = (kind, url, pred, describe) => {
    for (const r of records.filter((x) => x.kind === kind && covers(x, url, origin))) {
      if (isExpired(r, now)) { notes.push(`record ${r.id} covers this URL but expired on ${r.expiresAt}`); continue; }
      const why = pred(r);
      if (why === true) matched.push(r); else notes.push(`record ${r.id} (${kind}) does not match: ${why ?? describe}`);
    }
  };
  const oneOf = (list, v) => list.includes(v);
  const url = d.subject.url;
  const canonicalOk = (r) => { const cs = [...new Set(ev.canonicals ?? [])]; return cs.length === 1 && cs[0] === urlKey(r.expect.canonical, origin) ? true : `expected canonical ${r.expect.canonical} but observed ${cs.join(", ") || "none"}`; };
  const redirectOk = (r) => { const first = ev.firstStatus ?? ev.chain?.find((h) => h.location)?.status; return ev.redirects > 0 && oneOf(r.expect.status, first) && urlKey(ev.finalUrl) === urlKey(r.expect.target, origin) ? true : `expected ${r.expect.status.join("/")} to ${r.expect.target} but observed ${first ?? "no redirect"} to ${ev.finalUrl ?? "nothing"}`; };
  const indexOk = (via) => (r) => (r.expect.via === "any" || r.expect.via === via) ? true : `expected via ${r.expect.via} but observed ${via}`;
  switch (d.type) {
    case "page-error": test("removal", url, (r) => (!d._detail.evidence.redirects && oneOf(r.expect.status, ev.status) ? true : `expected status ${r.expect.status.join("/")} but observed ${ev.status}`)); break;
    case "sitemap-removal": {
      const pe = ev.page;
      if (!pe) { notes.push("an approved record needs the page's current result to be observed to match; it was not"); break; }
      test("removal", url, (r) => (!pe.redirects && oneOf(r.expect.status, pe.status) ? true : `expected status ${r.expect.status.join("/")} but observed ${pe.status}`));
      test("redirect", url, (r) => (pe.redirects > 0 && urlKey(pe.finalUrl) === urlKey(r.expect.target, origin) && oneOf(r.expect.status, pe.chain?.find((h) => h.location)?.status) ? true : "the page does not redirect as the record expects"));
      test("canonical", url, (r) => { const cs = [...new Set(pe.canonicals ?? [])]; return cs.length === 1 && cs[0] === urlKey(r.expect.canonical, origin) ? true : "the page's canonical is not the approved one"; });
      test("indexability", url, (r) => (pe.noindex?.meta === true || pe.noindex?.header === true ? indexOk("noindex")(r) : "the page is still indexable"));
      break;
    }
    case "unexpected-redirect": case "sitemap-entry-redirected": test("redirect", url, redirectOk); break;
    case "canonical-changed": case "sitemap-entry-noncanonical": test("canonical", url, canonicalOk); break;
    case "noindex-added": case "sitemap-entry-noindex": test("indexability", url, indexOk("noindex")); break;
    case "robots-restriction": {
      const urls = d._detail?.urls ?? [];
      const used = new Set();
      let all = urls.length > 0;
      for (const u of urls) {
        const hit = records.find((r) => r.kind === "indexability" && !isExpired(r, now) && covers(r, u, origin) && indexOk("robots")(r) === true);
        if (hit) used.add(hit); else { all = false; const near = records.find((r) => covers(r, u, origin)); if (near && notes.length < 3) notes.push(`record ${near.id} covers ${u} but not with the expected result`); }
      }
      if (all) matched.push(...used); else if (used.size) notes.push("only some of the affected URLs have an approved record; the restriction as a whole is not approved");
      break;
    }
    default: break; // loops, chains, broken links and orphans are never excused by an approved change
  }
  return { matched: matched.length ? matched[0] : null, matchedAll: matched, notes };
}

// ---------------------------------------------------------------- findings lifecycle

export const emptyFindings = () => ({ format: FINDINGS_FORMAT, version: FORMAT_VERSION, updatedAt: null, lastObservation: null, findings: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const strip = (d) => { const { _detail, ...rest } = d; return rest; };

// Apply a comparison to the stored findings. Repeated runs update findings by stable id (no duplicates); human decisions survive;
// a finding resolves only when its own check, on a usable observation, positively confirms recovery. Pure: returns a new store.
export function mergeFindings(store, comparison, { baseline, observation, exceptions = emptyExceptions(), now }) {
  if (!comparison.comparable) throw new Error("cannot record findings from a comparison that was not possible");
  const obs = normalizeObservation(observation);
  const last = store.lastObservation;
  if (last && Date.parse(obs.observedAt) < Date.parse(last.observedAt)) throw new Error(`this observation (${obs.observedAt}) is older than the last recorded one (${last.observedAt}); findings are not rolled back`);
  const sameRun = !!last && last.observedAt === obs.observedAt && (last.id ?? null) === (obs.id ?? null);
  const origin = obs.environment.origin;
  const next = clone(store);
  const byId = new Map(next.findings.map((f) => [f.id, f]));
  const changes = { created: [], updated: [], reopened: [], resolved: [], intentional: [], unchanged: [] };
  const seen = new Set();
  for (const d of comparison.detections) {
    seen.add(d.id);
    const m = matchIntentional(d, exceptions.records, { origin, now });
    const fresh = strip(d);
    const existing = byId.get(d.id);
    const status = m.matched ? "intentional" : "open";
    const intentionalChange = m.matched ? { id: m.matched.id, matchedAt: obs.observedAt, kind: m.matched.kind, reason: m.matched.reason, author: m.matched.author, ...(m.matchedAll.length > 1 ? { allIds: m.matchedAll.map((r) => r.id) } : {}) } : null;
    if (!existing) {
      const f = { ...fresh, firstObservedAt: obs.observedAt, lastObservedAt: obs.observedAt, status, decision: null, intentionalChange, exceptionNotes: m.notes, occurrences: 1, lastObservationId: obs.id ?? null, history: [{ at: obs.observedAt, status, note: "first observed" }] };
      next.findings.push(f); byId.set(f.id, f); changes.created.push(f.id);
      if (m.matched) changes.intentional.push(f.id);
      continue;
    }
    const wasClosed = existing.status === "resolved" || existing.status === "accepted";
    const keep = { firstObservedAt: existing.firstObservedAt, decision: existing.decision ?? null, history: existing.history ?? [], occurrences: existing.occurrences ?? 1, resolvedHistory: existing.resolvedHistory };
    Object.assign(existing, fresh, keep, { lastObservedAt: obs.observedAt, status, intentionalChange, exceptionNotes: m.notes, lastObservationId: obs.id ?? null });
    delete existing.resolvedAt; delete existing.resolution;
    if (!sameRun) existing.occurrences += 1;
    if (wasClosed) { existing.reopenedAt = obs.observedAt; existing.history.push({ at: obs.observedAt, status, note: "detected again after it was closed" }); changes.reopened.push(d.id); }
    else if (existing.history.at(-1)?.status !== status) { existing.history.push({ at: obs.observedAt, status, note: m.matched ? `matched intentional change ${m.matched.id}` : "no longer matches an approved change" }); changes.updated.push(d.id); }
    else changes.updated.push(d.id);
    if (m.matched) changes.intentional.push(d.id);
    existing.history = existing.history.slice(-20);
  }
  for (const f of next.findings) {
    if (seen.has(f.id) || !["open", "intentional"].includes(f.status)) continue;
    const r = recoveryCheck(baseline, observation, f);
    if (r.r === "clear") {
      f.resolvedHistory = [...(f.resolvedHistory ?? []), { at: obs.observedAt }].slice(-10);
      f.status = "resolved"; f.resolvedAt = obs.observedAt; f.resolution = { observedAt: obs.observedAt, evidence: r.evidence, note: "the finding's own check passed on a usable observation" };
      f.history = [...(f.history ?? []), { at: obs.observedAt, status: "resolved", note: "recovery confirmed" }].slice(-20);
      changes.resolved.push(f.id);
    } else {
      f.lastCheck = { observedAt: obs.observedAt, outcome: r.r === "detect" ? "still-present" : "inconclusive", reason: r.reason ?? null };
      changes.unchanged.push(f.id);
    }
  }
  next.findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
  next.updatedAt = now;
  next.lastObservation = { id: obs.id ?? null, observedAt: obs.observedAt };
  return { store: next, changes };
}

export function setDecision(store, id, { state, by, note, now }) {
  const f = store.findings.find((x) => x.id === id);
  if (!f) return { ok: false, errors: [`no finding ${id}`] };
  if (!["acknowledged", "wont-fix", "clear"].includes(state)) return { ok: false, errors: ["state must be acknowledged, wont-fix or clear"] };
  if (!by?.trim()) return { ok: false, errors: ["--by <name> is required"] };
  const next = clone(store); const t = next.findings.find((x) => x.id === id);
  t.decision = state === "clear" ? null : { state, by: by.trim(), at: now, note: note?.trim() || null };
  t.history = [...(t.history ?? []), { at: now, status: t.status, note: state === "clear" ? `decision cleared by ${by.trim()}` : `${state} by ${by.trim()}` }].slice(-20);
  next.updatedAt = now;
  return { ok: true, store: next };
}

// A detection counts as an actionable regression unless an approved record matched it or a human decided "won't fix".
export function actionable(detection, store, { exceptions = emptyExceptions(), origin, now }) {
  const m = matchIntentional(detection, exceptions.records, { origin, now });
  const stored = store?.findings?.find((f) => f.id === detection.id);
  return { actionable: !m.matched && stored?.decision?.state !== "wont-fix", intentional: m.matched, decision: stored?.decision ?? null, notes: m.notes };
}

// ---------------------------------------------------------------- baseline operations (rules only; the store does the I/O)

export const EXIT = { OK: 0, REGRESSIONS: 1, NOT_COMPARABLE: 2, FAILURE: 3 };

// Rules for creating (init) or replacing (accept) the accepted baseline. Never accepts automatically.
export function planBaseline(current, observation, { kind, by, reason, acknowledgeRegressions = false, exceptions = emptyExceptions(), findings = emptyFindings(), now }) {
  const errors = [];
  if (!by?.trim()) errors.push("--by <name> is required: acceptance is a recorded human decision");
  if (kind === "accept" && !reason?.trim()) errors.push("--reason is required to accept a new baseline");
  const v = validateObservation(observation, { purpose: "baseline" });
  if (!v.ok) errors.push(...v.errors);
  if (kind === "init" && current) errors.push(`a baseline already exists (seq ${current.seq}); use accept to replace it`);
  if (kind === "accept" && !current) errors.push("there is no baseline yet; use init");
  if (errors.length) return { ok: false, errors };
  let comparison = null; let acknowledged = []; let matched = [];
  if (current) {
    const compat = checkCompatibility(current.observation, observation);
    if (!compat.ok) return { ok: false, errors: ["the observation is not comparable with the accepted baseline: " + compat.reasons.join("; ")] };
    comparison = compareObservations(current.observation, observation, { now });
    const origin = observation.environment.origin;
    const open = comparison.detections.filter((d) => actionable(d, findings, { exceptions, origin, now }).actionable);
    matched = comparison.detections.map((d) => matchIntentional(d, exceptions.records, { origin, now }).matched?.id).filter(Boolean);
    if (open.length && !acknowledgeRegressions) return { ok: false, errors: [`${open.length} unresolved regression(s) would become the new normal: ${open.slice(0, 5).map((d) => d.id).join(", ")}${open.length > 5 ? ", …" : ""}. Fix them, record approved changes, or accept deliberately with --acknowledge-regressions.`], comparison };
    acknowledged = open.map((d) => d.id);
  }
  const seq = (current?.seq ?? 0) + 1;
  const record = {
    format: BASELINE_FORMAT, version: FORMAT_VERSION, seq, kind, acceptedAt: now, acceptedBy: by.trim(), reason: reason?.trim() || (kind === "init" ? "initial baseline" : ""),
    observationHash: hashObservation(observation), previousSeq: current?.seq ?? null, previousObservationHash: current?.observationHash ?? null,
    acknowledgedFindings: acknowledged, matchedIntentionalChanges: [...new Set(matched)], engineVersion: REGRESSION_ENGINE_VERSION, observation: normalizeObservation(observation),
  };
  const audit = { at: now, action: kind === "init" ? "baseline-initialized" : "baseline-accepted", by: record.acceptedBy, reason: record.reason, seq, supersedes: current?.seq ?? null, observationId: observation.id ?? null, observedAt: observation.observedAt, observationHash: record.observationHash, acknowledgedFindings: acknowledged, matchedIntentionalChanges: record.matchedIntentionalChanges };
  return { ok: true, record, audit, comparison };
}

// After acceptance, findings the acceptance covered are closed as "accepted" (history kept); others are untouched.
export function closeAcceptedFindings(store, ids, { now, by, seq }) {
  const next = clone(store);
  for (const f of next.findings) if (ids.includes(f.id) && ["open", "intentional"].includes(f.status)) {
    f.status = "accepted"; f.acceptedAt = now; f.acceptedBy = by; f.acceptedInBaseline = seq;
    f.history = [...(f.history ?? []), { at: now, status: "accepted", note: `accepted into baseline ${seq} by ${by}` }].slice(-20);
  }
  next.updatedAt = now;
  return next;
}

// ---------------------------------------------------------------- read model & text

export function baselineSummary(baseline) {
  if (!baseline) return { state: "none", note: "no baseline yet: collect a complete observation and run init" };
  const o = baseline.observation;
  return { state: "accepted", seq: baseline.seq, acceptedAt: baseline.acceptedAt, acceptedBy: baseline.acceptedBy, observedAt: o.observedAt, environment: o.environment, scope: { origin: o.scope.origin, robotsAgent: o.scope.robotsAgent, includePaths: o.scope.includePaths, excludePaths: o.scope.excludePaths, sitemapUrls: o.scope.sitemapUrls }, coverage: { ...o.coverage, ratio: o.coverage.discovered ? Number((o.coverage.fetched / o.coverage.discovered).toFixed(3)) : 0 }, pages: Object.keys(o.pages).length, observationHash: baseline.observationHash };
}

// Stable, documented shape for customer dashboards. Pure: give it what the store loaded.
export function buildReadModel({ baseline, findings = emptyFindings(), exceptions = emptyExceptions(), audit = [], now }) {
  const items = findings.findings.map((f) => ({ id: f.id, type: f.type, severity: f.severity, status: f.status, decision: f.decision?.state ?? null, title: f.title, subject: f.subject, firstObservedAt: f.firstObservedAt, lastObservedAt: f.lastObservedAt, confidence: f.confidence, intentionalChangeId: f.intentionalChange?.id ?? null }));
  const count = (key, vals) => Object.fromEntries(vals.map((v) => [v, items.filter((i) => i[key] === v).length]));
  const open = items.filter((i) => i.status === "open" && i.decision !== "wont-fix");
  const soon = exceptions.records.filter((r) => r.expiresAt && !isExpired(r, now) && Date.parse(r.expiresAt) - Date.parse(now) < 14 * 86400000).map((r) => r.id);
  return {
    format: "bweseo.regression.readmodel", version: 1, generatedAt: now, indexingStatement: INDEXING_STATEMENT,
    baseline: baselineSummary(baseline),
    findings: { total: items.length, byStatus: count("status", ["open", "intentional", "resolved", "accepted"]), openBySeverity: Object.fromEntries(["critical", "high", "medium", "low"].map((s) => [s, open.filter((i) => i.severity === s).length])), actionable: open.length, items },
    lastObservation: findings.lastObservation,
    intentionalChanges: { total: exceptions.records.length, active: exceptions.records.filter((r) => !isExpired(r, now)).length, expired: exceptions.records.filter((r) => isExpired(r, now)).map((r) => r.id), expiringWithin14Days: soon },
    recentAudit: audit.slice(-10),
  };
}

// The contract an issue queue consumes: one entry per actionable finding, in the shape of content-inventory `issues`
// (id, title, severity, area, status, pages) plus the regression-specific fields. Read-only: nothing is written to the inventory.
export function toIssueCandidates(findings) {
  return findings.findings.filter((f) => f.status === "open" && f.decision?.state !== "wont-fix").map((f) => ({
    id: f.id, title: f.title, severity: f.severity, area: "technical", status: f.decision?.state === "acknowledged" ? "approved" : "open", blocking: f.severity === "critical",
    pages: [f.subject.url ?? f.subject.target].filter(Boolean), source: "regression-detection", type: f.type, firstObservedAt: f.firstObservedAt, lastObservedAt: f.lastObservedAt, recommendedAction: f.recommendedAction, verification: f.verification,
  }));
}

export function formatComparison(cmp, { actionableIds = null } = {}) {
  if (!cmp.comparable) return [`NOT COMPARABLE (${cmp.status})`, ...cmp.reasons.map((r) => `  - ${r}`)].join("\n");
  const lines = [];
  const ds = cmp.detections;
  lines.push(ds.length ? `${ds.length} regression(s) detected against baseline observed ${cmp.baseline.observedAt}` : `No regressions detected against baseline observed ${cmp.baseline.observedAt}`);
  lines.push(`Observation ${cmp.observation.observedAt} · ${cmp.observation.status} · coverage ${cmp.observation.coverage.fetched}/${cmp.observation.coverage.discovered}`);
  for (const d of ds) lines.push(`  [${d.severity.toUpperCase()}] ${d.id}  ${d.title}${actionableIds && !actionableIds.has(d.id) ? "  (approved or won't-fix)" : ""}`);
  const un = {};
  for (const u of cmp.unknown) (un[u.check] ??= { n: 0, reason: u.reason }).n += 1;
  const unk = Object.entries(un);
  if (unk.length) { lines.push("UNKNOWN (insufficient evidence, not failures):"); for (const [c, v] of unk) lines.push(`  ${c}: ${v.n} subject(s) — ${v.reason}`); }
  for (const c of cmp.checks) if (c.reason) lines.push(`  ${c.id}: ${c.reason}`);
  lines.push(INDEXING_STATEMENT);
  return lines.join("\n");
}

export function explainFinding(f) {
  const out = [`${f.id}  [${f.severity.toUpperCase()}] ${f.status}${f.decision ? ` · ${f.decision.state} by ${f.decision.by}` : ""}`, f.title, "",
    `First observed ${f.firstObservedAt} · last observed ${f.lastObservedAt} · seen ${f.occurrences}×  · confidence ${f.confidence}`,
    "", "Previous evidence:", `  ${JSON.stringify(f.previous)}`, "Current evidence:", `  ${JSON.stringify(f.current)}`, "",
    `Impact: ${f.impact}`, `Recommended action: ${f.recommendedAction}`, "Verify recovery when:", ...f.verification.map((v) => `  - ${v}`), "", "Limitations:", ...f.limitations.map((l) => `  - ${l}`)];
  if (f.intentionalChange) out.push("", `Matched intentional change ${f.intentionalChange.id} (${f.intentionalChange.kind}) by ${f.intentionalChange.author}: ${f.intentionalChange.reason}`);
  for (const n of f.exceptionNotes ?? []) out.push(`Approved-change note: ${n}`);
  if (f.resolution) out.push("", `Resolved ${f.resolvedAt}: ${f.resolution.note}`);
  if (f.lastCheck) out.push("", `Last check ${f.lastCheck.observedAt}: ${f.lastCheck.outcome}${f.lastCheck.reason ? ` — ${f.lastCheck.reason}` : ""}`);
  return out.join("\n");
}
