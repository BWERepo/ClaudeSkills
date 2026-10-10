import { createHash } from "node:crypto";

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

/** Short stable id from any set of strings. */
export const stableId = (prefix: string, ...parts: string[]): string =>
  `${prefix}-${sha256(parts.join("\u0000")).slice(0, 12)}`;

/** JSON with sorted keys, so semantically equal objects hash equally. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Content fingerprint: whitespace-insensitive, so reformatting alone does not flag a change. */
export const contentHash = (body: string): string => sha256(body.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());

export const metadataHash = (meta: Record<string, unknown>): string => sha256(canonicalJson(meta));
