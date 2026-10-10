// Tests for the /BWESEO state machine (seo/tools/seo-state.mjs, vendored from the BWESEO engine).
//
// 1. Representative lifecycle states, built as fixture evidence for a fictional business, each
//    produce the right single recommendation (evaluateState is pure — no disk, no network).
// 2. Evidence gathering from a temporary project folder (docs, exports, source hashes, a mocked
//    production site).
// 3. (Project-specific checks against this repo's own data live in seo-project.test.mjs, which is
//    not part of the reusable engine.)

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  ENV,
  S,
  STATE_VERSION,
  classifyUrl,
  collectEvidence,
  environmentSummary,
  environmentsOf,
  evaluateState,
  findEnvironmentLeaks,
  indexProtection,
  indexingAllowed,
  robotsBlocksAll,
  classifyProbe,
  healthConfig,
  HEALTH_STRATEGIES,
  selfFetchRisk,
  registrableDomain,
  buildProbeInput,
  sanitizeLiveCheck,
  healthCategory,
  nextHealthHistory,
  probeLive,
  LIVE_HEALTH_LABEL,
  searchConsoleSite,
  formatDashboard,
  formatDetails,
  pipelineSummary,
  formatPipeline,
  pipelineLines,
  sourceFiles,
  sourceState,
} from "./seo-state.mjs";
import { validateInventory } from "./validate-seo-data.mjs";

const TODAY = "2026-11-02";

// ---------------------------------------------------------------- fixtures (fictional business)

const config = (over = {}) => ({
  schemaVersion: 1,
  projectId: "acme-heating",
  website: "https://acme-heating.example.com",
  repo: { gitRemote: "acme/site" },
  engine: { version: STATE_VERSION },
  adapter: "static-html",
  stack: {},
  workflows: { build: "npm run build", test: "npm test", deployProduction: "npm run release" },
  conversion: { primary: "A booked service call" },
  paths: {
    businessProfile: "seo/business-profile.json",
    contentInventory: "seo/content-inventory.json",
    docs: "docs/seo",
  },
  analytics: {
    searchConsole: {
      access: "manual-export",
      dataDir: "seo/data/search-console",
      requestIndexing: "recommended",
      configured: "yes",
      propertyType: "Domain",
      verifiedProperty: "acme-heating.example.com",
      verificationMethod: "DNS",
      verifiedOn: "2026-10-01",
      sitemap: {
        url: "https://acme-heating.example.com/sitemap.xml",
        submitted: "yes",
        status: "Success",
        verifiedOn: "2026-10-01",
      },
      sitemapSubmission: "verified",
    },
  },
  publication: { usesSitemap: true, sitemapUrl: "https://acme-heating.example.com/sitemap.xml" },
  ...over,
});
const profile = (over = {}) => ({
  identity: { businessName: { value: "Acme Heating", status: "verified" } },
  lastReviewed: TODAY,
  openQuestions: [],
  ...over,
});
const page = (over) => ({ type: "service", topic: "A topic", indexable: true, ...over });
const home = page({
  id: "home",
  url: "/",
  type: "home",
  status: "published",
  title: "Acme Heating",
});
// A scored-and-rejected idea: evidence that opportunity analysis has run.
const doneIdea = page({ id: "old-idea", url: "/old-idea", status: "rejected" });
const doc = (updated = TODAY) => ({ exists: true, updated, hasContent: true });
const noDoc = { exists: false, updated: null, hasContent: false };
const planned = { baseline: doc(), roadmap: doc() };
const approved = (over = {}) =>
  page({
    id: "ac-repair",
    url: "/ac-repair",
    name: "AC Repair",
    status: "approved",
    priority: "P1",
    approvedOn: "2026-10-01",
    approvedBy: "user",
    verifyText: "Air conditioning repair",
    source: "src/ac-repair.html",
    ...over,
  });
const qaPass = (date = "2026-10-05", sourceHash = "a1b2c3d4e5f60718") => ({
  result: "pass",
  date,
  sourceHash,
});
const livePage = (over = {}) =>
  approved({
    status: "published",
    qa: qaPass(),
    publishedOn: "2026-10-30",
    postPublication: {
      checkedOn: "2026-10-30",
      result: "ready",
      searchConsole: {
        indexingRequest: "REQUESTED",
        requestedOn: "2026-10-30",
        requestSource: "owner:2026-10-30 chat",
        liveUrlTest: { result: "passed", testedOn: "2026-10-30" },
        indexed: {
          status: "INDEXED",
          verifiedOn: "2026-11-02",
          evidence: "URL Inspection: URL is on Google",
          source: "owner:2026-11-02 chat",
        },
      },
      google: {
        readiness: { status: "PASSED", checkedAt: "2026-10-30", source: "post-publication check (production)" },
        sitemap: { included: "yes", verifiedAt: "2026-10-30", source: "post-publication check (production)" },
      },
      monitoring: { review7: "2026-11-06", review30: "2026-11-29", review90: "2027-01-28" },
    },
    ...over,
  });

function evidence({
  cfg = config(),
  prof = profile(),
  pages = [home],
  issues,
  docs = {},
  live,
  exports = [],
  sources = {},
  validation,
  install,
  repo = { remote: "https://github.com/acme/site.git", folderName: "site" },
} = {}) {
  return {
    today: TODAY,
    ...(install ? { install } : {}),
    repo,
    config: cfg,
    profile: prof,
    inventory: {
      schemaVersion: 1,
      projectId: "acme-heating",
      pages,
      ...(issues ? { issues } : {}),
    },
    validation: validation ?? { errors: [], warnings: [] },
    docs: { baseline: noDoc, roadmap: noDoc, ...docs },
    searchConsoleExports: exports,
    sources,
    live: live
      ? { checked: true, origin: "https://acme-heating.example.com", pages: live }
      : { checked: false, reason: "not checked in tests" },
  };
}
const run = (ev) => evaluateState(ev, { today: TODAY });
const rec = (ev) => run(ev).recommendation;
const row = (state, key) =>
  state.pages.find((p) => p.id === state.focusPageId).rows.find((r) => r.key === key);
const SRC = {
  "ac-repair": {
    files: ["src/ac-repair.html"],
    missing: [],
    hash: "a1b2c3d4e5f60718",
    modifiedOn: "2026-10-05",
  },
};

// ---------------------------------------------------------------- lifecycle states

describe("state machine — the lifecycle", () => {
  const RECEIPT = { engineVersion: "1.7.0", schemaVersion: 1, manifestVersion: 1, installationMode: "install", adapter: "astro" };

  it("NEW PROJECT (BWESEO not installed) → recommends /BWESEOInstall, not setup", () => {
    const state = evaluateState({ today: TODAY, config: null }, { today: TODAY });
    expect(state.recommendation).toMatchObject({ kind: "install", skill: "BWESEOInstall", command: "/BWESEOInstall" });
    expect(state.recommendation.headline).toBe("Install the BWESEO engine.");
    expect(state.stages[0]).toMatchObject({ key: "install", status: S.NOT_STARTED, next: true });
    expect(state.install.status).toBe("not-installed");
    const out = formatDashboard(state);
    expect(out).toContain("Install the BWESEO engine.");
    expect(out).toContain("/BWESEOInstall --dry-run");
    expect(out).not.toContain("Live production check");
  });

  it("ENGINE INSTALLED, project not set up → 'Engine installed — project setup is next' → /BWESEOSetup", () => {
    const state = evaluateState({ today: TODAY, config: null, install: { receipt: RECEIPT, integrity: "verified" } }, { today: TODAY });
    expect(state.recommendation).toMatchObject({ kind: "setup", skill: "BWESEOSetup", command: "/BWESEOSetup", installed: true });
    expect(state.recommendation.headline).toMatch(/Engine installed — project setup is next/);
    expect(state.stages.find((r) => r.key === "install")).toMatchObject({ status: S.COMPLETE });
    expect(state.stages.find((r) => r.key === "setup")).toMatchObject({ status: S.NOT_STARTED, next: true });
    expect(state.install).toMatchObject({ status: "installed", engineVersion: "1.7.0", schemaVersion: 1, integrity: "verified" });
    const out = formatDashboard(state);
    expect(out).toMatch(/SEO setup .* → Next/);
    expect(out).toContain("SEO has not been configured for this business.");
  });

  it("SET UP → the normal state-aware workflow; installation status is a small line, never the recommendation", () => {
    const state = run(evidence({ pages: [home], docs: planned, install: { receipt: RECEIPT, integrity: "verified" } }));
    expect(["install", "setup", "setup-incomplete"]).not.toContain(state.recommendation.kind);
    const line = environmentSummary(state).find((l) => l.key === "engine");
    expect(line.value).toBe("v1.7.0 · Schema 1 · Installation verified ✓");
  });

  it("a project with SEO records but no receipt is a LEGACY install — flagged small, never blocking", () => {
    const state = run(evidence({ pages: [home], docs: planned }));
    expect(state.install.status).toBe("legacy");
    expect(["install", "setup"]).not.toContain(state.recommendation.kind);
    expect(environmentSummary(state).find((l) => l.key === "engine").value).toMatch(/installed before install receipts existed/);
  });

  it("modified / missing engine files and an available update are shown, not hidden", () => {
    const mod = run(evidence({ pages: [home], docs: planned, install: { receipt: RECEIPT, integrity: "modified", latestKnown: "1.8.0" } }));
    expect(environmentSummary(mod).find((l) => l.key === "engine")).toMatchObject({ tone: "warn" });
    expect(environmentSummary(mod).find((l) => l.key === "engine").value).toMatch(/engine files modified locally.*Update available \(v1\.8\.0\)/);
    expect(mod.install.updateAvailable).toBe("1.8.0");
    const same = run(evidence({ pages: [home], docs: planned, install: { receipt: RECEIPT, integrity: "verified", latestKnown: "1.7.0" } }));
    expect(same.install.updateAvailable).toBeNull();
  });

  it("the state never contains the receipt's file hashes or any credential", () => {
    const state = run(evidence({ pages: [home], docs: planned, install: { receipt: RECEIPT, integrity: "verified" } }));
    expect(JSON.stringify(state.install)).not.toMatch(/sha256|files/);
  });

  it("stops when the SEO files belong to a different repo (project guard)", () => {
    const r = rec(
      evidence({ repo: { remote: "https://github.com/someone/else.git", folderName: "else" } }),
    );
    expect(r).toMatchObject({ kind: "guard-mismatch", actor: "user" });
  });

  it("SETUP COMPLETE / NO AUDIT → recommends the audit", () => {
    expect(rec(evidence())).toMatchObject({ kind: "audit", skill: "BWESEOAudit" });
  });

  it("AUDIT COMPLETE / NO OPPORTUNITIES → recommends opportunity analysis", () => {
    expect(rec(evidence({ docs: { baseline: doc() } }))).toMatchObject({
      kind: "opportunities",
      skill: "BWESEOOpportunities",
    });
  });

  it("OPPORTUNITIES / NO ROADMAP → recommends the content plan", () => {
    const pages = [
      home,
      page({ id: "ac-repair", url: "/ac-repair", status: "idea", priority: "P1" }),
    ];
    expect(rec(evidence({ pages, docs: { baseline: doc() } }))).toMatchObject({
      kind: "content-plan",
      skill: "BWESEOContentPlan",
    });
  });

  it("ROADMAP COMPLETE / NO APPROVED PAGE → asks the owner to approve ONE page, in roadmap order", () => {
    const pages = [
      home,
      page({
        id: "furnace",
        url: "/furnace-repair",
        name: "Furnace",
        status: "planned",
        priority: "P1",
        roadmapOrder: 2,
      }),
      page({
        id: "ac-repair",
        url: "/ac-repair",
        name: "AC Repair",
        status: "planned",
        priority: "P1",
        roadmapOrder: 1,
      }),
      page({
        id: "ac-home",
        url: "/",
        name: "Home retitle",
        status: "planned",
        priority: "P1",
        roadmapOrder: 1,
      }),
      page({
        id: "blog",
        url: "/blog",
        name: "Blog",
        status: "idea",
        priority: "P2",
        roadmapOrder: 3,
      }),
    ];
    const state = run(evidence({ pages, docs: planned }));
    const r = state.recommendation;
    expect(r).toMatchObject({ kind: "approve-page", actor: "user", approval: "page" });
    // Entries sharing a roadmapOrder are one item, approved together.
    expect(r.pageIds).toEqual(["ac-repair", "ac-home"]);
    expect(r.options.map((o) => o.name)).toEqual(["AC Repair + Home retitle", "Furnace", "Blog"]);
    expect(state.actions.some((a) => a.kind === "create-page")).toBe(false);
  });

  it("PAGE APPROVED → recommends creating that page", () => {
    const r = rec(evidence({ pages: [home, approved()], docs: planned }));
    expect(r).toMatchObject({
      kind: "create-page",
      command: "/BWESEOCreatePage ac-repair",
      actor: "claude",
    });
  });

  it("PAGE CREATED / NO QA → recommends SEO QA", () => {
    const state = run(
      evidence({ pages: [home, approved({ status: "review" })], docs: planned, sources: SRC }),
    );
    expect(state.recommendation).toMatchObject({ kind: "qa", command: "/BWESEOQA ac-repair" });
    expect(row(state, "creation").status).toBe(S.COMPLETE);
    expect(row(state, "qa")).toMatchObject({ status: S.NOT_STARTED, next: true });
    expect(row(state, "deployment").status).toBe(S.WAITING);
    expect(formatDashboard(state)).toMatch(/SEO QA \.+ → Next/);
  });

  it("QA PASSED / NOT DEPLOYED → asks for deployment approval through the project's workflow", () => {
    const pages = [home, approved({ status: "review", qa: qaPass() })];
    const state = run(
      evidence({ pages, docs: planned, sources: SRC, live: { "ac-repair": { status: 404 } } }),
    );
    expect(state.recommendation).toMatchObject({
      kind: "approve-deploy",
      actor: "user",
      approval: "deploy",
    });
    expect(state.recommendation.next).toMatch(/npm run release/);
    expect(row(state, "deployment").status).toBe(S.NEEDS_APPROVAL);
  });

  it("DEPLOYED / NO POST-PUBLICATION CHECK → recommends /BWESEOPublish", () => {
    const pages = [home, approved({ status: "review", qa: qaPass() })];
    const live = {
      "ac-repair": {
        status: 200,
        finalUrl: "https://acme-heating.example.com/ac-repair",
        hasVerifyText: true,
      },
    };
    const state = run(evidence({ pages, docs: planned, sources: SRC, live }));
    expect(state.recommendation).toMatchObject({
      kind: "publish-check",
      command: "/BWESEOPublish ac-repair",
    });
    expect(row(state, "deployment").status).toBe(S.COMPLETE);
  });

  it("LIVE / INDEXING ACTION REQUIRED → shows the manual Search Console steps with the exact URL", () => {
    const p = livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { indexingRequest: "NOT REQUESTED", requestedOn: null, requestSource: null,
          liveUrlTest: { result: "passed", testedOn: "2026-10-30" },
        },
      },
    });
    const state = run(evidence({ pages: [home, p], docs: planned }));
    const r = state.recommendation;
    expect(r).toMatchObject({ kind: "request-indexing", actor: "user", manual: true });
    expect(r.steps.join("\n")).toContain("https://acme-heating.example.com/ac-repair");
    expect(r.steps.join("\n")).toMatch(/Request Indexing/);
    const out = formatDashboard(state);
    expect(out).toContain("USER MUST DO THIS");
    expect(out).toContain("MANUAL ACTION REQUIRED");
  });

  it("an owner's decision not to request indexing is respected (not asked again)", () => {
    const p = livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: {
          indexingRequest: "NOT REQUESTED",
          requestSource: "owner:2026-10-31 chat — declined",
        },
      },
    });
    expect(rec(evidence({ pages: [home, p], docs: planned })).kind).toBe("wait");
  });

  it("LIVE / RECENTLY PUBLISHED → says to wait, gives the next review date, and invents no work", () => {
    const state = run(evidence({ pages: [home, livePage()], docs: planned }));
    const r = state.recommendation;
    expect(r).toMatchObject({ kind: "wait", headline: "No SEO change is needed right now." });
    expect(r.why).toMatch(/published 3 day\(s\) ago/);
    expect(r.next).toContain("2026-11-06");
    expect(state.actions.some((a) => ["refresh-page", "qa", "create-page"].includes(a.kind))).toBe(
      false,
    );
    expect(row(state, "monitoring").status).toBe(S.WAITING_FOR_DATA);
  });

  it("30-DAY REVIEW DUE → recommends the Search Console review when the export is there", () => {
    const p = livePage({
      publishedOn: "2026-09-25",
      postPublication: {
        ...livePage().postPublication,
        monitoring: {
          review7: "2026-10-02",
          review30: "2026-10-25",
          review90: "2026-12-24",
          completed: { review7: "2026-10-03" },
        },
      },
    });
    const r = rec(evidence({ pages: [home, p], docs: planned, exports: ["2026-10-30"] }));
    expect(r).toMatchObject({ kind: "sc-review", skill: "BWESEOSearchConsole", days: 30 });
  });

  it("a review that's due without an export asks the owner to export first", () => {
    const p = livePage({
      postPublication: {
        ...livePage().postPublication,
        monitoring: { review7: "2026-10-30", review30: "2026-11-29", review90: "2027-01-28" },
      },
    });
    const r = rec(evidence({ pages: [home, p], docs: planned, exports: ["2026-10-01"] }));
    expect(r).toMatchObject({
      kind: "export-search-console",
      actor: "user",
      manual: true,
      days: 7,
    });
    expect(r.steps.join("\n")).toContain(`seo/data/search-console/${TODAY}/`);
  });

  it("UNDERPERFORMING EXISTING PAGE → recommends a refresh only when evidence is recorded", () => {
    const weak = page({
      id: "services",
      url: "/services",
      status: "published",
      title: "Services",
      refresh: {
        trigger: "Low click-through",
        evidence: "1,200 impressions, 0.4% CTR at position 6 (Aug–Oct)",
        flaggedOn: "2026-10-31",
      },
    });
    const r = rec(evidence({ pages: [home, doneIdea, weak], docs: planned }));
    expect(r).toMatchObject({
      kind: "refresh-page",
      command: "/BWESEORefresh services",
      approval: "change",
    });
    expect(r.why).toMatch(/0\.4% CTR/);
    const quiet = page({
      id: "services",
      url: "/services",
      status: "published",
      title: "Services",
    });
    expect(rec(evidence({ pages: [home, doneIdea, quiet], docs: planned })).kind).toBe("idle");
  });

  it("BLOCKED BY MISSING VERIFIED FACT → asks only the blocking question", () => {
    const prof = profile({
      openQuestions: [
        { id: "founded-year", question: "What year did the business start?" },
        {
          id: "emergency-service",
          question: "Does the company provide 24-hour emergency HVAC service?",
          blocks: ["ac-repair"],
        },
      ],
    });
    const state = run(
      evidence({
        prof,
        pages: [home, approved({ blockedBy: ["emergency-service"] })],
        docs: planned,
      }),
    );
    expect(state.recommendation).toMatchObject({ kind: "answer-question", actor: "user" });
    expect(state.recommendation.questions).toEqual([
      {
        id: "emergency-service",
        question: "Does the company provide 24-hour emergency HVAC service?",
      },
    ]);
    expect(row(state, "creation").status).toBe(S.BLOCKED);
    expect(formatDashboard(state)).not.toMatch(/What year/);
  });

  it("a profile question marked blocking holds up everything — and only it is asked", () => {
    const prof = profile({
      openQuestions: [
        {
          id: "which-site",
          question: "Which of the two websites is the real one?",
          blocking: true,
        },
        { id: "founded-year", question: "What year did the business start?" },
      ],
    });
    const r = rec(evidence({ prof, docs: planned, pages: [home, approved()] }));
    expect(r.kind).toBe("answer-question");
    expect(r.questions.map((q) => q.id)).toEqual(["which-site"]);
  });

  it("STALE QA → recommends re-running QA when the page changed after it passed", () => {
    const pages = [
      home,
      approved({ status: "review", qa: qaPass("2026-10-05", "0000aaaa0000aaaa") }),
    ];
    expect(rec(evidence({ pages, docs: planned, sources: SRC }))).toMatchObject({
      kind: "qa-rerun",
      date: "2026-10-05",
    });
    // No recorded hash: fall back to file dates.
    const noHash = [
      home,
      approved({ status: "review", qa: { result: "pass", date: "2026-10-01" } }),
    ];
    expect(rec(evidence({ pages: noHash, docs: planned, sources: SRC })).kind).toBe("qa-rerun");
  });

  it("QA FAILED → recommends fixing, not deploying", () => {
    const pages = [
      home,
      approved({ status: "review", qa: { result: "fail", date: "2026-10-05" } }),
    ];
    expect(rec(evidence({ pages, docs: planned, sources: SRC }))).toMatchObject({ kind: "qa-fix" });
  });
});

