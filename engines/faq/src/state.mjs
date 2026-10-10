// State-aware status: reads a site's real FAQ Engine files and says where the run stands and the ONE best next step.
// Read-only. It never changes a file, calls the network or publishes anything.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadConfig } from './config.mjs';
import { loadRegistry } from './registry.mjs';
import { importedPageFaqs } from './propose.mjs';
import { validate } from './validate.mjs';

export const STAGES = ['INSTALL', 'CONFIGURE', 'SCAN', 'PROPOSE', 'REVIEW', 'APPLY', 'WIRE PAGE', 'BUILD', 'VALIDATE', 'PUBLISH'];

const SKILL = { INSTALL: '/BWEFAQInstall', CONFIGURE: '/BWEFAQSetup', SCAN: '/BWEFAQGenerate', PROPOSE: '/BWEFAQGenerate', REVIEW: '/BWEFAQReview', APPLY: '/BWEFAQReview', 'WIRE PAGE': '/BWEFAQPublish', BUILD: '/BWEFAQPublish', VALIDATE: '/BWEFAQPublish', PUBLISH: '/BWEFAQPublish' };
const CLI = 'node faq/engine/src/cli.mjs';
const COMMAND = { SCAN: `${CLI} scan`, PROPOSE: `${CLI} propose`, APPLY: `${CLI} apply`, BUILD: `${CLI} build`, VALIDATE: `${CLI} validate` };

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);

/** Placeholder values copied from the config template: the owner has not set the site up yet. */
function configProblems(cfg) {
  const out = [];
  if (!cfg.site.name || cfg.site.name === 'Your Site') out.push('site.name is not set');
  if (!cfg.site.url || /example\.com/.test(cfg.site.url)) out.push('site.url is not set');
  if (!cfg.adapters.length) out.push('no content adapter is configured');
  return out;
}

/** Is the FAQ page built into the site's output? Only the html-dir adapter can tell; otherwise null (unknown). */
function pageWired(cfg) {
  const a = cfg.adapters.find((x) => x.type === 'html-dir');
  if (!a) return null;
  const base = resolve(cfg.root, a.dir);
  const p = cfg.faqPage.path.replace(/^\/|\/$/g, '');
  for (const f of [join(base, p, 'index.html'), join(base, `${p}.html`)]) if (existsSync(f)) return readFileSync(f, 'utf8').includes('data-faq-root');
  return false;
}

