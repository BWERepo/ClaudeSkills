// Types for keyword-performance-run.mjs (BWESEO engine 1.10.0, Keyword Performance: fetching, caching, orchestration).
// Results are intentionally loose: a site renders what it needs. Every function returns a result object; none throws for a failing API.
export type Store = { get(key: string): Promise<any>; put(key: string, value: any): Promise<void> | void; delete(key: string): Promise<void> | void };
export interface RunContext {
  store: Store;
  client?: { available: boolean; status?: Record<string, any>; searchAnalytics(body: Record<string, any>): Promise<{ ok: boolean; data?: any; kind?: string; message?: string }> };
  site: { productionUrl: string; stagingUrl?: string | null; sitemapUrl?: string | null };
  /** Only "production" ever calls Google. */
  environment?: string;
  now?: () => number;
  cfg?: Record<string, number>;
  limits?: Partial<{ ttlHours: number; manualRefreshCooldownMinutes: number; dailyCallCap: number; rowLimit: number; maxPages: number; targetTtlHours: number; maxTargets: number }>;
  autoWiden?: boolean;
  fetchPage?: (path: string) => Promise<{ status: number | null; redirectedTo?: string | null; xRobotsTag?: string | null; html?: string | null }>;
  fetchText?: (url: string) => Promise<string | null>;
}
export type RangeSpec = "7d" | "28d" | "3m" | { startDate: string; endDate: string };
export declare const KW_KEYS: { snapshot: string; targets: string; meta: string };
export declare const LIMITS: Readonly<Record<string, number>>;
export declare function kvStore(kv: { get(k: string, t: "json"): Promise<any>; put(k: string, v: string): Promise<void>; delete(k: string): Promise<void> }): Store;
export declare function memoryStore(initial?: Record<string, any>): Store & { _dump(): Record<string, any> };
export declare function refreshKeywordPerformance(ctx: RunContext, opts?: { range?: RangeSpec; force?: boolean }): Promise<Record<string, any>>;
export declare function refreshTargets(ctx: RunContext, registry: Record<string, any>[], opts?: { force?: boolean }): Promise<Record<string, any>>;
export declare function getKeywordPerformance(ctx: RunContext, opts: { inventory: unknown; siteId?: string | null }): Promise<Record<string, any>>;
export declare function lookupKeyword(ctx: RunContext, opts: { inventory: unknown; keyword: string }): Promise<{ ok: true; source: string; lastUpdated: string | null; analysis: Record<string, any> }>;
export declare function pageView(opts: Record<string, any>): Record<string, any>;
export declare function normalizeKeyword(k: string): string;
export declare function readPage(html: string, origin?: string): Record<string, any>;