describe("state machine — holds, pacing, conflicts, issues", () => {
  it("a deploy hold still allows QA", () => {
    const hold = { since: "2026-10-02", scope: "deploy", source: "owner:2026-10-02 chat" };
    const state = run(
      evidence({
        pages: [home, approved({ status: "review", hold })],
        docs: planned,
        sources: SRC,
      }),
    );
    expect(state.recommendation.kind).toBe("qa");
    expect(row(state, "deployment").status).toBe(S.ON_HOLD);
  });

  it("a held page that passed QA is never pushed to deploy — the next useful work comes first", () => {
    const hold = { since: "2026-10-02", scope: "deploy", source: "owner:2026-10-02 chat" };
    const held = approved({ status: "review", qa: qaPass(), hold });
    const next = page({
      id: "furnace",
      url: "/furnace",
      status: "planned",
      priority: "P1",
      roadmapOrder: 2,
    });
    const state = run(evidence({ pages: [home, held, next], docs: planned, sources: SRC }));
    expect(state.recommendation.kind).toBe("approve-page");
    expect(state.actions.some((a) => a.kind === "approve-deploy")).toBe(false);
    // Nothing else left: only then is the hold mentioned as the next step.
    expect(rec(evidence({ pages: [home, held], docs: planned, sources: SRC })).kind).toBe(
      "resume-hold",
    );
  });

  it("a hold on everything pauses the page completely", () => {
    const hold = { since: "2026-10-02", scope: "all", source: "owner:2026-10-02 chat" };
    expect(rec(evidence({ pages: [home, approved({ hold })], docs: planned })).kind).toBe(
      "resume-hold",
    );
  });

  it("a page waiting for data does not stop the next roadmap page (pacing)", () => {
    const next = page({
      id: "furnace",
      url: "/furnace",
      status: "planned",
      priority: "P1",
      roadmapOrder: 2,
    });
    const state = run(evidence({ pages: [home, livePage(), next], docs: planned }));
    expect(state.recommendation.kind).toBe("approve-page");
    expect(state.actions.some((a) => a.kind === "wait")).toBe(true);
  });

  it("reports a published page that is missing from production before anything else", () => {
    const live = {
      "ac-repair": { status: 404, finalUrl: "https://acme-heating.example.com/ac-repair" },
    };
    const state = run(evidence({ pages: [home, livePage()], docs: planned, live }));
    // a 404 is a production-health / content conflict to investigate — never a republish
    expect(state.recommendation).toMatchObject({
      kind: "conflict-not-live",
      skill: "BWESEOTechnical",
    });
    expect(state.recommendation.command).not.toMatch(/BWESEOPublish/);
    expect(row(state, "deployment").status).toBe(S.COMPLETE); // history intact
    expect(formatDashboard(state)).toContain("RECORDS DON'T MATCH REALITY");
  });

  it("reports a page that went live before passing QA", () => {
    const live = { "ac-repair": { status: 200, hasVerifyText: true } };
    const r = rec(
      evidence({
        pages: [home, approved({ status: "review" })],
        docs: planned,
        sources: SRC,
        live,
      }),
    );
    expect(r).toMatchObject({ kind: "conflict-live-before-qa", skill: "BWESEOQA" });
  });

  it("a page that answers 200 without its own text is not assumed deployed", () => {
    const live = { "ac-repair": { status: 200, hasVerifyText: false } };
    const r = rec(
      evidence({
        pages: [home, approved({ status: "review", qa: qaPass() })],
        docs: planned,
        sources: SRC,
        live,
      }),
    );
    expect(r.kind).toBe("approve-deploy");
  });

  it("treats a blockedBy id that is no longer an open question as resolved, and says so", () => {
    const pages = [
      home,
      page({
        id: "pricing",
        url: "/pricing",
        status: "planned",
        priority: "P1",
        blockedBy: ["old-question"],
      }),
    ];
    const state = run(evidence({ pages, docs: planned }));
    expect(state.recommendation.kind).toBe("approve-page");
    expect(state.warnings.join("\n")).toMatch(/old-question is no longer an open question/);
  });

  it("ranks site issues: critical before page work, high after in-flight pages, fixed and low ignored", () => {
    const issue = (id, severity, status = "open") => ({
      id,
      title: id,
      severity,
      area: "technical",
      status,
    });
    const inFlight = [home, approved({ status: "review" })];
    const crit = run(
      evidence({
        pages: inFlight,
        docs: planned,
        sources: SRC,
        issues: [issue("robots-blocks-all", "critical")],
      }),
    );
    expect(crit.recommendation).toMatchObject({
      kind: "approve-issue",
      issueId: "robots-blocks-all",
    });
    const high = run(
      evidence({
        pages: inFlight,
        docs: planned,
        sources: SRC,
        issues: [issue("og-tags", "high")],
      }),
    );
    expect(high.recommendation.kind).toBe("qa");
    expect(high.alsoForYou[0]).toMatchObject({ kind: "approve-issue", issueId: "og-tags" });
    const approvedFix = run(
      evidence({
        pages: [home, doneIdea],
        docs: planned,
        issues: [issue("og-tags", "high", "approved")],
      }),
    );
    expect(approvedFix.recommendation).toMatchObject({
      kind: "fix-issue",
      command: "/BWESEOTechnical og-tags",
      actor: "claude",
    });
    const quiet = run(
      evidence({
        pages: [home, doneIdea],
        docs: planned,
        issues: [issue("a", "high", "fixed"), issue("b", "low")],
      }),
    );
    expect(quiet.recommendation.kind).toBe("idle");
  });

  it("broken SEO data is fixed before anything is recommended from it", () => {
    const r = rec(
      evidence({
        docs: planned,
        validation: { errors: ["pages[3].status is wrong"], warnings: [] },
      }),
    );
    expect(r).toMatchObject({ kind: "fix-data", errorCount: 1 });
  });

  it("detailed mode lists every page, issue and the whole action list", () => {
    const pages = [
      home,
      approved({ status: "review" }),
      page({ id: "furnace", url: "/furnace", status: "planned", priority: "P1" }),
    ];
    const out = formatDetails(run(evidence({ pages, docs: planned, sources: SRC })));
    expect(out).toContain("FULL SEO STATUS");
    expect(out).toContain("AC Repair (/ac-repair)");
    expect(out).toContain("EVERYTHING THAT COULD BE DONE");
  });
});

// ---------------------------------------------------------------- evidence gathering

// ---------------------------------------------------------------- environments (engine 1.3.0)

const PROD = "https://acme-heating.example.com";
const STG = "https://staging.acme-heating.example.com";
const stagedConfig = (staging = { status: "configured", url: STG }) =>
  config({
    environments: {
      production: {
        url: PROD,
        hosts: ["acme-heating.example.com", "www.acme-heating.example.com"],
      },
      staging,
    },
    workflows: {
      build: "npm run build",
      test: "npm test",
      deployProduction: "npm run release",
      deployStaging: "npm run deploy:staging",
    },
  });
const indexable = { header: null, meta: ["index, follow"], noindex: false };
const noindexHeader = { header: "noindex, nofollow", meta: ["index, follow"], noindex: true };
const onSite = { status: 200, hasVerifyText: true };
const notThere = { status: 404, hasVerifyText: null };
// A live check of both sites: production indexable, staging hidden (noindex header + robots.txt).
function envLive({
  prod = {},
  staging = {},
  prodHome = { status: 200, robots: indexable },
  prodRobots = { status: 200, blocksAll: false },
  stagingHome = { status: 200, robots: noindexHeader },
  stagingRobots = { status: 200, blocksAll: true },
} = {}) {
  return {
    checked: true,
    origin: PROD,
    pages: prod,
    production: { home: prodHome, robots: prodRobots },
    staging: {
      checked: true,
      origin: STG,
      pages: staging,
      home: stagingHome,
      robots: stagingRobots,
    },
  };
}
const stagedEv = ({ pages, live, cfg = stagedConfig(), ...rest }) => ({
  ...evidence({ cfg, pages, docs: planned, sources: SRC, ...rest }),
  live: envLive(live),
});
const building = (over = {}) => approved({ status: "review", ...over });
const reviewPass = { result: "pass", date: "2026-10-06", sourceHash: "a1b2c3d4e5f60718" };
const approvalOk = {
  approvedOn: "2026-10-07",
  source: "owner:2026-10-07 chat",
  sourceHash: "a1b2c3d4e5f60718",
};
const noIndexingAction = (state) =>
  expect(state.actions.map((a) => a.kind)).not.toContain("request-indexing");
const envLine = (state, key) => environmentSummary(state).find((l) => l.key === key);

