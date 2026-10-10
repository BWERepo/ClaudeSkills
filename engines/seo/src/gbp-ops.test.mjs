// Tests for the GBP improvement queue, review drafting, post drafting and manual performance import. Fictional data only.
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Q from "./gbp-queue.mjs";
import * as R from "./gbp-reviews.mjs";
import * as P from "./gbp-posts.mjs";
import * as F from "./gbp-performance.mjs";
import { completeness } from "./gbp-profile.mjs";
import { auditConsistency } from "./gbp-schema.mjs";
import { main } from "./seo-local-gbp.mjs";
import { validateInventory } from "./validate-seo-data.mjs";
const checkIssues_forTest = (issues) => validateInventory({ issues }).errors.filter((e) => /issues\[/.test(e));

const rec = (o = {}) => Q.makeRec({ type: "add-hours", target: "hours", reason: "Hours missing", benefit: "Customers see when you are open", ...o }, "2026-10-10");

describe("recommendation queue", () => {
  it("every recommendation carries current, proposed, reason, evidence, benefit, confidence and approval status", () => {
    const r = rec({ current: null, proposed: { mon: [] }, evidence: ["x"], confidence: "high" });
    expect(r).toMatchObject({ state: "new", confidence: "high", approval: { required: true, by: null } });
    expect(r).toHaveProperty("current"); expect(r.benefitNote).toMatch(/ranking weight/);
    expect(() => Q.makeRec({ type: "nope", reason: "r", benefit: "b" })).toThrow(/Unknown/);
    expect(() => Q.makeRec({ type: "add-hours" })).toThrow(/reason/);
  });
  it("does not duplicate and does not resurrect rejected items", () => {
    const a = rec();
    let q = Q.mergeRecs([], [a]).queue;
    expect(Q.mergeRecs(q, [rec()]).added).toEqual([]);
    Q.transition(q[0], "rejected", { note: "owner declined" });
    const again = Q.mergeRecs(q, [rec()]);
    expect(again.added).toEqual([]);
    expect(again.skipped[0].because).toMatch(/rejected/);
  });
  it("enforces the workflow, approver and completion evidence", () => {
    const r = rec();
    expect(() => Q.transition(r, "completed", {})).toThrow(/Cannot move/);
    Q.transition(r, "review");
    expect(() => Q.transition(r, "approved", {})).toThrow(/administrator/);
    Q.transition(r, "approved", { by: "Ann" });
    Q.transition(r, "implementing"); Q.transition(r, "verification");
    expect(() => Q.transition(r, "completed", { by: "Ann" })).toThrow(/evidence/);
    Q.transition(r, "completed", { by: "Ann", evidence: "Hours show on the profile", at: "2026-10-12" });
    expect(r.verification.source).toBe("owner-reported");
    expect(Q.canMove("completed", "review")).toBe(false);
  });
  it("failed and deferred items can come back to review", () => { const r = rec(); Q.transition(r, "review"); Q.transition(r, "deferred"); expect(Q.canMove(r.state, "review")).toBe(true); });
  it("generates recommendations from checks, audit findings and unanswered reviews", () => {
    const values = { name: "A", classification: "storefront" };
    const recs = Q.recommend({ values, completeness: completeness(values), auditFindings: [{ id: "phone-mismatch", severity: "high", message: "Phone differs", evidence: ["1"] }, { id: "x", severity: "low", message: "meh" }], reviews: [{ id: "r1", rating: 1, date: "2026-10-01", reply: null }, { id: "r2", rating: 5, date: "2026-10-01", reply: { text: "ok" } }] }, "2026-10-10");
    const types = recs.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(["add-hours", "fix-phone", "respond-review", "set-categories"]));
    expect(recs.filter((r) => r.type === "respond-review")).toHaveLength(1);
    expect(recs.every((r) => r.approval.required)).toBe(true);
  });
  it("maps into the existing improvement queue without touching other issues and stays valid for the validator", () => {
    const r = rec(); Q.transition(r, "review"); Q.transition(r, "approved", { by: "Ann" });
    const inv = { issues: [{ id: "other", title: "t", severity: "low", area: "content", status: "open" }] };
    const s = Q.syncToInventory(inv, [r], "2026-10-10");
    expect(s.inventory.issues[0]).toEqual(inv.issues[0]);
    expect(s.inventory.issues[1]).toMatchObject({ area: "local", status: "approved", needsApproval: true });
    Q.transition(r, "implementing"); Q.transition(r, "verification"); Q.transition(r, "completed", { by: "Ann", evidence: "seen", at: "2026-10-12" });
    const s2 = Q.syncToInventory(s.inventory, [r], "2026-10-12");
    expect(s2.updated).toBe(1);
    expect(s2.inventory.issues[1]).toMatchObject({ status: "verified", verifiedOn: "2026-10-12" });
    expect(checkIssues_forTest(s2.inventory.issues)).toEqual([]);
    expect(Q.syncToInventory(s2.inventory, [r]).updated).toBe(0);
  });
});

