// BWESEO Google Business Profile — website information extraction, LocalBusiness structured data and profile/website
// consistency (pure, zero dependencies).

import { digits, hostOf, nameSimilarity } from "./gbp-discovery.mjs";

const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const attr = (tag, name) => { const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag); return decode(m?.[1] ?? m?.[2] ?? ""); };
const strip = (h) => decode(String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

// Pull the facts a page publishes about the business. Reads only the page's own HTML; nothing is fetched here.
export function extractSiteFacts(html, pageUrl = "") {
  const h = String(html ?? "");
  const jsonld = [];
  for (const m of h.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); for (const n of flatten(j)) jsonld.push(n); } catch { jsonld.push({ "@type": "INVALID_JSON" }); }
  }
  const text = strip(h);
  const phones = [...new Set([...h.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1]).trim()))];
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? "");
  const h1 = strip(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? "");
  const metaDesc = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /name\s*=\s*["']description["']/i.test(t)).map((t) => attr(t, "content"))[0] ?? "";
  const images = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => ({ path: attr(m[0], "src"), alt: attr(m[0], "alt"), width: Number(attr(m[0], "width")) || undefined, height: Number(attr(m[0], "height")) || undefined })).filter((i) => i.path);
  const ogImage = [...h.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /property\s*=\s*["']og:image["']/i.test(t)).map((t) => attr(t, "content"))[0];
  if (ogImage) images.unshift({ path: ogImage, alt: "og:image" });
  const local = jsonld.filter((n) => isLocalType(n));
  const addr = local.map((n) => n.address).find((a) => a && typeof a === "object") ?? null;
  return {
    url: pageUrl, title, h1, metaDescription: metaDesc, phones, text, images,
    jsonld, localBusinessNodes: local,
    schemaName: local.map((n) => n.name).find(Boolean) ?? null,
    schemaPhone: local.map((n) => n.telephone).find(Boolean) ?? null,
    schemaAddress: addr, hasHoursSchema: local.some((n) => n.openingHoursSpecification || n.openingHours),
    textPhones: [...new Set((text.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).map((p) => p.trim()))],
  };
}
function flatten(j) {
  if (Array.isArray(j)) return j.flatMap(flatten);
  if (j && typeof j === "object") return [j, ...flatten(j["@graph"] ?? [])];
  return [];
}
const LOCAL_TYPES = new Set(["LocalBusiness", "Store", "ProfessionalService", "HomeAndConstructionBusiness", "Electrician", "Plumber", "RoofingContractor", "HVACBusiness", "GeneralContractor", "Locksmith", "MovingCompany", "HousePainter", "LegalService", "Attorney", "Dentist", "Physician", "MedicalBusiness", "AccountingService", "FinancialService", "RealEstateAgent", "AutomotiveBusiness", "AutoRepair", "Restaurant", "FoodEstablishment", "BeautySalon", "HealthAndBeautyBusiness", "DaySpa", "HairSalon", "VeterinaryCare", "FitnessCenter", "SportsActivityLocation", "TravelAgency", "InsuranceAgency", "EmploymentAgency", "Notary", "TouristInformationCenter", "Florist", "PetStore", "AutoDealer", "Bakery", "CafeOrCoffeeShop", "ChildCare", "Library", "EntertainmentBusiness", "LodgingBusiness", "Hotel"]);
const typesOf = (n) => [].concat(n?.["@type"] ?? []).map(String);
export const isLocalType = (n) => typesOf(n).some((t) => LOCAL_TYPES.has(t));

// Most specific schema.org subtype by keyword; falls back to LocalBusiness. Never guesses a regulated profession from thin evidence.
const SUBTYPES = [
  [/\broof/i, "RoofingContractor"], [/\bplumb/i, "Plumber"], [/\belectric/i, "Electrician"], [/\b(hvac|heating|air condition)/i, "HVACBusiness"],
  [/\blocksmith/i, "Locksmith"], [/\bmov(er|ing)\b/i, "MovingCompany"], [/\bpaint/i, "HousePainter"], [/\b(general contractor|remodel|construction)/i, "GeneralContractor"],
  [/\b(law|legal|attorney|lawyer)/i, "LegalService"], [/\bdent/i, "Dentist"], [/\b(account|bookkeep|tax prep)/i, "AccountingService"], [/\breal estate/i, "RealEstateAgent"],
  [/\b(auto repair|mechanic|garage)/i, "AutoRepair"], [/\brestaurant/i, "Restaurant"], [/\b(hair|barber|salon)/i, "HairSalon"], [/\bveterin/i, "VeterinaryCare"], [/\b(gym|fitness)/i, "FitnessCenter"],
  [/\binsurance/i, "InsuranceAgency"], [/\bflorist/i, "Florist"], [/\b(web design|web development|marketing|seo|consult)/i, "ProfessionalService"],
];
export const chooseSubtype = (text, explicit = null) => explicit ?? SUBTYPES.find(([re]) => re.test(text ?? ""))?.[1] ?? "LocalBusiness";

const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

// values: the proposed profile (gbp-profile.mjs shape). Only verified, public facts are passed in by the caller; this function
// additionally refuses to emit a street address for a hidden-address business.
export function buildLocalBusinessSchema(values, { subtype = null, gbpUrl = null, logoUrl = null, id = null } = {}) {
  const v = values ?? {};
  const warnings = [];
  const node = { "@context": "https://schema.org", "@type": chooseSubtype(`${v.businessType ?? ""} ${v.industry ?? ""}`, subtype) };
  if (v.website) node["@id"] = id ?? `${String(v.website).replace(/\/$/, "")}/#localbusiness`;
  if (v.name) node.name = v.name; else warnings.push("No verified business name: omitted.");
  if (v.website) node.url = v.website;
  if (v.phone) node.telephone = v.phone; else warnings.push("No verified phone: omitted.");
  if (v.description) node.description = v.description;
  if (logoUrl) node.logo = logoUrl;
  const a = v.address;
  if (v.hideAddress) {
    if (a) warnings.push("Address is hidden in the profile (service-area business): the street address is NOT published in structured data.");
    if (a?.city || a?.region) node.address = { "@type": "PostalAddress", ...(a.city ? { addressLocality: a.city } : {}), ...(a.region ? { addressRegion: a.region } : {}), ...(a.country ? { addressCountry: a.country } : {}) };
  } else if (a) {
    node.address = { "@type": "PostalAddress", streetAddress: a.street, addressLocality: a.city, addressRegion: a.region ?? a.state, postalCode: a.postalCode, addressCountry: a.country };
  } else warnings.push("No public address: omitted.");
  if ((v.serviceAreas ?? []).length) node.areaServed = v.serviceAreas.map((n) => ({ "@type": "AdministrativeArea", name: n }));
  if (v.hours) {
    const spec = Object.entries(v.hours).flatMap(([d, spans]) => (spans ?? []).map((s) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DAY_NAMES[d], opens: s.open, closes: s.close })));
    if (spec.length) node.openingHoursSpecification = spec;
  } else warnings.push("No structured hours: openingHoursSpecification omitted.");
  if (gbpUrl) node.sameAs = [gbpUrl];
  warnings.push("aggregateRating is never generated; only add it from real, first-party reviews displayed on the page and permitted by Google's review snippet policy.");
  return { node, json: JSON.stringify(node, null, 2), warnings };
}