describe("environments — classification and leak detection", () => {
  const cfg = stagedConfig();
  cfg.environments.preview = { status: "configured", hostPatterns: ["*.previews.example.net"] };

  it("classifies every URL by the project's own config, never by guesswork", () => {
    expect(classifyUrl(`${PROD}/ac-repair`, cfg)).toBe(ENV.PRODUCTION);
    expect(classifyUrl("https://www.acme-heating.example.com/", cfg)).toBe(ENV.PRODUCTION);
    expect(classifyUrl(`${STG}/ac-repair`, cfg)).toBe(ENV.STAGING);
    expect(classifyUrl("https://pr-12.previews.example.net/", cfg)).toBe(ENV.PREVIEW);
    expect(classifyUrl("http://localhost:5173/ac-repair", cfg)).toBe(ENV.LOCAL);
    expect(classifyUrl("http://127.0.0.1:8080/", cfg)).toBe(ENV.LOCAL);
    // A lookalike or unrelated host is not production.
    expect(classifyUrl("https://acme-heating.example.com.evil.test/", cfg)).toBe(ENV.LOCAL);
    expect(classifyUrl("https://unknown.example.org/", cfg)).toBe(ENV.UNKNOWN);
  });

  it("only production is ever allowed search-engine indexing actions", () => {
    expect(indexingAllowed(ENV.PRODUCTION)).toBe(true);
    for (const e of [ENV.LOCAL, ENV.STAGING, ENV.PREVIEW, ENV.UNKNOWN, null]) {
      expect(indexingAllowed(e)).toBe(false);
    }
  });

  it("reads the pre-1.3.0 config form, and reports a missing staging entry as unknown — not invented", () => {
    const legacy = environmentsOf({
      website: PROD,
      environments: { production: PROD, staging: STG },
      publication: { stagingHosts: ["staging-worker.example.dev"] },
    });
    expect(legacy.staging).toMatchObject({ status: "configured", url: STG });
    expect(legacy.staging.hosts).toEqual([
      "staging.acme-heating.example.com",
      "staging-worker.example.dev",
    ]);
    expect(environmentsOf({ website: PROD }).staging.status).toBe("unknown");
    expect(
      environmentsOf({ website: PROD, environments: { staging: { status: "not-configured" } } })
        .staging,
    ).toMatchObject({ status: "not-configured", url: null });
  });

  it("finds staging, preview and localhost URLs leaking into production output", () => {
    const html = `<a href="${STG}/pricing">Pricing</a>
      <script type="application/ld+json">{"@id":"https://pr-3.previews.example.net/#org","logo":"http://localhost:3000/logo.png"}</script>
      <a href="${PROD}/contact">Contact</a> built on staging.acme-heating.example.com`;
    const leaks = findEnvironmentLeaks(html, cfg);
    expect(leaks.map((l) => l.environment).sort()).toEqual([ENV.LOCAL, ENV.PREVIEW, ENV.STAGING]);
    expect(findEnvironmentLeaks(`<a href="${PROD}/contact">Contact</a>`, cfg)).toEqual([]);
  });

  it("rates staging protection: noindex or sign-in is strong, robots.txt alone is weak", () => {
    expect(robotsBlocksAll("User-agent: *\nDisallow: /\n")).toBe(true);
    expect(robotsBlocksAll("User-agent: *\nDisallow: /admin\n")).toBe(false);
    expect(indexProtection({ status: 200, robots: noindexHeader }, { blocksAll: true }).level).toBe(
      "strong",
    );
    expect(indexProtection({ status: 401 }, null).level).toBe("strong");
    expect(indexProtection({ status: 200, robots: indexable }, { blocksAll: true }).level).toBe(
      "weak",
    );
    expect(indexProtection({ status: 200, robots: indexable }, { blocksAll: false }).level).toBe(
      "none",
    );
  });
});

describe("state machine — environments (staging and production)", () => {
  it("LOCAL PAGE → no indexing actions, and QA leads to staging", () => {
    const state = run(
      stagedEv({
        pages: [home, building()],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": notThere } },
      }),
    );
    expect(state.recommendation.kind).toBe("qa");
    expect(state.recommendation.next).toMatch(/staging/);
    expect(state.environment.current).toBe(ENV.LOCAL);
    expect(envLine(state, "indexing").value).toMatch(/^Not applicable — the page is local only/);
    noIndexingAction(state);
  });

  it("QA PASSED LOCALLY → recommends the staging deploy, not production", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass() })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": notThere } },
      }),
    );
    expect(state.recommendation).toMatchObject({
      kind: "deploy-staging",
      approval: "staging-deploy",
      command: "npm run deploy:staging",
    });
    expect(row(state, "stagingDeploy")).toMatchObject({ status: S.READY, next: true });
    expect(row(state, "deployment").status).toBe(S.WAITING);
    expect(state.actions.map((a) => a.kind)).not.toContain("approve-deploy");
    noIndexingAction(state);
  });

  it("STAGING DEPLOYED → staging review, with indexing actions disabled on staging", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass() })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(state.recommendation).toMatchObject({
      kind: "staging-review",
      command: "/BWESEOQA ac-repair staging",
      stagingUrl: `${STG}/ac-repair`,
    });
    expect(state.recommendation.why).toMatch(/SEARCH ENGINE INDEXING ACTIONS: DISABLED/);
    expect(state.environment.current).toBe(ENV.STAGING);
    expect(row(state, "stagingDeploy").status).toBe(S.COMPLETE);
    expect(row(state, "indexingRequest").detail).toBe("disabled on staging");
    const dash = formatDashboard(state);
    expect(dash).toMatch(/Environment \.+ STAGING — AC Repair is on staging, not on production/);
    expect(dash).toMatch(/Production domain \.+ acme-heating\.example\.com — ✓ indexable/);
    expect(dash).toMatch(/Staging domain \.+ staging\.acme-heating\.example\.com — ✓ hidden/);
    expect(dash).toMatch(/Indexing actions \.+ DISABLED on staging/);
    noIndexingAction(state);
  });

  it("STAGING NOINDEX is the intended setup — no finding", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass() })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(state.environment.staging.protection.level).toBe("strong");
    expect(state.conflicts).toEqual([]);
    expect(state.actions.map((a) => a.kind)).not.toContain("strengthen-staging");
    expect(state.actions.map((a) => a.kind)).not.toContain("staging-exposed");
  });

  it("staging with robots.txt only, or nothing at all, is flagged", () => {
    const pages = [home, building({ qa: qaPass() })];
    const weak = run(
      stagedEv({
        pages,
        live: { staging: { "ac-repair": onSite }, stagingHome: { status: 200, robots: indexable } },
      }),
    );
    expect(weak.actions.map((a) => a.kind)).toContain("strengthen-staging");
    const exposed = run(
      stagedEv({
        pages,
        live: {
          staging: { "ac-repair": onSite },
          stagingHome: { status: 200, robots: indexable },
          stagingRobots: { status: 200, blocksAll: false },
        },
      }),
    );
    expect(exposed.actions.map((a) => a.kind)).toContain("staging-exposed");
    expect(exposed.conflicts.join("\n")).toMatch(/not hidden from search engines/);
  });

  it("STAGING REVIEW FAILED → fix the problems, not deploy", () => {
    const state = run(
      stagedEv({
        pages: [
          home,
          building({ qa: qaPass(), staging: { review: { ...reviewPass, result: "fail" } } }),
        ],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(state.recommendation).toMatchObject({ kind: "staging-fix", skill: "BWESEOQA" });
    expect(row(state, "stagingReview").status).toBe(S.BLOCKED);
  });

  it("STAGING QA PASSED / NO HUMAN APPROVAL → stops at the owner's staging approval", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass(), staging: { review: reviewPass } })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(state.recommendation).toMatchObject({
      kind: "approve-staging",
      actor: "user",
      approval: "staging",
      stepsTitle: "WHAT TO CHECK ON STAGING",
    });
    expect(state.recommendation.headline).toMatch(/^STAGING REVIEW PASSED/);
    expect(state.recommendation.what).toContain(`${STG}/ac-repair`);
    expect(state.recommendation.next).toMatch(/PRODUCTION DEPLOYMENT REQUIRES YOUR APPROVAL/);
    expect(row(state, "stagingApproval").status).toBe(S.NEEDS_APPROVAL);
    expect(row(state, "deployment").status).toBe(S.WAITING);
    expect(state.actions.map((a) => a.kind)).not.toContain("approve-deploy");
    noIndexingAction(state);
  });

  it("STAGING APPROVED / PRODUCTION NOT DEPLOYED → recommends production deployment, not indexing", () => {
    const state = run(
      stagedEv({
        pages: [
          home,
          building({ qa: qaPass(), staging: { review: reviewPass, approval: approvalOk } }),
        ],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(state.recommendation).toMatchObject({
      kind: "approve-deploy",
      actor: "user",
      approval: "deploy",
    });
    expect(state.recommendation.why).toMatch(/You approved it on staging on 2026-10-07/);
    expect(state.recommendation.why).toMatch(/production is indexable now/);
    expect(state.recommendation.next).toMatch(/npm run release/);
    expect(state.recommendation.next).toMatch(/staging checks don't count for production/);
    expect(row(state, "deployment").status).toBe(S.NEEDS_APPROVAL);
    noIndexingAction(state);
  });

  it("a production-only hold lets the page through staging but never to production", () => {
    const hold = { since: "2026-10-01", scope: "deploy", source: "owner:2026-10-01 chat" };
    const toStaging = rec(
      stagedEv({
        pages: [home, building({ qa: qaPass(), hold })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": notThere } },
      }),
    );
    expect(toStaging.kind).toBe("deploy-staging");
    const held = run(
      stagedEv({
        pages: [
          home,
          building({ qa: qaPass(), hold, staging: { review: reviewPass, approval: approvalOk } }),
        ],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(held.actions.map((a) => a.kind)).not.toContain("approve-deploy");
    expect(row(held, "deployment").status).toBe(S.ON_HOLD);
  });

  it("PRODUCTION DEPLOYED / POST-PUBLICATION NOT RUN → recommends /BWESEOPublish", () => {
    const state = run(
      stagedEv({
        pages: [
          home,
          building({ qa: qaPass(), staging: { review: reviewPass, approval: approvalOk } }),
        ],
        live: {
          prod: { "ac-repair": { ...onSite, finalUrl: `${PROD}/ac-repair` } },
          staging: { "ac-repair": onSite },
        },
      }),
    );
    expect(state.recommendation).toMatchObject({
      kind: "publish-check",
      command: "/BWESEOPublish ac-repair",
    });
    expect(state.environment.current).toBe(ENV.PRODUCTION);
    expect(envLine(state, "indexing").value).toBe("Production URLs only");
  });

  it("STAGING 200 / PRODUCTION 404 → production not deployed, even when the records say published", () => {
    const state = run(
      stagedEv({
        pages: [home, livePage()],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(state.recommendation.kind).toBe("conflict-not-live");
    expect(state.recommendation.headline).toMatch(/PRODUCTION PAGE MISSING/);
    expect(state.conflicts.join("\n")).toMatch(/PRODUCTION PAGE MISSING/);
    expect(state.conflicts.join("\n")).toMatch(/recorded lifecycle unchanged/);
    expect(state.recommendation.skill).toBe("BWESEOTechnical");
    expect(row(state, "deployment").status).toBe(S.COMPLETE);
    expect(state.environment.current).toBe(ENV.PRODUCTION);
  });

  it("PRODUCTION NOINDEX → a critical error before any page work", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass() })],
        live: {
          prod: { "ac-repair": notThere },
          staging: { "ac-repair": onSite },
          prodHome: { status: 200, robots: { header: null, meta: ["noindex"], noindex: true } },
        },
      }),
    );
    expect(state.recommendation.kind).toBe("production-not-indexable");
    expect(state.conflicts.join("\n")).toMatch(/CRITICAL SEO ERROR — production is not indexable/);
    expect(envLine(state, "production")).toMatchObject({ tone: "error" });
    expect(envLine(state, "production").value).toMatch(/NOT INDEXABLE/);
  });

  it("a production robots.txt that blocks everything is critical too", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass() })],
        live: { staging: { "ac-repair": onSite }, prodRobots: { status: 200, blocksAll: true } },
      }),
    );
    expect(state.recommendation.kind).toBe("production-not-indexable");
  });

  it("a project WITHOUT staging goes from QA to the production approval, and says so", () => {
    const state = run({
      ...evidence({
        cfg: stagedConfig({ status: "not-configured" }),
        pages: [home, building({ qa: qaPass() })],
        docs: planned,
        sources: SRC,
      }),
      live: { ...envLive({ prod: { "ac-repair": notThere } }), staging: { checked: false } },
    });
    expect(state.recommendation.kind).toBe("approve-deploy");
    expect(state.recommendation.why).toMatch(/no staging site/);
    expect(envLine(state, "staging").value).toMatch(/^NOT CONFIGURED/);
    const keys = state.pages.find((p) => p.id === "ac-repair").rows.map((r) => r.key);
    expect(keys).not.toContain("stagingDeploy");
  });
});