export function faqState({ root = process.cwd(), configFile = 'faq/faq.config.json' } = {}) {
  const installed = existsSync(resolve(root, 'faq/engine/INSTALL.json'));
  const configPath = resolve(root, configFile);
  const st = { root, installed, hasConfig: existsSync(configPath), configProblems: [], counts: { ACTIVE: 0, DRAFT: 0, 'NEEDS REVIEW': 0, RETIRED: 0 }, pendingAdds: 0, candidates: 0, needsYou: [], wired: null, validate: null };
  const done = {};
  done.INSTALL = installed;
  let cfg = null;
  if (st.hasConfig) {
    cfg = loadConfig(configFile, root);
    st.configProblems = configProblems(cfg);
  } else st.configProblems = ['faq/faq.config.json does not exist'];
  done.CONFIGURE = st.hasConfig && !st.configProblems.length;

  let reg = { items: [] };
  let inventoryFile = null;
  let proposalFile = null;
  if (cfg) {
    inventoryFile = resolve(root, cfg.paths.inventory);
    proposalFile = resolve(root, cfg.paths.proposal);
    if (existsSync(resolve(root, cfg.paths.registry))) reg = loadRegistry(cfg);
    for (const i of reg.items) st.counts[i.status] = (st.counts[i.status] ?? 0) + 1;
    const cand = resolve(root, cfg.paths.candidates);
    if (existsSync(cand)) { const d = readJson(cand); st.candidates = (d.candidates ?? d).length; }
    if (existsSync(proposalFile)) {
      const ids = new Set(reg.items.map((i) => i.id));
      st.pendingAdds = (readJson(proposalFile).adds ?? []).filter((a) => !ids.has(a.id)).length;
    }
    st.wired = pageWired(cfg);
    const seoFile = resolve(root, cfg.paths.seoRegistry);
    st.seoFresh = existsSync(seoFile) && mtime(seoFile) >= mtime(resolve(root, cfg.paths.registry));
    if (existsSync(resolve(root, cfg.paths.registry))) {
      const inv = existsSync(inventoryFile) ? readJson(inventoryFile) : null;
      const r = validate({ cfg, registry: reg, imported: inv ? importedPageFaqs(inv, cfg) : [], inventory: inv });
      st.validate = { errors: r.errors.length, warnings: r.warnings.length, first: r.errors.slice(0, 3).map((e) => `${e.id}: ${e.msg}`) };
    }
  }
  done.SCAN = !!inventoryFile && existsSync(inventoryFile);
  done.PROPOSE = (!!proposalFile && existsSync(proposalFile)) || reg.items.length > 0;
  done.REVIEW = done.PROPOSE && st.pendingAdds === 0;
  done.APPLY = st.counts.ACTIVE > 0 && st.pendingAdds === 0;
  done['WIRE PAGE'] = st.wired !== false && st.counts.ACTIVE > 0;
  done.BUILD = !!st.seoFresh && st.counts.ACTIVE > 0;
  done.VALIDATE = st.validate !== null && st.validate.errors === 0 && st.counts.ACTIVE > 0;
  done.PUBLISH = false; // the owner's own action: the engine cannot see a deploy

  for (const i of reg.items.filter((x) => x.status === 'NEEDS REVIEW')) st.needsYou.push(`${i.question}: ${i.reviewReason ?? 'held for review'}`);
  if (st.pendingAdds) st.needsYou.push(`${st.pendingAdds} proposed FAQ(s) are waiting for your review (.faq/proposal.md)`);
  if (st.hasConfig) for (const p of st.configProblems) st.needsYou.push(`config: ${p}`);
  if (st.wired === null && st.counts.ACTIVE) st.needsYou.push('FAQ page wiring cannot be checked automatically for this adapter: confirm the page shows the FAQs');

  let next = STAGES.find((s) => s !== 'PUBLISH' && !done[s]);
  let why = '';
  if (!next) {
    if (st.counts['NEEDS REVIEW']) { next = 'REVIEW'; why = `${st.counts['NEEDS REVIEW']} FAQ(s) are held back as NEEDS REVIEW.`; }
    else { next = 'PUBLISH'; why = 'Everything checks out. Publish your site the way you normally do. After the site changes, run an update.'; }
  } else {
    why = {
      INSTALL: 'The engine is not installed in this site yet.',
      CONFIGURE: `The site configuration is not finished: ${st.configProblems.join('; ')}.`,
      SCAN: 'No content inventory yet. Build the site, then scan it.',
      PROPOSE: 'Nothing has been proposed yet. Add candidates (optional), then propose.',
      REVIEW: `${st.pendingAdds} proposed FAQ(s) need your review before they are accepted.`,
      APPLY: 'No FAQ is published (ACTIVE) yet. Apply the reviewed proposal, or add candidates that cite site text.',
      'WIRE PAGE': 'The FAQ page does not show the engine output yet. Add the renderer, stylesheet and script to the page.',
      BUILD: 'The SEO export is missing or older than the registry.',
      VALIDATE: st.validate ? `Validation reports ${st.validate.errors} error(s): ${st.validate.first.join(' | ')}` : 'Validation has not been run.',
    }[next];
  }
  const stages = STAGES.map((id) => ({ id, done: !!done[id], next: id === next }));
  return { ...st, stages, next: { stage: next, skill: SKILL[next], command: COMMAND[next] ?? null, why } };
}

export function formatState(s) {
  const mark = (x) => (x.next ? '▸' : x.done ? '✓' : '·');
  const L = ['FAQ ENGINE STATUS', ''];
  L.push(s.stages.map((x) => `${mark(x)} ${x.id}`).join('   '), '');
  L.push(`FAQs: ${s.counts.ACTIVE} ACTIVE, ${s.counts.DRAFT} DRAFT, ${s.counts['NEEDS REVIEW']} NEEDS REVIEW, ${s.counts.RETIRED} RETIRED. Candidates written: ${s.candidates}.`);
  if (s.validate) L.push(`Last validate: ${s.validate.errors} error(s), ${s.validate.warnings} warning(s).`);
  L.push(`FAQ page: ${s.wired === null ? 'not checked (no html-dir adapter)' : s.wired ? 'built with FAQ output' : 'not showing FAQ output'}`);
  L.push('', 'Needs you:');
  L.push(...(s.needsYou.length ? s.needsYou.slice(0, 10).map((n) => `- ${n}`) : ['- nothing right now']));
  if (s.needsYou.length > 10) L.push(`- ...and ${s.needsYou.length - 10} more`);
  L.push('', `Next step: ${s.next.stage}. ${s.next.why}`);
  if (s.next.skill) L.push(`Skill: ${s.next.skill}`);
  if (s.next.command) L.push(`Command: ${s.next.command}`);
  return L.join('\n') + '\n';
}
