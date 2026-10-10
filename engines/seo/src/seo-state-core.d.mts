// Types for seo-state-core.mjs (BWESEO engine), so TypeScript projects can import the state
// machine directly — e.g. an admin status card that runs it in a Worker. Vendored next to it.

export declare const STATE_VERSION: string;

export declare const S: {
  readonly COMPLETE: "COMPLETE";
  readonly IN_PROGRESS: "IN PROGRESS";
  readonly BLOCKED: "BLOCKED";
  readonly READY: "READY";
  readonly NOT_STARTED: "NOT STARTED";
  readonly WAITING_FOR_DATA: "WAITING FOR DATA";
  readonly NEEDS_APPROVAL: "NEEDS HUMAN APPROVAL";
  readonly NEEDS_MANUAL_ACTION: "NEEDS MANUAL ACTION";
  readonly ON_HOLD: "ON HOLD";
  readonly WAITING: "WAITING";
  readonly UNKNOWN: "UNKNOWN";
  readonly NOT_APPLICABLE: "NOT APPLICABLE";
};
export type StepStatus = (typeof S)[keyof typeof S];

/** Where a URL lives. Only PRODUCTION is ever for search engines. */
export declare const ENV: {
  readonly LOCAL: "LOCAL";
  readonly STAGING: "STAGING";
  readonly PREVIEW: "PREVIEW";
  readonly PRODUCTION: "PRODUCTION";
  readonly UNKNOWN: "UNKNOWN";
};
export type EnvironmentName = (typeof ENV)[keyof typeof ENV];
export declare const STATUS_LABEL: Record<StepStatus, string>;

export interface StepRow {
  key: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  next?: boolean;
}

export interface OpenQuestion {
  id: string;
  question: string;
}

export interface RoadmapOption {
  ids: string[];
  name: string;
  priority: string;
  urls: string[];
  topic: string;
}

/** Who acts: Claude can do it, only the user can (decision or manual action), or nobody (wait). */
export type Actor = "claude" | "user" | "nobody";

export interface SeoAction {
  kind: string;
  rank: number;
  actor: Actor;
  /** Which approval gate this is, if any: "page", "deploy", "staging-deploy", "staging", "change",
   *  "setup", "resume". */
  approval: string | null;
  headline: string;
  what: string;
  why: string;
  next: string;
  skill?: string | null;
  args?: string;
  command?: string;
  row?: string;
  pageId?: string;
  pageIds?: string[];
  issueId?: string;
  name?: string;
  url?: string;
  priority?: string | null;
  manual?: boolean;
  steps?: string[];
  /** Heading for `steps` (default "MANUAL ACTION REQUIRED"). */
  stepsTitle?: string;
  /** The page's staging URL, for staging steps. */
  stagingUrl?: string | null;
  /** The project has a staging site, so pages go QA → staging → your approval → production. */
  staged?: boolean;
  after?: string;
  questions?: OpenQuestion[];
  options?: RoadmapOption[];
  errors?: string[];
  errorCount?: number;
}

export interface PageHold {
  since: string;
  /** "deploy" (default): holds the PRODUCTION deploy only — QA, staging deploys, the staging review
   *  and the staging approval go ahead. "all": nothing happens on the page. */
  scope?: "deploy" | "all";
  reason?: string;
  source: string;
}

