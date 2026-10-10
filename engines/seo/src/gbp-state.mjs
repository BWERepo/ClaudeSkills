// BWESEO Google Business Profile — workflow state, the creation gate, approvals and the manual verification assistant
// (pure; storage is the caller's: seo/data/local-gbp/state.json, which is private and git-ignored).
//
// Manual mode is the baseline: nothing here needs Google API access. The state records WHO said what and WHEN, and never marks
// something completed that the administrator has not reported (a manual step is "reported by the administrator", not "verified by Google").

import { assessEligibility } from "./gbp-eligibility.mjs";
import { discoveryGate } from "./gbp-discovery.mjs";
import { completeness, preview } from "./gbp-profile.mjs";

export const STATE_VERSION = 1;
export const VERIFICATION_STATES = ["not-started", "in-progress", "pending-owner-action", "owner-reported-verified", "failed", "suspended-or-restricted"];
export const API_STATES = ["unknown", "not-approved", "approved"];

export const newState = () => ({
  v: STATE_VERSION,
  apiAccess: { status: "unknown", checkedAt: null, note: "Google Business Profile API access needs separate approval; until it is confirmed the module runs in manual mode." },
  eligibility: null, discovery: { searched: null, candidates: [], resolutions: {} }, draft: null, approvals: [],
  creation: { status: "not-started", reportedBy: null, at: null, profileUrl: null },
  verification: { status: "not-started", method: null, source: "manual", updatedBy: null, updatedAt: null, note: "" },
  audit: [],
});

export function loadState(raw) {
  const s = raw && typeof raw === "object" && raw.v === STATE_VERSION ? raw : newState();
  return { ...newState(), ...s, discovery: { ...newState().discovery, ...(s.discovery ?? {}) }, creation: { ...newState().creation, ...(s.creation ?? {}) }, verification: { ...newState().verification, ...(s.verification ?? {}) } };
}
export const log = (state, who, action, detail = {}, at = new Date().toISOString()) => (state.audit.push({ at, by: who || "unknown", action, ...detail }), state);

export function setEligibility(state, answers, who, at) {
  state.eligibility = { answers, result: assessEligibility(answers), assessedAt: at ?? new Date().toISOString(), by: who };
  return log(state, who, "eligibility-assessed", { eligible: state.eligibility.result.eligible, classification: state.eligibility.result.classification }, at);
}

export function recordSearch(state, { method, by, candidates = [] }, at = new Date().toISOString()) {
  if (!method || !by) throw new Error("A search needs a method (where it was done) and who did it.");
  state.discovery.searched = { at, method, by };
  state.discovery.candidates = candidates;
  state.discovery.resolutions = {};
  return log(state, by, "existing-profile-search", { method, found: candidates.length }, at);
}
export function resolveCandidate(state, key, { resolution, reason, by }, at = new Date().toISOString()) {
  state.discovery.resolutions[key] = { resolution, reason, by, at };
  return log(state, by, "candidate-resolved", { key, resolution }, at);
}

// The only gate in front of "create a profile". Every condition must hold; each failure says what the administrator must do.
export function creationGate(state, { values, validation }) {
  const blockers = [];
  const userInputNeeded = [];
  const e = state.eligibility?.result;
  if (!e) { blockers.push("Eligibility has not been assessed."); userInputNeeded.push("Answer the eligibility questions."); }
  else {
    if (e.eligible !== "yes") { blockers.push(`Eligibility is "${e.eligible}" (${e.nextAction}).`); for (const q of e.userInputNeeded) userInputNeeded.push(q.question); for (const b of e.blockers) blockers.push(b); }
    else if (e.nextAction === "connect-existing") blockers.push("An existing profile was reported: connect or claim it instead of creating a new one.");
  }
  const d = discoveryGate({ name: values?.name, phone: values?.phone, website: values?.website, address: values?.address ? Object.values(values.address).join(" ") : "" }, state.discovery);
  blockers.push(...d.blockers); userInputNeeded.push(...d.userInputNeeded);
  if (validation && !validation.valid) { blockers.push(`The profile has ${validation.errors.length} validation error(s).`); userInputNeeded.push(...validation.errors.map((x) => x.message)); }
  const approved = latestApproval(state, "create-profile", values);
  if (!approved) { blockers.push("No administrator approval of the exact proposed profile is recorded."); userInputNeeded.push("Review the profile preview and approve it (names the approving administrator)."); }
  const uniq = (a) => [...new Set(a)];
  return { canCreate: blockers.length === 0, blockers: uniq(blockers), userInputNeeded: uniq(userInputNeeded) };
}

// ---------------------------------------------------------------- approvals

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
export const fingerprint = (v) => { let h = 5381; const s = stable(v); for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, "0"); };

export function approve(state, { kind, values, by }, at = new Date().toISOString()) {
  if (!by || !String(by).trim()) throw new Error("An approval must name the approving administrator.");
  const a = { kind, by, at, fingerprint: fingerprint(values), original: state.draft?.approvedValues ?? null, proposed: values, result: null, verification: "not-started" };
  state.approvals.push(a);
  state.draft = { ...(state.draft ?? {}), approvedValues: values };
  log(state, by, "approved", { kind, fingerprint: a.fingerprint }, at);
  return a;
}
// An approval only counts for the exact values approved: any later edit invalidates it.
export const latestApproval = (state, kind, values) => [...state.approvals].reverse().find((a) => a.kind === kind && a.fingerprint === fingerprint(values) && !a.revokedAt) ?? null;

