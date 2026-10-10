import { escapeAttr, escapeHtml, isTag, parseHtml, type AnyNode } from "./dom.js";

/**
 * Allowlist HTML sanitizer for generated article bodies. Anything not explicitly allowed is dropped:
 * scripts, styles, iframes, forms, event handlers, inline styles, javascript:/data: URLs, unknown attributes.
 * Text content of dropped wrapper elements is kept; content of dangerous elements is discarded.
 */

const ALLOWED: Record<string, string[]> = {
  p: [],
  h2: ["id"],
  h3: ["id"],
  h4: ["id"],
  h5: ["id"],
  h6: ["id"],
  ul: [],
  ol: ["start"],
  li: [],
  a: ["href", "title", "rel"],
  strong: [],
  em: [],
  b: [],
  i: [],
  code: [],
  pre: [],
  blockquote: ["cite"],
  table: [],
  thead: [],
  tbody: [],
  tfoot: [],
  tr: [],
  th: ["scope", "colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  caption: [],
  img: ["src", "alt", "width", "height", "loading"],
  figure: [],
  figcaption: [],
  hr: [],
  br: [],
  dl: [],
  dt: [],
  dd: [],
  details: [],
  summary: [],
  abbr: ["title"],
  sup: [],
  sub: [],
  small: [],
  mark: [],
  cite: [],
  q: ["cite"],
  time: ["datetime"],
};
const VOID = new Set(["img", "hr", "br"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "template", "noscript", "svg", "math", "link", "meta", "base", "frame", "frameset", "applet", "title", "head"]);
const URL_ATTRS = new Set(["href", "src", "cite"]);

export interface SanitizeReport {
  html: string;
  removed: string[];
}

export function sanitizeHtml(html: string, opts: { allowH1?: boolean } = {}): SanitizeReport {
  const removed = new Set<string>();
  const doc = parseHtml(html);
  const out: string[] = [];
  const walk = (n: AnyNode): void => {
    if (isTag(n)) {
      const name = n.name;
      if (DROP_WITH_CONTENT.has(name)) {
        removed.add(`<${name}>`);
        return;
      }
      const allowedAttrs = name === "h1" && opts.allowH1 ? [] : ALLOWED[name];
      if (!allowedAttrs) {
        if (name !== "html" && name !== "body" && name !== "div" && name !== "span" && name !== "section" && name !== "article" && name !== "main") removed.add(`<${name}>`);
        for (const c of n.children) walk(c);
        return;
      }
      const attrs: string[] = [];
      for (const [k, v] of Object.entries(n.attribs ?? {})) {
        if (!allowedAttrs.includes(k)) {
          if (k.startsWith("on")) removed.add(`${k} handler`);
          else if (k === "style") removed.add("inline style");
          continue;
        }
        if (URL_ATTRS.has(k) && !isSafeUrl(v)) {
          removed.add(`unsafe ${k} URL`);
          continue;
        }
        if (k === "rel") {
          const rel = v
            .split(/\s+/)
            .filter((r) => ["nofollow", "noopener", "noreferrer", "sponsored", "ugc", "external"].includes(r.toLowerCase()))
            .join(" ");
          if (rel) attrs.push(`rel="${escapeAttr(rel)}"`);
          continue;
        }
        attrs.push(`${k}="${escapeAttr(v)}"`);
      }
      if (name === "img" && !n.attribs?.alt) attrs.push('alt=""');
      if (name === "img" && !n.attribs?.loading) attrs.push('loading="lazy"');
      if (name === "img" && !(n.attribs?.src && isSafeUrl(n.attribs.src))) return;
      out.push(`<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`);
      if (VOID.has(name)) return;
      for (const c of n.children) walk(c);
      out.push(`</${name}>`);
    } else if (n.type === "text") {
      out.push(escapeHtml((n as unknown as { data: string }).data));
    } else if (n.type === "comment" || n.type === "directive") {
      // dropped
    } else if ("children" in n && Array.isArray((n as { children?: AnyNode[] }).children)) {
      for (const c of (n as { children: AnyNode[] }).children) walk(c);
    }
  };
  for (const c of doc.children) walk(c);
  return { html: out.join("").trim(), removed: [...removed] };
}

export function isSafeUrl(v: string): boolean {
  // Strip control chars and whitespace browsers ignore before checking the scheme.
  const s = v.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (!s) return false;
  if (s.startsWith("#") || s.startsWith("/") || s.startsWith("./") || s.startsWith("../") || s.startsWith("?")) return !s.startsWith("//") || /^\/\/[a-z0-9.-]+\//.test(s);
  const m = /^([a-z][a-z0-9+.-]*):/.exec(s);
  if (!m) return true; // relative path like "page.html"
  return ["http", "https", "mailto", "tel"].includes(m[1]!);
}

/** Plain text safe for <title>, meta and JSON-LD: no markup, no control characters, bounded. */
export function cleanText(s: unknown, max = 500): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
