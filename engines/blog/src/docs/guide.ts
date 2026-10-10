import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "../core/content/markdown.js";
import { slugify } from "../core/util/slug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `docs/INSTALL-AND-USE.md` ships inside the npm package (see package.json "files") one directory up
 * from this compiled module, exactly as it sits one directory up from this source file in the repo.
 * So the same relative path resolves correctly whether this runs from `src/docs` or `dist/docs`.
 */
const GUIDE_PATH = path.join(__dirname, "../../docs/INSTALL-AND-USE.md");

export interface GuideSection {
  id: string;
  level: number;
  title: string;
}

let cachedMarkdown: string | undefined;
let cachedHtml: string | undefined;
let cachedSections: { section: GuideSection; markdownIndex: number }[] | undefined;

/** Raw Markdown of the install/usage guide. Throws if it's missing (a broken install or build). */
export function loadGuideMarkdown(): string {
  if (cachedMarkdown !== undefined) return cachedMarkdown;
  if (!existsSync(GUIDE_PATH)) throw new Error(`install guide not found at ${GUIDE_PATH}; this looks like a broken install or build`);
  cachedMarkdown = readFileSync(GUIDE_PATH, "utf8");
  return cachedMarkdown;
}

/** Guide rendered to sanitized HTML, with heading ids matching guideSections(), for the admin dashboard's Guide tab. */
export function loadGuideHtml(): string {
  return (cachedHtml ??= renderMarkdown(loadGuideMarkdown()));
}

/**
 * Every heading in the guide, in document order, with the same id `renderMarkdown` gives it (same
 * slug algorithm, same left-to-right dedup), so a link built from this id lands on the right element
 * in the rendered HTML. Parsed straight from the Markdown source rather than round-tripped through
 * HTML, since not every heading level survives sanitization with an id attribute (e.g. `<h1>`).
 */
function parsedSections(): { section: GuideSection; markdownIndex: number }[] {
  if (cachedSections) return cachedSections;
  const md = loadGuideMarkdown();
  const used = new Set<string>();
  cachedSections = [...md.matchAll(/^(#{1,4})\s+(.+?)\s*$/gm)].map((m, markdownIndex) => {
    const level = m[1]!.length;
    const title = m[2]!.replace(/[`*_]/g, "");
    let id = slugify(title, { maxLength: 60 });
    let i = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${i++}`;
    used.add(id);
    return { section: { id, level, title: m[2]! }, markdownIndex };
  });
  return cachedSections;
}

/**
 * Every linkable heading in the guide, in document order. Excludes the top-level `<h1>` (the guide's own
 * title): the sanitizer that cleans the rendered HTML never keeps an `id` on `<h1>`, so it has no anchor
 * to link to.
 */
export function guideSections(): GuideSection[] {
  return parsedSections()
    .map((s) => s.section)
    .filter((s) => s.level > 1);
}

/** First heading whose title contains (case-insensitive) any of the given keywords. */
export function findGuideSection(...keywords: string[]): GuideSection | undefined {
  const lower = keywords.map((k) => k.toLowerCase());
  return guideSections().find((s) => lower.some((k) => s.title.toLowerCase().includes(k)));
}

/** Markdown of one section (its heading up to, but not including, the next heading of equal-or-lower depth). */
export function guideSectionMarkdown(id: string): string | undefined {
  const all = parsedSections();
  const idx = all.findIndex((s) => s.section.id === id);
  if (idx === -1) return undefined;
  const target = all[idx]!.section;
  const md = loadGuideMarkdown();
  const headingLines = [...md.matchAll(/^#{1,4}\s+.*$/gm)];
  const heading = headingLines[idx];
  if (!heading) return undefined;
  const next = headingLines.slice(idx + 1).find((h) => (h[0].match(/^#+/)?.[0].length ?? 99) <= target.level);
  const end = next ? next.index! : md.length;
  return md.slice(heading.index!, end).trim();
}
