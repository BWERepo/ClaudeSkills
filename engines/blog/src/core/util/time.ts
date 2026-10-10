/** Clock indirection so tests and repeat runs are deterministic. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

export const isoNow = (c: Clock): string => c.now().toISOString();
export const isoDate = (d: Date | string): string => (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);

/** Parse a loosely formatted date from frontmatter/meta. Returns ISO string or undefined (never guesses). */
export function parseLooseDate(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) && !/^[A-Z][a-z]+ \d{1,2},? \d{4}/.test(s) && !/^\d{1,2} [A-Z][a-z]+ \d{4}/.test(s)) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export const daysBetween = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 86_400_000;
