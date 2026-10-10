// Types for gsc-client.mjs (BWESEO engine 1.9.0) so TypeScript sites (e.g. a Cloudflare Worker) can import the Search Console client.
export type ClientResult<T = any> = { ok: true; data: T } | { ok: false; kind: string; message: string };
export interface SearchConsoleClient {
  available: boolean;
  status: { enabled: boolean; available?: boolean; reason?: string | null; [k: string]: unknown };
  siteUrl: string | null;
  getSitemap(url: string): Promise<ClientResult>;
  listSitemaps(): Promise<ClientResult>;
  submitSitemap(url: string): Promise<ClientResult>;
  inspectUrl(url: string): Promise<ClientResult>;
  searchAnalytics(body: Record<string, unknown>): Promise<ClientResult>;
}
export declare function createSearchConsoleClient(opts: {
  config: unknown;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}): SearchConsoleClient;
export declare function redact(text: unknown): string;
export declare function credentialStatus(config: unknown, env?: Record<string, string | undefined>): Record<string, any>;
export declare function guardProductionTarget(url: string, config: unknown, what?: string): true;
export declare function reconcileSitemap(opts: { client: SearchConsoleClient; config: unknown; dryRun?: boolean; force?: boolean }): Promise<Record<string, any>>;
