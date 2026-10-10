#!/usr/bin/env node
// faq-engine CLI. Run from the site's repository root.
//   faq-engine install [dir] [--update]   copy the engine into a site and scaffold its config
//   faq-engine scan        build the content inventory from the configured adapters
//   faq-engine propose     candidates -> duplicate check -> grounding -> categories -> link proposals -> .faq/proposal.{json,md}
//   faq-engine apply       merge the proposal into the registry (never overwrites an existing or hand-edited answer)
//   faq-engine update      scan + propose in one go: what changed on the site since the last run
//   faq-engine build       write the SEO registry export
//   faq-engine validate    fail on anything that must not ship
//   faq-engine report      plain-language summary of the registry
//   faq-engine status      where the run stands and the one best next step (read-only; --json for tools)
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig, fromRoot } from './config.mjs';
import { scan, loadInventory, applyProposal, buildAll, propose, loadRegistry, saveRegistry, writeJson } from './engine.mjs';
import { proposalMarkdown, importedPageFaqs } from './propose.mjs';
import { validate } from './validate.mjs';
import { install, verifyInstall, syncSkills } from './install.mjs';
import { faqState, formatState } from './state.mjs';

function out(file, text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }

/**
 * Run one command. `hooks.config(cfg)` lets a site wrapper adjust the loaded config in code (e.g. fill a {{token}} from the site's own constants).
 * Returns the process exit code.
 */
export async function main(args, hooks = {}) {
  const cmd = args[0];
  const flag = (n) => args.includes(`--${n}`);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  if (!cmd || cmd === 'help' || flag('help')) {
    console.log('Usage: faq-engine <install|status|scan|propose|apply|update|build|validate|report> [--config faq/faq.config.json] [--drafts-only]');
    return 0;
  }
  if (cmd === 'install') {
    const target = args[1] && !args[1].startsWith('--') ? args[1] : process.cwd();
    if (flag('verify')) {
      const v = verifyInstall(target);
      for (const p of v.problems) console.log(`problem: ${p}`);
      console.log(v.ok ? `Installation verified: engine ${v.version}, ${v.files} files match the receipt.` : 'Installation NOT verified.');
      return v.ok ? 0 : 1;
    }
    if (flag('sync-skills')) {
      const r = syncSkills(target, { dir: opt('dir'), dryRun: flag('dry-run') });
      for (const f of r.actions) console.log(`${r.dryRun ? 'would ' : ''}${f.action} ${f.file}`);
      console.log(r.dryRun ? 'Dry run: nothing was changed.' : `Skills synced to ${r.dir}.`);
      return r.conflicts ? 1 : 0;
    }
    const r = install(target, { update: flag('update'), dryRun: flag('dry-run') });
    if (r.dryRun) {
      for (const l of r.plan) console.log(`would ${l}`);
      console.log('Dry run: nothing was changed.');
      return 0;
    }
    console.log(`Installed FAQ Engine ${r.version}. Created: ${r.created.join(', ') || 'nothing (site files already exist)'}`);
    console.log('Next recommended action: set up faq/faq.config.json (/BWEFAQSetup), then run: node faq/engine/src/cli.mjs status');
    return 0;
  }
  if (cmd === 'status') {
    const s = faqState({ root: process.cwd(), configFile: opt('config') ?? 'faq/faq.config.json' });
    console.log(flag('json') ? JSON.stringify(s, null, 2) : formatState(s));
    return 0;
  }
  const cfg = loadConfig(opt('config') ?? 'faq/faq.config.json');
  hooks.config?.(cfg);
  if (cmd === 'scan') {
    const inv = scan(cfg);
    console.log(`Inventory: ${inv.summary.pages} pages (${inv.summary.indexable} indexable); ${inv.summary.existingFaqs} existing FAQs on ${inv.summary.withExistingFaqs} pages.`);
    console.log('By type:', JSON.stringify(inv.summary.byType));
    return 0;
  }
  if (cmd === 'propose' || cmd === 'update') {
    const inv = cmd === 'update' ? scan(cfg) : loadInventory(cfg);
    const p = propose({ cfg, inventory: inv, registry: loadRegistry(cfg) });
    writeJson(fromRoot(cfg, cfg.paths.proposal), p);
    out(fromRoot(cfg, cfg.paths.proposalReport), proposalMarkdown(p, cfg));
    console.log(`Proposal: ${p.adds.length} new, ${p.merged.length} merged as duplicates, ${p.skipped.length} skipped, ${p.review.changes.length} existing FAQs changed state.`);
    console.log(`Written to ${cfg.paths.proposal} and ${cfg.paths.proposalReport}. Nothing was changed. Run "faq-engine apply" to accept.`);
    return 0;
  }
  if (cmd === 'apply') {
    const file = fromRoot(cfg, cfg.paths.proposal);
    if (!existsSync(file)) throw new Error('No proposal. Run: faq-engine propose');
    const proposal = JSON.parse(readFileSync(file, 'utf8'));
    const { registry, added } = applyProposal(cfg, loadRegistry(cfg), proposal, { draftsOnly: flag('drafts-only') });
    saveRegistry(cfg, registry);
    console.log(`Applied: ${added.length} added (${added.filter((a) => a.status === 'ACTIVE').length} ACTIVE), ${proposal.review?.changes.length ?? 0} existing FAQs re-checked.`);
    return 0;
  }
  if (cmd === 'build') {
    const inv = existsSync(fromRoot(cfg, cfg.paths.inventory)) ? loadInventory(cfg) : null;
    const b = buildAll(cfg, loadRegistry(cfg), inv);
    writeJson(fromRoot(cfg, cfg.paths.seoRegistry), b.seo);
    console.log(`SEO registry: ${b.seo.faqs.length} FAQs, ${b.seo.categories.length} categories, ${b.seo.pages.length} pages -> ${cfg.paths.seoRegistry}`);
    return 0;
  }
  if (cmd === 'validate') {
    const inv = existsSync(fromRoot(cfg, cfg.paths.inventory)) ? loadInventory(cfg) : null;
    const reg = loadRegistry(cfg);
    const r = validate({ cfg, registry: reg, imported: inv ? importedPageFaqs(inv, cfg) : [], inventory: inv });
    for (const w of r.warnings) console.log(`warn  ${w.id}: ${w.msg}`);
    for (const e of r.errors) console.log(`ERROR ${e.id}: ${e.msg}`);
    console.log(`${r.errors.length} error(s), ${r.warnings.length} warning(s). ${JSON.stringify(r.stats.byStatus)}; search=${r.stats.search}; schema=${r.stats.schema}`);
    return r.errors.length ? 1 : 0;
  }
  if (cmd === 'report') {
    const inv = existsSync(fromRoot(cfg, cfg.paths.inventory)) ? loadInventory(cfg) : null;
    const reg = loadRegistry(cfg);
    const b = buildAll(cfg, reg, inv);
    console.log(JSON.stringify({ counts: b.seo.counts, categories: b.organised.categories, showCategories: b.organised.showCategories }, null, 2));
    return 0;
  }
  console.error(`Unknown command: ${cmd}`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
}
