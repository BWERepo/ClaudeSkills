import { STOPWORDS, words } from "../util/text.js";

const GENERIC = /^(click here|here|read more|learn more|this|this page|this article|more|link|website|page|find out more|see more|details)$/i;

export interface AnchorTarget {
  title: string;
  h1?: string;
  primaryTopic?: string;
}

export interface AnchorMatch {
  anchor: string;
  sentence: string;
}

/** Candidate anchor phrases for a target, longest first: n-grams of its title/H1/topic that read as noun phrases. */
export function anchorCandidates(t: AnchorTarget): string[] {
  const out = new Set<string>();
  for (const src of [t.h1, t.title, t.primaryTopic].filter((x): x is string => !!x)) {
    const clean = src.replace(/\s*[|–—]\s.*$/, "").replace(/[?!:.,()"“”]/g, " ");
    const w = words(clean);
    for (let n = Math.min(7, w.length); n >= 2; n--) {
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n);
        if (STOPWORDS.has(g[0]!) || STOPWORDS.has(g[n - 1]!)) continue;
        if (g.every((x) => STOPWORDS.has(x) || x.length < 3)) continue;
        const phrase = g.join(" ");
        if (!GENERIC.test(phrase)) out.add(phrase);
      }
    }
  }
  return [...out].sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);
}

/** Text segments of a Markdown document where a link may be inserted (not headings, code, tables, or existing links). */
function eligibleParagraphs(md: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let inFence = false;
  let offset = 0;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) inFence = !inFence;
    const ok = !inFence && t && !t.startsWith("#") && !t.startsWith("|") && !t.startsWith(">") && !t.startsWith("<") && !/^\*[^*]+\*$/.test(t);
    if (ok) out.push({ start: offset, text: line });
    offset += line.length + 1;
  }
  return out;
}

const LINK_RE = /!?\[[^\]]*\]\([^)]*\)/g;

/** Find the best natural anchor for `target` already present in `md` (outside existing links). */
export function findAnchor(md: string, target: AnchorTarget, avoid: Set<string> = new Set()): AnchorMatch | undefined {
  const paras = eligibleParagraphs(md);
  for (const phrase of anchorCandidates(target)) {
    if (avoid.has(phrase)) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${phrase.split(" ").map(escapeRe).join("[\\s-]+")})(?=$|[^\\p{L}\\p{N}])`, "iu");
    for (const p of paras) {
      const plain = p.text.replace(LINK_RE, (m) => " ".repeat(m.length));
      const m = re.exec(plain);
      if (m) {
        const idx = m.index + m[1]!.length;
        const sentence = sentenceAround(p.text, idx);
        return { anchor: p.text.slice(idx, idx + m[2]!.length), sentence };
      }
    }
  }
  return undefined;
}

/** Wrap the first eligible occurrence of `anchor` in a Markdown link. Returns null when no safe spot exists. */
export function insertLink(md: string, anchor: string, href: string): string | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(anchor)})(?=$|[^\\p{L}\\p{N}])`, "u");
  for (const p of eligibleParagraphs(md)) {
    const plain = p.text.replace(LINK_RE, (m) => " ".repeat(m.length));
    const m = re.exec(plain);
    if (!m) continue;
    const at = p.start + m.index + m[1]!.length;
    return `${md.slice(0, at)}[${md.slice(at, at + anchor.length)}](${href})${md.slice(at + anchor.length)}`;
  }
  return null;
}

function sentenceAround(text: string, idx: number): string {
  const before = text.slice(0, idx);
  const s = Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "));
  const after = text.slice(idx);
  const e = after.search(/[.!?](\s|$)/);
  return text.slice(s === -1 ? 0 : s + 2, e === -1 ? text.length : idx + e + 1).trim().slice(0, 300);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isGenericAnchor = (a: string): boolean => GENERIC.test(a.trim());
