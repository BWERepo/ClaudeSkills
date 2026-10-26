// Types for index-monitor-run.mjs (BWESEO engine 1.9.0, Google Index Monitoring: storage and orchestration).
import type { SearchConsoleClient } from "./gsc-client.mjs";
export interface MonitorStore { get(key: string): Promise<any>; put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>; atomic?: boolean; acquire?(key: string, record: { at: string; owner: string }, opts?: { staleBefore?: number }): Promise<boolean>; release?(key: string, owner: string): Promise<void> }
export interface MonitorContext {
  store: MonitorStore;
  client: SearchConsoleClient | { available: boolean; status?: any; [k: string]: any };
  site: { productionUrl: string; stagingUrl?: string; sitemapUrl?: string };
  searchConsoleConfig?: unknown;
  config?: Record<string, any>;
  subrequestBudget?: number;
  pageCheckBatch?: number;
  now?: () => number;
  discover: () => Promise<{ items: Record<string, any>[] }>;
  fetchHtml?: (path: string) => Promise<string>;
  fetchStaging?: () => Promise<{ reachable?: boolean; xRobotsTag?: string | null; html?: string | null; robotsTxt?: string | null }>;
}
export declare const KEYS: { registry: string; meta: string; summary: string; links: string; lock: string; detail: (path: string) => string };
export declare function kvStore(kv: { get(key: string, type: "json"): Promise<any>; put(key: string, value: string): Promise<void>; delete(key: string): Promise<void> }): MonitorStore;
export declare function memoryStore(initial?: Record<string, unknown>): MonitorStore & { _dump(): Record<string, any> };
export declare function loadState(store: MonitorStore): Promise<{ registry: { v: number; records: Record<string, Record<string, any>> }; meta: Record<string, any> }>;
export declare function parseOnPage(html: string, origin: string): { noindex: boolean; canonicalUrl: string | null; title: string | null; links: string[] };
export declare function syncRegistry(registry: { v?: number; records: Record<string, any> }, items: Record<string, any>[], opts: { origin: string; now: number }): { registry: { v: number; records: Record<string, any> }; added: string[]; removed: string[]; ignored: string[] };
export declare function discoverFromSitemap(opts: { sitemapXml: string; fetchText?: (url: string) => Promise<string | null>; origin: string; sitemapUrl: string }): Promise<{ items: Record<string, any>[]; ignored: string[] }>;
export declare function runMonitor(ctx: MonitorContext, opts?: { mode?: "cron" | "refresh" | "url"; paths?: string[] }): Promise<Record<string, any>>;
export declare function submitSitemapNow(ctx: MonitorContext, opts?: { force?: boolean }): Promise<Record<string, any>>;
export declare function sitemapView(data: unknown, url: string, now: number, submittedHint?: string): Record<string, any>;
export declare function acquireLock(store: MonitorStore, key: string, opts: { now: number; ttlMs: number; owner?: string }): Promise<{ ok: boolean; owner?: string; atomic?: boolean }>;
export declare function releaseLock(store: MonitorStore, key: string, owner: string | undefined): Promise<void>;