describe("reviews", () => {
  const rows = [{ id: "a", rating: 5, text: "Great roof repair", date: "2026-10-01", reviewer: "Pat Doe" }, { id: "b", rating: 1, text: "Late and rude. Call me on 555 010 9999", date: "2026-09-01", reviewer: "Sam" }, { id: "c", rating: 4, text: "Good", date: "2026-10-05", reply: "Thanks" }, { id: "bad", rating: 9, date: "x" }];
  it("imports, validates and dedupes", () => {
    const r = R.importReviews(rows, [], { by: "Ann" });
    expect(r.added).toBe(3); expect(r.errors).toHaveLength(1);
    expect(R.importReviews(rows, r.reviews, { by: "Ann" }).added).toBe(0);
    expect(() => R.importReviews(rows, [], {})).toThrow(/Name who/);
    expect(r.reviews[0].source).toBe("manual-import");
  });
  it("prioritises low, old, unanswered reviews and summarises", () => {
    const { reviews } = R.importReviews(rows, [], { by: "Ann" });
    const p = R.prioritize(reviews, "2026-10-10");
    expect(p[0].review.id).toBe("b"); expect(p[0].priority).toBe("high"); expect(p).toHaveLength(2);
    expect(R.summary(reviews)).toMatchObject({ total: 3, unanswered: 2 });
    expect(R.filterReviews(reviews, { maxRating: 2 })).toHaveLength(1);
  });
  it("drafts replies that are varied, private and promise-free", () => {
    const { reviews } = R.importReviews(rows, [], { by: "Ann" });
    const bad = R.draftReply(reviews[1], { businessName: "Acme", contactOffline: "info@acme.example" });
    expect(bad.text).not.toContain("555"); expect(bad.text).not.toMatch(/refund|guarantee/i); expect(bad.text).toContain("info@acme.example");
    expect(R.draftReply(reviews[1], { businessName: "Acme" }).text).not.toContain("@");
    const good = R.draftReply(reviews[0], { businessName: "Acme" });
    expect(good.text).toMatch(/^Hi Pat/); expect(good.text).not.toContain("Doe");
    const o = new Set(["a", "b", "c", "d", "e", "f"].map((id) => R.draftReply({ id, rating: 5, text: "x" }, { businessName: "A" }).opener));
    expect(o.size).toBeGreaterThan(1);
    expect(R.checkReply("We will give you a full refund and a guarantee")).toHaveLength(1);
  });
  it("requires named approval before a reply counts, and records posting as owner-reported", () => {
    const { reviews } = R.importReviews(rows, [], { by: "Ann" });
    const r = reviews[0]; r.draft = R.draftReply(r, { businessName: "Acme" });
    expect(() => R.markReplyPosted(r, { by: "Ann" })).toThrow(/approved/);
    expect(() => R.approveReply(r, {})).toThrow(/administrator/);
    expect(() => R.approveReply(r, { by: "Ann", text: "We guarantee a refund" })).toThrow(/problems/);
    R.approveReply(r, { by: "Ann" }); R.markReplyPosted(r, { by: "Ann" });
    expect(r.reply.source).toBe("owner-reported");
  });
  it("review requests are compliant: no rewards, no gating, no rating requests", () => {
    for (const ch of ["email", "text", "website"]) expect(R.reviewRequestTemplate({ businessName: "Acme", channel: ch }).checks).toEqual([]);
    expect(R.checkReviewRequest("Leave a 5-star review and get a discount")).toHaveLength(2);
    expect(R.checkReviewRequest("If you were happy, please review us")).toHaveLength(1);
    expect(R.checkReviewRequest("Unhappy? Contact us first instead")).toHaveLength(1);
  });
});

