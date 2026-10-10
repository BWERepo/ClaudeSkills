// Tests for the Google Business Profile / Local SEO module (Phase 1: manual mode). Fictional data only (.example / .test domains).
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessEligibility } from "./gbp-eligibility.mjs";
import { findDuplicates, discoveryGate, nameSimilarity, claimGuidance, candidateKey } from "./gbp-discovery.mjs";
import { validateName, validateDescription, generateDescription, validateHours, validateCategories, suggestCategories, checkImage, validateProfile, completeness, validateAddress, profileFromBusinessProfile, validatePhone, validateWebsite } from "./gbp-profile.mjs";
import { buildLocalBusinessSchema, auditConsistency, extractSiteFacts, chooseSubtype } from "./gbp-schema.mjs";
import { newState, loadState, setEligibility, recordSearch, resolveCandidate, creationGate, approve, latestApproval, reportCreation, setVerification, verificationGuidance, nextPrimaryAction, summarize } from "./gbp-state.mjs";
import { main, context } from "./seo-local-gbp.mjs";

const yes = { servesInPerson: true, staffedLocation: true, travelsToCustomers: false, onlineOnly: false, hasLegitimateAddress: true, addressType: "commercial", existingProfile: "no", ownerAuthorized: true };
const sab = { servesInPerson: false, staffedLocation: false, travelsToCustomers: true, onlineOnly: false, hasLegitimateAddress: true, addressType: "residential", existingProfile: "no", ownerAuthorized: true };

describe("eligibility", () => {
  it("storefront is eligible", () => { const r = assessEligibility(yes); expect(r).toMatchObject({ eligible: "yes", classification: "storefront", nextAction: "create-profile", hideAddress: false }); });
  it("home-based service-area business: eligible, address hidden, warned", () => { const r = assessEligibility(sab); expect(r).toMatchObject({ eligible: "yes", classification: "service-area", hideAddress: true }); expect(r.warnings.join(" ")).toMatch(/hide the address/); });
  it("hybrid", () => expect(assessEligibility({ ...yes, travelsToCustomers: true }).classification).toBe("hybrid"));
  it("online-only is ineligible and gets website alternatives, never a creation action", () => {
    const r = assessEligibility({ ...yes, servesInPerson: false, staffedLocation: false, travelsToCustomers: false, onlineOnly: true, hasLegitimateAddress: false });
    expect(r).toMatchObject({ eligible: "no", classification: "online-only", nextAction: "not-eligible" });
    expect(r.alternatives.length).toBeGreaterThan(0);
  });
  it("virtual office and PO box never qualify", () => {
    for (const addressType of ["virtual-office", "po-box", "shared-unstaffed"]) {
      expect(assessEligibility({ ...yes, addressType }).eligible).toBe("no");
      expect(assessEligibility({ ...sab, addressType }).eligible).toBe("no");
    }
  });
  it("customers visit but nobody staffs the location: not eligible", () => expect(assessEligibility({ ...yes, staffedLocation: false }).eligible).toBe("no"));
  it("unanswered questions are asked, never assumed", () => {
    const r = assessEligibility({});
    expect(r).toMatchObject({ eligible: "needs-input", nextAction: "answer-questions" });
    expect(r.userInputNeeded.map((q) => q.key)).toContain("ownerAuthorized");
  });
  it("contradictory answers are rejected", () => expect(assessEligibility({ ...yes, onlineOnly: true }).eligible).toBe("no"));
  it("unauthorised person must obtain owner consent", () => expect(assessEligibility({ ...yes, ownerAuthorized: false }).nextAction).toBe("obtain-authorization"));
  it("an existing profile routes to connect, not create", () => expect(assessEligibility({ ...yes, existingProfile: "yes" }).nextAction).toBe("connect-existing"));
});

