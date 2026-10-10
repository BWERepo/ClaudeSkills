// BWESEO Google Business Profile — manual performance import (pure, zero dependencies).
//
// Until Business Profile Performance API access is approved, the administrator may import figures they copied or exported from the
// Business Profile interface. Imported rows are labelled "manual-import", with who imported them and when. The engine never estimates,
// interpolates or invents a figure, never mixes these with Search Console data, and reports every metric it has no data for as unavailable.

export const METRICS = ["searchViewsMaps", "searchViewsSearch", "calls", "websiteClicks", "directions", "messages", "bookings"];
export const WINDOWS = [7, 28, 90];
const DAY = 86400000;

// Accepts JSON rows [{date, metric, value}] or [{date, calls, websiteClicks…}] (wide), or CSV text with the same headers.
export function parseCsv(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((c, i) => [head[i], c.trim()])));
}

export function importPerformance(input, existing = [], { by, at = new Date().toISOString() } = {}) {
  if (!by) throw new Error("Name who is importing the figures.");
  const rows = typeof input === "string" ? parseCsv(input) : Array.isArray(input) ? input : [];
  const errors = [];
  const key = (r) => `${r.date}|${r.metric}`;
  const map = new Map(existing.map((r) => [key(r), r]));
  let added = 0, replaced = 0;
  const put = (date, metric, raw, i) => {
    const value = Number(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return void errors.push(`row ${i + 1}: date must be YYYY-MM-DD`);
    if (!METRICS.includes(metric)) return void errors.push(`row ${i + 1}: unknown metric "${metric}" (allowed: ${METRICS.join(", ")})`);
    if (raw === "" || raw == null || !Number.isFinite(value) || value < 0) return void errors.push(`row ${i + 1}: ${metric} needs a non-negative number`);
    const rec = { date, metric, value, source: "manual-import", importedBy: by, importedAt: at };
    if (map.has(key(rec))) replaced++; else added++;
    map.set(key(rec), rec);
  };
  rows.forEach((r, i) => {
    if (r.metric !== undefined) put(r.date, r.metric, r.value, i);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) errors.push(`row ${i + 1}: date must be YYYY-MM-DD`);
    else for (const m of METRICS) if (r[m] !== undefined && r[m] !== "") put(r.date, m, r[m], i);
  });
  return { rows: [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.metric < b.metric ? -1 : 1)), added, replaced, errors };
}

const sumBetween = (rows, metric, from, to) => rows.filter((r) => r.metric === metric && r.date > from && r.date <= to);
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// For each metric and window: total, previous-period total and change, and how many days of data back it. Metrics without data are "unavailable".
export function summarize(rows, today = new Date().toISOString().slice(0, 10)) {
  const out = { source: "manual import from the Business Profile interface; Google-reported, not verified by BWESEO. Separate from Search Console data.", asOf: today, metrics: {}, history: {} };
  for (const m of METRICS) {
    const all = rows.filter((r) => r.metric === m);
    if (!all.length) { out.metrics[m] = { available: false, note: "No data imported. Not estimated." }; continue; }
    out.history[m] = all.map((r) => ({ date: r.date, value: r.value }));
    const windows = {};
    for (const w of WINDOWS) {
      const end = Date.parse(today), mid = iso(end - w * DAY), start = iso(end - 2 * w * DAY);
      const cur = sumBetween(rows, m, mid, today), prev = sumBetween(rows, m, start, mid);
      if (!cur.length) { windows[w] = { available: false, note: `No data in the last ${w} days.` }; continue; }
      const total = cur.reduce((s, r) => s + r.value, 0), pt = prev.reduce((s, r) => s + r.value, 0);
      windows[w] = { available: true, total, daysWithData: new Set(cur.map((r) => r.date)).size, partial: new Set(cur.map((r) => r.date)).size < w, previous: prev.length ? pt : null, changePct: prev.length && pt > 0 ? Math.round(((total - pt) / pt) * 1000) / 10 : null };
    }
    out.metrics[m] = { available: true, windows, lastDate: all.reduce((a, r) => (r.date > a ? r.date : a), "") };
  }
  return out;
}
