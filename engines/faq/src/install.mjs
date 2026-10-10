// Installer: copies the engine core into a site (faq/engine/) the same way the site then runs it, and scaffolds site-owned files once.
// The engine copy is managed: `install --update` replaces it. Site-owned files (faq/faq.config.json, faq/faq-registry.json, faq/candidates.json) are never touched after creation.
// Modes (all run from the engine repository, targeting a website folder):
//   install [site]                    install, scaffold site files, write a receipt (faq/engine/INSTALL.json) with a hash of every engine file
//   install [site] --dry-run          show exactly what would happen, change nothing
//   install [site] --update           replace the engine copy, keep the site's files
//   install [site] --verify           check the installed copy against its receipt, change nothing
//   install [site] --sync-skills      copy the Claude skills into <site>/.claude/skills (--dir <folder> to use another folder; --dry-run to preview)
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = resolve(HERE, '..');
const PAYLOAD = ['src', 'client', 'docs']; // folders copied into faq/engine/
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

function filesUnder(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out.sort();
}

const payloadFiles = () => PAYLOAD.filter((d) => existsSync(join(ENGINE_ROOT, d))).flatMap((d) => filesUnder(join(ENGINE_ROOT, d)).map((f) => relative(ENGINE_ROOT, f).split('\\').join('/')));

export function install(targetRoot, { update = false, dryRun = false } = {}) {
  const pkg = JSON.parse(readFileSync(join(ENGINE_ROOT, 'package.json'), 'utf8'));
  const dest = resolve(targetRoot, 'faq/engine');
  const exists = existsSync(dest);
  if (exists && !update && !dryRun) throw new Error(`${dest} exists. Use --update to replace the engine copy (site files are kept).`);
  const files = payloadFiles();
  const siteFiles = ['faq/faq.config.json', 'faq/faq-registry.json', 'faq/candidates.json'];
  if (dryRun) {
    const plan = [`${exists ? 'replace' : 'create'} faq/engine/ (${files.length} files, engine ${pkg.version})`];
    for (const f of siteFiles) plan.push(existsSync(resolve(targetRoot, f)) ? `keep ${f} (already exists)` : `create ${f}`);
    plan.push('write faq/engine/INSTALL.json (receipt)', 'ensure .faq/ is in .gitignore');
    if (exists && !update) plan.unshift('REFUSE: faq/engine already exists; pass --update to replace it');
    return { dryRun: true, version: pkg.version, plan };
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const d of PAYLOAD) if (existsSync(join(ENGINE_ROOT, d))) cpSync(join(ENGINE_ROOT, d), join(dest, d), { recursive: true });
  const hashes = Object.fromEntries(files.map((f) => [f, sha(join(ENGINE_ROOT, f))]));
  writeFileSync(join(dest, 'INSTALL.json'), JSON.stringify({ engine: 'faq-engine', version: pkg.version, note: 'Managed copy of the reusable FAQ Engine. Do not edit by hand; run `install --update` from the engine repository.', files: hashes }, null, 2) + '\n');
  const created = [];
  const scaffold = (rel, content) => {
    const f = resolve(targetRoot, rel);
    if (existsSync(f)) return;
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, content);
    created.push(rel);
  };
  scaffold('faq/faq.config.json', readFileSync(join(ENGINE_ROOT, 'templates/faq.config.example.json'), 'utf8'));
  scaffold('faq/faq-registry.json', JSON.stringify({ schema: 1, categories: [], items: [] }, null, 2) + '\n');
  scaffold('faq/candidates.json', JSON.stringify({ candidates: [] }, null, 2) + '\n');
  const gi = resolve(targetRoot, '.gitignore');
  const text = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!/^\.faq\/?$/m.test(text)) writeFileSync(gi, text + (text.endsWith('\n') || !text ? '' : '\n') + '.faq/\n');
  return { version: pkg.version, created };
}

/** Compare the installed copy with its receipt: missing, modified and unexpected files are problems. */
export function verifyInstall(targetRoot) {
  const dest = resolve(targetRoot, 'faq/engine');
  const receiptFile = join(dest, 'INSTALL.json');
  if (!existsSync(receiptFile)) return { ok: false, version: null, files: 0, problems: ['FAQ Engine is not installed here (no faq/engine/INSTALL.json)'] };
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  const problems = [];
  for (const [f, h] of Object.entries(receipt.files ?? {})) {
    const p = join(dest, f);
    if (!existsSync(p)) problems.push(`missing: ${f}`);
    else if (sha(p) !== h) problems.push(`modified: ${f}`);
  }
  for (const d of PAYLOAD) {
    const base = join(dest, d);
    if (!existsSync(base)) continue;
    for (const f of filesUnder(base)) {
      const rel = relative(dest, f).split('\\').join('/');
      if (!(rel in (receipt.files ?? {}))) problems.push(`unexpected: ${rel}`);
    }
  }
  return { ok: !problems.length, version: receipt.version, files: Object.keys(receipt.files ?? {}).length, problems };
}

/** Copy the Claude skills from the engine repository into a skills folder. A skill file edited by hand since the last sync is a conflict and is left alone. */
export function syncSkills(targetRoot, { dir, dryRun = false } = {}) {
  const src = join(ENGINE_ROOT, 'skills');
  if (!existsSync(src)) throw new Error('This copy of the engine has no skills/ folder. Run sync from the engine repository.');
  const dest = resolve(dir ?? join(targetRoot, '.claude/skills'));
  const stateFile = join(dest, '.bwefaq-skills.json');
  const prev = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const next = { ...prev };
  const actions = [];
  let conflicts = 0;
  for (const f of filesUnder(src)) {
    const rel = relative(src, f).split('\\').join('/');
    const to = join(dest, rel);
    const h = sha(f);
    if (!existsSync(to)) actions.push({ action: 'install', file: rel, h });
    else if (sha(to) === h) { next[rel] = h; continue; }
    else if (prev[rel] && sha(to) === prev[rel]) actions.push({ action: 'update', file: rel, h });
    else { actions.push({ action: 'CONFLICT (edited by hand, left alone)', file: rel }); conflicts++; }
  }
  if (!dryRun) {
    for (const a of actions) {
      if (!a.h) continue;
      mkdirSync(dirname(join(dest, a.file)), { recursive: true });
      cpSync(join(src, a.file), join(dest, a.file));
      next[a.file] = a.h;
    }
    mkdirSync(dest, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n');
  }
  return { dir: dest, dryRun, actions, conflicts };
}