describe("existing-profile discovery and duplicate prevention", () => {
  const biz = { name: "Acme Roofing Pty", phone: "+1 555 010 1234", website: "https://www.acme-roofing.example", address: "12 Main Street Springfield" };
  it("matches by name, phone, website and address", () => {
    const m = findDuplicates(biz, [{ name: "Acme Roofing", phone: "(555) 010-1234", website: "acme-roofing.example" }, { name: "Totally Different Plumbing", phone: "555 999 0000" }]);
    expect(m).toHaveLength(1);
    expect(m[0].level).toBe("exact");
  });
  it("name similarity ignores legal suffixes and case", () => expect(nameSimilarity("Acme Roofing LLC", "ACME ROOFING")).toBe(1));
  it("creation is blocked until a search is recorded", () => {
    const g = discoveryGate(biz, null);
    expect(g.canCreate).toBe(false);
    expect(g.userInputNeeded[0]).toMatch(/Search for existing/);
  });
  it("a likely duplicate blocks creation until resolved with a reason and a name", () => {
    const cand = { name: "Acme Roofing", phone: "555 010 1234", ownership: "unclaimed" };
    const d = { searched: { at: "2026-10-10", method: "manual", by: "Ann" }, candidates: [cand], resolutions: {} };
    expect(discoveryGate(biz, d).canCreate).toBe(false);
    d.resolutions[candidateKey(cand, 0)] = { resolution: "different-business", reason: "", by: "Ann" };
    expect(discoveryGate(biz, d).canCreate).toBe(false); // no reason
    d.resolutions[candidateKey(cand, 0)] = { resolution: "different-business", reason: "Same name, other town; owner confirmed.", by: "Ann" };
    expect(discoveryGate(biz, d).canCreate).toBe(true);
    d.resolutions[candidateKey(cand, 0)] = { resolution: "claim", reason: "It is ours", by: "Ann" };
    expect(discoveryGate(biz, d).canCreate).toBe(false); // continue with that profile
  });
  it("search with no matches opens the gate", () => expect(discoveryGate(biz, { searched: { at: "x", method: "m", by: "b" }, candidates: [] }).canCreate).toBe(true));
  it("claim guidance depends on ownership and never suggests a second profile", () => {
    expect(claimGuidance({ candidate: { ownership: "claimed-by-other" } }).steps.join(" ")).toMatch(/Never create a second profile/);
    expect(claimGuidance({ candidate: { ownership: "owned-by-you" } }).action).toBe("connect-existing");
  });
});