describe("posts", () => {
  it("validates by type", () => {
    expect(P.validatePost({ type: "offer", text: "x".repeat(60) }, {}).errors.length).toBeGreaterThanOrEqual(2);
    expect(P.validatePost({ type: "offer", title: "T", start: "2026-10-01", end: "2026-10-05", text: "x".repeat(60) }, { today: "2026-10-10" }).errors[0].message).toMatch(/ended/);
    expect(P.validatePost({ type: "update", text: "x".repeat(1501) }).valid).toBe(false);
    expect(P.validatePost({ type: "update", text: "Call us on 555 010 1234 for the best deal ever offered locally." }).errors).toHaveLength(1);
    expect(P.validatePost({ type: "event", title: "Open day", start: "2026-11-01", end: "2026-11-01", text: "Join us for an open day at the workshop with demonstrations." }).valid).toBe(true);
  });
  it("warns about repetitive posts", () => {
    const posts = [];
    P.addDraft(posts, { type: "update", text: "We repaired a slate roof this week and replaced the flashing." }, { by: "Ann" });
    const p2 = P.addDraft(posts, { type: "update", text: "We repaired a slate roof this week and replaced the flashing." }, { by: "Ann" });
    expect(p2.checks.some((c) => /similar/.test(c.message))).toBe(true);
  });
  it("suggests posts only from recent real pages", () => {
    const pages = [{ path: "/new", title: "New guide", publishedAt: "2026-10-01" }, { path: "/old", title: "Old", publishedAt: "2025-01-01" }];
    expect(P.suggestPosts(pages, [], { today: "2026-10-10" }).map((s) => s.sourcePath)).toEqual(["/new"]);
    expect(P.suggestPosts(pages, [{ sourcePath: "/new", state: "draft" }], { today: "2026-10-10" })).toEqual([]);
  });
  it("never auto-posts: approval, then an intended date, then owner-reported", () => {
    const posts = []; const p = P.addDraft(posts, { type: "update", text: "We repaired a slate roof this week and replaced the flashing." }, { by: "Ann" });
    expect(() => P.schedulePost(p, "2026-10-20")).toThrow(/approved/);
    expect(() => P.approvePost(p, {})).toThrow(/administrator/);
    P.approvePost(p, { by: "Ann" }, posts); P.schedulePost(p, "2026-10-20");
    expect(P.duePosts(posts, "2026-10-19")).toEqual([]); expect(P.duePosts(posts, "2026-10-20")).toHaveLength(1);
    p.text = "Edited after approval"; expect(() => P.schedulePost({ ...p, state: "approved" }, "2026-10-21")).toThrow(/unchanged/);
    p.text = p.approvedText; P.markPosted(p, { by: "Ann" });
    expect(p).toMatchObject({ state: "posted-reported", postedSource: "owner-reported" });
  });
});