describe("pipeline line", () => {
  it("shows the current page as Created ✓ → QA ✓ → Staging ✓ → …, with holds and the next step", () => {
    const state = run(
      stagedEv({
        pages: [
          home,
          building({
            qa: qaPass(),
            hold: { since: "2026-10-01", scope: "deploy", source: "owner:2026-10-01 chat" },
            staging: { review: reviewPass, approval: approvalOk },
          }),
        ],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    expect(formatPipeline(pipelineSummary(state))).toBe(
      [
        "Created ✓ → QA ✓ → Staging ✓ → Staging review ✓ → Human approval ✓",
        "Production ⏸",
        "Post-publication check … → Google readiness … → Sitemap included … → Search Console setup … → Sitemap registered … → Google discovered … → Google crawled … → Google indexed … → Monitoring …",
      ].join("\n"),
    );
    expect(pipelineLines(pipelineSummary(state)).map((l) => l.tone)).toEqual([
      "done",
      "hold",
      "rest",
    ]);
    expect(formatDashboard(state)).toContain("  Created ✓ → QA ✓ → Staging ✓");
    // Colour is opt-in: green for done, yellow for on hold.
    const coloured = formatPipeline(pipelineSummary(state), { color: true }).split("\n");
    expect(coloured[0].startsWith("\u001b[32m")).toBe(true);
    expect(coloured[1].startsWith("\u001b[33m")).toBe(true);
    expect(coloured[2]).not.toContain("\u001b");
  });

  it("marks the next step, and a project without staging has no staging steps", () => {
    const state = run({
      ...evidence({
        cfg: stagedConfig({ status: "not-configured" }),
        pages: [home, building({ qa: qaPass() })],
        docs: planned,
        sources: SRC,
      }),
      live: { ...envLive({ prod: { "ac-repair": notThere } }), staging: { checked: false } },
    });
    expect(formatPipeline(pipelineSummary(state))).toBe(
      "Created ✓ → QA ✓\nProduction ▸ → Post-publication check … → Google readiness … → Sitemap included … → Search Console setup … → Sitemap registered … → Google discovered … → Google crawled … → Google indexed … → Monitoring …",
    );
  });
});

describe("collectEvidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-state-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel, text) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };

  it("a folder with no seo/ is a new project: BWESEO is not installed", async () => {
    const ev = await collectEvidence(dir, { live: false, today: TODAY });
    expect(ev.config).toBeNull();
    expect(ev.install.receipt).toBeNull();
    expect(evaluateState(ev, { today: TODAY }).recommendation.kind).toBe("install");
  });

  it("an installation receipt moves a new project to setup; its integrity is checked against the files", async () => {
    const { createHash } = await import("node:crypto");
    write("seo/tools/seo-state-core.mjs", "// engine\n");
    const sha = createHash("sha256").update("// engine\n").digest("hex");
    write("seo/bweseo-install.json", JSON.stringify({ engineVersion: "1.7.0", schemaVersion: 1, manifestVersion: 1, installationMode: "install", adapter: null, files: { "seo/tools/seo-state-core.mjs": { sha256: sha } } }));
    let ev = await collectEvidence(dir, { live: false, today: TODAY });
    expect(ev.install.integrity).toBe("verified");
    expect(ev.install.receipt).not.toHaveProperty("files"); // hashes never enter the state / the card snapshot
    expect(evaluateState(ev, { today: TODAY }).recommendation).toMatchObject({ kind: "setup", installed: true });
    write("seo/tools/seo-state-core.mjs", "// edited by hand\n");
    ev = await collectEvidence(dir, { live: false, today: TODAY });
    expect(ev.install.integrity).toBe("modified");
    rmSync(join(dir, "seo/tools/seo-state-core.mjs"));
    ev = await collectEvidence(dir, { live: false, today: TODAY });
    expect(ev.install.integrity).toBe("missing");
    rmSync(join(dir, "seo/bweseo-install.json"));
  });

  it("reads docs, exports, source fingerprints and the live site", async () => {
    write("seo/seo-config.json", JSON.stringify(config({ repo: { rootFolderName: "whatever" } })));
    write("seo/business-profile.json", JSON.stringify(profile()));
    const pages = [
      home,
      approved({ status: "review", source: "src/ac-repair.html + src/shared.js" }),
    ];
    write(
      "seo/content-inventory.json",
      JSON.stringify({ schemaVersion: 1, projectId: "acme-heating", pages }),
    );
    write(
      "docs/seo/SEO-BASELINE.md",
      `# Baseline\nLast updated: 2026-10-01 · Engine 1.2.0\n\n${"Real findings. ".repeat(30)}`,
    );
    write("docs/seo/CONTENT-ROADMAP.md", "# Roadmap\nLast updated: 2026-10-02\n\n## P1\n\n## P2\n");
    write("seo/data/search-console/2026-10-20/queries.csv", "query,clicks\n");
    write("src/ac-repair.html", "<h1>Air conditioning repair</h1>\r\n<p>Hi</p>\r\n");
    write("src/shared.js", "export const x = 1;\n");
    utimesSync(
      join(dir, "src/ac-repair.html"),
      new Date("2026-10-04T12:00:00"),
      new Date("2026-10-04T12:00:00"),
    );
    utimesSync(
      join(dir, "src/shared.js"),
      new Date("2026-10-03T12:00:00"),
      new Date("2026-10-03T12:00:00"),
    );
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      const ok = url.endsWith("/ac-repair");
      return {
        status: ok ? 200 : 404,
        url,
        text: async () => (ok ? "<main><h1>Air conditioning   repair</h1></main>" : ""),
        body: { cancel: async () => {} },
      };
    };
    const ev = await collectEvidence(dir, { fetchImpl, today: TODAY });
    expect(ev.docs.baseline).toMatchObject({
      exists: true,
      updated: "2026-10-01",
      hasContent: true,
    });
    expect(ev.docs.roadmap).toMatchObject({ exists: true, hasContent: false }); // an empty shell
    expect(ev.searchConsoleExports).toEqual(["2026-10-20"]);
    expect(ev.sources["ac-repair"]).toMatchObject({
      files: ["src/ac-repair.html", "src/shared.js"],
      missing: [],
      modifiedOn: "2026-10-04",
    });
    expect(ev.sources["ac-repair"].hash).toMatch(/^[0-9a-f]{16}$/);
    expect(seen).toContain("https://acme-heating.example.com/ac-repair");
    expect(ev.live.pages["ac-repair"]).toMatchObject({
      status: 200,
      hasVerifyText: true,
      redirected: false,
    });
    expect(ev.live.pages.home).toMatchObject({ status: 404 });
  });

  it("source hashes ignore line endings but change with content", () => {
    write("a/lf.html", "<p>one</p>\n");
    const lf = sourceState(join(dir, "a"), "lf.html").hash;
    write("a/lf.html", "<p>one</p>\r\n");
    expect(sourceState(join(dir, "a"), "lf.html").hash).toBe(lf);
    write("a/lf.html", "<p>two</p>\n");
    expect(sourceState(join(dir, "a"), "lf.html").hash).not.toBe(lf);
  });

  it("finds file paths in free-text source notes", () => {
    expect(
      sourceFiles(
        "src/routes/a.tsx → src/lib/b.ts:211-324 + code default in x.functions.ts (no DB override)",
      ),
    ).toEqual(["src/routes/a.tsx", "src/lib/b.ts", "x.functions.ts"]);
    expect(sourceFiles("src/routes/sitemap[.]xml.ts")).toEqual(["src/routes/sitemap[.]xml.ts"]);
  });
});

// ---------------------------------------------------------------- Google lifecycle (engine 1.4.0)
// Search Console setup → Live URL test → Indexing requested → Sitemap verified → Indexed by Google
// → Monitoring. Each is a separate recorded fact; none implies the next.
describe("Google lifecycle — Search Console steps", () => {
  const SITE_OK = {
    requestIndexing: "recommended", // the manual accelerators are opt-in; see "optional accelerator" tests below
    configured: "yes",
    propertyType: "Domain",
    verifiedProperty: "acme-heating.example.com",
    verificationMethod: "DNS",
    verifiedOn: "2026-10-01",
    sitemap: { submitted: "yes", status: "Success", verifiedOn: "2026-10-01", discoveredPages: 15 },
  };
  const cfgWith = (site) => {
    const c = config();
    c.analytics = { searchConsole: { access: "manual-export", ...site } };
    return c;
  };
  const pageWith = (searchConsole) =>
    livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { indexingRequest: "NOT REQUESTED", ...searchConsole },
      },
    });
  const requested = {
    indexingRequest: "REQUESTED",
    requestedOn: "2026-10-30",
    requestSource: "owner:2026-10-30 chat",
  };
  const passed = { liveUrlTest: { result: "passed", testedOn: "2026-10-30" } };
  const go = (site, sc) =>
    run(evidence({ cfg: cfgWith(site), pages: [home, pageWith(sc)], docs: planned }));
  const kinds = (state) => state.actions.map((a) => a.kind);
  const GOOGLE_KINDS = [
    "setup-search-console",
    "live-url-test",
    "fix-live-url-test",
    "request-indexing",
    "verify-sitemap",
    "verify-indexing",
  ];

  it("Search Console not configured → recommends setup, owned by the site's own Google account", () => {
    const state = go({ configured: "no" }, {});
    expect(state.recommendation).toMatchObject({
      kind: "setup-search-console",
      actor: "user",
      manual: true,
    });
    const text = state.recommendation.steps.join("\n");
    expect(text).toMatch(/owns this website/);
    expect(text).toMatch(/Never paste the verification code/);
    expect(row(state, "scSetup").status).toBe(S.NEEDS_MANUAL_ACTION);
  });

  it("Search Console unrecorded → asks the owner to confirm rather than assuming", () => {
    const state = go({}, {});
    expect(state.recommendation).toMatchObject({ kind: "setup-search-console", unknown: true });
    expect(state.recommendation.headline).toMatch(/Confirm whether/);
  });

  it("configured but no Live URL Test → URL Inspection → Test Live URL steps with the exact URL", () => {
    const state = go(SITE_OK, {});
    expect(state.recommendation).toMatchObject({ kind: "live-url-test", manual: true });
    const text = state.recommendation.steps.join("\n");
    expect(text).toContain("https://acme-heating.example.com/ac-repair");
    expect(text).toMatch(/Test Live URL/);
    expect(row(state, "scSetup").status).toBe(S.COMPLETE);
    expect(row(state, "liveUrlTest").status).toBe(S.NEEDS_MANUAL_ACTION);
  });

  it("a failed Live URL Test is blocked — fix and retest, never request indexing", () => {
    const state = go(SITE_OK, { liveUrlTest: { result: "failed", testedOn: "2026-10-30" } });
    expect(state.recommendation.kind).toBe("fix-live-url-test");
    expect(kinds(state)).not.toContain("request-indexing");
    expect(row(state, "liveUrlTest").status).toBe(S.BLOCKED);
  });

  it("Live URL Test passed, indexing not requested → tells the owner to click Request Indexing", () => {
    const state = go(SITE_OK, passed);
    expect(state.recommendation).toMatchObject({ kind: "request-indexing", manual: true });
    expect(state.recommendation.steps.join("\n")).toMatch(/Request Indexing/);
    expect(row(state, "liveUrlTest").status).toBe(S.COMPLETE);
  });

  it("a failed indexing request is retried", () => {
    const state = go(SITE_OK, { ...passed, indexingRequest: "REQUEST FAILED" });
    expect(state.recommendation).toMatchObject({ kind: "request-indexing", retry: true });
    expect(row(state, "indexingRequest").status).toBe(S.BLOCKED);
  });

  it("requested but the sitemap isn't verified → tells the owner to verify the sitemap", () => {
    const state = go({ ...SITE_OK, sitemap: { submitted: "unknown" } }, { ...passed, ...requested });
    expect(state.recommendation).toMatchObject({ kind: "verify-sitemap", manual: true });
    expect(state.recommendation.steps.join("\n")).toMatch(/Sitemaps/);
    expect(row(state, "sitemap").status).toBe(S.NEEDS_MANUAL_ACTION);
  });

  it("the legacy sitemapSubmission flag still counts as a verified sitemap", () => {
    const site = { ...SITE_OK, sitemap: undefined, sitemapSubmission: "verified" };
    const state = go(site, { ...passed, ...requested });
    expect(row(state, "sitemap").status).toBe(S.COMPLETE);
  });

  it("all Google steps done but indexing unverified → waiting for Google; nothing is re-requested", () => {
    const state = go(SITE_OK, { ...passed, ...requested });
    expect(state.recommendation).toMatchObject({ kind: "wait", awaitingIndexing: true });
    expect(state.recommendation.headline).toMatch(/Waiting for Google/);
    expect(state.recommendation.headline).toMatch(/not yet verified as indexed/);
    expect(kinds(state).filter((k) => GOOGLE_KINDS.includes(k))).toEqual([]);
    expect(row(state, "indexed").status).toBe(S.WAITING_FOR_DATA);
    expect(row(state, "monitoring").status).toBe(S.WAITING);
  });

  it("INDEXING REQUESTED ≠ INDEXED, LIVE URL TEST PASSED ≠ INDEXED, SITEMAP SUCCESS ≠ INDEXED", () => {
    for (const sc of [requested, passed, { ...passed, ...requested }]) {
      const state = go(SITE_OK, sc);
      expect(row(state, "indexed").status).not.toBe(S.COMPLETE);
      expect(row(state, "monitoring").status).not.toBe(S.COMPLETE);
    }
    // a sitemap that says Success, on its own
    const state = go(SITE_OK, {});
    expect(row(state, "sitemap").status).toBe(S.COMPLETE);
    expect(row(state, "indexed").status).not.toBe(S.COMPLETE);
    // an "indexed" record with no evidence does not count
    const bare = go(SITE_OK, { ...passed, ...requested, indexed: { status: "INDEXED" } });
    expect(row(bare, "indexed").status).not.toBe(S.COMPLETE);
  });

  it("indexed with evidence → Indexed by Google is complete and the page moves into monitoring", () => {
    const state = go(SITE_OK, {
      ...passed,
      ...requested,
      indexed: {
        status: "INDEXED",
        verifiedOn: "2026-11-01",
        evidence: "URL Inspection: URL is on Google",
        source: "owner:2026-11-01 chat",
      },
    });
    expect(row(state, "indexed").status).toBe(S.COMPLETE);
    expect(row(state, "monitoring").status).toBe(S.WAITING_FOR_DATA);
    expect(state.recommendation).toMatchObject({
      kind: "wait",
      headline: "No SEO change is needed right now.",
    });
  });

  it("a due review while unindexed asks the owner to check URL Inspection — once, not repeatedly", () => {
    const sc = { ...passed, ...requested };
    const monitoring = { review7: "2026-11-01", review30: "2026-11-29", review90: "2027-01-28" };
    const due = livePage({
      postPublication: { ...livePage().postPublication, searchConsole: sc, monitoring },
    });
    const state = run(evidence({ cfg: cfgWith(SITE_OK), pages: [home, due], docs: planned }));
    expect(state.recommendation).toMatchObject({ kind: "verify-indexing", manual: true });
    // the owner reports "not indexed yet" → recorded as checked; the same review isn't asked again
    const checked = livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { ...sc, indexed: { status: "NOT VERIFIED", lastCheckedOn: "2026-11-02" } },
        monitoring,
      },
    });
    const after = run(evidence({ cfg: cfgWith(SITE_OK), pages: [home, checked], docs: planned }));
    expect(after.recommendation.kind).toBe("wait");
    expect(after.recommendation.date).toBe("2026-11-29");
  });

  it("completed manual steps are never requested again", () => {
    const state = go(SITE_OK, { ...passed, ...requested });
    expect(kinds(state).filter((k) => GOOGLE_KINDS.includes(k))).toEqual([]);
  });

  it("an owner's decision not to request indexing is respected", () => {
    const state = go(SITE_OK, {
      indexingRequest: "NOT REQUESTED",
      requestSource: "owner:2026-10-31 chat — declined",
    });
    expect(kinds(state)).not.toContain("request-indexing");
    expect(kinds(state)).not.toContain("live-url-test");
    expect(row(state, "indexingRequest").status).toBe(S.NOT_APPLICABLE);
    expect(row(state, "indexingRequest").detail).toMatch(/your decision/);
  });

  it("site-level state is reused across pages — setup and sitemap are recorded once", () => {
    const second = livePage({
      id: "heat-pump",
      url: "/heat-pump",
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { ...passed, ...requested },
      },
    });
    const state = run(
      evidence({
        cfg: cfgWith(SITE_OK),
        pages: [home, pageWith({ ...passed, ...requested }), second],
        docs: planned,
      }),
    );
    const withRows = state.pages.filter((x) => x.rows?.some((r) => r.key === "scSetup"));
    expect(withRows.length).toBeGreaterThan(0);
    for (const p of withRows) {
      expect(p.rows.find((r) => r.key === "scSetup").status).toBe(S.COMPLETE);
      expect(p.rows.find((r) => r.key === "sitemap").status).toBe(S.COMPLETE);
    }
    expect(searchConsoleSite(cfgWith(SITE_OK))).toMatchObject({
      configured: "yes",
      propertyType: "Domain",
      sitemap: { verified: true, discoveredPages: 15 },
    });
  });

  it("a site without a sitemap marks the Sitemap step not applicable", () => {
    const c = cfgWith(SITE_OK);
    c.publication = { ...c.publication, usesSitemap: false };
    const state = run(
      evidence({ cfg: c, pages: [home, pageWith({ ...passed, ...requested })], docs: planned }),
    );
    expect(row(state, "sitemap").status).toBe(S.NOT_APPLICABLE);
    expect(kinds(state)).not.toContain("verify-sitemap");
  });

  it("the pipeline shows every Google step by name", () => {
    const line = formatPipeline(pipelineSummary(go(SITE_OK, { ...passed, ...requested })));
    expect(line).toContain(
      "Google readiness ✓ → Sitemap included ✓ → Search Console setup ✓ → Sitemap registered ✓",
    );
    expect(line).toContain("Google discovered … → Google crawled … → Google indexed … → Monitoring …");
  });

  it("staging never triggers a Search Console step", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass(), staging: { deployedOn: "2026-10-06" } })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    for (const k of ["scSetup", "liveUrlTest", "indexingRequest", "sitemap", "indexed"])
      expect(row(state, k).status).toBe(S.WAITING);
    expect(row(state, "liveUrlTest").detail).toBe("disabled on staging");
    expect(kinds(state).filter((k) => GOOGLE_KINDS.includes(k))).toEqual([]);
  });

  it("Search Console steps only apply once the page is verified live on production", () => {
    const unverified = livePage({
      postPublication: { checkedOn: "2026-10-30", result: "action-required", searchConsole: {} },
    });
    const state = run(
      evidence({ cfg: cfgWith({ configured: "no" }), pages: [home, unverified], docs: planned }),
    );
    expect(kinds(state)).not.toContain("setup-search-console");
    expect(row(state, "scSetup").status).toBe(S.WAITING);
  });

});

