// Tests for change-to-outcome history. Fictional data only; no network.
import { describe, expect, it } from "vitest";
import { newOutcomes, recordChange, compareChange, dueReviews, recordReview, migrateOutcomes, addDays } from "./outcome-history.mjs";

const PUB = "2026-09-01";
const rowsFor = (start, end, f) => { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, ...f(d) }); return out; };
const base = () => recordChange(newOutcomes("https://shop.example"), { id: "chg-1", page: "/widgets", category: "content", publishedAt: PUB, contentHash: "abc123", by: "Dana", now: Date.parse("2026-09-01T10:00:00Z") });
const full = (f = () => ({ clicks: 10, impressions: 200 })) => rowsFor(addDays(PUB, -28), addDays(PUB, 28), f);
const cmp = (rows, extra = {}) => compareChange(base().changes[0], rows, { today: "2026-10-20", ...extra });

describe("recording a change", () => {
  it("captures page, category, time, hash, baseline and default review dates", () => {
    const c = base().changes[0];
    expect(c).toMatchObject({ page: "/widgets", category: "content", publishedAt: PUB, contentHash: "abc123", recordedBy: "Dana", baseline: { start: "2026-08-04", end: "2026-08-31" } });
    expect(c.reviewDates).toEqual(["2026-09-15", "2026-09-29", "2026-10-27"]);
  });
  it("is append-only and validates input", () => {
    const f = base();
    expect(() => recordChange(f, { id: "chg-1", page: "/x", publishedAt: PUB, by: "D" })).toThrow(/already exists/);
    expect(() => recordChange(f, { id: "chg-2", page: "x", publishedAt: PUB, by: "D" })).toThrow(/site path/);
    expect(() => recordChange(f, { id: "chg-2", page: "/x", publishedAt: "soon", by: "D" })).toThrow(/publishedAt/);
    expect(() => recordChange(f, { id: "chg-2", page: "/x", publishedAt: PUB })).toThrow(/name/);
    expect(() => recordChange(f, { id: "chg-2", page: "/x", category: "magic", publishedAt: PUB, by: "D" })).toThrow(/category/);
  });
  it("reports due reviews until they are recorded", () => {
    let f = base();
    expect(dueReviews(f, "2026-09-20").map((d) => d.reviewDate)).toEqual(["2026-09-15"]);
    const r = cmp(full());
    f = recordReview(f, "chg-1", { reviewDate: "2026-09-15", by: "Dana", comparison: r });
    expect(dueReviews(f, "2026-09-20")).toEqual([]);
    expect(f.changes[0].reviews[0]).toMatchObject({ by: "Dana", status: "compared" });
  });
});