describe("profile validation", () => {
  it("rejects keyword-stuffed or altered names", () => {
    expect(validateName("Best Cheap Roofing Near Me 24/7").some((i) => i.level === "error")).toBe(true);
    expect(validateName("Acme Roofing Springfield", { officialName: "Acme Roofing" }).some((i) => i.level === "error")).toBe(true);
    expect(validateName("Acme Roofing", { officialName: "Acme Roofing" })).toEqual([]);
  });
  it("description limits and content rules", () => {
    expect(validateDescription("x".repeat(751)).some((i) => /750/.test(i.message))).toBe(true);
    expect(validateDescription("Visit https://acme.example for the best roofing guaranteed. ".repeat(3)).filter((i) => i.level === "error").length).toBeGreaterThan(1);
    expect(validateDescription("Acme Roofing repairs and replaces residential roofs for homeowners across the Springfield area, with inspections and written estimates before work begins.")).toEqual([]);
  });
  it("detects keyword stuffing", () => expect(validateDescription(("roofing repair roofing service roofing quote roofing help ".repeat(6))).some((i) => /stuffing/.test(i.message))).toBe(true));
  it("generated description uses only verified facts and flags what is missing", () => {
    const g = generateDescription({ name: "Acme Roofing", businessType: "residential roofing contractor", services: [{ name: "roof repair" }, { name: "roof replacement" }], serviceAreas: ["Springfield"], classification: "service-area", hideAddress: true });
    expect(g.text).toContain("residential roofing contractor");
    expect(g.text).toContain("roof repair and roof replacement");
    expect(validateDescription(g.text).filter((i) => i.level === "error")).toEqual([]);
    expect(generateDescription({ name: "Acme" }).missing).toContain("Verified services");
    expect(generateDescription({}).text).toBe("");
  });
  it("hours: valid, malformed and reversed", () => {
    expect(validateHours({ mon: [{ open: "09:00", close: "17:00" }] })).toEqual([]);
    expect(validateHours({ mon: [{ open: "17:00", close: "09:00" }] })[0].level).toBe("error");
    expect(validateHours({ xyz: [] })[0].level).toBe("error");
    expect(validateHours(null)[0].level).toBe("error");
  });
  it("categories need a primary and are checked against a supplied Google list", () => {
    expect(validateCategories({}).some((i) => i.level === "error")).toBe(true);
    const list = [{ name: "Roofing contractor" }];
    expect(validateCategories({ primary: "Roofing contractor" }, list)).toEqual([]);
    expect(validateCategories({ primary: "Best roofer" }, list).some((i) => i.level === "error")).toBe(true);
  });
  it("category suggestions never invent a list", () => {
    expect(suggestCategories({ industry: "roofing" }, []).suggestions).toEqual([]);
    const s = suggestCategories({ industry: "roofing contractor", services: [{ name: "roof repair" }] }, [{ name: "Roofing contractor" }, { name: "Plumber" }]);
    expect(s.suggestions[0].name).toBe("Roofing contractor");
  });
  it("service-area profile must hide its address and keep a real one", () => {
    expect(validateAddress(null, { classification: "service-area", hideAddress: true }).length).toBe(1);
    const a = { street: "1 Test Lane", city: "Springfield", region: "ST", postalCode: "00000", country: "US" };
    expect(validateAddress(a, { classification: "service-area", hideAddress: false }).some((i) => /hidden/.test(i.message))).toBe(true);
    expect(validateAddress(a, { classification: "service-area", hideAddress: true })).toEqual([]);
    expect(validateAddress({ ...a, street: "PO Box 12" }, { classification: "storefront" }).some((i) => /PO box/.test(i.message))).toBe(true);
  });
  it("phone and website", () => { expect(validatePhone("12")).toHaveLength(1); expect(validateWebsite("not a url")[0].level).toBe("error"); expect(validateWebsite("http://a.example")[0].level).toBe("warning"); });
  it("images: format, size, dimensions, fabricated imagery", () => {
    expect(checkImage({ kind: "logo", format: "png", width: 720, height: 720, bytes: 50000 }).ok).toBe(true);
    expect(checkImage({ kind: "logo", format: "gif", width: 100, height: 100, bytes: 50000 }).ok).toBe(false);
    expect(checkImage({ kind: "photo", format: "jpg", width: 800, height: 600, bytes: 50000, generated: true }).ok).toBe(false);
    expect(checkImage({ kind: "cover", format: "jpg", width: 1080, height: 608, bytes: 90000 }).ok).toBe(true);
  });
  it("reads only verified, public facts from business-profile.json", () => {
    const bp = { identity: { businessName: { value: "Acme", status: "verified" }, website: { value: "https://acme.example", status: "verified" } }, contact: { phone: { value: "555 010 1234", status: "unverified" } }, markets: {}, offerings: { services: [{ id: "a", name: "Repair", status: "verified" }, { id: "b", name: "Secret", status: "verified", public: false }, { id: "c", name: "Maybe", status: "unverified" }] } };
    const { values, missing } = profileFromBusinessProfile(bp);
    expect(values.phone).toBeNull();
    expect(values.services.map((s) => s.name)).toEqual(["Repair"]);
    expect(missing.join(" ")).toMatch(/phone/);
  });
  it("completeness never counts what it cannot see", () => {
    const c = completeness({ name: "A", classification: "storefront" });
    expect(c.items.find((i) => i.id === "posts").status).toBe("unknown");
    expect(c.coverage).toBeLessThan(100);
    expect(c.note).toMatch(/not a Google ranking factor/);
  });
});

