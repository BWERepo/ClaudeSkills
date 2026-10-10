// BWESEO Google Business Profile — profile builder: validation, description generator, category matching, image checks,
// readiness preview and completeness score (pure, zero dependencies).
//
// Data comes from the site's own seo/business-profile.json (Facts with provenance). Only facts with status "verified" and
// public !== false are used for anything that will become public. Nothing is invented: a missing fact stays missing and is
// listed under userInputNeeded.
//
// The numeric limits below follow Google's published Business Profile guidance as understood on the date in GUIDANCE_DATE.
// Google changes these rules; re-check https://support.google.com/business/ before relying on a limit, and treat Google's own
// validation as authoritative.

export const GUIDANCE_DATE = "2026-10-10";
export const LIMITS = { nameMax: 100, descriptionMax: 750, descriptionMin: 100, secondaryCategoriesMax: 9 };
export const IMAGE_SPECS = {
  logo: { formats: ["jpg", "jpeg", "png"], minPx: 250, recommendedPx: 720, minBytes: 10 * 1024, maxBytes: 5 * 1024 * 1024, square: true },
  cover: { formats: ["jpg", "jpeg", "png"], minPx: 480, recommendedWidth: 1080, recommendedHeight: 608, minBytes: 10 * 1024, maxBytes: 5 * 1024 * 1024, ratio: 16 / 9 },
  photo: { formats: ["jpg", "jpeg", "png"], minPx: 250, recommendedPx: 720, minBytes: 10 * 1024, maxBytes: 5 * 1024 * 1024 },
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- reading verified facts

export const usable = (fact) => !!fact && fact.status === "verified" && fact.public !== false && fact.value !== undefined && fact.value !== "" && !(Array.isArray(fact.value) && !fact.value.length);

// Builds the proposed-profile input from a business-profile.json and the eligibility result. Returns the values plus which facts were missing.
export function profileFromBusinessProfile(bp, eligibility = null) {
  const identity = bp?.identity ?? {};
  const contact = bp?.contact ?? {};
  const markets = bp?.markets ?? {};
  const pick = (f) => (usable(f) ? f.value : null);
  const services = (bp?.offerings?.services ?? []).filter((s) => s?.status === "verified" && s.public !== false).map((s) => ({ name: s.name, description: s.description ?? "" }));
  const primary = (markets.locations ?? []).map((l) => l?.value).find((v) => v && ["storefront", "office"].includes(v.type));
  const missing = [];
  const out = {
    name: pick(identity.businessName),
    website: pick(identity.website),
    phone: pick(contact.phone),
    businessType: pick(identity.businessType),
    industry: pick(identity.industry),
    description: null,
    address: primary?.address ?? null,
    serviceAreas: pick(markets.serviceAreas) ?? [],
    services,
    hours: null,
    hoursText: pick(contact.businessHours),
    differentiators: (bp?.positioning?.differentiators ?? []).filter((d) => usable(d)).map((d) => d.value),
    classification: eligibility?.classification ?? null,
    hideAddress: eligibility?.hideAddress ?? false,
  };
  for (const [k, label] of [["name", "business name"], ["website", "website"], ["phone", "phone"]]) if (!out[k]) missing.push(`Verified ${label} is missing from seo/business-profile.json.`);
  if (!out.services.length) missing.push("No verified services in seo/business-profile.json (offerings.services).");
  if (out.hoursText && !out.hours) missing.push("Business hours exist only as free text; enter them as structured hours (day, open, close) before submission.");
  if (!out.hoursText) missing.push("Business hours are missing.");
  return { values: out, missing };
}

// ---------------------------------------------------------------- name

const NAME_HYPE = /\b(best|cheap(est)?|#1|number one|top[- ]rated|affordable|24\/7|near me|open now|free quote)\b/i;
export function validateName(name, { officialName = null, serviceAreaNames = [] } = {}) {
  const issues = [];
  const n = clean(name);
  if (!n) return [{ level: "error", field: "name", message: "Business name is required." }];
  if (n.length > LIMITS.nameMax) issues.push({ level: "error", field: "name", message: `Name is longer than ${LIMITS.nameMax} characters.` });
  if (officialName && clean(officialName).toLowerCase() !== n.toLowerCase())
    issues.push({ level: "error", field: "name", message: `Name "${n}" differs from the official business name "${clean(officialName)}". Use the real-world name customers see on signage, invoices and the website; do not add keywords.` });
  if (NAME_HYPE.test(n)) issues.push({ level: "error", field: "name", message: "Name contains promotional or search wording (best, cheap, near me, 24/7…). Unless it is genuinely part of the registered name, remove it." });
  if (/https?:\/\/|www\.|\.(com|net|org|biz|co)\b/i.test(n)) issues.push({ level: "warning", field: "name", message: "Name contains a web address; only keep it if it is genuinely part of the business name." });
  if (/\d{3}[\s.-]?\d{3,4}/.test(n)) issues.push({ level: "error", field: "name", message: "Name contains a phone number." });
  if (n.length > 4 && n === n.toUpperCase() && /[A-Z]{5,}/.test(n)) issues.push({ level: "warning", field: "name", message: "Name is all capitals; use the normal capitalisation of the business name." });
  for (const city of serviceAreaNames) if (city && new RegExp(`(^|[-–|,]\\s*|\\s)${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(n) && !(officialName && new RegExp(city, "i").test(officialName)))
    issues.push({ level: "warning", field: "name", message: `Name ends with the place "${city}", which is not in the official name. Do not add locations to the name.` });
  return issues;
}

// ---------------------------------------------------------------- description

const DESC_BAD = [
  [/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|biz)\b/i, "contains a link; Google does not allow links in the description"],
  [/\b(best|#1|number one|top[- ]rated|guarantee[sd]?|unbeatable|cheapest|lowest price)\b/i, "contains an unsupported or promotional claim"],
  [/\d{3}[\s.-]\d{3,4}[\s.-]?\d{0,4}/, "contains a phone number"],
  [/[\u{1F300}-\u{1FAFF}☀-➿]/u, "contains emoji or symbols; keep it plain text"],
  [/<[a-z/][^>]*>/i, "contains HTML"],
];
export function validateDescription(text) {
  const d = clean(text);
  const issues = [];
  if (!d) return [{ level: "error", field: "description", message: "Description is required." }];
  if (d.length > LIMITS.descriptionMax) issues.push({ level: "error", field: "description", message: `Description is ${d.length} characters; the limit is ${LIMITS.descriptionMax}.` });
  if (d.length < LIMITS.descriptionMin) issues.push({ level: "warning", field: "description", message: `Description is short (${d.length} characters); say what the business does, for whom and where.` });
  for (const [re, msg] of DESC_BAD) if (re.test(d)) issues.push({ level: "error", field: "description", message: `Description ${msg}.` });
  const words = d.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (words.length >= 20 && n >= 5 && n / words.length > 0.12) issues.push({ level: "warning", field: "description", message: `The word "${top}" is repeated ${n} times; this reads as keyword stuffing.` });
  return issues;
}

// Builds a plain, factual description ONLY from verified facts. It is a draft: the administrator must edit and approve it.
export function generateDescription(values, { maxLength = LIMITS.descriptionMax } = {}) {
  const v = values ?? {};
  const name = v.name;
  if (!name) return { text: "", missing: ["Verified business name"], sources: [] };
  const missing = [];
  const sources = ["identity.businessName"];
  const parts = [];
  const kind = v.businessType ?? v.industry;
  if (kind) { parts.push(`${name} is a ${String(kind).replace(/^an?\s+/i, "")}.`); sources.push("identity.businessType/industry"); }
  else missing.push("Business type or industry (verified)");
  const svc = (v.services ?? []).map((s) => s.name).filter(Boolean).slice(0, 8);
  if (svc.length) { parts.push(`Services include ${list(svc)}.`); sources.push("offerings.services"); } else missing.push("Verified services");
  if (v.serviceAreas?.length) {
    const areas = v.serviceAreas.slice(0, 8);
    if (v.classification === "storefront" || v.classification === "hybrid" || !v.hideAddress) parts.push(v.classification === "service-area" ? `We serve ${list(areas)}.` : `Customers come to us from, and we also serve, ${list(areas)}.`);
    else parts.push(`We serve customers in ${list(areas)}.`);
    sources.push("markets.serviceAreas");
  }
  const diff = (v.differentiators ?? []).filter((x) => typeof x === "string").slice(0, 2);
  if (diff.length) { parts.push(diff.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(" ")); sources.push("positioning.differentiators"); }
  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (text.length > maxLength) text = text.slice(0, text.lastIndexOf(" ", maxLength - 1)).replace(/[,;]$/, "") + ".";
  return { text, missing, sources, note: "Draft built only from verified facts. Edit it, then approve it; it is never submitted automatically." };
}
const list = (a) => (a.length <= 1 ? a.join("") : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`);

// ---------------------------------------------------------------- categories

// categoryList: [{ id?, name }] — Google's category data, imported from the official API (once approved) or copied from the
// Business Profile category picker. The engine does not bundle or invent a category list.
export function suggestCategories(values, categoryList = [], limit = 8) {
  if (!Array.isArray(categoryList) || !categoryList.length)
    return { suggestions: [], needsInput: "No Google category list is available. Open the category picker in the Business Profile interface (or import the API category list once access is approved) and choose from Google's own names." };
  const text = clean([values?.industry, values?.businessType, ...(values?.services ?? []).map((s) => s.name)].join(" ")).toLowerCase();
  const words = new Set(text.match(/[a-z]{3,}/g) ?? []);
  const scored = categoryList.map((c) => {
    const cw = (String(c.name).toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !["and", "the", "service", "services"].includes(w));
    const hit = cw.filter((w) => words.has(w) || words.has(w.replace(/s$/, "")));
    return { category: c, score: cw.length ? hit.length / cw.length : 0, evidence: hit };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return { suggestions: scored.map((s) => ({ ...s.category, confidence: s.score >= 0.8 ? "high" : s.score >= 0.5 ? "medium" : "low", evidence: `matches: ${s.evidence.join(", ")}` })), needsInput: "The administrator must pick the primary category and any secondary categories; suggestions are not applied automatically." };
}

export function validateCategories(cats, categoryList = null) {
  const issues = [];
  const primary = cats?.primary;
  const secondary = cats?.secondary ?? [];
  if (!isStr(primary)) issues.push({ level: "error", field: "categories", message: "A primary category is required." });
  if (secondary.length > LIMITS.secondaryCategoriesMax) issues.push({ level: "error", field: "categories", message: `At most ${LIMITS.secondaryCategoriesMax} additional categories.` });
  if (isStr(primary) && secondary.map((s) => s.toLowerCase()).includes(primary.toLowerCase())) issues.push({ level: "warning", field: "categories", message: "The primary category is repeated as an additional category." });
  if (Array.isArray(categoryList) && categoryList.length) {
    const known = new Set(categoryList.map((c) => String(c.name).toLowerCase()));
    for (const c of [primary, ...secondary].filter(isStr)) if (!known.has(c.toLowerCase())) issues.push({ level: "error", field: "categories", message: `"${c}" is not in the supplied Google category list.` });
  } else if (isStr(primary)) issues.push({ level: "warning", field: "categories", message: "Categories could not be checked against Google's list; confirm each in the category picker." });
  return issues;
}

// ---------------------------------------------------------------- contact, address, hours

export function validatePhone(phone) {
  const d = String(phone ?? "").replace(/\D+/g, "");
  if (!d) return [{ level: "error", field: "phone", message: "A phone number is required." }];
  if (d.length < 7 || d.length > 15) return [{ level: "error", field: "phone", message: "The phone number does not look valid." }];
  return [];
}
export function validateWebsite(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("scheme");
    return u.protocol === "http:" ? [{ level: "warning", field: "website", message: "Use the https version of the website." }] : [];
  } catch { return [{ level: "error", field: "website", message: "The website must be a full http(s) URL." }]; }
}

export function validateAddress(address, { classification, hideAddress }) {
  const issues = [];
  const a = address && typeof address === "object" ? address : null;
  const needsAddress = classification !== "online-only";
  if (needsAddress && !(a && isStr(a.street) && isStr(a.city) && isStr(a.region ?? a.state ?? "x") && isStr(a.postalCode) && isStr(a.country ?? "x"))) {
    issues.push({ level: "error", field: "address", message: classification === "service-area" ? "A service-area business still needs the real address it operates from (it will be hidden). Enter it to verify with Google." : "A street address is required." });
  }
  if (a && /\b(p\.?\s?o\.?\s?box|post office box)\b/i.test(`${a.street ?? ""}`)) issues.push({ level: "error", field: "address", message: "A PO box cannot be a business address." });
  if (classification === "service-area" && hideAddress !== true) issues.push({ level: "error", field: "address", message: "Service-area business: the address must be hidden from the public profile." });
  return issues;
}

const T = /^([01]\d|2[0-3]):[0-5]\d$/;
// hours: { mon: [{open:"09:00", close:"17:00"}], tue: [], ... }  — an empty/absent day means closed. close may be "24:00".
export function validateHours(hours) {
  if (!hours || typeof hours !== "object") return [{ level: "error", field: "hours", message: "Structured business hours are required (Google shows hours as open/closed per day)." }];
  const issues = [];
  for (const [day, spans] of Object.entries(hours)) {
    if (!DAYS.includes(day)) { issues.push({ level: "error", field: "hours", message: `Unknown day "${day}".` }); continue; }
    for (const s of spans ?? []) {
      if (!T.test(s.open ?? "") || !(T.test(s.close ?? "") || s.close === "24:00")) issues.push({ level: "error", field: "hours", message: `${day}: times must be HH:MM (24-hour).` });
      else if (s.close <= s.open && s.close !== "24:00") issues.push({ level: "error", field: "hours", message: `${day}: closing time must be after opening time.` });
    }
  }
  if (!DAYS.some((d) => (hours[d] ?? []).length)) issues.push({ level: "warning", field: "hours", message: "Every day is closed. Confirm this is correct." });
  return issues;
}
export function validateSpecialHours(list, today = new Date().toISOString().slice(0, 10)) {
  const issues = [];
  for (const h of list ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date ?? "")) issues.push({ level: "error", field: "specialHours", message: `Special hours date "${h.date}" must be YYYY-MM-DD.` });
    else if (h.date < today) issues.push({ level: "warning", field: "specialHours", message: `Special hours for ${h.date} are in the past.` });
    if (!h.closed && !(T.test(h.open ?? "") && T.test(h.close ?? ""))) issues.push({ level: "error", field: "specialHours", message: `${h.date}: give open and close times, or mark it closed.` });
  }
  return issues;
}

// ---------------------------------------------------------------- images

export function checkImage(img) {
  const kind = IMAGE_SPECS[img?.kind] ? img.kind : "photo";
  const s = IMAGE_SPECS[kind];
  const issues = [];
  const fmt = String(img?.format ?? String(img?.path ?? "").split(".").pop()).toLowerCase();
  if (!s.formats.includes(fmt)) issues.push({ level: "error", message: `Format ${fmt || "unknown"} is not accepted (use JPG or PNG).` });
  const { width, height, bytes } = img ?? {};
  if (!(width > 0 && height > 0)) issues.push({ level: "warning", message: "Dimensions unknown; check them before upload." });
  else {
    if (Math.min(width, height) < s.minPx) issues.push({ level: "error", message: `Image is ${width}x${height}; the shortest side must be at least ${s.minPx}px.` });
    else if (s.recommendedPx && Math.min(width, height) < s.recommendedPx) issues.push({ level: "warning", message: `Image is ${width}x${height}; ${s.recommendedPx}px or more is recommended for sharpness.` });
    if (s.square && Math.abs(width - height) / Math.max(width, height) > 0.1) issues.push({ level: "warning", message: "A logo works best as a square image." });
    if (s.ratio && Math.abs(width / height - s.ratio) > 0.15) issues.push({ level: "warning", message: "A cover photo should be about 16:9." });
  }
  if (bytes != null && (bytes < s.minBytes || bytes > s.maxBytes)) issues.push({ level: "error", message: `File size ${Math.round(bytes / 1024)} KB is outside ${Math.round(s.minBytes / 1024)} KB – ${Math.round(s.maxBytes / 1048576)} MB.` });
  if (img?.stock === true || img?.generated === true) issues.push({ level: "error", message: "Do not upload stock or AI-generated images as photos of the business or its premises. Use real photographs." });
  return { kind, ok: !issues.some((i) => i.level === "error"), issues };
}

// Recommend which of the site's images fit which role; never creates imagery.
export function recommendImages(siteImages = []) {
  const imgs = siteImages.map((i) => ({ ...i, check: checkImage({ ...i, kind: i.kind ?? "photo" }) }));
  const named = (re) => imgs.filter((i) => re.test(`${i.path ?? ""} ${i.alt ?? ""}`));
  const pick = (re, kind) => named(re).map((i) => ({ ...i, check: checkImage({ ...i, kind }) })).filter((i) => i.check.ok);
  return {
    logo: pick(/logo|brand/i, "logo"),
    cover: pick(/hero|cover|banner|storefront|exterior/i, "cover"),
    team: pick(/team|staff|owner|crew/i, "photo"),
    work: pick(/project|work|gallery|product|service|portfolio/i, "photo"),
    problems: imgs.filter((i) => !i.check.ok).map((i) => ({ path: i.path, issues: i.check.issues })),
    note: "Only photographs that genuinely show the business, its work, team or premises should be uploaded. Nothing here is generated or fabricated.",
  };
}

// ---------------------------------------------------------------- readiness and completeness

export function validateProfile(p, ctx = {}) {
  const issues = [
    ...validateName(p.name, { officialName: ctx.officialName ?? null, serviceAreaNames: p.serviceAreas ?? [] }),
    ...validateDescription(p.description),
    ...validateCategories(p.categories, ctx.categoryList),
    ...validatePhone(p.phone), ...validateWebsite(p.website),
    ...validateAddress(p.address, { classification: p.classification, hideAddress: p.hideAddress }),
    ...validateHours(p.hours), ...validateSpecialHours(p.specialHours, ctx.today),
  ];
  if (p.classification !== "storefront" && p.classification !== "hybrid" && !(p.serviceAreas ?? []).length) issues.push({ level: "error", field: "serviceAreas", message: "Service areas are required for a service-area business." });
  if (!(p.services ?? []).length) issues.push({ level: "warning", field: "services", message: "No services listed." });
  return { issues, errors: issues.filter((i) => i.level === "error"), warnings: issues.filter((i) => i.level === "warning"), valid: !issues.some((i) => i.level === "error") };
}

// What the administrator must still supply, as a plain list. "USER INPUT NEEDED" is rendered by the CLI/skill.
export function userInputNeeded(p, validation) {
  const out = validation.errors.map((e) => e.message);
  if (p.opened === undefined) out.push("Opening date is optional; add it only if the business has not yet opened.");
  return out.filter((m) => !/optional/.test(m));
}

// Completeness checklist. Each item: pass | fail | unknown ("unknown" = only the owner can see it in Google's interface).
export function completeness(p, { live = false, reviews = null } = {}) {
  const has = (v) => (Array.isArray(v) ? v.length > 0 : isStr(v) || (v && typeof v === "object"));
  const sab = p.classification === "service-area";
  const items = [
    ["name", "Business name", 10, has(p.name) ? "pass" : "fail"],
    ["primary-category", "Primary category", 12, has(p.categories?.primary) ? "pass" : "fail"],
    ["secondary-categories", "Additional categories", 4, (p.categories?.secondary ?? []).length ? "pass" : "fail"],
    ["description", "Description", 10, validateDescription(p.description).some((i) => i.level === "error") ? "fail" : "pass"],
    ["phone", "Phone", 8, validatePhone(p.phone).length ? "fail" : "pass"],
    ["website", "Website", 8, validateWebsite(p.website).some((i) => i.level === "error") ? "fail" : "pass"],
    [sab ? "service-area" : "address", sab ? "Service areas and hidden address" : "Address", 10, (sab ? has(p.serviceAreas) && p.hideAddress === true && has(p.address) : has(p.address)) ? "pass" : "fail"],
    ["hours", "Opening hours", 8, validateHours(p.hours).some((i) => i.level === "error") ? "fail" : "pass"],
    ["special-hours", "Special hours (holidays)", 2, (p.specialHours ?? []).length ? "pass" : "fail"],
    ["services", "Services", 6, has(p.services) ? "pass" : "fail"],
    ["logo", "Logo", 4, p.images?.logo ? "pass" : "fail"],
    ["cover", "Cover photo", 3, p.images?.cover ? "pass" : "fail"],
    ["photos", "At least 3 real photos", 5, (p.images?.photos ?? []).length >= 3 ? "pass" : "fail"],
    ["attributes", "Business attributes", 3, live && p.attributes ? "pass" : "unknown"],
    ["reviews", "Review process in place", 4, reviews == null ? "unknown" : reviews.responding ? "pass" : "fail"],
    ["posts", "Recent useful post", 3, live ? (p.lastPostAt ? "pass" : "fail") : "unknown"],
  ].map(([id, label, weight, status]) => ({ id, label, weight, status }));
  const known = items.filter((i) => i.status !== "unknown");
  const earned = known.filter((i) => i.status === "pass").reduce((s, i) => s + i.weight, 0);
  const possible = known.reduce((s, i) => s + i.weight, 0);
  return {
    score: possible ? Math.round((earned / possible) * 100) : 0,
    coverage: Math.round((known.reduce((s, i) => s + i.weight, 0) / items.reduce((s, i) => s + i.weight, 0)) * 100),
    items,
    note: "An internal checklist score, not a Google ranking factor. Items marked unknown can only be seen in the Business Profile interface (or the API once approved).",
  };
}

export function preview(p, validation, discoveryOk) {
  const status = validation.valid && discoveryOk ? "ready-for-approval" : "not-ready";
  return {
    status,
    public: {
      name: p.name, categories: p.categories, description: p.description, phone: p.phone, website: p.website,
      address: p.hideAddress ? "(hidden from the public profile)" : p.address, serviceAreas: p.serviceAreas, hours: p.hours, specialHours: p.specialHours ?? [], services: (p.services ?? []).map((s) => s.name),
    },
    errors: validation.errors, warnings: validation.warnings,
  };
}
