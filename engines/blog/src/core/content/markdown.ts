import { Marked } from "marked";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { sanitizeHtml } from "../html/sanitize.js";
import { slugify } from "../util/slug.js";

export type FrontmatterFormat = "yaml" | "toml" | "none";

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
  format: FrontmatterFormat;
  errors: string[];
}

const MAX_FRONTMATTER = 64 * 1024;

/** Parse YAML (---) or simple TOML (+++) frontmatter. Malformed frontmatter is reported, never thrown. */
export function parseFrontmatter(src: string): ParsedMarkdown {
  const text = src.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const yaml = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (yaml) {
    const raw = yaml[1] ?? "";
    const body = text.slice(yaml[0].length);
    if (raw.length > MAX_FRONTMATTER) return { data: {}, body, format: "yaml", errors: ["frontmatter too large"] };
    try {
      const data = parseYaml(raw, { maxAliasCount: 50, prettyErrors: false, customTags: [] });
      if (data !== null && (typeof data !== "object" || Array.isArray(data))) return { data: {}, body, format: "yaml", errors: ["frontmatter is not a mapping"] };
      return { data: (data ?? {}) as Record<string, unknown>, body, format: "yaml", errors: [] };
    } catch (e) {
      return { data: {}, body, format: "yaml", errors: [`malformed YAML frontmatter: ${(e as Error).message.split("\n")[0]}`] };
    }
  }
  const toml = /^\+\+\+[ \t]*\n([\s\S]*?)\n\+\+\+[ \t]*(?:\n|$)/.exec(text);
  if (toml) {
    const body = text.slice(toml[0].length);
    const { data, errors } = parseSimpleToml(toml[1] ?? "");
    return { data, body, format: "toml", errors };
  }
  return { data: {}, body: text, format: "none", errors: [] };
}

/** Minimal TOML for flat frontmatter (key = "string" | number | bool | [array]). Tables are ignored. */
function parseSimpleToml(src: string): { data: Record<string, unknown>; errors: string[] } {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  let inTable = false;
  for (const line of src.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    if (/^\[.*\]$/.test(l)) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(l);
    if (!m) {
      errors.push(`unparsed TOML line: ${l.slice(0, 40)}`);
      continue;
    }
    const v = m[2]!.trim();
    try {
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) data[m[1]!] = v.slice(1, -1);
      else if (v === "true" || v === "false") data[m[1]!] = v === "true";
      else if (/^-?\d+(\.\d+)?$/.test(v)) data[m[1]!] = Number(v);
      else if (/^\[.*\]$/.test(v)) data[m[1]!] = JSON.parse(v.replace(/'/g, '"'));
      else data[m[1]!] = v;
    } catch {
      errors.push(`unparsed TOML value for ${m[1]}`);
    }
  }
  return { data, errors };
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string, format: FrontmatterFormat = "yaml"): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== undefined && /^[A-Za-z0-9_-]+$/.test(k)));
  if (format === "toml") {
    const lines = Object.entries(clean).map(([k, v]) => `${k} = ${tomlValue(v)}`);
    return `+++\n${lines.join("\n")}\n+++\n\n${body.trim()}\n`;
  }
  const yaml = stringifyYaml(clean, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }).trim();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

function tomlValue(v: unknown): string {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return JSON.stringify(String(v));
}

/** Markdown -> sanitized HTML with stable heading ids. Raw HTML inside Markdown is sanitized too. */
export function renderMarkdown(md: string): string {
  const used = new Set<string>();
  const marked = new Marked({ gfm: true, breaks: false, async: false });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const plain = inner.replace(/<[^>]+>/g, "");
        let id = slugify(plain, { maxLength: 60 });
        let i = 2;
        const base = id;
        while (used.has(id)) id = `${base}-${i++}`;
        used.add(id);
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
    },
  });
  const html = marked.parse(md) as string;
  return sanitizeHtml(html, { allowH1: true }).html;
}

export function frontString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v instanceof Date) return v.toISOString();
  }
  return undefined;
}

export function frontList(data: Record<string, unknown>, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
    if (typeof v === "string" && v.trim()) return v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}