// ---------------------------------------------------------------- manual creation and verification reporting

export function reportCreation(state, { by, profileUrl = null }, at = new Date().toISOString()) {
  if (state.creation.status === "reported-created") throw new Error("Creation was already reported; connect the profile instead of creating another.");
  state.creation = { status: "reported-created", reportedBy: by, at, profileUrl, note: "Reported by the administrator; not confirmed by Google." };
  return log(state, by, "creation-reported", { profileUrl }, at);
}

export function setVerification(state, { status, method = null, by, note = "" }, at = new Date().toISOString()) {
  if (!VERIFICATION_STATES.includes(status)) throw new Error(`Unknown verification status "${status}". Use one of: ${VERIFICATION_STATES.join(", ")}.`);
  if (!by) throw new Error("Name who is reporting this status.");
  state.verification = { status, method, source: "manual", updatedBy: by, updatedAt: at, note };
  return log(state, by, "verification-reported", { status, method }, at);
}

// What the owner must do next, in plain words. Google decides which methods exist; none is promised.
export function verificationGuidance(state) {
  const v = state.verification;
  const base = { status: v.status, source: v.source, userInputNeeded: null, steps: [], disclaimer: "Google decides which verification methods are offered and whether a profile is approved. No method or outcome is guaranteed, and verification cannot be bypassed." };
  switch (v.status) {
    case "not-started": return { ...base, steps: state.creation.status === "reported-created" ? ["Open the profile in the Business Profile interface and select 'Get verified'."] : ["Create or claim the profile first."], userInputNeeded: state.creation.status === "reported-created" ? "The business owner must start verification in Google's interface and choose from the methods Google offers." : null };
    case "in-progress": return { ...base, steps: ["Follow Google's instructions for the offered method.", "Do not request several methods at once or edit the name/address while verification is pending."], userInputNeeded: "The business owner must complete the step Google asked for, then report the result here." };
    case "pending-owner-action": return { ...base, steps: ["Enter the code or complete the video/phone step Google requested."], userInputNeeded: `Owner action required${v.method ? ` (${v.method})` : ""}: ${v.note || "complete the pending verification step"}.` };
    case "failed": return { ...base, steps: ["Read the reason Google shows, correct genuine data problems (never invent information), then retry or use Google's appeal/support form."], userInputNeeded: "The owner must review Google's failure reason and decide how to proceed." };
    case "suspended-or-restricted": return { ...base, steps: ["Use Google's reinstatement form after correcting any guideline problem.", "Do not create a replacement profile."], userInputNeeded: "The owner must resolve the suspension or restriction with Google." };
    default: return { ...base, steps: ["Re-check the profile in Google's interface periodically; this status is owner-reported and not confirmed by the API."] };
  }
}

// ---------------------------------------------------------------- the dashboard summary and the one primary action

export function nextPrimaryAction(state, gate) {
  const e = state.eligibility?.result;
  if (!e) return { label: "Check Eligibility", userInputNeeded: true };
  if (e.nextAction === "not-eligible") return { label: "Website SEO Alternatives", userInputNeeded: false };
  if (e.nextAction === "answer-questions") return { label: "Check Eligibility", userInputNeeded: true };
  if (e.nextAction === "obtain-authorization") return { label: "Obtain Owner Authorization", userInputNeeded: true };
  if (!state.discovery.searched) return { label: "Connect Existing Profile", userInputNeeded: true, detail: "Search for an existing profile first." };
  if (e.nextAction === "connect-existing" || gate?.blockers.some((b) => /existing/i.test(b))) return { label: "Connect Existing Profile", userInputNeeded: true };
  if (state.creation.status !== "reported-created") return gate?.canCreate ? { label: "Create Profile", userInputNeeded: true } : { label: "Complete Profile", userInputNeeded: true };
  if (state.verification.status !== "owner-reported-verified") return { label: "Verification Required", userInputNeeded: true };
  return { label: "Review Recommendations", userInputNeeded: false };
}

export function summarize(state, { values, validation, categoryList = null } = {}) {
  const gate = creationGate(state, { values: values ?? {}, validation });
  const comp = values ? completeness(values) : null;
  return {
    mode: state.apiAccess.status === "approved" ? "api" : "manual",
    apiAccess: state.apiAccess,
    eligibility: state.eligibility ? { eligible: state.eligibility.result.eligible, classification: state.eligibility.result.classification, assessedAt: state.eligibility.assessedAt } : null,
    primaryAction: nextPrimaryAction(state, gate),
    gate, completeness: comp ? { score: comp.score, coverage: comp.coverage } : null,
    verification: { status: state.verification.status, source: state.verification.source, updatedAt: state.verification.updatedAt },
    creation: state.creation.status,
    preview: values && validation ? preview(values, validation, !gate.blockers.some((b) => /existing|search/i.test(b))) : null,
    unavailable: ["Google-reported search visibility and profile interactions (need approved API access or a manual import)", "Review data (needs approved API access)", "Live profile sync (needs approved API access)"],
  };
}
