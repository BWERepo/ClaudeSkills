import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, loadState, statePath } from "./seo-landing.mjs";
import { contentHash, approvalState, canTransition, approve, publishPayload } from "./landing-quality.mjs";
import { reconcileOpportunities } from "./landing-opportunities.mjs";

const body = "We design every site by hand for local owners who want clear pricing and a simple process. ".repeat(40) + "Plans start at $499.";
const page = (extra = {}) => ({ title: "Custom Websites | Example", description: "Custom websites for small businesses with fixed prices and a free prototype you can review first.", h1: "Custom websites", body, headings: ["a", "b", "c"], images: [{ src: "/a.png", alt: "desk" }], links: ["/a", "/b"], canonical: "https://www.example.test/custom-websites", structuredData: { "@type": "Service", name: "Custom websites" }, ...extra });

describe("approval covers the whole publish payload", () => {
  const draft = { ...page(), path: "/custom-websites", status: "draft" };
  const approved = approve(draft, "Dana");
  it("is valid for the approved content", () => { expect(approvalState(approved)).toBe("valid"); expect(canTransition(approved, "published").ok).toBe(true); });
  it.each([
    ["canonical", { canonical: "https://www.example.test/other" }],
    ["path", { path: "/elsewhere" }],
    ["structured data", { structuredData: { "@type": "Service", name: "Other" } }],
    ["links", { links: ["/a", "/c"] }],
    ["images", { images: [{ src: "/b.png", alt: "desk" }] }],
    ["image alt", { images: [{ src: "/a.png", alt: "chair" }] }],
    ["indexability", { indexable: false }],
    ["title", { title: "Other | Example" }],
    ["faq", { faq: [{ q: "x", a: "y" }] }],
    ["body", { body: body + " More." }],
  ])("a change to %s voids the approval", (_n, change) => {
    const t = canTransition({ ...approved, ...change }, "published");
    expect(t.ok).toBe(false);
    expect(t.reason).toMatch(/changed after approval/);
  });
  it("ignores private notes, check results and link order", () => {
    expect(canTransition({ ...approved, notes: "private", reviewer: "x", checks: { ok: true }, links: ["/b", "/a"] }, "published").ok).toBe(true);
  });
  it("is deterministic regardless of key order", () => {
    expect(contentHash({ ...draft, structuredData: { b: 1, a: { d: 1, c: 2 } } })).toBe(contentHash({ ...draft, structuredData: { a: { c: 2, d: 1 }, b: 1 } }));
  });
  it("never trusts a legacy (unversioned) approval hash", () => {
    const legacy = { ...draft, status: "approved", approval: { by: "Dana", on: "2026-10-01", contentHash: "a".repeat(64) } };
    expect(approvalState(legacy)).toBe("legacy");
    expect(canTransition(legacy, "published")).toMatchObject({ ok: false, reason: expect.stringMatching(/before approvals covered the full publish content/) });
  });
  it("exposes the payload fields", () => { expect(Object.keys(publishPayload(draft))).toEqual(expect.arrayContaining(["path", "canonical", "structuredData", "links", "images", "indexable"])); });
});

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "landing-"));
  mkdirSync(join(cwd, "seo"), { recursive: true });
  const w = (f, v) => writeFileSync(join(cwd, f), typeof v === "string" ? v : JSON.stringify(v));
  w("pages.json", { pages: [{ path: "/", title: "Home", h1: "Home", h2: [], description: "" }] });
  w("p.json", page());
  const lines = []; const run = (...a) => main(a, { cwd, out: (x) => lines.push(x), today: "2026-10-23" });
  return { cwd, w, run, lines, state: () => loadState(cwd) };
}

describe("CLI approval flow", () => {
  it("check -> approve -> move works, and an edit after approval needs a fresh check and approval", async () => {
    const t = setup();
    await t.run("add", "custom websites"); await t.run("plan", "--pages", "pages.json");
    const id = t.state().opportunities[0].id;
    expect(await t.run("check", id, "--page", "p.json", "--prices", "$499")).toBe(0);
    expect(await t.run("move", id, "--to", "draft")).toBe(0);
    expect(await t.run("approve", id, "--by", "Dana")).toBe(0);
    t.w("p.json", page({ canonical: "https://www.example.test/changed" }));
    expect(await t.run("move", id, "--to", "published", "--by", "Dana")).toBe(0); // the stored draft is still the approved one
    // re-checking changed content voids the approval and demotes it
    const t2 = setup();
    await t2.run("add", "custom websites"); await t2.run("plan", "--pages", "pages.json");
    await t2.run("check", id, "--page", "p.json", "--prices", "$499"); await t2.run("move", id, "--to", "draft"); await t2.run("approve", id, "--by", "Dana");
    t2.w("p.json", page({ canonical: "https://www.example.test/changed" }));
    await t2.run("check", id, "--page", "p.json", "--prices", "$499");
    expect(t2.state().opportunities[0].approval).toBeUndefined();
    expect(t2.state().opportunities[0].status).toBe("draft");
    expect(await t2.run("move", id, "--to", "published")).toBe(1);
  });
  it("refuses approval when the draft changed since the check, and refuses publishing a hand-edited draft", async () => {
    const t = setup();
    await t.run("add", "custom websites"); await t.run("plan", "--pages", "pages.json");
    const id = t.state().opportunities[0].id;
    await t.run("check", id, "--page", "p.json", "--prices", "$499"); await t.run("move", id, "--to", "draft");
    const s = t.state(); s.opportunities[0].draft.canonical = "https://www.example.test/x"; writeFileSync(statePath(t.cwd), JSON.stringify(s));
    expect(await t.run("approve", id, "--by", "Dana")).toBe(1);
    expect(t.lines.join("\n")).toMatch(/changed since the last quality check/);
  });
  it("shows a legacy approval as needing re-approval and refuses to publish it", async () => {
    const t = setup();
    await t.run("add", "custom websites"); await t.run("plan", "--pages", "pages.json");
    const id = t.state().opportunities[0].id;
    await t.run("check", id, "--page", "p.json", "--prices", "$499");
    const s = t.state(); Object.assign(s.opportunities[0], { status: "approved", approval: { by: "Dana", on: "2026-10-01", contentHash: "b".repeat(64) } }); writeFileSync(statePath(t.cwd), JSON.stringify(s));
    expect(await t.run("move", id, "--to", "published")).toBe(1);
    t.lines.length = 0; await t.run("status");
    expect(t.lines.join("\n")).toMatch(/approval legacy - approve again/);
  });
});

