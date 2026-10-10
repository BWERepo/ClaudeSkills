import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Admin requests authenticate with a bearer token read from an environment variable (never from config, never
 * logged). Comparison is constant-time so response timing cannot leak the token.
 */
export function readToken(tokenEnv: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const t = env[tokenEnv];
  return t && t.trim() ? t.trim() : undefined;
}

export function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return false;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/** Simple same-origin CSRF defence: state-changing requests must carry the custom header fetch() sets. */
export function hasCsrfHeader(req: IncomingMessage): boolean {
  return req.headers["x-bwe-admin"] === "1";
}