// ---------------------------------------------------------------- lifecycle vs live health (engine 1.5.0)
// LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT. A failed availability check (5xx, Cloudflare
// 52x, timeout, DNS, network) never reverses a completed lifecycle milestone; it only changes the
// separate health model. 404/410 is an investigation, still without erasing history. Only a verified
// `production.reversal` (a deliberate rollback / removal) changes the recorded production milestone.
describe("lifecycle and live health are independent", () => {
  const ORIGIN = "https://acme-heating.example.com";
  const fakeFetch =
    (routes, calls = []) =>
    async (url) => {
      const u = new URL(url);
      calls.push(u.pathname);
      const r = routes[u.pathname] ?? routes["*"] ?? 200;
      if (r instanceof Error) throw r;
      if (typeof r === "function") return r(url);
      return new Response(
        u.pathname === "/robots.txt" ? "User-agent: *\nAllow: /" : "<html>ok</html>",
        { status: r },
      );
    };
  const timeout = () =>
    Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const SC_DONE = {
    indexingRequest: "REQUESTED",
    requestedOn: "2026-10-30",
    requestSource: "owner:2026-10-30 chat",
    liveUrlTest: { result: "passed", testedOn: "2026-10-30", availableToGoogle: true, canBeIndexed: true },
  };
  const finished = (over = {}) =>
    livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { ...SC_DONE, indexed: { status: "NOT VERIFIED" } },
      },
      ...over,
    });
  const scenario = async (routes, { calls = [], history, page = finished(), pages } = {}) => {
    const ev = evidence({ pages: pages ?? [home, page], docs: planned });
    ev.healthHistory = history ?? null;
    ev.live = await probeLive(ev.config, ev.inventory, {
      fetchImpl: fakeFetch(routes, calls),
      retryDelayMs: 0,
    });
    return { state: evaluateState(ev, { today: TODAY }), live: ev.live, calls, ev };
  };
  // Everything the lifecycle records as done, as a snapshot we can compare across health outcomes.
  const lifecycleOf = (state) =>
    state.pages
      .find((p) => p.id === "ac-repair")
      .lifecycle.map((m) => `${m.key}:${m.completed}:${m.completedAt}`);
  const DONE_KEYS = ["deployment", "postPublication", "scSetup", "liveUrlTest", "indexingRequest", "sitemap"];
  const conflictTexts = (state) => state.conflicts.join("\n");
  const kinds = (state) => state.actions.map((a) => a.kind);

  it("classifies probe results and health categories", () => {
    expect(classifyProbe({ status: 200 })).toBe("ok");
    expect(classifyProbe({ status: 200, redirected: true })).toBe("redirected");
    for (const status of [404, 410]) expect(classifyProbe({ status })).toBe("missing");
    for (const status of [500, 502, 503, 504, 522, 524, 429, 403, 401])
      expect(classifyProbe({ status })).toBe("unavailable");
    expect(classifyProbe({ error: "timed out" })).toBe("unavailable");
    const cat = (o) => healthCategory(o);
    expect(cat({ status: 200 })).toBe("ok");
    expect(cat({ status: 404 })).toBe("page-missing");
    expect(cat({ status: 410 })).toBe("page-missing");
    expect(cat({ status: 401 })).toBe("access-restricted");
    expect(cat({ status: 403 })).toBe("access-restricted");
    expect(cat({ status: 429 })).toBe("rate-limited");
    for (const c of [500, 502, 503, 504]) expect(cat({ status: c })).toBe("server-error");
    for (const c of [520, 521, 522, 523, 524]) expect(cat({ status: c })).toBe("edge-error");
    expect(cat({ error: "timed out" })).toBe("timeout");
    expect(cat({ error: "getaddrinfo ENOTFOUND x.example.com" })).toBe("dns");
    expect(cat({ error: "connect ECONNREFUSED 1.2.3.4:443" })).toBe("connection");
    expect(cat({ error: "something odd" })).toBe("unknown");
    expect(cat(null)).toBeNull();
  });

  it("HTTP 200 → HEALTHY, with response details recorded; lifecycle as recorded", async () => {
    const { state } = await scenario({ "*": 200 });
    const h = state.liveHealth.production;
    expect(h).toMatchObject({
      status: "HEALTHY",
      severity: "info",
      environment: "production",
      url: ORIGIN,
      httpStatus: 200,
      consecutiveFailures: 0,
      lastSuccessfulHttpStatus: 200,
    });
    expect(h.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof h.responseTimeMs).toBe("number");
    expect(h.lastSuccessfulCheck).toBe(h.checkedAt);
    expect(h.source).toMatch(/BWESEO/);
    expect(state.conflicts).toEqual([]);
  });

  it.each([
    ["522 (Cloudflare-style edge error)", 522, "edge-error"],
    ["503 (service unavailable)", 503, "server-error"],
    ["500", 500, "server-error"],
    ["502", 502, "server-error"],
    ["504", 504, "server-error"],
    ["a timeout", timeout(), "timeout"],
    ["a DNS failure", new Error("getaddrinfo ENOTFOUND acme-heating.example.com"), "dns"],
    ["a refused connection", new Error("connect ECONNREFUSED 203.0.113.1:443"), "connection"],
    ["an unknown checker failure", new Error("something odd"), "unknown"],
  ])("production completed + %s → every milestone stays complete; only HEALTH changes", async (_n, r, errorType) => {
    const baseline = lifecycleOf((await scenario({ "*": 200 })).state);
    const { state } = await scenario({ "*": r });
    expect(state.liveHealth.production).toMatchObject({
      status: "CHECK_FAILED",
      severity: "warning",
      errorType,
      consecutiveFailures: 1,
    });
    expect(state.liveHealth.production.message).toMatch(/health check temporarily unavailable/);
    // the lifecycle is identical to the healthy run
    expect(lifecycleOf(state)).toEqual(baseline);
    for (const k of DONE_KEYS) expect(row(state, k).status).toBe(S.COMPLETE);
    expect(state.environment.current).toBe(ENV.PRODUCTION);
    expect(state.conflicts).toEqual([]);
    expect(state.pages.find((p) => p.id === "ac-repair").summary).not.toMatch(/staging/i);
  });

  it("HTTP 404 → production milestone stays complete, with an investigation warning", async () => {
    const { state } = await scenario({ "/": 200, "/ac-repair": 404 });
    expect(row(state, "deployment").status).toBe(S.COMPLETE);
    expect(row(state, "deployment").detail).toMatch(/production now returns HTTP 404 \(investigate; history kept\)/);
    expect(conflictTexts(state)).toMatch(/PRODUCTION PAGE MISSING/);
    expect(conflictTexts(state)).toMatch(/Production page returned|returns HTTP 404/);
    expect(state.recommendation).toMatchObject({ kind: "conflict-not-live", skill: "BWESEOTechnical" });
    expect(state.environment.current).toBe(ENV.PRODUCTION);
    expect(lifecycleOf(state).find((m) => m.startsWith("deployment"))).toMatch(/:true:2026-10-30/);
  });

  it("Live URL Test, indexing request and sitemap verification survive a health failure", async () => {
    const { state } = await scenario({ "*": 522 });
    expect(row(state, "liveUrlTest").status).toBe(S.COMPLETE);
    expect(row(state, "liveUrlTest").detail).toMatch(/passed 2026-10-30/);
    expect(row(state, "indexingRequest").status).toBe(S.COMPLETE);
    expect(row(state, "indexingRequest").detail).toMatch(/requested 2026-10-30/);
    expect(row(state, "sitemap").status).toBe(S.COMPLETE);
    expect(row(state, "scSetup").status).toBe(S.COMPLETE);
    // and it is still "requested ≠ indexed"
    expect(row(state, "indexed").status).not.toBe(S.COMPLETE);
    expect(kinds(state).filter((k) => ["live-url-test", "request-indexing", "verify-sitemap", "setup-search-console"].includes(k))).toEqual([]);
  });

  it("ONE failed probe causes no lifecycle regression", async () => {
    const healthy = await scenario({ "*": 200 });
    const one = await scenario({ "*": 522 }, { history: null });
    expect(lifecycleOf(one.state)).toEqual(lifecycleOf(healthy.state));
    expect(one.state.liveHealth.production.status).toBe("CHECK_FAILED");
    expect(one.state.liveHealth.production.consecutiveFailures).toBe(1);
  });

  it("repeated failures escalate the HEALTH severity, never the lifecycle", async () => {
    const history = {
      production: {
        consecutiveFailures: 2,
        lastCheck: { status: "CHECK_FAILED", httpStatus: 522, checkedAt: "2026-10-30T11:00:00.000Z" },
        lastSuccess: { checkedAt: "2026-10-30T09:00:00.000Z", httpStatus: 200 },
      },
    };
    const healthy = await scenario({ "*": 200 });
    const { state } = await scenario({ "*": 522 }, { history });
    const h = state.liveHealth.production;
    expect(h).toMatchObject({
      status: "UNAVAILABLE",
      severity: "critical",
      consecutiveFailures: 3,
      lastSuccessfulCheck: "2026-10-30T09:00:00.000Z",
      lastSuccessfulHttpStatus: 200,
    });
    expect(h.message).toMatch(/appears unavailable — investigation recommended/);
    expect(lifecycleOf(state)).toEqual(lifecycleOf(healthy.state));
    for (const k of DONE_KEYS) expect(row(state, k).status).toBe(S.COMPLETE);
    expect(state.environment.current).toBe(ENV.PRODUCTION);
    expect(state.recommendation).toMatchObject({ kind: "investigate-health", repeated: true });
    expect(state.recommendation.headline).toBe("Investigate production availability.");
  });

  it("a recovered check resets the failure count and records the last success", async () => {
    const history = { production: { consecutiveFailures: 2, lastCheck: { status: "CHECK_FAILED", httpStatus: 522, checkedAt: "2026-10-30T11:00:00.000Z" }, lastSuccess: null } };
    const { state } = await scenario({ "*": 200 }, { history });
    expect(state.liveHealth.production).toMatchObject({ status: "HEALTHY", consecutiveFailures: 0, lastSuccessfulHttpStatus: 200 });
    const next = nextHealthHistory(state.liveHealth, history);
    expect(next.production).toMatchObject({ consecutiveFailures: 0, lastSuccess: { httpStatus: 200 } });
  });

  it("nextHealthHistory records only real observations and keeps the last success through failures", async () => {
    const ok = (await scenario({ "*": 200 })).state.liveHealth;
    const h1 = nextHealthHistory(ok, null);
    const bad = (await scenario({ "*": 522 }, { history: h1 })).state.liveHealth;
    const h2 = nextHealthHistory(bad, h1);
    expect(h2.production).toMatchObject({ consecutiveFailures: 1, lastCheck: { status: "CHECK_FAILED", httpStatus: 522 } });
    expect(h2.production.lastSuccess).toEqual(h1.production.lastSuccess);
    expect(nextHealthHistory({ production: { status: "UNKNOWN", checkedAt: null }, staging: { status: "UNKNOWN", checkedAt: null } }, null)).toEqual({ production: null, staging: null });
  });

  it("access-restricted (403) and rate-limited (429) are reported separately and never escalate to UNAVAILABLE", async () => {
    const many = { production: { consecutiveFailures: 9, lastCheck: null, lastSuccess: null } };
    const a = await scenario({ "*": 403 }, { history: many });
    expect(a.state.liveHealth.production).toMatchObject({ status: "CHECK_FAILED", errorType: "access-restricted" });
    expect(a.state.liveHealth.production.message).toMatch(/check restricted — HTTP 403/);
    const b = await scenario({ "*": 429 }, { history: many });
    expect(b.state.liveHealth.production).toMatchObject({ status: "CHECK_FAILED", errorType: "rate-limited" });
    expect(b.state.liveHealth.production.message).toMatch(/rate-limited — HTTP 429/);
  });

  it("staging HEALTHY + production UNAVAILABLE → staging is NOT the active lifecycle environment", async () => {
    const ev = stagedEv({
      pages: [home, finished({ staging: { review: reviewPass, approval: approvalOk } })],
      live: { prod: { "ac-repair": onSite }, staging: { "ac-repair": onSite } },
    });
    ev.live = await probeLive(ev.config, ev.inventory, {
      fetchImpl: async (url) => {
        const u = new URL(url);
        if (u.hostname === "acme-heating.example.com") return new Response("error code: 522", { status: 522 });
        return new Response(u.pathname === "/robots.txt" ? "User-agent: *\nDisallow: /" : "<html>ok</html>", {
          status: 200,
          headers: { "x-robots-tag": "noindex, nofollow" },
        });
      },
      retryDelayMs: 0,
    });
    const state = evaluateState(ev, { today: TODAY });
    expect(state.liveHealth.staging.status).toBe("HEALTHY");
    expect(state.liveHealth.production.status).toBe("CHECK_FAILED");
    expect(state.environment.current).toBe(ENV.PRODUCTION);
    expect(row(state, "deployment").status).toBe(S.COMPLETE);
    expect(conflictTexts(state)).not.toMatch(/on staging|not on production|PRODUCTION NOT VERIFIED/);
    expect(environmentSummary(state).find((l) => l.key === "environment").value).not.toMatch(/^STAGING/);
  });

  it("a health failure recommends investigating health — never a deploy, QA, staging, approval, Search Console or indexing step", async () => {
    const { state } = await scenario({ "*": 522 });
    expect(state.recommendation).toMatchObject({ kind: "investigate-health", skill: "BWESEOTechnical", repeated: false });
    expect(state.recommendation.headline).toBe("Re-check production availability.");
    expect(state.recommendation.why).toMatch(/nothing needs to be redeployed/);
    const repeats = ["publish-check", "qa", "staging-review", "deploy", "approve-staging", "approve-deploy", "conflict-not-live", "setup-search-console", "live-url-test", "request-indexing", "verify-sitemap", "create-page", "continue-page"];
    expect(kinds(state).filter((k) => repeats.includes(k))).toEqual([]);
    expect(state.actions.some((a) => a.skill === "BWESEOPublish")).toBe(false);
    const txt = formatDashboard(state);
    expect(txt).toContain("Live site health");
    expect(txt).toMatch(/health check temporarily unavailable — HTTP 522/);
    expect(txt).not.toMatch(/not on production/i);
  });

  it("with a HEALTHY check the health action is absent", async () => {
    const { state } = await scenario({ "*": 200 });
    expect(kinds(state)).not.toContain("investigate-health");
  });

  it("a verified production reversal is reported as such — the milestone's history is kept, not rewritten", async () => {
    const rolledBack = finished({
      production: {
        reversal: { kind: "rollback", date: "2026-11-01", source: "owner:2026-11-01 chat", evidence: "wrangler rollback to v9.55.0" },
      },
    });
    const { state } = await scenario({ "*": 200 }, { page: rolledBack });
    const dep = row(state, "deployment");
    expect(dep.status).toBe(S.BLOCKED);
    expect(dep.detail).toMatch(/rollback on 2026-11-01 \(verified: owner:2026-11-01 chat\).*live since 2026-10-30/);
    const m = state.pages.find((p) => p.id === "ac-repair").lifecycle.find((x) => x.key === "deployment");
    expect(m).toMatchObject({ completed: true, completedAt: "2026-10-30", reversed: { kind: "rollback", on: "2026-11-01" } });
    expect(state.environment.current).not.toBe(ENV.PRODUCTION);
    expect(state.recommendation).toMatchObject({ kind: "production-reversed", actor: "user" });
    expect(state.recommendation.headline).toMatch(/taken off production \(rollback, verified 2026-11-01\)/);
    // no false "conflict" and no automatic redeploy
    expect(kinds(state)).not.toContain("conflict-not-live");
    expect(state.actions.some((a) => a.skill === "BWESEOPublish")).toBe(false);
  });

  it("a reversal without evidence is invalid — a failed request can never be recorded as one", () => {
    const inv = { pages: [{ id: "x", url: "/x", production: { reversal: { kind: "rollback", date: "2026-11-01" } } }] };
    const r = validateInventory({ schemaVersion: 1, projectId: "p", pages: inv.pages, issues: [] }, { today: TODAY });
    expect(r.errors.join("\n")).toMatch(/production\.reversal needs source and evidence/);
    const bad = validateInventory(
      { schemaVersion: 1, projectId: "p", pages: [{ id: "x", url: "/x", production: { reversal: { kind: "http-522", date: "2026-11-01", source: "s", evidence: "e" } } }], issues: [] },
      { today: TODAY },
    );
    expect(bad.errors.join("\n")).toMatch(/reversal\.kind must be one of rollback, removed, reverted/);
  });

  it("customer isolation: one project's health and lifecycle never leak into another's", async () => {
    const a = await scenario({ "*": 522 });
    const beforeB = lifecycleOf((await scenario({ "*": 200 })).state);
    // project B: different site, evaluated after A failed; module state must not carry over
    const cfgB = config();
    cfgB.projectId = "other-customer";
    cfgB.website = "https://other-customer.example.org";
    cfgB.environments = { production: { url: "https://other-customer.example.org", hosts: ["other-customer.example.org"] }, staging: { status: "not-configured" } };
    const evB = evidence({ cfg: cfgB, pages: [home, finished()], docs: planned });
    evB.live = await probeLive(evB.config, evB.inventory, { fetchImpl: fakeFetch({ "*": 200 }), retryDelayMs: 0 });
    const b = evaluateState(evB, { today: TODAY });
    expect(a.state.liveHealth.production.status).toBe("CHECK_FAILED");
    expect(b.liveHealth.production).toMatchObject({ status: "HEALTHY", url: "https://other-customer.example.org", consecutiveFailures: 0 });
    expect(lifecycleOf(b)).toEqual(beforeB);
    expect(b.recommendation.kind).not.toBe("investigate-health");
    // health history is per-project input: A's history is not visible to B
    const withHistory = evaluateState({ ...evB, healthHistory: null }, { today: TODAY });
    expect(withHistory.liveHealth.production.consecutiveFailures).toBe(0);
  });

  it("circuit breaker: when the home page is unavailable no other page is requested", async () => {
    const calls = [];
    const { live } = await scenario({ "*": 522 }, { calls });
    expect(live.productionHealth).toMatchObject({ status: "unavailable", breaker: true });
    expect(calls).toEqual(["/", "/"]); // initial + one retry, nothing else
    expect(Object.keys(live.pages)).toEqual([]);
  });

  it("retries a transient failure once — a blip that recovers is reported as healthy", async () => {
    let n = 0;
    const flaky = () => (++n === 1 ? new Response("boom", { status: 522 }) : new Response("<html>ok</html>", { status: 200 }));
    const { state } = await scenario({ "/": flaky });
    expect(state.liveHealth.production.status).toBe("HEALTHY");
  });

  it("does not retry a clean 404", async () => {
    const calls = [];
    await scenario({ "/": 200, "/ac-repair": 404 }, { calls });
    expect(calls.filter((p) => p === "/ac-repair")).toHaveLength(1);
  });

  it("pages that fail while the home page is fine keep their recorded status (DEGRADED health)", async () => {
    const { state } = await scenario({ "/": 200, "/ac-repair": 503 });
    expect(state.liveHealth.production.status).toBe("DEGRADED");
    expect(state.liveHealth.production.message).toMatch(/1 of 2 pages could not be checked/);
    expect(row(state, "deployment").status).toBe(S.COMPLETE);
    expect(state.conflicts).toEqual([]);
  });

  it("a redirect is judged by its destination", async () => {
    const moved = (path) => () => {
      const r = new Response("<html>ok</html>", { status: 200 });
      Object.defineProperty(r, "url", { value: `${ORIGIN}${path}` });
      return r;
    };
    expect((await scenario({ "/ac-repair": moved("/ac-repair") })).state.conflicts).toEqual([]);
    const elsewhere = await scenario({ "/ac-repair": moved("/heating") });
    expect(conflictTexts(elsewhere.state)).toMatch(/PRODUCTION PAGE MOVED/);
    expect(row(elsewhere.state, "deployment").status).toBe(S.COMPLETE);
  });

  it("/BWESEOPublish is still recommended when INDEPENDENT evidence says publication is required", async () => {
    const unchecked = livePage({ postPublication: undefined });
    const { state } = await scenario({ "*": 522 }, { page: unchecked });
    expect(kinds(state)).toContain("publish-check");
  });

  it("the state code is read-only and names no business or provider-specific lifecycle rule", () => {
    const code = readFileSync(join(__dirname, "seo-state-core.mjs"), "utf8");
    expect(code).not.toMatch(/writeFile|appendFile|fs\.write/);
    // provider names may appear only as a health DETAIL hint, never in a lifecycle decision
    const codeLines = code.split("\n").filter((l) => !/^\s*\/\//.test(l));
    expect(codeLines.join("\n")).not.toMatch(/cloudflare/i);
  });
});