export interface InstallState {
  status: "installed" | "legacy" | "not-installed";
  engineVersion: string | null;
  schemaVersion: number | null;
  adapter: string | null;
  integrity: "verified" | "modified" | "missing" | "unknown";
  updateAvailable: string | null;
}
export declare function installOf(
  evInstall: { receipt?: Record<string, any> | null; integrity?: string; latestKnown?: string | null } | null | undefined,
  config: Record<string, any> | null | undefined,
): InstallState;
export interface GoogleEvidence {
  status: string;
  at: string | null;
  source: string | null;
  evidence: string | null;
  note: string | null;
}
export interface GooglePerformance {
  checkedAt: string;
  windowDays: number | null;
  source: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
  hasData: boolean;
  queries: { query: string; clicks: number; impressions: number }[];
  conversions: { qualifiedLeads: number; prototypeRequests: number; source: string | null } | null;
}
/** PAGE-LEVEL Google facts, each with its own evidence. Never inferred from an earlier stage. */
export interface GooglePage {
  readiness: {
    status: "PASSED" | "FAILED" | "PENDING" | "UNKNOWN";
    checkedAt: string | null;
    source: string | null;
    failures: string[];
    warnings: string[];
    items: { id: string; status: string; detail?: string }[];
    note: string | null;
  };
  sitemapIncluded: { status: "yes" | "no" | "unknown"; verifiedAt: string | null; lastmod: string | null; source: string | null };
  discovered: GoogleEvidence;
  crawled: GoogleEvidence;
  indexed:
    | { status: "INDEXED"; verifiedOn: string; evidence: string | null; source: string | null }
    | { status: "NOT VERIFIED"; lastCheckedOn: string | null };
  requestIndexing: {
    state: "NOT_REQUESTED" | "REQUESTED" | "UNKNOWN" | "NOT_APPLICABLE" | "REQUEST_FAILED";
    requestedAt: string | null;
    source: "manual" | null;
    optional: boolean;
  };
  performance: GooglePerformance | null;
  lastCheckedOn: string | null;
  indexingApiEligible: false;
}
export interface GoogleSite {
  searchConsole: {
    configured: "yes" | "no" | "unknown";
    property: string | null;
    propertyType: "domain" | "url-prefix" | "unknown";
    verificationMethod: string | null;
    verifiedAt: string | null;
  };
  sitemap: {
    applicable: boolean;
    url: string | null;
    submitted: "yes" | "no" | "unknown";
    submissionMethod: "api" | "manual" | "unknown";
    submissionAt: string | null;
    lastVerifiedAt: string | null;
    lastReadAt: string | null;
    status: "success" | "error" | "unknown";
    discoveredUrlCount: number | null;
    registered: boolean;
  };
  api: {
    enabled: boolean;
    credentialsSource: string | null;
    availability: "disabled" | "not-configured" | "available" | "missing" | "unknown";
    usable: boolean;
    reason: string | null;
  };
  requestIndexing: "optional" | "recommended";
  indexingApi: { ordinaryPagesEligible: false };
}
export declare function googleApiOf(
  config: Record<string, any> | null | undefined,
  evApi?: { available: boolean } | null,
): GoogleSite["api"] & { requestIndexing: "optional" | "recommended"; statusCheckDays: number };
export declare function googleSiteSummary(
  config: Record<string, any> | null | undefined,
  evApi?: { available: boolean } | null,
): GoogleSite;
export interface PageState {
  /** PAGE-LEVEL Google view (readiness, sitemap membership, discovery, crawl, index, performance). */
  google?: GooglePage;
  /** Durable lifecycle milestones (history) — never changed by live health. */
  lifecycle?: LifecycleMilestone[];
  /** A live-check observation for this page, shown apart from the lifecycle. */
  liveCheck?: { kind: string; detail: string };
  id: string;
  name: string;
  url: string;
  status: string;
  priority: string | null;
  roadmapOrder: number | null;
  index: number;
  summary: string | null;
  /** The page's pipeline steps (approval → monitoring); null for pages outside the pipeline. */
  rows: StepRow[] | null;
  blockers: OpenQuestion[];
  staleBlockers: string[];
  history: Record<string, string | Record<string, string>>;
  hold: PageHold | null;
  /** Where the page is right now (pipeline pages only): LOCAL, STAGING or PRODUCTION. */
  environment?: EnvironmentName;
  /** Its URL on staging, when the project has staging. */
  stagingUrl?: string | null;
}

export interface EnvironmentState {
  /** The environment of the page in focus — what the dashboard is describing. */
  current: EnvironmentName | null;
  production: {
    url: string;
    hosts: string[];
    checked: boolean;
    indexable: { ok: boolean | null; detail: string };
  } | null;
  staging: {
    status: "configured" | "not-configured" | "unknown";
    url: string | null;
    hosts: string[];
    checked: boolean;
    protection: {
      level: "strong" | "weak" | "none" | "unknown" | "not-applicable";
      detail: string;
      fixPending?: boolean;
    };
  };
  preview: { status: string; hostPatterns: string[] };
}

export interface EnvironmentLine {
  key: "environment" | "production" | "staging" | "indexing" | "liveHealth" | "engine";
  label: string;
  value: string;
  tone: "ok" | "warn" | "error" | "neutral";
}

export interface IssueState {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  area: string;
  status: string;
  pages: string[];
}

