// Tests for the evidence contract, the unified improvement queue and its source adapters. Fictional data only; no network.
import { describe, expect, it } from "vitest";
import { makeEvidence, unavailableEvidence, metric, unavailableMetric, isAvailable, ageInDays, weakestConfidence } from "./evidence.mjs";
import { reconcile, decide, newQueue, migrateQueue, nextAction, rank, readModel, eligibility, itemId } from "./improvement-queue.mjs";
import { fromInventoryIssues, fromGbpRecommendations, fromKeywordAnalyses, fromLandingState, fromRegressionReport, fromRegressionStore } from "./improvement-sources.mjs";

const SITE = "https://shop.example";
const NOW = Date.parse("2026-10-23T12:00:00Z");
const day = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
const ob = (ref, extra = {}) => ({ category: "technical", ref, title: `Fix ${ref}`, severity: "medium", target: { kind: "page", ref }, ...extra });
const batch = (observations, extra = {}) => ({ module: "audit", check: "pages", status: "complete", observedAt: day(0), observations, ...extra });
const run = (q, batches, at = NOW) => reconcile(q, batches, { now: at, site: SITE });

describe("evidence contract", () => {
  it("grades freshness and confidence with labels, not numbers", () => {
    expect(makeEvidence({ source: "crawl", observedAt: day(-1), coverage: "complete", now: NOW }).confidence).toBe("high");
    expect(makeEvidence({ source: "crawl", observedAt: day(-1), coverage: "complete", basis: "reported", now: NOW }).confidence).toBe("medium");
    expect(makeEvidence({ source: "crawl", observedAt: day(-40), coverage: "complete", now: NOW })).toMatchObject({ freshness: "stale", confidence: "low" });
    expect(makeEvidence({ source: "crawl", observedAt: day(-1), coverage: "partial", now: NOW }).confidence).toBe("medium");
    expect(makeEvidence({ source: "crawl", coverage: "complete", now: NOW })).toMatchObject({ freshness: "unknown", confidence: "unknown" });
    expect(typeof makeEvidence({ source: "x", observedAt: day(0), coverage: "complete", now: NOW }).confidence).toBe("string");
  });
  it("keeps the reason data is unavailable and never turns it into a value", () => {
    const e = unavailableEvidence("search console", "export missing", NOW);
    expect(e).toMatchObject({ coverage: "none", confidence: "unknown", unavailable: "export missing" });
    expect(isAvailable(metric(0))).toBe(true);
    expect(metric(undefined)).toMatchObject({ available: false });
    expect(isAvailable(unavailableMetric("no data"))).toBe(false);
    expect(ageInDays("not a date", NOW)).toBeNull();
    expect(weakestConfidence(["high", "low", "medium"])).toBe("low");
    expect(weakestConfidence([])).toBe("unknown");
  });
});

describe("queue: identity and deduplication", () => {
  it("creates one stable item per finding and updates it on a repeat run", () => {
    let { queue } = run(newQueue(), [batch([ob("/a"), ob("/a"), ob("/b")])]);
    expect(queue.items).toHaveLength(2);
    const id = queue.items[0].id;
    expect(id).toBe(itemId({ category: "technical", module: "audit", check: "pages", ref: "/a" }));
    ({ queue } = run(queue, [batch([ob("/a"), ob("/b")], { observedAt: day(3) })], NOW + 3 * 86_400_000));
    expect(queue.items).toHaveLength(2);
    expect(queue.items.find((i) => i.id === id)).toMatchObject({ firstObservedOn: day(0), lastObservedOn: day(3) });
  });
  it("keeps the same finding from two modules separate but each deduplicated", () => {
    const { queue } = run(newQueue(), [batch([ob("/a")]), { ...batch([ob("/a")]), module: "other" }]);
    expect(queue.items).toHaveLength(2);
  });
});

