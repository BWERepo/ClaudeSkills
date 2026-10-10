// BWESEO Google Business Profile — existing-profile discovery and duplicate prevention (pure, zero dependencies).
//
// The engine never searches Google Maps by scraping. Candidates come from permitted sources only: the administrator looking the
// business up in the official Google Business Profile interface / Google Search ("manual"), or the Business Profile API once access
// is approved ("api"). Each candidate is compared with the business; likely duplicates BLOCK creation until the administrator
// records a reason for each one (connect, claim, or "different business").

const clean = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["the", "and", "of", "llc", "inc", "ltd", "co", "company", "corp", "limited", "pty", "pllc", "group", "services", "service"]);
const tokens = (s) => clean(s).split(" ").filter((t) => t && !STOP.has(t));
export const digits = (s) => String(s ?? "").replace(/\D+/g, "");
export const hostOf = (u) => {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

export function nameSimilarity(a, b) {
  if (clean(a) && clean(a) === clean(b)) return 1;
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
const phoneMatch = (a, b) => { const x = digits(a), y = digits(b); return x.length >= 7 && y.length >= 7 && x.slice(-10) === y.slice(-10); };
const addressMatch = (a, b) => { const x = tokens(a), y = new Set(tokens(b)); return x.length >= 3 && x.filter((t) => y.has(t)).length / x.length >= 0.7; };

// candidate: { id?, name, address?, phone?, website?, ownership: "owned-by-you" | "unclaimed" | "claimed-by-other" | "unknown", source: "manual"|"api" }
export function compareCandidate(business, candidate) {
  const reasons = [];
  let score = 0;
  const ns = nameSimilarity(business.name, candidate.name);
  if (ns >= 0.99) { score += 3; reasons.push("same name"); } else if (ns >= 0.6) { score += 2; reasons.push("similar name"); } else if (ns >= 0.34) { score += 1; reasons.push("partly similar name"); }
  if (business.phone && candidate.phone && phoneMatch(business.phone, candidate.phone)) { score += 3; reasons.push("same phone"); }
  const bh = hostOf(business.website), ch = hostOf(candidate.website);
  if (bh && ch && bh === ch) { score += 3; reasons.push("same website"); }
  if (business.address && candidate.address && addressMatch(business.address, candidate.address)) { score += 2; reasons.push("same address"); }
  const level = score >= 5 || (ns >= 0.99 && score >= 4) ? "exact" : score >= 3 ? "likely" : score >= 1 ? "possible" : "none";
  return { level, score, reasons };
}

export function findDuplicates(business, candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((c) => ({ candidate: c, ...compareCandidate(business, c) }))
    .filter((m) => m.level !== "none")
    .sort((x, y) => y.score - x.score);
}

export const RESOLUTIONS = ["connect-existing", "claim", "different-business", "ignore-possible"];

// Which actions the administrator may take for a match, per ownership state.
export function claimGuidance(match) {
  const own = match.candidate.ownership ?? "unknown";
  if (own === "owned-by-you") return { action: "connect-existing", steps: ["Connect the profile you already manage instead of creating a new one."] };
  if (own === "unclaimed") return { action: "claim", steps: [
    "Open the profile in Google Search or Maps while signed in as the business owner and choose the option to claim or manage it.",
    "Complete Google's verification. Google decides which methods are offered; none is guaranteed.",
    "Record the outcome here once Google shows the profile as yours.",
  ] };
  if (own === "claimed-by-other") return { action: "request-ownership", steps: [
    "Use Google's ownership request flow from the profile; the current owner is asked to respond.",
    "If the profile is wrong or abandoned, use Google's own 'suggest an edit' or report process. Never create a second profile to get around it.",
    "Record the request here; do not create a duplicate while the request is open.",
  ] };
  return { action: "investigate", steps: ["Open the listing in the official Google interface and record whether you own it, it is unclaimed, or someone else manages it."] };
}

// discovery: { searched: {at, method, by}|null, candidates: [], resolutions: { <candidateKey>: { resolution, reason, by, at } } }
export const candidateKey = (c, i = 0) => c.id ?? `${clean(c.name).replace(/ /g, "-")}-${digits(c.phone).slice(-4) || i}`;

export function discoveryGate(business, discovery) {
  const d = discovery ?? {};
  const blockers = [];
  const userInputNeeded = [];
  if (!d.searched?.at) {
    userInputNeeded.push("Search for existing listings of this business in the official Google Business Profile / Google Search interface (or via the API once approved) and record the search before creating anything.");
    return { canCreate: false, matches: [], unresolved: [], blockers: ["No existing-profile search has been recorded."], userInputNeeded };
  }
  const matches = findDuplicates(business, d.candidates);
  const unresolved = [];
  for (const m of matches) {
    const key = candidateKey(m.candidate, d.candidates.indexOf(m.candidate));
    const res = d.resolutions?.[key];
    const settled = res && RESOLUTIONS.includes(res.resolution) && String(res.reason ?? "").trim() && String(res.by ?? "").trim();
    if (settled) m.resolution = res;
    else unresolved.push({ key, ...m });
    m.key = key;
  }
  const blocking = unresolved.filter((u) => u.level === "exact" || u.level === "likely");
  for (const u of blocking) {
    blockers.push(`Possible existing profile "${u.candidate.name}" (${u.level}: ${u.reasons.join(", ")}). Connect or claim it, or record why it is a different business.`);
    userInputNeeded.push(`Decide what to do about the existing listing "${u.candidate.name}".`);
  }
  const connect = matches.find((m) => m.resolution && ["connect-existing", "claim"].includes(m.resolution.resolution));
  if (connect) blockers.push(`"${connect.candidate.name}" was resolved as ${connect.resolution.resolution}: continue with that profile; do not create a new one.`);
  return { canCreate: blockers.length === 0, matches, unresolved, blockers, userInputNeeded };
}