export interface SeoState {
  version: string;
  today: string;
  business: string | null;
  website: string | null;
  liveCheck: string;
  /** Live SITE HEALTH — separate from the lifecycle. A failed probe is never a lifecycle change. */
  liveHealth: LiveHealth;
  /** Is the BWESEO engine installed (by /BWESEOInstall)? Small status for the card. */
  install: InstallState;
  /** SITE-LEVEL Google facts: Search Console property, sitemap registration, API, guardrails. */
  google: GoogleSite;
  stages: StepRow[];
  pages: PageState[];
  issues: IssueState[];
  blockers: { pageId: string; name: string; questions: string[] }[];
  conflicts: string[];
  warnings: string[];
  actions: SeoAction[];
  recommendation: SeoAction | null;
  alsoForYou: SeoAction[];
  focusPageId: string | null;
  environment: EnvironmentState | null;
}

/** Live site HEALTH (current observation) — independent of the lifecycle (durable milestones). */
export type LiveHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "CHECK_FAILED" | "UNKNOWN";
export interface EnvHealth {
  status: LiveHealthStatus;
  severity: "info" | "warning" | "critical";
  environment: string;
  url: string | null;
  httpStatus: number | null;
  checkedAt: string | null;
  responseTimeMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  consecutiveFailures: number;
  lastSuccessfulCheck: string | null;
  lastSuccessfulHttpStatus: number | null;
  providerHint: string | null;
  source: string;
  message: string;
}
export interface LiveHealth {
  production: EnvHealth;
  staging: EnvHealth;
}
export interface HealthHistoryEntry {
  consecutiveFailures: number;
  lastCheck: { status: LiveHealthStatus; httpStatus: number | null; checkedAt: string };
  lastSuccess: { checkedAt: string; httpStatus: number | null } | null;
}
export interface HealthHistory {
  production?: HealthHistoryEntry | null;
  staging?: HealthHistoryEntry | null;
}
export declare const LIVE_HEALTH_LABEL: Record<LiveHealthStatus, string>;
export declare const LIVE_HEALTH_MARKS: Record<LiveHealthStatus, string>;
export declare const HEALTH_ESCALATE_AFTER: number;
export declare function healthCategory(r: LiveProbe | null | undefined): string | null;
export declare function liveHealthOf(
  live: LiveCheck | null | undefined,
  history?: HealthHistory | null,
): LiveHealth;
export declare function nextHealthHistory(
  liveHealth: LiveHealth | null | undefined,
  prev?: HealthHistory | null,
): HealthHistory;
/** One lifecycle milestone: durable history, never reversed by a failed request. */
export interface LifecycleMilestone {
  key: string;
  label: string;
  completed: boolean;
  completedAt: string | null;
  reversed?: { kind: string; on: string; source: string; evidence: string | null };
}
/** ok / redirected / missing (404, 410) / unavailable (5xx, 429, timeouts, network, other 4xx). */
export declare function classifyProbe(
  r: LiveProbe | null | undefined,
): "ok" | "redirected" | "missing" | "unavailable" | null;

export interface LiveProbe {
  url: string;
  status?: number;
  finalUrl?: string;
  redirected?: boolean;
  hasVerifyText?: boolean | null;
  robots?: { header: string | null; meta: string[]; noindex: boolean };
  error?: string;
  checkedAt?: string;
  ms?: number;
  retried?: boolean;
}

export interface RobotsTxtProbe {
  status?: number;
  blocksAll?: boolean;
  error?: string;
}

export interface LiveCheck {
  checked: boolean;
  reason?: string;
  origin?: string;
  source?: string;
  homeProbe?: LiveProbe;
  /** Engine 1.4.1 — health of the production site, kept apart from any page's lifecycle. */
  /** True when the check was deliberately not run from here (self-fetch risk / cross-origin). Not a failure. */
  skipped?: boolean;
  productionHealth?: { status: "ok" | "degraded" | "unavailable"; detail: string; code?: number | null; breaker?: boolean; failed?: number };
  pages?: Record<string, LiveProbe>;
  /** Production's home page and robots.txt — is production indexable? */
  production?: { home: LiveProbe; robots: RobotsTxtProbe };
  /** The staging site, when the project has one. */
  staging?: {
    checked: boolean;
    reason?: string;
    origin?: string;
    pages?: Record<string, LiveProbe>;
    home?: LiveProbe;
    robots?: RobotsTxtProbe;
  };
}

export interface SourceState {
  files: string[];
  missing: string[];
  hash: string | null;
  modifiedOn: string | null;
}

export interface DocState {
  exists: boolean;
  updated: string | null;
  hasContent: boolean;
}