describe("manual performance import", () => {
  it("imports long and wide CSV/JSON and rejects bad rows", () => {
    const r = F.importPerformance("date,calls,websiteClicks\n2026-10-08,3,10\n2026-10-09,,4\nbad,1,1", [], { by: "Ann" });
    expect(r.added).toBe(3); expect(r.errors).toHaveLength(1);
    expect(F.importPerformance([{ date: "2026-10-08", metric: "calls", value: 5 }], r.rows, { by: "Ann" }).replaced).toBe(1);
    expect(F.importPerformance([{ date: "2026-10-08", metric: "rankings", value: 1 }], [], { by: "Ann" }).errors[0]).toMatch(/unknown metric/);
    expect(F.importPerformance([{ date: "2026-10-08", metric: "calls", value: -1 }], [], { by: "Ann" }).errors).toHaveLength(1);
    expect(() => F.importPerformance([], [], {})).toThrow();
  });
  it("summarises windows with previous-period change and marks everything else unavailable", () => {
    const rows = [];
    for (let d = 1; d <= 14; d++) rows.push({ date: `2026-09-${String(d + 16).padStart(2, "0")}`, metric: "calls", value: 1 });
    for (let d = 1; d <= 7; d++) rows.push({ date: `2026-10-${String(d + 3).padStart(2, "0")}`, metric: "calls", value: 2 });
    const s = F.summarize(rows, "2026-10-10");
    expect(s.metrics.calls.windows[7]).toMatchObject({ available: true, total: 14, previous: 4 });
    expect(s.metrics.websiteClicks.available).toBe(false);
    expect(s.metrics.calls.windows[90].available).toBe(true);
    expect(s.source).toMatch(/Separate from Search Console/);
    expect(JSON.stringify(s)).not.toMatch(/ranking|impression/i);
  });
});

describe("CLI wiring", () => {
  it("runs recommend → queue → sync → reviews → posts → performance in an isolated project", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "gbpops-")); mkdirSync(join(dir, "seo"));
    writeFileSync(join(dir, "seo", "business-profile.json"), JSON.stringify({ identity: { businessName: { value: "Acme Roofing", status: "verified" } }, contact: {}, markets: {}, offerings: { services: [] } }));
    writeFileSync(join(dir, "seo", "content-inventory.json"), JSON.stringify({ pages: [{ id: "g", url: "/guide", title: "Roof guide", status: "published", addedOn: new Date().toISOString().slice(0, 10) }], issues: [] }));
    const rv = join(dir, "r.json"); writeFileSync(rv, JSON.stringify([{ id: "r1", rating: 2, text: "Slow", date: "2026-10-01", reviewer: "Lee K" }]));
    expect(main(["reviews", "--import", rv, "--by", "Ann"], dir)).toBe(0);
    expect(main(["reviews", "--draft", "r1"], dir)).toBe(0);
    expect(main(["reviews", "--approve", "r1"], dir)).toBe(1); // no name
    expect(main(["reviews", "--approve", "r1", "--by", "Ann"], dir)).toBe(0);
    expect(main(["recommend"], dir)).toBe(0);
    const q = JSON.parse(readFileSync(join(dir, "seo", "data", "local-gbp", "recommendations.json"), "utf8"));
    expect(q.some((r) => r.type === "respond-review")).toBe(true);
    const n = q.length; main(["recommend"], dir);
    expect(JSON.parse(readFileSync(join(dir, "seo", "data", "local-gbp", "recommendations.json"), "utf8"))).toHaveLength(n);
    expect(main(["queue", "--sync"], dir)).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "seo", "content-inventory.json"), "utf8")).issues.length).toBe(n);
    expect(main(["queue", "--move", q[0].id, "--to", "approved"], dir)).toBe(1); // must go via review
    expect(main(["posts", "--suggest"], dir)).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("/guide");
    const csv = join(dir, "p.csv"); writeFileSync(csv, "date,calls\n2026-10-09,4\n");
    expect(main(["performance", "--import", csv, "--by", "Ann"], dir)).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toMatch(/websiteClicks: unavailable/);
    vi.restoreAllMocks();
  });
});