describe("replanning keeps work", () => {
  const draftState = async () => {
    const t = setup();
    await t.run("add", "custom websites"); await t.run("plan", "--pages", "pages.json");
    const id = t.state().opportunities[0].id;
    await t.run("check", id, "--page", "p.json", "--prices", "$499"); await t.run("move", id, "--to", "draft"); await t.run("approve", id, "--by", "Dana");
    return { t, id };
  };
  it("repeated planning is idempotent and keeps draft, checks and approval", async () => {
    const { t, id } = await draftState();
    const before = t.state().opportunities[0];
    await t.run("plan", "--pages", "pages.json"); await t.run("plan", "--pages", "pages.json");
    const after = t.state().opportunities;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id, status: "approved", approval: before.approval, checks: before.checks, draft: before.draft });
    expect(after[0].history).toBeUndefined();
  });
  it("keeps work when a new keyword changes the primary phrase of the same group", async () => {
    const { t, id } = await draftState();
    await t.run("add", "custom website design");
    await t.run("plan", "--pages", "pages.json");
    const o = t.state().opportunities.find((x) => x.id === id);
    expect(o?.draft).toBeTruthy();
  });
  it("voids checks and approval when the target changes, and says so", async () => {
    const { t, id } = await draftState();
    t.w("pages.json", { pages: [{ path: "/custom-websites-page", title: "Custom websites", h1: "Custom websites", h2: [], description: "" }] });
    t.lines.length = 0;
    await t.run("plan", "--pages", "pages.json");
    const o = t.state().opportunities.find((x) => x.id === id);
    expect(o.action).toBe("improve-existing");
    expect(o.approval).toBeUndefined(); expect(o.checks).toBeUndefined();
    expect(o.status).toBe("draft"); expect(o.draft).toBeTruthy();
    expect(o.history.at(-1)).toMatchObject({ event: "target-changed", invalidated: ["checks", "approval"] });
    expect(t.lines.join("\n")).toMatch(/checks and approval voided/);
  });
  it("retires unmatched work recoverably, then restores it", async () => {
    const { t, id } = await draftState();
    const s = t.state(); s.keywords = []; writeFileSync(statePath(t.cwd), JSON.stringify(s));
    await t.run("plan", "--pages", "pages.json");
    expect(t.state().opportunities).toHaveLength(0);
    expect(t.state().retired[0]).toMatchObject({ id, retiredReason: expect.any(String) });
    await t.run("add", "custom websites"); await t.run("plan", "--pages", "pages.json");
    const st = t.state();
    expect(st.opportunities[0]).toMatchObject({ id, status: "approved" });
    expect(st.opportunities[0].history[0].event).toBe("restored");
    expect(st.retired).toEqual([]);
  });
  it("drops unmatched opportunities that have no work", async () => {
    const t = setup();
    await t.run("add", "custom websites"); await t.run("plan", "--pages", "pages.json");
    const s = t.state(); s.keywords = []; writeFileSync(statePath(t.cwd), JSON.stringify(s));
    await t.run("plan", "--pages", "pages.json");
    expect(t.state().retired).toBeUndefined();
  });
  it("does not rewrite a published opportunity when the plan changes; it offers the change", () => {
    const published = { id: "lp-x", primary: "custom websites", secondary: [], intent: "service", action: "new-page", target: "/custom-websites", status: "published", draft: { path: "/custom-websites" }, approval: { by: "D" } };
    const planned = [{ id: "lp-x", primary: "custom websites", secondary: [], intent: "service", action: "improve-existing", target: "/home", status: "proposed" }];
    const r = reconcileOpportunities(planned, [published], [], { today: "2026-10-23" });
    expect(r.opportunities[0]).toMatchObject({ status: "published", target: "/custom-websites", pendingChange: { target: "/home" } });
    expect(r.opportunities[0].approval).toEqual({ by: "D" });
  });
});