// Compare what the website publishes with the proposed/connected profile. Reports; changes nothing.
export function auditConsistency(values, pages = []) {
  const v = values ?? {};
  const findings = [];
  const add = (severity, id, message, evidence) => findings.push({ severity, id, message, evidence });
  const all = pages.map((p) => (p.jsonld ? p : extractSiteFacts(p.html, p.url)));
  if (!all.length) return { findings: [{ severity: "info", id: "no-pages", message: "No website pages were supplied to compare." }], pagesChecked: 0 };

  const nodes = all.flatMap((p) => p.localBusinessNodes.map((n) => ({ n, url: p.url })));
  const names = [...new Set(nodes.map((x) => x.n.name).filter(Boolean))];
  const phones = [...new Set(nodes.map((x) => digits(x.n.telephone)).filter(Boolean))];
  if (all.some((p) => p.jsonld.some((n) => n["@type"] === "INVALID_JSON"))) add("high", "schema-invalid-json", "A JSON-LD block on the site is not valid JSON.", all.filter((p) => p.jsonld.some((n) => n["@type"] === "INVALID_JSON")).map((p) => p.url));
  if (names.length > 1) add("high", "schema-contradictory-names", `Structured data uses different business names: ${names.join(" / ")}.`, names);
  if (phones.length > 1) add("high", "schema-contradictory-phones", "Structured data uses different phone numbers.", phones);
  const perPage = all.filter((p) => p.localBusinessNodes.length > 1);
  if (perPage.length) add("medium", "schema-duplicate-nodes", "A page declares more than one LocalBusiness node; merge them so they do not contradict each other.", perPage.map((p) => p.url));

  if (v.name) {
    const seen = [...names, ...all.map((p) => p.h1)].filter(Boolean);
    if (names.length && !names.some((n) => nameSimilarity(n, v.name) >= 0.6)) add("high", "name-mismatch", `Website structured data name does not match the profile name "${v.name}".`, names);
    else if (!seen.length) add("low", "name-unseen", "The business name was not found in structured data or a main heading.");
  }
  if (v.phone) {
    const pub = new Set([...all.flatMap((p) => p.phones), ...all.flatMap((p) => p.textPhones), ...phones].map(digits).filter((d) => d.length >= 7).map((d) => d.slice(-10)));
    if (!pub.size) add("medium", "phone-not-on-site", "No phone number was found on the supplied pages.");
    else if (!pub.has(digits(v.phone).slice(-10))) add("high", "phone-mismatch", "The profile phone is not among the numbers the website publishes.", [...pub]);
    else if (pub.size > 1) add("low", "multiple-phones", "The website publishes more than one phone number; confirm which one the profile should use.", [...pub]);
  }
  if (v.website) {
    const host = hostOf(v.website);
    if (nodes.some((x) => x.n.url && hostOf(x.n.url) && hostOf(x.n.url) !== host)) add("medium", "schema-url-mismatch", "Structured data url points to a different host than the profile website.");
  }
  if (v.hideAddress) {
    const street = v.address?.street ? String(v.address.street).toLowerCase() : null;
    const leaks = street ? all.filter((p) => p.text.toLowerCase().includes(street) || String(p.schemaAddress?.streetAddress ?? "").toLowerCase() === street).map((p) => p.url) : [];
    if (leaks.length) add("high", "hidden-address-public", "The profile hides the street address (service-area business) but the website publishes it. Decide deliberately; do not publish a private address just to match.", leaks);
    else add("info", "hidden-address-ok", "The hidden address is not published on the supplied pages.");
  } else if (v.address?.street && !all.some((p) => p.text.toLowerCase().includes(String(v.address.street).toLowerCase()))) add("medium", "address-not-on-site", "The public address was not found on the supplied pages (check the contact page).");
  if (!all.some((p) => p.hasHoursSchema)) add("low", "no-hours-schema", "No opening hours in structured data.");
  if (!nodes.length) add("medium", "no-localbusiness-schema", "No LocalBusiness structured data found on the supplied pages.");
  return { findings, pagesChecked: all.length };
}