describe("comparison", () => {
  it("compares equal complete periods and excludes the publication day", () => {
    const r = cmp(full((d) => (d > PUB ? { clicks: 15, impressions: 300 } : { clicks: 10, impressions: 200 })));
    expect(r.status).toBe("compared");
    expect(r.periods.before).toEqual({ start: "2026-08-04", end: "2026-08-31" });
    expect(r.periods.after).toEqual({ start: "2026-09-02", end: "2026-09-29" });
    expect(r.metrics.clicks).toMatchObject({ available: true, before: 280, after: 420, change: 140, changePercent: 50 });
    expect(r.interpretation).toBe("association");
    expect(r.note).toMatch(/does not show that the change caused/);
  });
  it("is pending until the after period is complete and final", () => {
    const r = compareChange(base().changes[0], full(), { today: "2026-09-20" });
    expect(r.status).toBe("pending");
    expect(r.reason).toMatch(/not final until/);
  });
  it("distinguishes a real zero from unavailable data", () => {
    const zero = cmp(full((d) => (d > PUB ? { clicks: 0, impressions: 200 } : { clicks: 5, impressions: 200 })));
    expect(zero.metrics.clicks).toMatchObject({ available: true, after: 0 });
    expect(zero.metrics.conversions).toMatchObject({ available: false });
    expect(zero.metrics.conversions.reason).toMatch(/no conversions data supplied/);
    const fromZero = cmp(full((d) => (d > PUB ? { clicks: 5, impressions: 200 } : { clicks: 0, impressions: 200 })));
    expect(fromZero.metrics.clicks.changePercent).toBeNull();
    expect(fromZero.metrics.clicks.changePercentNote).toMatch(/real total of 0/);
  });
  it("does not compare a metric with missing days and flags it", () => {
    const rows = full().filter((r) => r.date !== "2026-09-10");
    const r = cmp(rows);
    expect(r.metrics.clicks).toMatchObject({ available: false });
    expect(r.metrics.clicks.reason).toMatch(/27\/28/);
    expect(r.flags.map((f) => f.id)).toContain("missing-data");
    expect(r.status).toBe("insufficient-data");
  });
  it("flags low volume and uncontrolled seasonality", () => {
    const r = cmp(full(() => ({ clicks: 1, impressions: 2 })));
    expect(r.flags.map((f) => f.id)).toEqual(expect.arrayContaining(["low-sample", "seasonality-not-controlled"]));
    expect(r.limits.join(" ")).toMatch(/Seasonal/);
  });
  it("gives a year-ago reference only when those days are supplied", () => {
    const rows = [...rowsFor(addDays(PUB, -28 - 364), addDays(PUB, 28 - 364), () => ({ clicks: 8, impressions: 150 })), ...full()];
    const r = cmp(rows);
    expect(r.metrics.yearAgo).toMatchObject({ available: true });
    expect(r.flags.map((f) => f.id)).not.toContain("seasonality-not-controlled");
  });
  it("flags overlapping changes on the same page or site-wide, not on other pages", () => {
    const f = recordChange(recordChange(recordChange(base(), { id: "chg-2", page: "/widgets", publishedAt: "2026-09-10", by: "D" }), { id: "chg-3", page: "*", publishedAt: "2026-08-20", by: "D" }), { id: "chg-4", page: "/other", publishedAt: "2026-09-05", by: "D" });
    const r = compareChange(f.changes[0], full(), { today: "2026-10-20", otherChanges: f.changes });
    const o = r.flags.find((x) => x.id === "overlapping-changes");
    expect(o.detail).toMatch(/chg-2/); expect(o.detail).toMatch(/chg-3/); expect(o.detail).not.toMatch(/chg-4/);
  });
  it("labels Search Console position as an average and passes indexing evidence through untouched", () => {
    const r = cmp(full(() => ({ clicks: 10, impressions: 200, position: 8 })), { indexing: { status: "INDEXED", observedAt: "2026-10-01", source: "index monitor" } });
    expect(r.metrics.searchConsolePosition.note).toMatch(/not a live ranking/);
    expect(r.indexing.status).toBe("INDEXED");
    expect(cmp(full()).indexing.status).toBe("not provided");
    expect(cmp(full()).metrics.searchConsolePosition).toMatchObject({ available: false });
  });
  it("notes when only the date, not the time, is known", () => {
    expect(cmp(full()).flags.map((f) => f.id)).toContain("date-only");
    const t = recordChange(newOutcomes(), { id: "c", page: "/a", publishedAt: "2026-09-01T09:30:00Z", by: "D" }).changes[0];
    expect(compareChange(t, full(), { today: "2026-10-20" }).flags.map((f) => f.id)).not.toContain("date-only");
  });
  it("lets thresholds be configured", () => {
    const r = compareChange(base().changes[0], full(() => ({ clicks: 1, impressions: 2 })), { today: "2026-10-20", cfg: { minImpressions: 1, minClicks: 1, windowDays: 28 } });
    expect(r.flags.map((f) => f.id)).not.toContain("low-sample");
  });
});

describe("storage versions", () => {
  it("upgrades an unversioned file and refuses a newer one", () => {
    const m = migrateOutcomes({ changes: [{ id: "old", page: "/a", publishedOn: "2026-08-01", reviewDates: [], reviews: [] }, { nope: 1 }] });
    expect(m).toMatchObject({ outcomesSchemaVersion: 1 });
    expect(m.changes).toHaveLength(1);
    expect(m.changes[0]).toMatchObject({ publishedAt: "2026-08-01T00:00:00Z", publishedPrecision: "date", category: "other" });
    expect(() => migrateOutcomes({ outcomesSchemaVersion: 5, changes: [] })).toThrow(/Update|not changed/);
  });
});
