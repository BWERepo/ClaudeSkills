// BWESEO Google Business Profile — eligibility engine (pure, zero dependencies). Engine 1.10.0 + Local/GBP module (Phase 1).
//
// Decides whether a business may be offered Google Business Profile creation. It NEVER infers eligibility from website marketing
// copy: every answer comes from the administrator (or the owner, through the administrator). An unanswered question is
// "needs input", never a default "yes". Google decides the final outcome; this engine only refuses to help create a profile
// that plainly does not qualify (no invented storefronts, no virtual offices, no PO boxes).
//
// Answers (all asked of the administrator):
//   servesInPerson        customers visit the business in person                   true | false | null
//   staffedLocation       a staffed physical location customers can visit           true | false | null
//   travelsToCustomers    the business travels to customers' locations              true | false | null
//   onlineOnly            the business operates only online                         true | false | null
//   hasLegitimateAddress  a real address the business operates from                 true | false | null
//   addressType           commercial | residential | po-box | virtual-office | shared-unstaffed | unknown
//   existingProfile       yes | no | unknown                                         (does a Google profile already exist?)
//   ownerAuthorized       the person acting is the owner or an authorized manager    true | false | null

export const CLASSIFICATIONS = ["storefront", "service-area", "hybrid", "online-only", "unknown"];
export const ADDRESS_TYPES = ["commercial", "residential", "po-box", "virtual-office", "shared-unstaffed", "unknown"];
export const NEXT_ACTIONS = ["answer-questions", "not-eligible", "connect-existing", "obtain-authorization", "create-profile"];

const QUESTIONS = [
  ["servesInPerson", "Does the business serve customers in person at a location they visit?"],
  ["staffedLocation", "Is there a staffed physical location customers can visit during stated hours?"],
  ["travelsToCustomers", "Does the business travel to customers at their locations?"],
  ["onlineOnly", "Is the business online-only (no in-person service and no travel to customers)?"],
  ["hasLegitimateAddress", "Does the business have a legitimate address it operates from?"],
  ["addressType", "Is that address commercial, residential, a PO box, a virtual office, or a shared space nobody staffs?"],
  ["existingProfile", "Does a Google Business Profile for this business already exist (yours or anyone's)?"],
  ["ownerAuthorized", "Is the person acting the owner, or authorized by the owner to manage the profile?"],
];
export const eligibilityQuestions = () => QUESTIONS.map(([key, text]) => ({ key, text }));

const bool = (v) => (v === true || v === false ? v : null);
const ALTERNATIVES = [
  "Strengthen the website itself: clear service pages, accurate contact and about pages, and LocalBusiness/Organization structured data that matches what is true.",
  "Build genuine citations and mentions (industry bodies, chambers of commerce, trade directories) that name the business accurately.",
  "Earn reviews on platforms that fit how the business actually operates; never ask for reviews selectively or in exchange for rewards.",
  "Revisit eligibility if the business later opens a staffed location or begins serving customers in person or at their locations.",
];

export function normalizeAnswers(raw = {}) {
  const a = raw && typeof raw === "object" ? raw : {};
  const addressType = ADDRESS_TYPES.includes(a.addressType) ? a.addressType : "unknown";
  const existing = ["yes", "no", "unknown"].includes(a.existingProfile) ? a.existingProfile : "unknown";
  return {
    servesInPerson: bool(a.servesInPerson), staffedLocation: bool(a.staffedLocation), travelsToCustomers: bool(a.travelsToCustomers),
    onlineOnly: bool(a.onlineOnly), hasLegitimateAddress: bool(a.hasLegitimateAddress), addressType, existingProfile: existing,
    ownerAuthorized: bool(a.ownerAuthorized),
  };
}

