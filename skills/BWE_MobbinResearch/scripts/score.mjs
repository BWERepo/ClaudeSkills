#!/usr/bin/env node
// BWE_MobbinResearch helper: weighted scores, ranking, duplicates, shortlist diversity,
// design-spec and skill-structure checks. Node 18+, no dependencies.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_WEIGHTS = { visual: 30, relevance: 25, usability: 20, mobile: 15, distinct: 10 };
export const DEFAULT_REQUIRED = ['homepage', 'navigation', 'catalog', 'detail', 'forms', 'mobile', 'conversion'];
export const DEFAULT_SHORTLIST = { min: 5, max: 8, perApp: 2, perFunction: 2 };
export const SPEC_SECTIONS = [
  'Project overview', 'Approval record', 'Approved design direction', 'Brand and visual principles',
  'Color tokens', 'Typography scale', 'Spacing system', 'Layout grids', 'Navigation patterns',
  'Page composition', 'Component specifications', 'Responsive behavior', 'Accessibility requirements',
  'Animation guidelines', 'SEO preservation', 'Approved references', 'Implementation priorities',
  'Acceptance criteria', 'Unresolved recommendations',
];

export function validateWeights(weights) {
  const errors = [];
  for (const [k, v] of Object.entries(weights)) {
    if (!(k in DEFAULT_WEIGHTS)) errors.push(`unknown weight "${k}"`);
    if (typeof v !== 'number' || v < 0) errors.push(`weight "${k}" must be a non-negative number`);
  }
  for (const k of Object.keys(DEFAULT_WEIGHTS)) if (!(k in weights)) errors.push(`missing weight "${k}"`);
  const total = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);
  if (total !== 100) errors.push(`weights total ${total}, must total 100`);
  return errors;
}

export function parseWeightsArg(text) {
  const w = {};
  for (const part of text.split(',')) {
    const [k, v] = part.split('=').map(s => s.trim());
    if (k) w[k] = Number(v);
  }
  return w;
}

export function weightedScore(scores, weights) {
  let sum = 0, total = 0;
  for (const [k, w] of Object.entries(weights)) { sum += scores[k] * w; total += w; }
  return Math.round((sum / total) * 10) / 10;
}

function validateCandidate(c, weights) {
  const errors = [];
  if (!c.id) errors.push('candidate without id');
  if (!c.source) errors.push(`${c.id}: missing source`);
  for (const k of Object.keys(weights)) {
    const s = c.scores?.[k];
    if (!Number.isInteger(s) || s < 1 || s > 10) errors.push(`${c.id}: score "${k}" must be an integer 1-10`);
  }
  return errors;
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normUrl = s => String(s ?? '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');

export function findDuplicates(candidates) {
  const dups = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      let reason = null;
      if (a.link && normUrl(a.link) === normUrl(b.link)) reason = 'same link';
      else if (a.image_url && normUrl(a.image_url) === normUrl(b.image_url)) reason = 'same image';
      else if (a.app && a.pattern && norm(a.app) === norm(b.app) && norm(a.pattern) === norm(b.pattern)
        && (a.platform ?? '') === (b.platform ?? '')) reason = 'same app and pattern';
      if (reason) dups.push({ a: a.id, b: b.id, reason });
    }
  }
  return dups;
}

export function rank(data) {
  const weights = data.weights ?? DEFAULT_WEIGHTS;
  const errors = validateWeights(weights);
  const candidates = data.candidates ?? [];
  if (!candidates.length) errors.push('no candidates');
  const ids = new Set();
  for (const c of candidates) {
    errors.push(...validateCandidate(c, weights));
    if (ids.has(c.id)) errors.push(`duplicate id "${c.id}"`);
    ids.add(c.id);
  }
  if (errors.length) return { errors };
  const ranked = candidates
    .map(c => ({ ...c, weighted: weightedScore(c.scores, weights) }))
    .sort((x, y) => y.weighted - x.weighted || y.scores.relevance - x.scores.relevance
      || y.scores.usability - x.scores.usability || String(x.id).localeCompare(String(y.id)))
    .map((c, i) => ({ ...c, rank: i + 1 }));
  return { errors: [], weights, ranked, duplicates: findDuplicates(ranked) };
}

const covers = (c, fn) => c.function === fn || (fn === 'mobile' && ['ios', 'android', 'mobile-web'].includes(c.platform));

