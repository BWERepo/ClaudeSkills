import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BlogEngine } from "../core/engine/engine.js";
import { isEngineError } from "../core/errors.js";
import type { ProgressListener } from "../core/progress.js";
import { hasCsrfHeader, isAuthorized, readToken } from "./auth.js";
import { loadGuideHtml } from "../docs/guide.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Handler = (engine: BlogEngine, req: IncomingMessage, res: ServerResponse, params: Record<string, string>, body: unknown) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; })}$`);
  routes.push({ method, pattern, keys, handler });
}

route("GET", "/api/overview", async (engine, _req, res) => {
  const articles = engine.articles();
  const recs = await engine.recommendations();
  const links = await engine.links();
  const state = await engine.state();
  json(res, 200, {
    engineVersion: engine.version,
    totalArticles: articles.length,
    existingArticles: articles.filter((a) => a.source === "existing").length,
    blogEngineArticles: articles.filter((a) => a.source === "blog-engine").length,
    published: articles.filter((a) => a.status === "published").length,
    drafts: articles.filter((a) => a.status === "draft" || a.status === "review").length,
    recommendations: recs.filter((r) => r.status === "recommended").length,
    orphanArticles: links.orphans.length,
    brokenLinks: links.broken.length,
    needingReview: articles.filter((a) => a.refreshRecommended).length,
    state,
  });
});

route("GET", "/api/conductor-status", async (engine, _req, res) => {
  json(res, 200, await engine.conductorStatus());
});

route("GET", "/api/guide", async (_engine, _req, res) => {
  json(res, 200, { html: loadGuideHtml() });
});

route("GET", "/api/recommendations", async (engine, _req, res) => {
  json(res, 200, await engine.recommendations());
});

route("POST", "/api/recommendations/select", async (engine, _req, res, _p, body) => {
  json(res, 200, await engine.select(arr(body, "ids"), str(body, "by") ?? "admin"));
});

route("POST", "/api/recommendations/reject", async (engine, _req, res, _p, body) => {
  json(res, 200, await engine.reject(arr(body, "ids"), str(body, "by") ?? "admin", str(body, "note")));
});

route("POST", "/api/recommendations/:id/edit", async (engine, _req, res, p, body) => {
  json(res, 200, await engine.editRecommendation(p.id!, (body as Record<string, unknown>) ?? {}, str(body, "by") ?? "admin"));
});

route("POST", "/api/generate", async (engine, _req, res, _p, body) => {
  const { report, text } = await engine.buildAndReport(arr(body, "ids"), str(body, "by") ?? "admin");
  json(res, 200, { report, text });
});

route("GET", "/api/articles", async (engine, _req, res) => {
  json(res, 200, engine.articles());
});

route("GET", "/api/articles/:id", async (engine, _req, res, p) => {
  const a = engine.article(p.id!);
  if (!a) return json(res, 404, { error: "not found" });
  const draft = a.source === "blog-engine" ? await engine.context.readDraft(a.id) : undefined;
  json(res, 200, { article: a, draft });
});

route("PUT", "/api/articles/:id/draft", async (engine, _req, res, p, body) => {
  await engine.saveDraft(p.id!, str(body, "markdown") ?? "");
  json(res, 200, { ok: true });
});

route("POST", "/api/articles/:id/approve", async (engine, _req, res, p, body) => json(res, 200, await engine.approve(p.id!, str(body, "by") ?? "admin")));
route("POST", "/api/articles/:id/request-changes", async (engine, _req, res, p, body) => json(res, 200, await engine.requestChanges(p.id!, str(body, "note") ?? "", str(body, "by") ?? "admin")));
route("POST", "/api/articles/:id/publish", async (engine, _req, res, p, body) => json(res, 200, await engine.publish(p.id!, str(body, "by") ?? "admin")));
route("POST", "/api/articles/:id/unpublish", async (engine, _req, res, p, body) => json(res, 200, await engine.unpublish(p.id!, str(body, "by") ?? "admin")));
route("POST", "/api/articles/:id/archive", async (engine, _req, res, p, body) => json(res, 200, await engine.archive(p.id!, str(body, "by") ?? "admin")));
route("POST", "/api/articles/:id/regenerate", async (engine, _req, res, p, body) => json(res, 200, await engine.regenerate(p.id!, str(body, "by") ?? "admin")));