/** Everything evaluateState reads (seo-state.mjs → collectEvidence builds it from disk). */
export interface SeoEvidence {
  today?: string;
  repo?: { remote: string | null; folderName: string };
  config: Record<string, any> | null;
  profile?: Record<string, any> | null;
  inventory?: {
    pages: Record<string, any>[];
    issues?: Record<string, any>[];
    [k: string]: any;
  } | null;
  validation?: { errors: string[]; warnings: string[] };
  docs?: Record<string, DocState>;
  reports?: { name: string; date: string }[];
  searchConsoleExports?: string[];
  /** Recorded live-health history (seo/data/live-health.json) — consecutive failures, last success. */
  healthHistory?: HealthHistory | null;
  /** Set by a host that can see its own environment (the CLI): is the Search Console API credential present? */
  googleApi?: { available: boolean } | null;
  /** The BWESEO installation receipt (metadata only) and its integrity, gathered by the host. */
  install?: { receipt?: Record<string, any> | null; integrity?: string; latestKnown?: string | null } | null;
  sources?: Record<string, SourceState>;
  live?: LiveCheck;
  parseErrors?: string[];
}

export interface DashboardSummary {
  /** Project-level stages are done up to the roadmap, so per-page detail applies. */
  roadmapComplete: boolean;
  /** The page shown step by step (null: none in progress). */
  focus: PageState | null;
  /** Up to six other pages worth a line each. */
  otherPages: PageState[];
  /** How many more roadmap pages exist beyond those. */
  morePages: number;
  /** "2 high · 9 medium open; 2 fixed, waiting to go live", or "". */
  issues: string;
  /** The recommendation is a site issue. */
  issuesNext: boolean;
}

export declare function evaluateState(ev: SeoEvidence, opts?: { today?: string }): SeoState;
export declare function dashboardSummary(state: SeoState): DashboardSummary;
export interface PipelineStep {
  key: string;
  label: string;
  /** ✓ done · ⏸ on hold · ✗ blocked/failed · ▸ next · … waiting */
  mark: "✓" | "⏸" | "✗" | "▸" | "…";
}
export declare function pipelineSummary(
  state: SeoState,
): { page: string; steps: PipelineStep[] } | null;
export declare function pipelineLines(p: {
  steps: PipelineStep[];
}): { tone: "done" | "hold" | "rest"; text: string }[];
/** Done on one line (green), on hold on the next (yellow), the rest on a third; \n-joined. */
export declare function formatPipeline(
  p: { steps: PipelineStep[] },
  opts?: { color?: boolean },
): string;
export declare function environmentSummary(state: SeoState): EnvironmentLine[];
export declare function formatDashboard(state: SeoState, opts?: { color?: boolean }): string;
export declare function formatDetails(state: SeoState): string;
/** Resolve an inventory id, a /path or an absolute URL on this project's own hosts to a page. */
export declare function resolvePageRef(state: SeoState, ref: string): { page?: PageState; error?: string };
/** `/BWESEO <page>`: the same state focused on one page. */
export declare function assessPage(
  state: SeoState,
  ref: string,
): { ok: boolean; error?: string; page?: PageState; actions?: SeoAction[]; text: string };
export declare function probeLive(
  config: Record<string, any>,
  inventory: { pages?: Record<string, any>[] },
  opts?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    concurrency?: number;
    retryDelayMs?: number;
    /** The host running the check, if it also serves the site: same-zone targets are skipped, never fetched. */
    servingHost?: string | null;
    /** Set in a browser: only `readableOrigin` is probed (plain requests, no custom headers). */
    browser?: { readableOrigin: string } | null;
  },
): Promise<LiveCheck>;

/** Where the live check runs (seo-config.json → environments.health.strategy). Default "browser". */
export type HealthStrategy = "browser" | "server" | "off";
export declare const HEALTH_STRATEGIES: readonly HealthStrategy[];
export declare function healthConfig(config: Record<string, any> | null | undefined): {
  strategy: HealthStrategy;
  endpoint: string;
};
export declare function registrableDomain(host: string): string;
/** Would fetching targetUrl from servingHost be a same-zone request from the site's own host? */
export declare function selfFetchRisk(
  targetUrl: string,
  servingHost: string | null | undefined,
  config: Record<string, any> | null | undefined,
): boolean;
/** The minimum a browser needs to run the probes — no profile, no notes. */
export interface ProbeInput {
  config: Record<string, any>;
  inventory: { pages: Record<string, any>[] };
  healthConfig: { strategy: HealthStrategy; endpoint: string };
}
export declare function buildProbeInput(
  config: Record<string, any> | null | undefined,
  inventory: { pages?: Record<string, any>[] } | null | undefined,
): ProbeInput;
/** Untrusted probe data from a browser → a clean LiveCheck (only known fields, origins and pages). */
export declare function sanitizeLiveCheck(
  input: unknown,
  config: Record<string, any> | null | undefined,
  inventory: { pages?: Record<string, any>[] } | null | undefined,
): LiveCheck;
export declare function pageName(p: Record<string, any>): string;
export declare function pageText(html: string): string;
export declare function sourceFiles(source: string | null | undefined): string[];
export declare function localToday(now?: Date): string;
export declare function productionOrigin(config: Record<string, any> | null | undefined): string;