describe("queue: human decisions, resolution and failed checks", () => {
  const first = () => run(newQueue(), [batch([ob("/a")])]).queue;
  it("preserves a person's decision and owner when the finding is seen again", () => {
    let q = first();
    const id = q.items[0].id;
    q = decide(q, id, { to: "approved", by: "Dana", note: "go", now: NOW });
    q = decide(q, id, { owner: "Sam", by: "Dana", now: NOW });
    q = run(q, [batch([ob("/a", { severity: "high" })], { observedAt: day(2) })], NOW + 2 * 86_400_000).queue;
    expect(q.items[0]).toMatchObject({ status: "approved", owner: "Sam", severity: "high" });
    expect(q.items[0].history.filter((h) => h.human).map((h) => h.by)).toEqual(["Dana", "Dana"]);
    q = decide(q, id, { to: "wont-fix", by: "Dana", now: NOW });
    q = run(q, [batch([ob("/a")])]).queue;
    expect(q.items[0].status).toBe("wont-fix");
  });
  it("requires a name and a legal transition for a decision", () => {
    const q = first();
    expect(() => decide(q, q.items[0].id, { to: "approved" })).toThrow(/name/);
    expect(() => decide(q, q.items[0].id, { to: "resolved", by: "Dana" })).toThrow(/not allowed/);
    expect(() => decide(q, "nope", { to: "approved", by: "Dana" })).toThrow(/no queue item/);
  });
  it("resolves an item only when a complete run covering it no longer reports it", () => {
    const q = first();
    const { queue, changes } = run(q, [batch([], { observedAt: day(5) })], NOW + 5 * 86_400_000);
    expect(queue.items[0]).toMatchObject({ status: "resolved" });
    expect(queue.items[0].verification.result.outcome).toMatch(/complete/);
    expect(changes.map((c) => c.event)).toContain("resolved");
  });
  it.each(["failed", "partial"])("does NOT resolve an item when the check was %s", (status) => {
    const { queue } = run(first(), [batch([], { status })]);
    expect(queue.items[0].status).toBe("open");
    expect(queue.items[0].check.status).not.toBe("complete");
    expect(queue.items[0].missingInformation.join()).toMatch(/did not confirm/);
    expect(queue.items[0].history.at(-1).event).toBe("unconfirmed");
  });
  it("does not resolve an item outside the coverage of a complete run", () => {
    const { queue } = run(first(), [batch([], { coveredRefs: ["/other"] })]);
    expect(queue.items[0].status).toBe("open");
  });
  it("reopens a resolved item that reappears and sends a failed fix back to open", () => {
    let q = run(first(), [batch([])]).queue;
    expect(q.items[0].status).toBe("resolved");
    q = run(q, [batch([ob("/a")])]).queue;
    expect(q.items[0].status).toBe("open");
    expect(q.items[0].history.some((h) => h.event === "reappeared")).toBe(true);
    q = decide(q, q.items[0].id, { to: "fixed", by: "Dana", now: NOW });
    q = run(q, [batch([ob("/a")])]).queue;
    expect(q.items[0].status).toBe("open");
    expect(q.items[0].history.at(-1).event).toBe("failed-verification");
  });
  it("never auto-resolves items from sources that keep their own workflow", () => {
    const inv = { issues: [{ id: "slow-pages", title: "Slow pages", severity: "high", area: "technical", status: "open" }] };
    let q = run(newQueue(), [fromInventoryIssues(inv, { observedAt: day(0), now: NOW })]).queue;
    q = run(q, [fromInventoryIssues({ issues: [] }, { observedAt: day(1), now: NOW })]).queue;
    expect(q.items[0].status).toBe("open");
  });
});