route("POST", "/api/analyze", async (engine, _req, res) => json(res, 200, await engine.analyze()));
route("POST", "/api/reanalyze", async (engine, _req, res) => json(res, 200, await engine.reanalyze()));
route("POST", "/api/rebuild-index", async (engine, _req, res) => json(res, 200, await engine.rebuildIndex()));
route("GET", "/api/links", async (engine, _req, res) => json(res, 200, await engine.links()));
route("GET", "/api/clusters", async (engine, _req, res) => json(res, 200, await engine.clusters()));
route("GET", "/api/bweseo", async (engine, _req, res) => json(res, 200, await engine.bweseoStatus()));
route("GET", "/api/settings", async (engine, _req, res) => {
  const { admin: _admin, ...safe } = engine.config as typeof engine.config & { admin?: unknown };
  json(res, 200, safe);
});

/**
 * Starts the admin HTTP server. Every request needs a valid bearer token (constant-time compared); every
 * state-changing request must also carry the app's own header, so a cross-site form post can't trigger one.
 */
export async function startAdminServer(engine: BlogEngine): Promise<void> {
  const { admin } = engine.config;
  const token = readToken(admin.tokenEnv);
  if (!token) {
    console.error(`No admin token set. Export ${admin.tokenEnv} to a long random value before starting the admin server.`);
    process.exitCode = 1;
    return;
  }
  const sseClients = new Set<ServerResponse>();
  const onProgress: ProgressListener = (u) => {
    const line = `data: ${JSON.stringify(u)}\n\n`;
    for (const res of sseClients) res.write(line);
  };
  engine.context.opts.onProgress = onProgress;

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      const code = isEngineError(e) ? engineErrorStatus(e.code) : 500;
      json(res, code, { error: (e as Error).message, code: isEngineError(e) ? e.code : undefined });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://admin.local");
    if (req.method === "GET" && url.pathname === "/") return serveFile(res, "index.html");
    if (req.method === "GET" && url.pathname === "/dashboard.js") return serveFile(res, "dashboard.js");
    if (req.method === "GET" && url.pathname === "/dashboard.css") return serveFile(res, "dashboard.css");

    if (!isAuthorized(req, token)) return json(res, 401, { error: "unauthorized" });

    if (url.pathname === "/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method !== "GET" && !hasCsrfHeader(req)) return json(res, 403, { error: "missing CSRF header" });

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      const body = req.method === "GET" ? undefined : await readJsonBody(req);
      await r.handler(engine, req, res, params, body);
      return;
    }
    json(res, 404, { error: "not found" });
  }

  await new Promise<void>((resolve) => server.listen(admin.port, admin.host, resolve));
  console.log(`BWE Blog Engine admin dashboard at http://${admin.host}:${admin.port}`);
}

function engineErrorStatus(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "VALIDATION_FAILED" || code === "INVALID_TRANSITION" || code === "BAD_INPUT" || code === "LIMIT_EXCEEDED" || code === "DUPLICATE" || code === "OVERWRITE_REFUSED") return 400;
  return 500;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid JSON body");
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

async function serveFile(res: ServerResponse, name: string): Promise<void> {
  const type = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html";
  try {
    const content = await readFile(path.join(__dirname, name), "utf8");
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

function arr(body: unknown, key: string): string[] {
  const v = (body as Record<string, unknown> | undefined)?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
function str(body: unknown, key: string): string | undefined {
  const v = (body as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : undefined;
}