export function shortlist(data) {
  const r = rank(data);
  if (r.errors.length) return r;
  const opts = { ...DEFAULT_SHORTLIST, ...(data.shortlist ?? {}) };
  const required = data.required ?? DEFAULT_REQUIRED;
  // The lower-ranked member of each duplicate pair is dropped.
  const dropped = new Set();
  const rankOf = Object.fromEntries(r.ranked.map(c => [c.id, c.rank]));
  for (const d of r.duplicates) dropped.add(rankOf[d.a] > rankOf[d.b] ? d.a : d.b);
  const pool = r.ranked.filter(c => !dropped.has(c.id));

  const picked = [], perApp = {}, perFn = {}, skipped = [];
  const fits = c => (perApp[norm(c.app)] ?? 0) < opts.perApp && (perFn[c.function] ?? 0) < opts.perFunction;
  const take = (c, why) => {
    picked.push({ ...c, why });
    perApp[norm(c.app)] = (perApp[norm(c.app)] ?? 0) + 1;
    perFn[c.function] = (perFn[c.function] ?? 0) + 1;
  };
  for (const c of pool) {
    if (picked.length >= opts.max) break;
    if (fits(c)) take(c, 'rank'); else skipped.push({ id: c.id, reason: 'diversity limit' });
  }
  // Coverage beats rank: fill each uncovered required function with its best remaining candidate.
  // When the list is full, that candidate replaces the lowest-ranked pick whose function is
  // covered more than once. A gap-filler may exceed the per-app limit; it says so.
  const uncovered = [];
  for (const fn of required) {
    if (picked.some(c => covers(c, fn))) continue;
    const best = pool.find(c => covers(c, fn) && !picked.some(p => p.id === c.id));
    if (best && picked.length >= opts.max) {
      const victim = [...picked].reverse().find(p => !p.why.startsWith('fills') && perFn[p.function] > 1);
      if (victim) {
        picked.splice(picked.indexOf(victim), 1);
        perApp[norm(victim.app)]--; perFn[victim.function]--;
        skipped.push({ id: victim.id, reason: `replaced to cover ${fn}` });
      }
    }
    if (best && picked.length < opts.max) {
      const over = (perApp[norm(best.app)] ?? 0) >= opts.perApp;
      take(best, `fills ${fn}${over ? ' (exceeds per-app limit)' : ''}`);
    } else uncovered.push({ function: fn, bestAvailable: best?.id ?? null });
  }
  picked.sort((x, y) => x.rank - y.rank);
  const warnings = [];
  if (picked.length < opts.min) warnings.push(`only ${picked.length} references, fewer than the minimum ${opts.min}`);
  if (r.ranked.length < 12) warnings.push(`only ${r.ranked.length} candidates reviewed; the skill expects at least 12`);
  return { errors: [], weights: r.weights, shortlist: picked, duplicates: r.duplicates, dropped: [...dropped], skipped, uncovered, warnings };
}

export function checkSpec(text) {
  const headings = [...text.matchAll(/^#{2,3}\s+(.+)$/gm)].map(m => m[1].trim().toLowerCase());
  const missing = SPEC_SECTIONS.filter(s => !headings.some(h => h.startsWith(s.toLowerCase())));
  const problems = missing.map(s => `missing section "${s}"`);
  const approval = text.split(/^##\s+Approval record/im)[1]?.split(/^##\s/m)[0] ?? '';
  if (!/\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(approval)) problems.push('approval record has no dated entry (YYYY-MM-DD)');
  if (!/\bApproved\b/.test(text)) problems.push('no item is marked Approved');
  return { ok: problems.length === 0, problems };
}

export function checkSkill(dir) {
  const problems = [];
  const skillMd = join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) return { ok: false, problems: ['SKILL.md not found'] };
  const text = readFileSync(skillMd, 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) problems.push('SKILL.md has no frontmatter');
  else {
    const name = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim();
    if (name !== basename(dir)) problems.push(`frontmatter name "${name}" does not match folder "${basename(dir)}"`);
    if (!/^description:\s*\S/m.test(fm[1])) problems.push('frontmatter has no description');
  }
  const refs = new Set([...text.matchAll(/`((?:reference|templates|scripts)\/[A-Za-z0-9_.\-]+)`/g)].map(m => m[1]));
  for (const ref of refs) if (!existsSync(join(dir, ref))) problems.push(`SKILL.md mentions missing file ${ref}`);
  return { ok: problems.length === 0, problems, checked: [...refs] };
}

function mdRank(r) {
  const rows = r.ranked.map(c => `| ${c.rank} | ${c.id} | ${c.app ?? ''} | ${c.source} | ${c.function ?? ''} | ${c.weighted.toFixed(1)} |`);
  const dups = r.duplicates.map(d => `- ${d.a} / ${d.b}: ${d.reason}`);
  return ['| Rank | Id | Reference | Source | Function | Score |', '|---|---|---|---|---|---|', ...rows,
    '', dups.length ? `Duplicates:\n${dups.join('\n')}` : 'Duplicates: none'].join('\n');
}

function mdShortlist(s) {
  const rows = s.shortlist.map(c => `| ${c.rank} | ${c.id} | ${c.app ?? ''} | ${c.source} | ${c.function ?? ''} | ${c.weighted.toFixed(1)} | ${c.why} |`);
  const out = ['| Rank | Id | Reference | Source | Function | Score | Why |', '|---|---|---|---|---|---|---|', ...rows, ''];
  out.push(s.uncovered.length ? `Uncovered: ${s.uncovered.map(u => u.function).join(', ')}` : 'Uncovered: none');
  if (s.dropped.length) out.push(`Dropped as duplicates: ${s.dropped.join(', ')}`);
  for (const w of s.warnings) out.push(`Warning: ${w}`);
  return out.join('\n');
}

const HELP = `Usage: node score.mjs <command> [file] [--md] [--weights k=v,...]
  rank <candidates.json>        weighted scores, ranking, duplicate warnings
  shortlist <candidates.json>   top 5-8 with diversity rules and coverage gaps
  check-spec <spec.md>          required sections and approval record
  check-skill [skill folder]    frontmatter and referenced files (default: this skill)`;

function main(argv) {
  const [cmd, file] = argv;
  const md = argv.includes('--md');
  const wi = argv.indexOf('--weights');
  const load = () => {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (wi >= 0) data.weights = parseWeightsArg(argv[wi + 1] ?? '');
    return data;
  };
  let result, text;
  switch (cmd) {
    case 'rank': result = rank(load()); text = !result.errors.length && md ? mdRank(result) : null; break;
    case 'shortlist': result = shortlist(load()); text = !result.errors.length && md ? mdShortlist(result) : null; break;
    case 'check-spec': result = checkSpec(readFileSync(file, 'utf8')); break;
    case 'check-skill': result = checkSkill(resolve(file && !file.startsWith('--') ? file : join(dirname(fileURLToPath(import.meta.url)), '..'))); break;
    default: console.log(HELP); return cmd && cmd !== 'help' ? 2 : 0;
  }
  console.log(text ?? JSON.stringify(result, null, 2));
  return result.errors?.length || result.ok === false ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