export interface ProjectEnvironments {
  production: { url: string; hosts: string[] } | null;
  staging: {
    status: "configured" | "not-configured" | "unknown";
    url: string | null;
    hosts: string[];
    indexProtection: string | null;
  };
  preview: { status: string; hostPatterns: string[] };
  local: { urls: string[]; run: string | null };
}
export declare function indexingAllowed(environment: EnvironmentName | null | undefined): boolean;
export declare function hostMatches(host: string, pattern: string): boolean;
export declare function isLocalHost(host: string): boolean;
export declare function environmentsOf(
  config: Record<string, any> | null | undefined,
): ProjectEnvironments;
export declare function classifyHost(
  host: string,
  config: Record<string, any> | null | undefined,
): EnvironmentName;
export declare function classifyUrl(
  url: string,
  config: Record<string, any> | null | undefined,
): EnvironmentName;
export declare function findEnvironmentLeaks(
  text: string,
  config: Record<string, any> | null | undefined,
): { environment: EnvironmentName; host: string; ref: string }[];
export declare function robotsSignals(
  html: string,
  headerValue: string | null | undefined,
): { header: string | null; meta: string[]; noindex: boolean };
/** Site-level Search Console state (engine 1.4.0): one property and one sitemap shared by every page. */
export declare function searchConsoleSite(config: Record<string, any> | null | undefined): {
  configured: "yes" | "no" | "unknown";
  propertyType: string | null;
  property: string | null;
  method: string | null;
  verifiedOn: string | null;
  sitemap: {
    applicable: boolean;
    verified: boolean;
    url: string | null;
    status: string | null;
    verifiedOn: string | null;
    lastRead: string | null;
    discoveredPages: number | null;
  };
};
export declare function robotsBlocksAll(txt: string): boolean;
export declare function indexProtection(
  page: {
    status?: number;
    error?: string;
    robots?: { header?: string | null; meta?: string[] };
  } | null,
  robots: { blocksAll?: boolean } | null,
): { level: "strong" | "weak" | "none" | "unknown"; detail: string };

export type LifecycleState = "complete" | "pending" | "attention" | "na";
export declare const LIFECYCLE_MARKS: Record<LifecycleState, { icon: string; word: string }>;
/** The page's lifecycle grouped for a timeline: Build · Staging · Publish · Google · Grow. */
export declare function lifecycleGroups(pageState: { rows?: StepRow[] | null } | null | undefined): {
  key: string;
  label: string;
  steps: {
    key: string;
    label: string;
    state: LifecycleState;
    icon: string;
    word: string;
    /** site = recorded once for the whole website; page = this page only */
    scope: "site" | "page";
    /** a manual accelerator that is never required */
    optional: boolean;
    detail: string | null;
    next: boolean;
  }[];
}[];

// Engine 1.9.0 - Google index monitoring display model (see index-monitor.mjs and docs/methodology/google-index-monitoring.md)
export declare function indexMonitorOf(config: unknown): { declared: boolean; enabled: boolean; staleAfterDays: number; snapshot: Record<string, unknown> | null };
export declare function googleIndexOf(config: unknown, snap: { pulledAt?: string; summary?: Record<string, unknown> } | null, today?: string): Record<string, any>;
export declare function indexSummaryLine(g: Record<string, any>): string;

// Engine 1.10.0 - keyword performance display model (see keyword-performance.mjs and docs/methodology/keyword-performance.md)
export declare function keywordPerformanceOf(config: unknown, inventory: unknown, snap: { pulledAt?: string; summary?: Record<string, any> } | null, today?: string): Record<string, any>;
export declare function keywordSummaryLine(k: Record<string, any>): string;