// ---------------------------------------------------------------- where the health check runs (engine 1.6.0)
// A host that serves the site must not fetch its own zone: on an edge runtime that request does not
// reach the public site (it goes to the zone's origin, bypassing the Worker, and a Worker behind a
// Custom Domain has no origin), so the check can report a false 522. The engine therefore never
// assumes the host running the check can fetch its own site; it picks a strategy from the project's
// own configuration, and a skipped check is "not checked" — never "failed".
describe("health-check strategy — no host fetches its own zone", () => {
  const PROD = "https://acme-heating.example.com";
  const STG = "https://staging.acme-heating.example.com";
  const cfgWith = (health, envs = {}) => {
    const c = config();
    c.environments = {
      production: { url: PROD, hosts: ["acme-heating.example.com"] },
      staging: { status: "configured", url: STG, hosts: ["staging.acme-heating.example.com"] },
      ...(health ? { health } : {}),
      ...envs,
    };
    return c;
  };
  const doneSc = {
    indexingRequest: "REQUESTED",
    requestedOn: "2026-10-30",
    requestSource: "owner:2026-10-30 chat",
    liveUrlTest: { result: "passed", testedOn: "2026-10-30" },
  };
  const published = () =>
    livePage({ postPublication: { ...livePage().postPublication, searchConsole: doneSc } });
  const lifecycle = (state) =>
    state.pages.find((p) => p.id === "ac-repair").lifecycle.map((m) => `${m.key}:${m.completed}`);
  // A model of the platform behaviour: from a host on zone Z, a fetch to any host on zone Z does not
  // reach the public site and comes back as 522; everything else answers normally.
  const edgeRuntime = (zoneOfCaller, calls = []) =>
    async (url, init) => {
      const u = new URL(url);
      calls.push({ url: String(url), headers: init?.headers });
      if (registrableDomain(u.hostname) === registrableDomain(zoneOfCaller))
        return new Response("error code: 522", { status: 522 });
      return new Response("<html>ok</html>", { status: 200 });
    };
  const evalWith = async (cfg, opts) => {
    const ev = evidence({ cfg, pages: [home, published()], docs: planned });
    ev.live = await probeLive(ev.config, ev.inventory, { retryDelayMs: 0, ...opts });
    return { state: evaluateState(ev, { today: TODAY }), live: ev.live };
  };

  it("defaults to the browser strategy and validates the configuration", () => {
    expect(healthConfig(config())).toEqual({ strategy: "browser", endpoint: "/" });
    expect(healthConfig({ environments: { health: { strategy: "server", endpoint: "/healthz" } } })).toEqual({
      strategy: "server",
      endpoint: "/healthz",
    });
    expect(healthConfig({ environments: { health: { strategy: "nonsense", endpoint: "no-slash" } } })).toEqual({
      strategy: "browser",
      endpoint: "/",
    });
    expect(HEALTH_STRATEGIES).toEqual(["browser", "server", "off"]);
  });

  it("selfFetchRisk: same host, own configured hosts and the same registrable domain are risky; others are not", () => {
    const c = cfgWith();
    expect(selfFetchRisk(PROD, "acme-heating.example.com", c)).toBe(true);
    expect(selfFetchRisk(STG, "acme-heating.example.com", c)).toBe(true); // same zone, another host
    expect(selfFetchRisk(PROD, "staging.acme-heating.example.com:8787", c)).toBe(true);
    expect(selfFetchRisk("https://other-customer.example.org", "acme-heating.example.com", c)).toBe(false);
    expect(selfFetchRisk(PROD, "elsewhere.example.net", c)).toBe(false);
    expect(selfFetchRisk(PROD, "", c)).toBe(false);
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("www.example.com")).toBe("example.com");
  });

  it("REPRODUCES the suspected self-fetch: from the site's own zone every probe is a false 522", async () => {
    const calls = [];
    const { state, live } = await evalWith(cfgWith({ strategy: "server" }), {
      fetchImpl: edgeRuntime("acme-heating.example.com", calls), // no guard: what the old card did
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(live.checked).toBe(false);
    expect(state.liveHealth.production).toMatchObject({ status: "CHECK_FAILED", httpStatus: 522 });
    // …and even then the lifecycle is untouched (the previous hardening)
    expect(lifecycle(state)).toContain("deployment:true");
    expect(state.conflicts).toEqual([]);
  });

  it("with servingHost set, a same-zone target is never fetched — 'not checked', not 'failed'", async () => {
    const calls = [];
    const baseline = lifecycle((await evalWith(cfgWith({ strategy: "server" }), { fetchImpl: edgeRuntime("elsewhere.example.net") })).state);
    const { state, live } = await evalWith(cfgWith({ strategy: "server" }), {
      fetchImpl: edgeRuntime("acme-heating.example.com", calls),
      servingHost: "acme-heating.example.com",
    });
    expect(calls).toEqual([]); // nothing was sent
    expect(live).toMatchObject({ checked: false, skipped: true });
    expect(live.staging).toMatchObject({ checked: false, skipped: true });
    const h = state.liveHealth.production;
    expect(h.status).toBe("UNKNOWN");
    expect(h.consecutiveFailures).toBe(0);
    expect(h.message).toMatch(/share a zone.*false 522/);
    expect(state.liveHealth.staging.status).toBe("UNKNOWN");
    expect(state.conflicts).toEqual([]);
    expect(lifecycle(state)).toEqual(baseline);
    expect(state.actions.map((a) => a.kind)).not.toContain("investigate-health");
    expect(state.environment.current).toBe(ENV.PRODUCTION);
  });

  it("with servingHost on ANOTHER zone the check proceeds normally", async () => {
    const calls = [];
    const { state } = await evalWith(cfgWith({ strategy: "server" }), {
      fetchImpl: edgeRuntime("elsewhere.example.net", calls),
      servingHost: "elsewhere.example.net",
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(state.liveHealth.production.status).toBe("HEALTHY");
  });

  it("browser mode: only the browser's own origin is probed, with plain requests; the rest is 'not checked'", async () => {
    const calls = [];
    const { state, live } = await evalWith(cfgWith({ strategy: "browser" }), {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response("<html>ok</html>", { status: 200 });
      },
      browser: { readableOrigin: PROD },
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url.startsWith(PROD)).toBe(true); // never staging (cross-origin)
      expect(c.init?.headers).toBeUndefined(); // no custom headers → no CORS preflight, no forbidden headers
    }
    expect(live.staging).toMatchObject({ checked: false, skipped: true });
    expect(live.source).toMatch(/browser/);
    expect(state.liveHealth.production.status).toBe("HEALTHY");
    expect(state.liveHealth.production.source).toMatch(/browser/);
    expect(state.liveHealth.staging.status).toBe("UNKNOWN");
    expect(state.liveHealth.staging.message).toMatch(/another origin.*run \/BWESEO in Claude Code/);
  });

  it("browser mode from the staging host: production is skipped (cross-origin), never reported as failed", async () => {
    const { state } = await evalWith(cfgWith({ strategy: "browser" }), {
      fetchImpl: async () => new Response("<html>ok</html>", { status: 200 }),
      browser: { readableOrigin: STG },
    });
    expect(state.liveHealth.production.status).toBe("UNKNOWN");
    expect(state.liveHealth.staging.status).toBe("HEALTHY");
    expect(state.conflicts.join("\n")).not.toMatch(/PRODUCTION|production/);
  });

  it("a configured health endpoint is probed instead of the home page", async () => {
    const calls = [];
    const { live } = await evalWith(cfgWith({ strategy: "server", endpoint: "/healthz" }), {
      fetchImpl: async (url) => {
        calls.push(new URL(url).pathname);
        return new Response("ok", { status: 200 });
      },
    });
    expect(calls).toContain("/healthz");
    expect(live.homeProbe.url).toBe(`${PROD}/healthz`);
    expect(live.production.home.url).toBe(`${PROD}/healthz`);
  });

  it("buildProbeInput carries only what a browser needs — no profile, no notes", () => {
    const inv = { pages: [{ id: "a", url: "/a", status: "published", approvedBy: "user", topic: "SECRET TOPIC", notes: "internal note", verifyText: "v" }] };
    const input = buildProbeInput({ ...cfgWith(), website: PROD, profileNote: "private" }, inv);
    const json = JSON.stringify(input);
    expect(json).not.toMatch(/SECRET TOPIC|internal note|private/);
    expect(input.inventory.pages[0]).toEqual({ id: "a", url: "/a", status: "published", approvedBy: "user", productionUrl: undefined, verifyText: "v" });
    expect(input.healthConfig.strategy).toBe("browser");
  });

  it("sanitizeLiveCheck keeps only known fields, this project's origins and pages, and valid values", () => {
    const c = cfgWith();
    const inv = { pages: [{ id: "ac-repair", url: "/ac-repair", status: "published" }] };
    const at = "2026-11-02T10:00:00.000Z";
    const good = {
      checked: true,
      homeProbe: { url: `${PROD}/`, status: 200, checkedAt: at, ms: 120, evil: "<script>" },
      pages: {
        "ac-repair": { url: `${PROD}/ac-repair`, status: 404, checkedAt: at },
        "not-a-page": { url: `${PROD}/x`, status: 200 },
        "ac-repair-2": { url: "https://evil.example.org/", status: 200 },
      },
      robots: { status: 200, blocksAll: false },
      injected: { anything: true },
    };
    const out = sanitizeLiveCheck(good, c, inv);
    expect(out.checked).toBe(true);
    expect(out.origin).toBe(PROD);
    expect(out.source).toMatch(/browser/);
    expect(Object.keys(out.pages)).toEqual(["ac-repair"]);
    expect(out.homeProbe).not.toHaveProperty("evil");
    expect(out).not.toHaveProperty("injected");
    // wrong-origin / out-of-range / non-object input is refused, never passed through
    expect(sanitizeLiveCheck({ homeProbe: { url: "https://evil.example.org/", status: 200 } }, c, inv).checked).toBe(false);
    expect(sanitizeLiveCheck({ checked: true, homeProbe: { url: `${PROD}/`, status: 999 } }, c, inv).checked).toBe(false);
    expect(sanitizeLiveCheck("junk", c, inv).checked).toBe(false);
    expect(sanitizeLiveCheck(null, c, inv).checked).toBe(false);
  });
});

// ---------------------------------------------------------------- failure-mode matrix (engine 1.6.0)
// Every kind of temporary problem, from the same starting point: nothing ever rolls the lifecycle back.
describe("failure modes never roll the lifecycle backward", () => {
  const DONE = ["approval", "creation", "qa", "deployment", "postPublication", "scSetup", "liveUrlTest", "indexingRequest", "sitemap"];
  const sc = {
    indexingRequest: "REQUESTED",
    requestedOn: "2026-10-30",
    requestSource: "owner:2026-10-30 chat",
    liveUrlTest: { result: "passed", testedOn: "2026-10-30" },
  };
  const moved = (path) => () => {
    const r = new Response("<html>ok</html>", { status: 200 });
    Object.defineProperty(r, "url", { value: `https://acme-heating.example.com${path}` });
    return r;
  };
  const CASES = [
    ["200", 200, "HEALTHY"],
    ["301 (not followed)", 301, "HEALTHY"],
    ["302 (not followed)", 302, "HEALTHY"],
    ["redirect to the same path", moved("/ac-repair"), "HEALTHY"],
    ["404", 404, "HEALTHY"], // the site is up; the page is a content conflict (below)
    ["410", 410, "HEALTHY"],
    ["429", 429, "CHECK_FAILED"],
    ["500", 500, "CHECK_FAILED"],
    ["502", 502, "CHECK_FAILED"],
    ["503", 503, "CHECK_FAILED"],
    ["504", 504, "CHECK_FAILED"],
    ["522", 522, "CHECK_FAILED"],
    ["timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "CHECK_FAILED"],
    ["DNS failure", new Error("getaddrinfo ENOTFOUND acme-heating.example.com"), "CHECK_FAILED"],
    ["connection failure", new Error("connect ECONNREFUSED 203.0.113.9:443"), "CHECK_FAILED"],
  ];
  const run = async (r, onlyPage) => {
    const page = livePage({ postPublication: { ...livePage().postPublication, searchConsole: sc } });
    const ev = evidence({ pages: [home, page], docs: planned });
    ev.live = await probeLive(ev.config, ev.inventory, {
      retryDelayMs: 0,
      fetchImpl: async (url) => {
        const path = new URL(url).pathname;
        if (onlyPage && path !== "/ac-repair") return new Response("<html>ok</html>", { status: 200 });
        if (r instanceof Error) throw r;
        if (typeof r === "function") return r(url);
        return new Response(path === "/robots.txt" ? "User-agent: *\nAllow: /" : "<html>ok</html>", { status: r });
      },
    });
    return evaluateState(ev, { today: TODAY });
  };

  it.each(CASES)("%s", async (name, r, expectedHealth) => {
    // 404/410 apply to the PAGE (the site itself answers), everything else to the whole site
    const state = await run(r, ["404", "410", "redirect to the same path"].includes(name));
    expect(state.liveHealth.production.status).toBe(expectedHealth);
    for (const k of DONE) {
      const row = state.pages.find((p) => p.id === "ac-repair").rows.find((x) => x.key === k);
      expect(row.status, `${name}: ${k}`).toBe(S.COMPLETE);
    }
    const m = state.pages.find((p) => p.id === "ac-repair").lifecycle.find((x) => x.key === "deployment");
    expect(m).toMatchObject({ completed: true, completedAt: "2026-10-30" });
    expect(m.reversed).toBeUndefined();
    expect(state.environment.current).toBe(ENV.PRODUCTION);
    expect(state.actions.some((a) => a.skill === "BWESEOPublish")).toBe(false);
    expect(state.conflicts.join("\n")).not.toMatch(/on staging|not on production|PRODUCTION NOT VERIFIED/);
    if (name === "404" || name === "410") {
      // only strong evidence the URL is gone raises a reconciliation warning — as an investigation
      expect(state.conflicts.join("\n")).toMatch(/PRODUCTION PAGE MISSING/);
      expect(state.recommendation).toMatchObject({ kind: "conflict-not-live", skill: "BWESEOTechnical" });
    } else if (expectedHealth !== "HEALTHY") {
      expect(state.conflicts).toEqual([]);
      expect(state.recommendation.kind).toBe("investigate-health");
    } else {
      expect(state.conflicts).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- Google workflow (engine 1.7.0)
// readiness → sitemap included → [site] property + sitemap registered → discovered → crawled → indexed
// → monitoring. Every stage is its own fact with its own evidence; none implies the next, and a health
// failure never erases any of it. Manual "Request Indexing" is an optional accelerator.
describe("Google workflow — separate stages, each with its own evidence", () => {
  const SITE = {
    configured: "yes",
    propertyType: "Domain",
    verifiedProperty: "acme-heating.example.com",
    verificationMethod: "DNS",
    verifiedOn: "2026-10-01",
    sitemap: { submitted: "yes", status: "Success", verifiedOn: "2026-10-01", lastRead: "2026-10-29", discoveredPages: 15, submissionMethod: "manual" },
  };
  const cfgFor = (site = SITE, extra = {}) => {
    const c = config();
    c.analytics = { searchConsole: { access: "manual-export", ...site, ...extra } };
    return c;
  };
  const READY = { status: "PASSED", checkedAt: "2026-10-30", source: "post-publication check (production)" };
  const IN_MAP = { included: "yes", verifiedAt: "2026-10-30", source: "post-publication check (production)" };
  const DISC = { status: "DISCOVERED", at: "2026-11-01", source: "search-console-api:url-inspection", evidence: "Discovered - currently not indexed" };
  const CRAWL = { status: "CRAWLED", at: "2026-11-01", source: "search-console-api:url-inspection", evidence: "Crawled - currently not indexed" };
  const INDEXED = { status: "INDEXED", verifiedOn: "2026-11-02", evidence: "Submitted and indexed", source: "search-console-api:url-inspection" };
  const pageG = ({ google, searchConsole, ...over } = {}) => {
    const base = livePage().postPublication;
    return livePage({
      postPublication: {
        ...base,
        searchConsole: searchConsole ?? { indexed: { status: "NOT VERIFIED" } },
        google: { readiness: READY, sitemap: IN_MAP, ...google },
      },
      ...over,
    });
  };
  const go = (page, cfg = cfgFor(), extra = {}) =>
    run({ ...evidence({ cfg, pages: [home, page], docs: planned }), ...extra });
  const kinds = (state) => state.actions.map((a) => a.kind);
  const pageState = (state, id = "ac-repair") => state.pages.find((p) => p.id === id);

  it("a new production page with no readiness record gets the Google readiness check first", () => {
    const state = go(livePage({ postPublication: { ...livePage().postPublication, google: undefined } }));
    expect(state.recommendation).toMatchObject({ kind: "google-readiness", skill: "BWESEOPublish", args: "ac-repair" });
    expect(row(state, "googleReadiness").status).toBe(S.READY);
    expect(state.recommendation.why).toMatch(/does not mean Google has discovered, crawled or indexed/);
  });

  it("a failed readiness check is fixed before anything is sent to Google", () => {
    const state = go(pageG({ google: { readiness: { status: "FAILED", checkedAt: "2026-10-30", source: "post-publication check", failures: ["Canonical correct (HTTPS, production)"] } } }));
    expect(state.recommendation).toMatchObject({ kind: "fix-google-readiness", skill: "BWESEOPublish" });
    expect(state.recommendation.headline).toMatch(/Fix what the Google readiness check found/);
    expect(row(state, "googleReadiness").status).toBe(S.BLOCKED);
    expect(row(state, "googleReadiness").detail).toMatch(/Canonical correct/);
    expect(kinds(state)).not.toContain("reconcile-sitemap");
  });

  it("a readiness record without a date and source is not evidence", () => {
    const state = go(pageG({ google: { readiness: { status: "PASSED" } } }));
    expect(row(state, "googleReadiness").status).not.toBe(S.COMPLETE);
    expect(state.recommendation.kind).toBe("google-readiness");
  });

  it("readiness PASSED means technically ready — never discovered, crawled or indexed", () => {
    const state = go(pageG());
    expect(row(state, "googleReadiness").status).toBe(S.COMPLETE);
    expect(row(state, "googleReadiness").detail).toMatch(/technically ready, not the same as indexed/);
    for (const k of ["googleDiscovered", "googleCrawled", "indexed"])
      expect(row(state, k).status).not.toBe(S.COMPLETE);
  });

  it("a URL missing from the sitemap is detected and fixed", () => {
    const state = go(pageG({ google: { sitemap: { included: "no", verifiedAt: "2026-10-30", source: "post-publication check" } } }));
    expect(state.recommendation).toMatchObject({ kind: "fix-google-readiness" });
    expect(state.recommendation.what).toMatch(/not in the sitemap/);
    expect(row(state, "sitemapIncluded").status).toBe(S.BLOCKED);
  });

  it("a URL present in the sitemap passes; membership is page-level", () => {
    const state = go(pageG());
    expect(row(state, "sitemapIncluded").status).toBe(S.COMPLETE);
    expect(pageState(state).google.sitemapIncluded.status).toBe("yes");
  });

  it("sitemap not registered + API not configured → the manual step, with a note that it can be automated", () => {
    const cfg = cfgFor({ ...SITE, sitemap: { submitted: "unknown" } });
    const state = go(pageG(), cfg);
    expect(state.recommendation).toMatchObject({ kind: "verify-sitemap", manual: true });
    expect(state.recommendation.why).toMatch(/can be automated once the Search Console API is set up/);
    expect(row(state, "sitemap").status).toBe(S.NEEDS_MANUAL_ACTION);
  });

  it("sitemap not registered + API configured → automated (BWESEOSearchConsole), not a manual step", () => {
    const cfg = cfgFor({ ...SITE, sitemap: { submitted: "unknown" } }, { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" });
    const state = go(pageG(), cfg);
    expect(state.recommendation).toMatchObject({ kind: "reconcile-sitemap", skill: "BWESEOSearchConsole", args: "sitemap" });
    expect(state.recommendation.actor).not.toBe("user");
    expect(kinds(state)).not.toContain("verify-sitemap");
    expect(row(state, "sitemap").status).toBe(S.READY);
  });

  it("a credential that is not present here (API 'missing') degrades to the manual path", () => {
    const cfg = cfgFor({ ...SITE, sitemap: { submitted: "unknown" } }, { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" });
    const state = go(pageG(), cfg, { googleApi: { available: false } });
    expect(state.recommendation.kind).toBe("verify-sitemap");
    expect(state.google.api).toMatchObject({ availability: "missing", usable: false });
  });

  it("an already-registered sitemap is never asked for again", () => {
    for (const cfg of [cfgFor(), cfgFor(SITE, { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" })]) {
      const state = go(pageG(), cfg);
      expect(kinds(state)).not.toContain("verify-sitemap");
      expect(kinds(state)).not.toContain("reconcile-sitemap");
      expect(row(state, "sitemap").status).toBe(S.COMPLETE);
      expect(row(state, "sitemap").detail).toMatch(/pages reported \(site-wide, not proof of this page\)/);
    }
  });

  it("all steps done, nothing evidenced → 'monitor Google discovery/indexing', naming the stage", () => {
    const state = go(pageG());
    expect(state.recommendation).toMatchObject({ kind: "wait", awaitingIndexing: true, stage: "not yet discovered by Google" });
    expect(state.recommendation.why).toMatch(/Where Google is now: not yet discovered by Google/);
    expect(row(state, "indexed").status).toBe(S.WAITING_FOR_DATA);
    expect(row(state, "monitoring").status).toBe(S.WAITING);
  });

  it("discovered ≠ crawled ≠ indexed — each stage is its own evidence", () => {
    const disc = go(pageG({ google: { discovered: DISC } }));
    expect(row(disc, "googleDiscovered").status).toBe(S.COMPLETE);
    expect(row(disc, "googleCrawled").status).not.toBe(S.COMPLETE);
    expect(row(disc, "indexed").status).not.toBe(S.COMPLETE);
    expect(disc.recommendation.stage).toBe("discovered by Google, not yet crawled");
    const crawled = go(pageG({ google: { discovered: DISC, crawled: CRAWL } }));
    expect(row(crawled, "googleCrawled").status).toBe(S.COMPLETE);
    expect(row(crawled, "indexed").status).not.toBe(S.COMPLETE);
    expect(row(crawled, "monitoring").status).not.toBe(S.COMPLETE);
    expect(crawled.recommendation.stage).toBe("crawled by Google, not yet indexed");
    expect(pageState(crawled).google.discovered.status).toBe("DISCOVERED");
  });

  it("discovery / crawl without a date and a source is UNKNOWN — a later stage is never inferred", () => {
    const state = go(pageG({ google: { discovered: { status: "DISCOVERED" }, crawled: { status: "CRAWLED" } } }));
    expect(row(state, "googleDiscovered").status).not.toBe(S.COMPLETE);
    expect(row(state, "googleCrawled").status).not.toBe(S.COMPLETE);
  });

  it("sitemap submitted / Success, a passed Live URL Test and a Request Indexing are NOT indexed", () => {
    const state = go(
      pageG({
        searchConsole: { indexingRequest: "REQUESTED", requestedOn: "2026-10-30", requestSource: "owner:chat", liveUrlTest: { result: "passed", testedOn: "2026-10-30" } },
        google: { discovered: DISC, crawled: CRAWL },
      }),
    );
    expect(row(state, "sitemap").status).toBe(S.COMPLETE);
    expect(row(state, "liveUrlTest").status).toBe(S.COMPLETE);
    expect(row(state, "indexingRequest").status).toBe(S.COMPLETE);
    expect(row(state, "indexed").status).not.toBe(S.COMPLETE);
    expect(pageState(state).google.indexed.status).toBe("NOT VERIFIED");
    expect(row(state, "monitoring").status).toBe(S.WAITING);
  });

  it("Request Indexing is an optional accelerator: never recommended by default, and once recorded never asked again", () => {
    const none = go(pageG({ searchConsole: { indexingRequest: "UNKNOWN", indexed: { status: "NOT VERIFIED" } } }));
    expect(kinds(none).filter((k) => ["request-indexing", "live-url-test", "fix-live-url-test"].includes(k))).toEqual([]);
    expect(row(none, "indexingRequest").status).toBe(S.NOT_APPLICABLE);
    expect(row(none, "indexingRequest").detail).toMatch(/optional accelerator/);
    expect(pageState(none).google.requestIndexing).toMatchObject({ state: "UNKNOWN", optional: true });
    const done = go(pageG({ searchConsole: { indexingRequest: "REQUESTED", requestedOn: "2026-10-30", requestSource: "owner:2026-10-30 chat", indexed: { status: "NOT VERIFIED" } } }));
    expect(kinds(done)).not.toContain("request-indexing");
    expect(row(done, "indexingRequest").status).toBe(S.COMPLETE);
    expect(row(done, "indexingRequest").detail).toMatch(/manual accelerator/);
    expect(pageState(done).google.requestIndexing).toMatchObject({ state: "REQUESTED", source: "manual", requestedAt: "2026-10-30" });
  });

  it("API usable: Google's status is checked automatically when due; a recent check waits", () => {
    const cfg = cfgFor(SITE, { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" });
    const stale = go(pageG(), cfg);
    expect(stale.recommendation).toMatchObject({ kind: "check-google-status", skill: "BWESEOSearchConsole", args: "ac-repair" });
    expect(stale.recommendation.actor).not.toBe("user");
    const recent = go(pageG({ google: { lastCheckedOn: "2026-11-01" } }), cfg);
    expect(recent.recommendation.kind).toBe("wait");
    expect(recent.recommendation.date).toBe("2026-11-06"); // next review; nothing to do before then
  });

  it("without the API a due review asks the owner to check URL Inspection once", () => {
    const monitoring = { review7: "2026-11-01", review30: "2026-11-29", review90: "2027-01-28" };
    const p = livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { indexed: { status: "NOT VERIFIED" } },
        google: { readiness: READY, sitemap: IN_MAP },
        monitoring,
      },
    });
    expect(go(p).recommendation).toMatchObject({ kind: "verify-indexing", manual: true });
    const checked = livePage({
      postPublication: {
        ...livePage().postPublication,
        searchConsole: { indexed: { status: "NOT VERIFIED", lastCheckedOn: "2026-11-02" } },
        google: { readiness: READY, sitemap: IN_MAP },
        monitoring,
      },
    });
    expect(go(checked).recommendation.kind).toBe("wait");
  });

  it("indexed (with Google's evidence) → monitoring; zero impressions is valid, not an error", () => {
    const state = go(pageG({ searchConsole: { indexed: INDEXED }, google: { discovered: DISC, crawled: CRAWL, performance: { checkedAt: "2026-11-05", windowDays: 7, source: "search-console-api:search-analytics", impressions: 0, clicks: 0, ctr: 0 } } }));
    expect(row(state, "indexed").status).toBe(S.COMPLETE);
    expect(row(state, "indexed").detail).toMatch(/verified 2026-11-02 \(Search Console API: url-inspection\)/);
    expect(row(state, "monitoring").status).toBe(S.WAITING_FOR_DATA);
    expect(row(state, "monitoring").detail).toMatch(/No Search Console performance data yet\./);
    expect(state.conflicts).toEqual([]);
    expect(pageState(state).google.performance).toMatchObject({ hasData: false, impressions: 0, clicks: 0 });
    expect(state.actions.some((a) => a.kind === "refresh-page" || a.kind === "refresh-check")).toBe(false);
  });

  it("indexed with 30 days of performance data shows real numbers, queries and business outcomes — never estimates", () => {
    const perf = {
      checkedAt: "2026-11-30", windowDays: 30, source: "search-console-api:search-analytics",
      impressions: 420, clicks: 18, ctr: 0.0429, position: 8.4,
      queries: [{ query: "website redesign springfield", clicks: 9, impressions: 120 }],
      conversions: { qualifiedLeads: 2, prototypeRequests: 1, source: "analytics" },
    };
    const state = go(pageG({ searchConsole: { indexed: INDEXED }, google: { discovered: DISC, crawled: CRAWL, performance: perf } }));
    expect(row(state, "monitoring").detail).toMatch(/420 impressions, 18 clicks \(last 30 days\)/);
    const g = pageState(state).google;
    expect(g.performance).toMatchObject({ hasData: true, position: 8.4, conversions: { qualifiedLeads: 2, prototypeRequests: 1 } });
    expect(g.performance.queries[0].query).toBe("website redesign springfield");
  });

  it("a health failure never erases Google history, never resubmits the sitemap and never republishes", async () => {
    const cfg = cfgFor(SITE, { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" });
    const p = pageG({ searchConsole: { indexingRequest: "REQUESTED", requestedOn: "2026-10-30", requestSource: "owner:2026-10-30 chat", liveUrlTest: { result: "passed", testedOn: "2026-10-30" }, indexed: { status: "NOT VERIFIED" } }, google: { discovered: DISC, crawled: CRAWL, lastCheckedOn: "2026-11-01" } });
    const ev = evidence({ cfg, pages: [home, p], docs: planned });
    ev.live = await probeLive(ev.config, ev.inventory, {
      retryDelayMs: 0,
      fetchImpl: async () => new Response("error code: 522", { status: 522 }),
    });
    const state = evaluateState(ev, { today: TODAY });
    expect(state.liveHealth.production.status).toBe("CHECK_FAILED");
    for (const k of ["googleReadiness", "sitemapIncluded", "scSetup", "sitemap", "googleDiscovered", "googleCrawled", "indexingRequest", "liveUrlTest"])
      expect(row(state, k).status, k).toBe(S.COMPLETE);
    expect(kinds(state)).not.toContain("reconcile-sitemap");
    expect(kinds(state)).not.toContain("verify-sitemap");
    expect(kinds(state)).not.toContain("google-readiness");
    expect(state.actions.some((a) => a.skill === "BWESEOPublish")).toBe(false);
    expect(state.recommendation.kind).toBe("investigate-health");
  });

  it("staging never triggers a Google step", () => {
    const state = run(
      stagedEv({
        pages: [home, building({ qa: qaPass(), staging: { deployedOn: "2026-10-06" } })],
        live: { prod: { "ac-repair": notThere }, staging: { "ac-repair": onSite } },
      }),
    );
    for (const k of ["googleReadiness", "sitemapIncluded", "sitemap", "googleDiscovered", "googleCrawled", "indexed"])
      expect(row(state, k).status, k).toBe(S.WAITING);
    expect(row(state, "googleReadiness").detail).toBe("disabled on staging");
    const google = ["google-readiness", "fix-google-readiness", "reconcile-sitemap", "check-google-status", "verify-sitemap", "setup-search-console", "request-indexing", "live-url-test", "verify-indexing"];
    expect(kinds(state).filter((k) => google.includes(k))).toEqual([]);
  });

  it("site-level Search Console state is inherited by every page; page-level Google state stays isolated", () => {
    const second = livePage({
      id: "heat-pump",
      url: "/heat-pump",
      name: "Heat Pump",
      postPublication: { ...livePage().postPublication, searchConsole: { indexed: { status: "NOT VERIFIED" } }, google: { readiness: READY, sitemap: IN_MAP } },
    });
    const first = pageG({ searchConsole: { indexed: INDEXED }, google: { discovered: DISC, crawled: CRAWL } });
    const state = run(evidence({ cfg: cfgFor(), pages: [home, first, second], docs: planned }));
    const a = pageState(state, "ac-repair");
    const b = pageState(state, "heat-pump");
    for (const ps of [a, b]) {
      expect(ps.rows.find((r) => r.key === "scSetup").status).toBe(S.COMPLETE);
      expect(ps.rows.find((r) => r.key === "sitemap").status).toBe(S.COMPLETE);
    }
    expect(a.google.indexed.status).toBe("INDEXED");
    expect(b.google.indexed.status).toBe("NOT VERIFIED");
    expect(b.google.discovered.status).not.toBe("DISCOVERED"); // page A's evidence never leaks into page B
    expect(state.google.searchConsole.configured).toBe("yes");
    expect(state.google.sitemap.registered).toBe(true);
  });

  it("customer isolation: one project's Google state, sitemap and evidence cannot affect another's", () => {
    const a = go(pageG({ searchConsole: { indexed: INDEXED }, google: { discovered: DISC, crawled: CRAWL } }), cfgFor());
    const cfgB = cfgFor({ configured: "no" });
    cfgB.projectId = "other-customer";
    cfgB.website = "https://other-customer.example.org";
    cfgB.publication = { usesSitemap: true, sitemapUrl: "https://other-customer.example.org/sitemap.xml" };
    const b = go(livePage({ postPublication: { ...livePage().postPublication, google: undefined, searchConsole: {} } }), cfgB);
    expect(a.google.searchConsole.configured).toBe("yes");
    expect(b.google.searchConsole.configured).toBe("no");
    expect(b.google.sitemap.registered).toBe(false);
    expect(row(b, "indexed").status).not.toBe(S.COMPLETE);
    expect(pageState(b).google.discovered.status).toBe("UNKNOWN");
    expect(JSON.stringify(b.google)).not.toMatch(/acme-heating\.example\.com/); // site-level state comes only from B's own config
  });

  it("the Search Console API is optional: unconfigured degrades with an explanation, and credentials never enter the state", () => {
    const off = go(pageG());
    expect(off.google.api).toMatchObject({ enabled: false, availability: "disabled", usable: false });
    expect(off.google.api.reason).toMatch(/not enabled/);
    const SECRET = ["-----BEGIN ", "PRIVATE", " KEY-----MIIEvQIBADANBgkq-----END ", "PRIVATE", " KEY-----"].join("");
    const on = go(pageG(), cfgFor(SITE, { enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" }), { googleApi: { available: true } });
    expect(on.google.api).toMatchObject({ enabled: true, credentialsSource: "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON", availability: "available", usable: true });
    const dump = JSON.stringify(on) + formatDashboard(on) + formatDetails(on);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toMatch(/PRIVATE KEY|refresh_token|client_secret|access_token/);
    // a value that is not a NAME is ignored, never echoed
    const bad = go(pageG(), cfgFor(SITE, { enabled: true, credentialsSource: SECRET }));
    expect(bad.google.api.credentialsSource).toBeNull();
    expect(JSON.stringify(bad)).not.toContain("MIIEvQIBADANBgkq");
  });

  it("Google's Indexing API is never used for ordinary pages", () => {
    const state = go(pageG());
    expect(state.google.indexingApi).toEqual({ ordinaryPagesEligible: false });
    expect(pageState(state).google.indexingApiEligible).toBe(false);
    // even a page that claims eligibility is normalized to false by the state engine
    const claims = go(pageG({ google: { indexingApi: { eligible: true } } }));
    expect(pageState(claims).google.indexingApiEligible).toBe(false);
  });

  it("the site-level record carries the requested fields", () => {
    const g = go(pageG()).google;
    expect(g.searchConsole).toMatchObject({ configured: "yes", property: "acme-heating.example.com", propertyType: "domain", verificationMethod: "DNS", verifiedAt: "2026-10-01" });
    expect(g.sitemap).toMatchObject({ url: "https://acme-heating.example.com/sitemap.xml", submitted: "yes", submissionMethod: "manual", status: "success", lastVerifiedAt: "2026-10-01", lastReadAt: "2026-10-29", discoveredUrlCount: 15 });
  });
});