describe("LocalBusiness structured data and website consistency", () => {
  const addr = { street: "1 Test Lane", city: "Springfield", region: "ST", postalCode: "00000", country: "US" };
  const vals = { name: "Acme Roofing", website: "https://acme.example", phone: "+1 555 010 1234", businessType: "roofing contractor", address: addr, hideAddress: false, serviceAreas: ["Springfield"], hours: { mon: [{ open: "09:00", close: "17:00" }] } };
  it("uses the most specific subtype and verified facts", () => {
    const { node } = buildLocalBusinessSchema(vals);
    expect(node["@type"]).toBe("RoofingContractor");
    expect(node.address.streetAddress).toBe("1 Test Lane");
    expect(node.openingHoursSpecification[0].dayOfWeek).toBe("Monday");
    expect(chooseSubtype("something unusual")).toBe("LocalBusiness");
  });
  it("never publishes a hidden service-area street address", () => {
    const { node, json } = buildLocalBusinessSchema({ ...vals, hideAddress: true });
    expect(json).not.toContain("1 Test Lane");
    expect(node.address.addressLocality).toBe("Springfield");
  });
  it("never invents ratings", () => expect(buildLocalBusinessSchema(vals).json).not.toContain("aggregateRating"));
  const page = (ld, body = "") => `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>Acme Roofing</h1>${body}</body></html>`;
  it("extracts site facts", () => {
    const f = extractSiteFacts(page({ "@type": "Roofer" }) + '<a href="tel:+15550101234">call</a>', "https://acme.example/");
    expect(f.phones).toEqual(["+15550101234"]);
  });
  it("finds contradictory and duplicate structured data and phone mismatches", () => {
    const html = page([{ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Acme Roofing", telephone: "555 010 1234" }, { "@type": "RoofingContractor", name: "Acme Roof Co", telephone: "555 010 9999" }]);
    const ids = auditConsistency(vals, [{ html, url: "https://acme.example/" }]).findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["schema-contradictory-names", "schema-contradictory-phones", "schema-duplicate-nodes"]));
  });
  it("flags a hidden address that the website publishes", () => {
    const html = page({ "@type": "LocalBusiness", name: "Acme Roofing", telephone: "555 010 1234" }, "<p>Visit 1 Test Lane today</p>");
    const ids = auditConsistency({ ...vals, hideAddress: true }, [{ html, url: "u" }]).findings.map((f) => f.id);
    expect(ids).toContain("hidden-address-public");
  });
  it("reports invalid JSON-LD and missing pages", () => {
    expect(auditConsistency(vals, [{ html: '<script type="application/ld+json">{bad</script>', url: "u" }]).findings.map((f) => f.id)).toContain("schema-invalid-json");
    expect(auditConsistency(vals, []).pagesChecked).toBe(0);
  });
});

describe("state, approval and the creation gate", () => {
  const values = { name: "Acme", phone: "555 010 1234", website: "https://acme.example", classification: "storefront", hideAddress: false, description: "x" };
  const ok = { valid: true, errors: [], warnings: [] };
  const ready = () => { const s = newState(); setEligibility(s, yes, "Ann"); recordSearch(s, { method: "manual", by: "Ann", candidates: [] }); return s; };
  it("blocks until eligibility, discovery, validation and a named approval all exist", () => {
    const s = newState();
    expect(creationGate(s, { values, validation: ok }).canCreate).toBe(false);
    const r = ready();
    expect(creationGate(r, { values, validation: ok }).blockers.join(" ")).toMatch(/approval/);
    approve(r, { kind: "create-profile", values, by: "Ann" });
    expect(creationGate(r, { values, validation: ok }).canCreate).toBe(true);
    expect(creationGate(r, { values, validation: { valid: false, errors: [{ message: "bad" }], warnings: [] } }).canCreate).toBe(false);
  });
  it("an approval needs an approver and is void once the values change", () => {
    const s = ready();
    expect(() => approve(s, { kind: "create-profile", values, by: "" })).toThrow(/administrator/);
    approve(s, { kind: "create-profile", values, by: "Ann" });
    expect(latestApproval(s, "create-profile", values)).toBeTruthy();
    expect(latestApproval(s, "create-profile", { ...values, name: "Acme Roofing Springfield" })).toBeNull();
  });
  it("ineligible businesses can never pass the gate", () => {
    const s = newState();
    setEligibility(s, { ...yes, servesInPerson: false, staffedLocation: false, onlineOnly: true }, "Ann");
    recordSearch(s, { method: "m", by: "Ann" });
    approve(s, { kind: "create-profile", values, by: "Ann" });
    expect(creationGate(s, { values, validation: ok }).canCreate).toBe(false);
  });
  it("reported creation and verification stay owner-reported, never 'verified by Google'", () => {
    const s = ready();
    reportCreation(s, { by: "Ann", profileUrl: null });
    expect(() => reportCreation(s, { by: "Ann" })).toThrow(/already/);
    expect(verificationGuidance(s).userInputNeeded).toMatch(/owner/);
    setVerification(s, { status: "pending-owner-action", method: "postcard", by: "Ann", note: "enter the code" });
    expect(verificationGuidance(s).userInputNeeded).toMatch(/postcard/);
    expect(verificationGuidance(s).disclaimer).toMatch(/No method or outcome is guaranteed/);
    expect(() => setVerification(s, { status: "verified", by: "Ann" })).toThrow(/Unknown verification status/);
    setVerification(s, { status: "owner-reported-verified", by: "Ann" });
    expect(s.verification.source).toBe("manual");
    expect(verificationGuidance(s).status).toBe("owner-reported-verified");
  });
  it("picks one clear primary action per state", () => {
    expect(nextPrimaryAction(newState()).label).toBe("Check Eligibility");
    const s = newState(); setEligibility(s, { ...yes, onlineOnly: true }, "A");
    expect(nextPrimaryAction(s).label).toBe("Website SEO Alternatives");
    const e = newState(); setEligibility(e, yes, "A");
    expect(nextPrimaryAction(e).label).toBe("Connect Existing Profile");
  });
  it("manual mode is the default and API-dependent metrics are listed as unavailable", () => {
    const sum = summarize(newState());
    expect(sum.mode).toBe("manual");
    expect(sum.unavailable.join(" ")).toMatch(/API access/);
  });
  it("tolerates unreadable state files", () => expect(loadState("garbage").v).toBe(1));
});

describe("command line, tenant isolation, no network", () => {
  const site = (name, areas = ["Springfield"]) => {
    const dir = mkdtempSync(join(tmpdir(), "gbp-"));
    mkdirSync(join(dir, "seo"));
    writeFileSync(join(dir, "seo", "business-profile.json"), JSON.stringify({
      identity: { businessName: { value: name, status: "verified" }, website: { value: `https://${name.toLowerCase().replace(/ /g, "")}.example`, status: "verified" }, businessType: { value: "roofing contractor", status: "verified" } },
      contact: { phone: { value: "555 010 1234", status: "verified" } }, markets: { serviceAreas: { value: areas, status: "verified" } },
      offerings: { services: [{ id: "r", name: "roof repair", status: "verified" }] },
    }));
    return dir;
  };
  it("runs the whole manual flow and refuses to skip a gate", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = site("Acme Roofing");
    writeFileSync(join(dir, "answers.json"), JSON.stringify(sab));
    expect(main(["eligibility", "--answers", join(dir, "answers.json"), "--by", "Ann"], dir)).toBe(0);
    expect(main(["created", "--by", "Ann"], dir)).toBe(1); // gate closed
    expect(main(["discover", "--method", "Google Search", "--by", "Ann"], dir)).toBe(0);
    expect(main(["draft", "--init"], dir)).toBe(0);
    const draftPath = join(dir, "seo", "data", "local-gbp", "draft.json");
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    expect(draft.description).toContain("roofing contractor");
    expect(main(["approve", "--by", "Ann"], dir)).toBe(1); // invalid: no categories/hours/address
    writeFileSync(draftPath, JSON.stringify({ ...draft, categories: { primary: "Roofing contractor", secondary: [] }, hours: { mon: [{ open: "08:00", close: "16:00" }] }, address: { street: "1 Test Lane", city: "Springfield", region: "ST", postalCode: "00000", country: "US" } }));
    expect(context(dir).validation.errors.map((e) => e.message)).toEqual([]);
    expect(main(["created", "--by", "Ann"], dir)).toBe(1); // not approved yet
    expect(main(["approve", "--by", "Ann"], dir)).toBe(0);
    expect(main(["created", "--by", "Ann"], dir)).toBe(0);
    expect(main(["verification", "--status", "pending-owner-action", "--method", "postcard", "--by", "Ann"], dir)).toBe(0);
    expect(main(["schema"], dir)).toBe(0);
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("USER INPUT NEEDED");
    expect(out).not.toContain("1 Test Lane"); // hidden address never reaches the structured data
    expect(fetchSpy).not.toHaveBeenCalled();
    // editing after approval voids it
    writeFileSync(draftPath, JSON.stringify({ ...JSON.parse(readFileSync(draftPath, "utf8")), description: "A changed description of the roofing business that is long enough to pass the minimum length check easily." }));
    expect(context(dir).state.approvals).toHaveLength(1);
    expect(creationGate(context(dir).state, context(dir)).blockers.join(" ")).toMatch(/approval/);
    log.mockRestore(); err.mockRestore(); fetchSpy.mockRestore();
  });
  it("keeps two clients completely separate", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const a = site("Acme Roofing"), b = site("Beta Plumbing");
    writeFileSync(join(a, "answers.json"), JSON.stringify(yes));
    main(["eligibility", "--answers", join(a, "answers.json"), "--by", "Ann"], a);
    expect(existsSync(join(b, "seo", "data", "local-gbp", "state.json"))).toBe(false);
    expect(context(b).state.eligibility).toBeNull();
    expect(context(a).values.name).toBe("Acme Roofing");
    expect(context(b).values.name).toBe("Beta Plumbing");
    vi.restoreAllMocks();
  });
  it("rejects unknown commands and missing names", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["nope"])).toBe(3);
    expect(main(["constructor"])).toBe(3);
    vi.restoreAllMocks();
  });
});
