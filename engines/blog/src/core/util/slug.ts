const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "your", "you", "is", "are", "vs"]);

/**
 * URL-safe slug: lowercase ASCII, hyphen-separated, transliterated where possible, max 80 chars,
 * cut on a word boundary. Leading articles are dropped only when the slug is long.
 */
export function slugify(input: string, opts: { maxLength?: number; dropStopWords?: boolean } = {}): string {
  const max = opts.maxLength ?? 80;
  let s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (opts.dropStopWords || s.length > max) {
    const parts = s.split("-");
    const kept = parts.filter((p, i) => !(STOP.has(p) && i !== parts.length - 1));
    if (kept.length) s = kept.join("-");
  }
  if (s.length > max) {
    s = s.slice(0, max);
    const cut = s.lastIndexOf("-");
    if (cut > max / 2) s = s.slice(0, cut);
  }
  return s.replace(/-+$/g, "") || "article";
}

/** Returns `base`, or `base-2`, `base-3`... the first one not in `taken`. Deterministic. */
export function uniqueSlug(base: string, taken: Set<string> | ((s: string) => boolean)): string {
  const has = typeof taken === "function" ? taken : (s: string) => taken.has(s);
  if (!has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const c = `${base}-${i}`;
    if (!has(c)) return c;
  }
  throw new Error(`could not find a unique slug for ${base}`);
}

export const isValidSlug = (s: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 120;
