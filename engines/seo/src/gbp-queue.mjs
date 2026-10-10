// BWESEO Google Business Profile — recommendations and the improvement queue (pure, zero dependencies).
//
// Recommendations carry the full workflow the owner asked for (new → review → approved → implementing → verification → completed,
// plus rejected, deferred, failed) and are SYNCED into the existing improvement queue — the inventory's issues[] (area "local") —
// so the GBP work appears in the same place as every other site issue. The inventory's own statuses are not changed (no schema
// bump); the mapping is below. Every public change needs a named approver.

import { fingerprint } from "./gbp-state.mjs";

export const WORKFLOW = ["new", "review", "approved", "implementing", "verification", "completed", "rejected", "deferred", "failed"];
const NEXT = {
  new: ["review", "rejected", "deferred"], review: ["approved", "rejected", "deferred"], approved: ["implementing", "rejected", "deferred"],
  implementing: ["verification", "failed", "deferred"], verification: ["completed", "failed"], failed: ["review", "deferred", "rejected"],
  deferred: ["review", "rejected"], completed: [], rejected: [],
};
export const canMove = (from, to) => (NEXT[from] ?? []).includes(to);

export const TYPES = ["add-hours", "fix-phone", "improve-description", "add-services", "replace-logo", "add-photos", "respond-review", "fix-inconsistency", "investigate-suggested-edit", "improve-service-page", "set-categories", "add-special-hours", "publish-post", "add-address-config"];

// A recommendation id is a fingerprint of WHAT it changes, so the same problem can never be queued twice and a rejected
// change is not submitted again.
export const recId = (type, target, proposed) => `gbp-${type}-${fingerprint({ target: target ?? "", proposed: proposed ?? null })}`;

export function makeRec({ type, target = null, current = null, proposed = null, reason, evidence = [], benefit, confidence = "medium", priority = "medium", publicChange = true, userInputNeeded = null }, at = new Date().toISOString().slice(0, 10)) {
  if (!TYPES.includes(type)) throw new Error(`Unknown recommendation type "${type}".`);
  if (!reason || !benefit) throw new Error("A recommendation needs a reason and an expected benefit.");
  return {
    id: recId(type, target, proposed), type, target, current, proposed, reason, evidence, benefit,
    benefitNote: "Expected benefit is a qualitative judgement; Google does not publish a ranking weight for profile fields.",
    confidence, priority, publicChange, userInputNeeded, state: "new", approval: { required: publicChange, by: null, at: null },
    history: [{ at, state: "new" }], foundOn: at,
  };
}

// Add new recommendations to a queue without duplicating anything; rejected and deferred items are not resurrected.
export function mergeRecs(queue, incoming, at) {
  const out = [...queue];
  const added = [], skipped = [];
  for (const r of incoming) {
    const have = out.find((q) => q.id === r.id);
    if (!have) { out.push(r); added.push(r.id); }
    else skipped.push({ id: r.id, because: have.state === "rejected" ? "rejected earlier, not resubmitted" : have.state === "deferred" ? "deferred" : "already queued" });
  }
  return { queue: out, added, skipped, at };
}

export function transition(rec, to, { by = null, note = "", evidence = null, at = new Date().toISOString().slice(0, 10) } = {}) {
  if (!WORKFLOW.includes(to)) throw new Error(`Unknown state "${to}".`);
  if (!canMove(rec.state, to)) throw new Error(`Cannot move a recommendation from ${rec.state} to ${to}.`);
  if (to === "approved") {
    if (!by) throw new Error("Approval must name the approving administrator.");
    rec.approval = { ...rec.approval, by, at };
  }
  if (["implementing", "verification", "completed"].includes(to) && rec.approval.required && !rec.approval.by) throw new Error("This public change has no recorded approval.");
  if (to === "completed" && !evidence) throw new Error("Completing needs evidence that the change is live (for example what the owner saw in Google's interface, and the date).");
  if (to === "rejected" && !note) throw new Error("Give a reason for rejecting so it is not suggested again.");
  rec.state = to;
  if (evidence) rec.verification = { evidence, at, by, source: "owner-reported" };
  rec.history.push({ at, state: to, by, note });
  return rec;
}

// ---------------------------------------------------------------- generating recommendations from checks