describe("queue: prioritization and the next action", () => {
  const mk = (list, extra = {}) => run(newQueue(), [batch(list, extra)]).queue;
  it("orders deterministically by documented factors and explains them", () => {
    const q = mk([ob("/low", { severity: "low" }), ob("/high", { severity: "high" }), ob("/blocker", { severity: "medium", blocking: true }), ob("/high2", { severity: "high", impact: "high" })]);
    const refs = rank(q, { now: NOW }).map((i) => i.source.ref);
    expect(refs).toEqual(["/blocker", "/high2", "/high", "/low"]);
    expect(rank({ items: [...q.items].reverse() }, { now: NOW }).map((i) => i.source.ref)).toEqual(refs);
    expect(readModel(q, { now: NOW }).items[0].priority.factors.join()).toMatch(/blocking: yes/);
  });
  it("leaves effort and impact unknown rather than inventing them", () => {
    const [i] = mk([ob("/a")]).items;
    expect(i.effort.level).toBe("unknown");
    expect(i.impact).toBe("unknown");
  });
  it("does not let page-level work bypass a site-wide blocker or an unresolved dependency", () => {
    let q = mk([ob("/blocker", { blocking: true, severity: "critical" }), ob("/kw", { category: "keyword", severity: "high" })]);
    const kw = q.items.find((i) => i.category === "keyword");
    expect(eligibility(kw, q, { now: NOW })).toMatchObject({ eligible: false });
    const n = nextAction(q, { now: NOW });
    expect(n.item.source.ref).toBe("/blocker");
    q = run(q, [batch([ob("/kw", { category: "keyword", severity: "high" })])]).queue; // blocker no longer reported by a complete run
    expect(q.items.find((i) => i.source.ref === "/blocker").status).toBe("resolved");
    expect(nextAction(q, { now: NOW }).item.source.ref).toBe("/kw");
    const dep = mk([ob("/x"), ob("/y")]);
    dep.items[1].dependencies = [dep.items[0].id];
    expect(eligibility(dep.items[1], dep, { now: NOW }).reason).toMatch(/waiting for/);
    dep.items[1].dependencies = ["q-missing"];
    expect(eligibility(dep.items[1], dep, { now: NOW }).reason).toMatch(/unknown/);
  });
  it("asks to re-check stale evidence before acting, and treats approval as a person's step", () => {
    const old = mk([ob("/a", { evidence: [makeEvidence({ source: "crawl", observedAt: day(-60), coverage: "complete", now: NOW })] })]);
    expect(nextAction(old, { now: NOW })).toMatchObject({ action: "recheck" });
    const fresh = mk([ob("/a", { evidence: [makeEvidence({ source: "crawl", observedAt: day(-1), coverage: "complete", now: NOW })] })]);
    expect(nextAction(fresh, { now: NOW })).toMatchObject({ action: "approve" });
    const free = mk([ob("/a", { needsApproval: false, evidence: [makeEvidence({ source: "crawl", observedAt: day(-1), coverage: "complete", now: NOW })] })]);
    expect(nextAction(free, { now: NOW }).action).toBe("work");
    expect(nextAction(run(free, [batch([ob("/a")], { status: "failed" })]).queue, { now: NOW }).action).toBe("recheck");
  });
  it("reports nothing to do and lists what is waiting", () => {
    expect(nextAction(newQueue(), { now: NOW })).toMatchObject({ item: null, reason: "nothing outstanding" });
    const q = mk([ob("/x"), ob("/y")]);
    q.items[0].dependencies = [q.items[1].id]; q.items[1].dependencies = [q.items[0].id];
    expect(nextAction(q, { now: NOW })).toMatchObject({ item: null, reason: expect.stringMatching(/waiting/) });
  });
});

describe("queue: storage, versions and customer isolation", () => {
  it("upgrades an unversioned file without inventing values and refuses a newer one", () => {
    const { queue, migrated, notes } = migrateQueue({ items: [{ id: "legacy-1", title: "Old item", status: "weird", severity: "high" }, { title: "no id" }] });
    expect(migrated).toBe(true);
    expect(queue).toMatchObject({ queueSchemaVersion: 1 });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ status: "open", severity: "high", effort: { level: "unknown" }, impact: "unknown" });
    expect(notes.join()).toMatch(/unknown status/);
    expect(() => migrateQueue({ queueSchemaVersion: 99, items: [] })).toThrow(/Update the engine/);
    expect(() => migrateQueue([])).toThrow();
  });
  it("refuses to merge another site's observations into a queue", () => {
    const { queue } = run(newQueue(), [batch([ob("/a")])]);
    expect(() => reconcile(queue, [batch([ob("/a")])], { now: NOW, site: "https://other.example" })).toThrow(/belongs to/);
  });
  it("does not modify its input", () => {
    const q = run(newQueue(), [batch([ob("/a")])]).queue;
    const copy = JSON.stringify(q);
    run(q, [batch([])]);
    decide(q, q.items[0].id, { to: "deferred", by: "Dana" });
    expect(JSON.stringify(q)).toBe(copy);
  });
});