export function assessEligibility(raw) {
  const a = normalizeAnswers(raw);
  const blockers = [];
  const warnings = [];
  const userInputNeeded = [];
  const need = (key) => userInputNeeded.push({ key, question: QUESTIONS.find(([k]) => k === key)[1] });

  for (const k of ["servesInPerson", "travelsToCustomers", "onlineOnly", "ownerAuthorized"]) if (a[k] === null) need(k);
  if (a.existingProfile === "unknown") need("existingProfile");

  // contradictions are not guessed around — they go back to the administrator
  if (a.onlineOnly === true && (a.servesInPerson === true || a.travelsToCustomers === true || a.staffedLocation === true))
    blockers.push("Answers contradict each other: the business is marked online-only but also serves customers in person or travels to them. Correct the answers.");
  if (a.staffedLocation === true && a.servesInPerson === false) blockers.push("A staffed location is marked yes, but serving customers in person is marked no. Correct the answers.");

  const badAddress = ["po-box", "virtual-office", "shared-unstaffed"].includes(a.addressType);
  const hasAddress = a.hasLegitimateAddress === true && !badAddress;
  if (a.hasLegitimateAddress === null) need("hasLegitimateAddress");
  if (a.hasLegitimateAddress === true && a.addressType === "unknown") need("addressType");

  let classification = "unknown";
  const visits = a.servesInPerson === true && a.staffedLocation === true;
  const travels = a.travelsToCustomers === true;
  if (!blockers.length) {
    if (a.onlineOnly === true) classification = "online-only";
    else if (visits && travels) classification = "hybrid";
    else if (visits) classification = "storefront";
    else if (travels) classification = "service-area";
    else if (a.servesInPerson === false && a.travelsToCustomers === false && a.onlineOnly === false) classification = "online-only";
    else if (a.servesInPerson === true && a.staffedLocation === null) need("staffedLocation");
    else if (a.servesInPerson === true && a.staffedLocation === false) {
      blockers.push("Customers visit, but there is no staffed location: Google profiles for in-person service need a location that is staffed during the stated hours. Do not create one.");
    }
  }

  if (classification === "online-only")
    blockers.push("Online-only businesses generally do not qualify for a Google Business Profile. Do not create one; use the website SEO alternatives instead.");

  // address rules
  if (["storefront", "hybrid"].includes(classification) && !hasAddress && a.hasLegitimateAddress !== null)
    blockers.push("A storefront or hybrid profile needs a legitimate, staffed street address. A PO box, virtual office or unstaffed shared space does not qualify. Do not invent one.");
  if (classification === "service-area") {
    if (a.hasLegitimateAddress === false || badAddress)
      blockers.push("A service-area profile still needs a real address the business operates from (it may be hidden from the public). A PO box or virtual office does not qualify. Do not invent one.");
    else if (a.addressType === "residential") warnings.push("Home-based service-area business: hide the address in the profile so it is not shown publicly.");
  }
  if (["storefront", "hybrid"].includes(classification) && a.addressType === "residential")
    warnings.push("Residential address with customers visiting: Google only accepts this if the location is genuinely staffed and open to customers during stated hours. Otherwise treat the business as service-area and hide the address.");
  if (classification === "hybrid") warnings.push("Hybrid business: show the staffed address and list the areas served; make sure hours describe when customers can actually visit.");

  const hideAddress = classification === "service-area" || (classification === "unknown" && a.travelsToCustomers === true && a.servesInPerson === false);
  if (a.ownerAuthorized === false) blockers.push("The person acting is not the owner or an authorized manager. Obtain the owner's consent before connecting, claiming or creating anything.");

  const ineligible = blockers.some((b) => /Online-only|Do not (create|invent)|contradict/.test(b));
  const answered = userInputNeeded.length === 0 && classification !== "unknown";
  let nextAction;
  if (ineligible) nextAction = "not-eligible";
  else if (!answered) nextAction = "answer-questions";
  else if (a.ownerAuthorized === false) nextAction = "obtain-authorization";
  else if (a.existingProfile === "yes") nextAction = "connect-existing";
  else nextAction = "create-profile";

  const eligible = ineligible ? "no" : answered && a.ownerAuthorized === true ? "yes" : "needs-input";
  return {
    eligible, classification, hideAddress, nextAction, blockers, warnings, userInputNeeded,
    alternatives: eligible === "no" ? ALTERNATIVES : [],
    note: "Google makes the final decision on eligibility and verification. This assessment is based only on the administrator's answers.",
  };
}
