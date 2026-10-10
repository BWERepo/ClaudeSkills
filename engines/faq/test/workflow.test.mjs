import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, verifyInstall, syncSkills } from '../src/install.mjs';
import { faqState, formatState } from '../src/state.mjs';
import { checkGuide } from '../scripts/show-guide.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'faq-site-'));
const write = (f, text) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const configure = (site) => {
  const f = join(site, 'faq/faq.config.json');
  const c = JSON.parse(readFileSync(f, 'utf8'));
  c.site = { name: 'Demo', url: 'https://demo.test' };
  c.adapters = [{ type: 'html-dir', dir: 'dist' }];
  writeFileSync(f, JSON.stringify(c));
};

test('install --dry-run changes nothing', () => {
  const site = tmp();
  const r = install(site, { dryRun: true });
  assert.ok(r.dryRun && r.plan.length > 3);
  assert.equal(existsSync(join(site, 'faq')), false);
});

test('install writes a receipt, verify passes, then catches a modified file', () => {
  const site = tmp();
  const r = install(site);
  assert.ok(r.created.includes('faq/faq.config.json'));
  assert.equal(verifyInstall(site).ok, true);
  assert.throws(() => install(site), /--update/);
  writeFileSync(join(site, 'faq/engine/src/text.mjs'), '// tampered\n');
  const v = verifyInstall(site);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => p.startsWith('modified: src/text.mjs')));
  install(site, { update: true });
  assert.equal(verifyInstall(site).ok, true);
});

test('verify reports a site with no install', () => {
  assert.equal(verifyInstall(tmp()).ok, false);
});

test('sync-skills installs, is idempotent, updates, and leaves hand edits alone', () => {
  const site = tmp();
  const a = syncSkills(site, { dryRun: true });
  assert.ok(a.actions.length >= 7);
  assert.equal(existsSync(join(site, '.claude/skills')), false);
  syncSkills(site);
  assert.ok(existsSync(join(site, '.claude/skills/BWEFAQ/SKILL.md')));
  assert.equal(syncSkills(site).actions.length, 0);
  const f = join(site, '.claude/skills/BWEFAQReview/SKILL.md');
  writeFileSync(f, readFileSync(f, 'utf8') + '\nmy note\n');
  const r = syncSkills(site);
  assert.equal(r.conflicts, 1);
  assert.match(readFileSync(f, 'utf8'), /my note/);
});

test('status walks the stages and recommends one next step', () => {
  const site = tmp();
  let s = faqState({ root: site });
  assert.equal(s.next.stage, 'INSTALL');
  install(site);
  s = faqState({ root: site });
  assert.equal(s.next.stage, 'CONFIGURE');
  assert.equal(s.next.skill, '/BWEFAQSetup');
  configure(site);
  s = faqState({ root: site });
  assert.equal(s.next.stage, 'SCAN');
  write(join(site, '.faq/inventory.json'), JSON.stringify({ pages: [], summary: {} }));
  s = faqState({ root: site });
  assert.equal(s.next.stage, 'PROPOSE');
  write(join(site, '.faq/proposal.json'), JSON.stringify({ adds: [{ id: 'a-question' }], review: { changes: [] } }));
  s = faqState({ root: site });
  assert.equal(s.next.stage, 'REVIEW');
  assert.equal(s.pendingAdds, 1);
  assert.match(formatState(s), /▸ REVIEW/);
});

test('status reports ACTIVE FAQs, held items and an unwired page', () => {
  const site = tmp();
  install(site);
  configure(site);
  write(join(site, '.faq/inventory.json'), JSON.stringify({ pages: [], summary: {} }));
  write(join(site, '.faq/proposal.json'), JSON.stringify({ adds: [] }));
  const item = (id, status, extra = {}) => ({ id, anchor: id, question: `${id}?`, answer: 'x', category: 'general', status, origin: 'manual', ...extra });
  write(join(site, 'faq/faq-registry.json'), JSON.stringify({ schema: 1, categories: [], items: [item('one', 'ACTIVE'), item('two', 'NEEDS REVIEW', { reviewReason: 'quote not found' })] }));
  write(join(site, 'dist/faq/index.html'), '<html><body>no faq output</body></html>');
  const s = faqState({ root: site });
  assert.equal(s.counts.ACTIVE, 1);
  assert.equal(s.counts['NEEDS REVIEW'], 1);
  assert.equal(s.wired, false);
  assert.equal(s.next.stage, 'WIRE PAGE');
  assert.ok(s.needsYou.some((n) => n.includes('quote not found')));
  write(join(site, 'dist/faq/index.html'), '<div class="faq-engine" data-faq-root></div>');
  assert.equal(faqState({ root: site }).wired, true);
});

test('the user manual matches the engine', () => {
  assert.deepEqual(checkGuide(ROOT), []);
});

test('every skill has valid front matter and no CRLF', () => {
  for (const base of ['skills', '.claude/skills']) {
    for (const name of readdirSync(join(ROOT, base))) {
      const file = join(ROOT, base, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      assert.ok(!text.includes('\r'), `${name} has CRLF`);
      const lines = text.split('\n');
      assert.equal(lines[0], '---');
      assert.equal(lines[1], `name: ${name}`);
      assert.match(lines[2], /^description: .{40,}/);
      assert.equal(lines[3], '---');
    }
  }
});

test('the engine stays site-neutral', () => {
  const bad = /one\s*click|oneclickanswers/i;
  const scan = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === '.git' || e.name === 'node_modules' ? [] : e.isDirectory() ? scan(join(dir, e.name)) : [join(dir, e.name)]));
  for (const f of scan(ROOT).filter((x) => /\.(md|mjs|js|json|yml|css)$/.test(x) && !x.endsWith('workflow.test.mjs'))) assert.ok(!bad.test(readFileSync(f, 'utf8')), `${f} names a specific site`);
});