describe("source adapters", () => {
  it("maps inventory issues, skipping GBP entries that have their own richer record", () => {
    const b = fromInventoryIssues({ issues: [{ id: "a-issue", title: "T", severity: "critical", area: "technical", status: "fixed", fixedOn: "2026-10-01", blocking: true, pages: ["/p"] }, { id: "gbp-add-hours-1", title: "GBP", severity: "low", area: "local", status: "open" }, { id: "v", title: "V", severity: "low", area: "content", status: "verified", fixedOn: "2026-10-01", verifiedOn: "2026-10-02" }] }, { observedAt: day(0), now: NOW });
    expect(b.observations.map((o) => o.ref)).toEqual(["a-issue", "v"]);
    expect(b.observations[0]).toMatchObject({ sourceStatus: "fixed", blocking: true, target: { kind: "page", ref: "/p" } });
    expect(b.observations[1].sourceStatus).toBe("resolved");
  });
  it("maps GBP recommendations and landing opportunities with their own states", () => {
    const g = fromGbpRecommendations([{ id: "gbp-x", type: "add-hours", reason: "Hours missing", priority: "high", state: "verification", foundOn: "2026-10-01", publicChange: true, userInputNeeded: "the hours" }], { observedAt: day(0), now: NOW });
    expect(g.observations[0]).toMatchObject({ sourceStatus: "fixed", severity: "high", category: "gbp" });
    expect(g.observations[0].missingInformation[0]).toMatch(/hours/);
    const l = fromLandingState({ opportunities: [{ id: "lp-a", action: "new-page", primary: "custom things", target: "/custom-things", status: "approved", score: { priority: "P1" }, performance: "unavailable" }] }, { observedAt: day(0), now: NOW });
    expect(l.observations[0]).toMatchObject({ category: "landing-page", sourceStatus: "approved", severity: "high" });
    expect(l.observations[0].missingInformation[0]).toMatch(/no sourced performance/);
  });
  it("treats keyword data without a snapshot as a failed check, never as 'all fixed'", () => {
    const analyses = [{ keyword: "blue widgets", target: { path: "/widgets" }, status: { priority: "FIX NOW", headline: "Not indexed", why: "w", actions: ["Request indexing review"] }, metrics: { impressions: 120 }, indexing: { confidence: "UNKNOWN" } }];
    let q = run(newQueue(), [fromKeywordAnalyses(analyses, { observedAt: day(0), snapshot: { fetchedAt: day(-1), range: "28d" }, now: NOW })]).queue;
    expect(q.items[0]).toMatchObject({ category: "keyword", impact: "high" });
    expect(q.items[0].evidence[0].detail).toMatch(/not a live ranking/);
    q = run(q, [fromKeywordAnalyses([], { observedAt: day(1), snapshot: null, now: NOW })]).queue;
    expect(q.items[0].status).toBe("open");
  });
  it("carries regression findings but a partial report resolves nothing", () => {
    const report = { run: { status: "complete", observedAt: day(0) }, findings: [{ type: "noindex-added", severity: "critical", url: "/pricing", siteWide: false, previous: "indexable", current: "noindex", impact: "The page can drop out of search.", action: "Remove the noindex.", verification: ["Re-run the comparison"], limitations: ["crawl only; Google's index not checked"] }] };
    let q = run(newQueue(), [fromRegressionReport(report, { now: NOW })]).queue;
    expect(q.items[0]).toMatchObject({ category: "regression", severity: "critical" });
    expect(q.items[0].verification.criteria).toEqual(["Re-run the comparison"]);
    q = run(q, [fromRegressionReport({ run: { status: "partial", observedAt: day(1) }, findings: [] }, { now: NOW })]).queue;
    expect(q.items[0].status).toBe("open");
    q = run(q, [fromRegressionReport({ run: { status: "weird" }, findings: [] }, { now: NOW })]).queue;
    expect(q.items[0].status).toBe("open");
  });
  it("mirrors the regression module's own findings, statuses and decisions", () => {
    const f = (id, status, extra = {}) => ({ id, type: "noindex-added", severity: "high", status, title: `T ${id}`, subject: { url: `/${id}` }, lastObservedAt: day(0), recommendedAction: "Fix", verification: ["rerun"], limitations: ["crawl only"], confidence: "high", ...extra });
    const b = fromRegressionStore({ lastObservation: { observedAt: day(0) }, findings: [f("a", "open"), f("b", "open", { decision: { state: "acknowledged" } }), f("c", "resolved"), f("d", "intentional")] }, { now: NOW });
    expect(b.observations.map((o) => o.sourceStatus)).toEqual(["open", "approved", "resolved", "wont-fix"]);
    const { queue } = run(newQueue(), [b]);
    expect(queue.items).toHaveLength(4);
    expect(run(queue, [fromRegressionStore({ findings: [] }, { now: NOW })]).queue.items.find((i) => i.source.ref === "a").status).toBe("open");
  });
});
