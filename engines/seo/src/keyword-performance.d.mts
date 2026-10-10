// Types for keyword-performance.mjs / keyword-registry.mjs / keyword-target.mjs (BWESEO engine 1.10.0). Records are intentionally loose.
export type Priority = "FIX NOW" | "HIGH OPPORTUNITY" | "IMPROVE" | "MONITOR" | "HEALTHY" | "INSUFFICIENT DATA";
export declare const PRIORITIES: Priority[];
export declare const TABLE_FILTERS: string[];
export declare function rangeFor(spec?: "7d" | "28d" | "3m" | { startDate: string; endDate: string }, now?: number, cfg?: Record<string, number>): Record<string, any>;
export declare function previousRange(range: Record<string, any>): Record<string, any>;
export declare function parseRows(response: unknown, opts: { origin: string }): { rows: Record<string, any>[]; dropped: number };
export declare function indexRows(rows: Record<string, any>[]): { byQuery: Map<string, any>; byPage: Map<string, any>; totalRows: number };
export declare function indexingStatus(opts?: { record?: Record<string, any> | null; impressions?: number; now?: number }): { confidence: "CONFIRMED" | "INFERRED" | "UNKNOWN"; indexed: boolean | null; label: string; source: string | null; checkedAt: string | null; reason: string | null; action: string | null; [k: string]: any };
export declare function analyzeKeyword(ctx: Record<string, any>): Record<string, any>;
export declare function analyzeSite(ctx: Record<string, any>): { analyses: Record<string, any>[]; discovered: Record<string, any>[]; summary: Record<string, any> };
export declare function discoverQueries(ctx: Record<string, any>): Record<string, any>[];
export declare function summarizeKeywords(analyses: Record<string, any>[], discovered: Record<string, any>[], opts?: Record<string, any>): Record<string, any>;
export declare function tableRows(analyses: Record<string, any>[]): Record<string, any>[];
export declare function queryTable(rows: Record<string, any>[], opts?: { filter?: string; sort?: string | null; dir?: "asc" | "desc" | null; q?: string }): Record<string, any>[];
export declare function pageView(opts: Record<string, any>): Record<string, any>;
export declare function formatKeywordAnalysis(analysis: Record<string, any>): string;
// registry
export declare function normalizeKeyword(k: string): string;
export declare function similarKeywords(a: string, b: string): { similar: boolean; score: number };
export declare function registryOf(inventory: unknown, opts?: { siteId?: string | null }): Record<string, any>[];
export declare function findKeyword(records: Record<string, any>[], phrase: string): Record<string, any>[];
export declare function validateRegistry(inventory: unknown): { errors: string[]; warnings: string[]; groups: Record<string, any>[] };
export declare function addKeyword(inventory: unknown, opts: { pageId: string; keyword: string; role?: "primary" | "secondary"; replace?: boolean; allowDuplicate?: boolean; searchIntent?: string | null; on?: string | null }): { ok: boolean; inventory?: any; changed?: boolean; error?: string; note?: string; conflict?: any };
export declare function removeKeyword(inventory: unknown, opts: { pageId: string; keyword: string }): { ok: boolean; inventory?: any; changed?: boolean; error?: string };
export declare function applyDiscoveredAction(inventory: unknown, opts: { query: string; action: "ignore" | "monitor" | "investigate" | "add-secondary" | "add-primary"; pageId?: string | null; on?: string | null; note?: string | null }): { ok: boolean; inventory?: any; changed?: boolean; error?: string; note?: string };
// target page + sitemap
export declare function readPage(html: string, origin?: string): Record<string, any>;
export declare function robotsAllows(robotsTxt: string | null, path: string): { allowed: boolean | null; basis: string };
export declare function inspectTargetPage(input: Record<string, any>): Record<string, any>;
export declare function inboundCounts(linkMap: Record<string, string[]>): Record<string, number>;
export declare function analyzeSitemap(xml: string | null, opts: { origin: string; probes?: Record<string, any> }): { detected: boolean; isIndex: boolean; entries: number; problems: { type: string; url: string; message: string }[]; paths: string[] };