// inputs: { values (proposed/current profile), completeness, auditFindings, reviews (list), live: boolean }
export function recommend({ values = {}, completeness = null, auditFindings = [], reviews = [] } = {}, at) {
  const recs = [];
  const fail = new Set((completeness?.items ?? []).filter((i) => i.status === "fail").map((i) => i.id));
  const mk = (o) => recs.push(makeRec(o, at));
  if (fail.has("hours")) mk({ type: "add-hours", target: "hours", current: null, proposed: values.hours ?? null, reason: "Opening hours are missing or invalid.", evidence: ["completeness checklist: hours"], benefit: "Customers and Google can see when the business is open; incorrect hours cause wasted visits.", confidence: "high", priority: "high", userInputNeeded: values.hours ? null : "Provide the real opening hours." });
  if (fail.has("description")) mk({ type: "improve-description", target: "description", current: values.description ?? null, proposed: null, reason: "The description is missing or breaks Google's content rules.", evidence: ["completeness checklist: description"], benefit: "Explains what the business does to customers.", confidence: "high", priority: "high", userInputNeeded: "Review the generated description and approve or edit it." });
  if (fail.has("services")) mk({ type: "add-services", target: "services", current: [], proposed: (values.services ?? []).map((s) => s.name), reason: "No verified services are listed.", evidence: ["seo/business-profile.json offerings.services"], benefit: "Lets customers see the real services offered.", confidence: "medium", priority: "medium", userInputNeeded: values.services?.length ? null : "Confirm the services the business actually offers." });
  if (fail.has("primary-category") || fail.has("secondary-categories")) mk({ type: "set-categories", target: "categories", current: values.categories ?? null, proposed: null, reason: "Categories are incomplete.", evidence: ["completeness checklist"], benefit: "Categories tell Google what the business is.", confidence: "high", priority: "high", userInputNeeded: "Choose the primary and additional categories from Google's own list." });
  if (fail.has("logo")) mk({ type: "replace-logo", target: "logo", current: null, proposed: null, reason: "No usable logo is recorded.", evidence: ["completeness checklist: logo"], benefit: "Recognisable branding on the profile.", confidence: "medium", priority: "low", userInputNeeded: "Supply the real logo (JPG/PNG, at least 250px, ideally 720px square)." });
  if (fail.has("photos")) mk({ type: "add-photos", target: "photos", current: values.images?.photos?.length ?? 0, proposed: null, reason: "Fewer than 3 real photos are recorded.", evidence: ["completeness checklist: photos"], benefit: "Shows real work, team and premises to customers.", confidence: "medium", priority: "medium", userInputNeeded: "Supply real photographs; the engine never creates or generates images." });
  if (fail.has("special-hours")) mk({ type: "add-special-hours", target: "specialHours", current: [], proposed: null, reason: "No holiday or special hours are set.", evidence: ["completeness checklist: special-hours"], benefit: "Avoids wrong hours on holidays.", confidence: "low", priority: "low", userInputNeeded: "Add upcoming holiday hours if they differ." });
  if (fail.has("phone")) mk({ type: "fix-phone", target: "phone", current: values.phone ?? null, proposed: null, reason: "The phone number is missing or invalid.", evidence: ["completeness checklist: phone"], benefit: "Customers can reach the business.", confidence: "high", priority: "high", userInputNeeded: "Provide the correct public phone number." });
  if (fail.has("service-area") || fail.has("address")) mk({ type: "add-address-config", target: "address", current: values.address ?? null, proposed: null, reason: values.classification === "service-area" ? "Service-area configuration is incomplete (service areas and hidden address)." : "The public address is missing.", evidence: ["completeness checklist"], benefit: "Correct location presentation without exposing a private address.", confidence: "high", priority: "high", userInputNeeded: "Complete the address and service areas." });
  for (const f of auditFindings) {
    if (!["high", "medium"].includes(f.severity)) continue;
    const type = f.id === "phone-mismatch" || f.id === "schema-contradictory-phones" ? "fix-phone" : "fix-inconsistency";
    mk({ type, target: f.id, current: f.evidence ?? null, proposed: null, reason: f.message, evidence: [`website audit: ${f.id}`], benefit: "Consistent name, phone and address across profile and site support trust and accurate structured data.", confidence: f.severity === "high" ? "high" : "medium", priority: f.severity === "high" ? "high" : "medium", userInputNeeded: "Decide which value is correct, then correct the website or the profile." });
  }
  for (const r of reviews.filter((x) => !x.reply)) mk({ type: "respond-review", target: r.id, current: null, proposed: null, reason: `Unanswered ${r.rating}-star review.`, evidence: [`review ${r.id} dated ${r.date}`], benefit: "Replying shows customers the business listens.", confidence: "high", priority: r.rating <= 2 ? "high" : "medium", publicChange: true, userInputNeeded: "Review and approve the drafted reply." });
  return recs;
}

// ---------------------------------------------------------------- mapping into the existing improvement queue

const AREA = "local";
const SEVERITY = { high: "high", medium: "medium", low: "low" };
export const issueStatusOf = (rec) => ({ new: "open", review: "open", approved: "approved", implementing: "approved", verification: "fixed", completed: "verified", rejected: "wont-fix", deferred: "deferred", failed: "open" })[rec.state];

export function toIssue(rec, today) {
  const status = issueStatusOf(rec);
  const is = {
    id: rec.id, title: `GBP: ${rec.reason}`.slice(0, 200), severity: SEVERITY[rec.priority] ?? "medium", area: AREA, status,
    needsApproval: rec.publicChange, foundOn: rec.foundOn, source: "seo/data/local-gbp/recommendations.json",
    notes: `Google Business Profile recommendation (${rec.type}). Workflow state: ${rec.state}. ${rec.userInputNeeded ? `USER INPUT NEEDED: ${rec.userInputNeeded}` : ""}`.trim(),
  };
  if (status === "fixed" || status === "verified") is.fixedOn = rec.history.find((h) => h.state === "verification")?.at ?? today;
  if (status === "verified") is.verifiedOn = rec.verification?.at ?? today;
  return is;
}

// Writes/updates only entries with ids starting "gbp-"; every other issue is untouched.
export function syncToInventory(inventory, recs, today = new Date().toISOString().slice(0, 10)) {
  const inv = JSON.parse(JSON.stringify(inventory ?? {}));
  inv.issues = inv.issues ?? [];
  let added = 0, updated = 0;
  for (const rec of recs) {
    const is = toIssue(rec, today);
    const i = inv.issues.findIndex((x) => x.id === is.id);
    if (i < 0) { inv.issues.push(is); added++; } else if (inv.issues[i].status !== is.status || inv.issues[i].notes !== is.notes) { inv.issues[i] = { ...inv.issues[i], ...is }; updated++; }
  }
  return { inventory: inv, added, updated };
}
