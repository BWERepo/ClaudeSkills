// Tests for score.mjs. Run: node --test skills/BWE_MobbinResearch/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_WEIGHTS, SPEC_SECTIONS, validateWeights, parseWeightsArg, weightedScore,
  findDuplicates, rank, shortlist, checkSpec, checkSkill,
} from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = name => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));

test('default weights total 100 and validate', () => {
  assert.deepEqual(validateWeights(DEFAULT_WEIGHTS), []);
});

test('bad weights are reported', () => {
  const errs = validateWeights({ visual: 50, relevance: 25, usability: 20, mobile: 15 });
  assert.ok(errs.some(e => e.includes('missing weight "distinct"')));
  assert.ok(errs.some(e => e.includes('total 110')));
  assert.ok(validateWeights({ ...DEFAULT_WEIGHTS, colour: 0 }).some(e => e.includes('unknown')));
});

test('weights argument parses', () => {
  assert.deepEqual(parseWeightsArg('visual=25, relevance=30,usability=20,mobile=15,distinct=10'),
    { visual: 25, relevance: 30, usability: 20, mobile: 15, distinct: 10 });
});

test('weighted score matches hand calculation', () => {
  // (9*30 + 8*25 + 8*20 + 7*15 + 8*10) / 100 = 8.15 -> 8.2
  assert.equal(weightedScore({ visual: 9, relevance: 8, usability: 8, mobile: 7, distinct: 8 }, DEFAULT_WEIGHTS), 8.2);
  assert.equal(weightedScore({ visual: 10, relevance: 10, usability: 10, mobile: 10, distinct: 10 }, DEFAULT_WEIGHTS), 10);
});

test('custom weights change the ranking', () => {
  const data = {
    candidates: [
      { id: 'pretty', source: 'fixture', scores: { visual: 10, relevance: 5, usability: 5, mobile: 5, distinct: 5 } },
      { id: 'usable', source: 'fixture', scores: { visual: 5, relevance: 5, usability: 10, mobile: 5, distinct: 5 } },
    ],
  };
  assert.equal(rank(data).ranked[0].id, 'pretty');
  data.weights = { visual: 10, relevance: 20, usability: 50, mobile: 10, distinct: 10 };
  assert.equal(rank(data).ranked[0].id, 'usable');
});

test('ties break by relevance, then usability, then id', () => {
  const s = (v, r, u) => ({ visual: v, relevance: r, usability: u, mobile: 5, distinct: 5 });
  const r = rank({ candidates: [
    { id: 'b', source: 'fixture', scores: s(5, 5, 5) },
    { id: 'a', source: 'fixture', scores: s(5, 5, 5) },
    { id: 'low', source: 'fixture', scores: s(4, 7, 3) }, // 4.8, below the tied pair at 5.0
  ] });
  assert.deepEqual(r.ranked.filter(c => c.weighted === r.ranked[0].weighted).map(c => c.id).slice(0, 2), ['a', 'b']);
  const t = rank({ candidates: [
    { id: 'x', source: 'fixture', scores: s(6, 4, 5) }, // 180+100+100 = 380 + 125 = 5.1
    { id: 'y', source: 'fixture', scores: s(4, 6, 6) }, // 120+150+120 = 390 + 125 = 5.2
    { id: 'z', source: 'fixture', scores: s(5, 6, 4) }, // 150+150+80 = 380 + 125 = 5.1
  ] });
  assert.deepEqual(t.ranked.map(c => c.id), ['y', 'z', 'x']);
});

test('invalid scores and ids are rejected, not ranked', () => {
  const r = rank({ candidates: [
    { id: 'a', source: 'fixture', scores: { visual: 11, relevance: 5, usability: 5, mobile: 5, distinct: 5 } },
    { id: 'a', scores: { visual: 5, relevance: 5, usability: 5, mobile: 5 } },
  ] });
  assert.ok(r.errors.some(e => e.includes('"visual" must be an integer')));
  assert.ok(r.errors.some(e => e.includes('missing source')));
  assert.ok(r.errors.some(e => e.includes('"distinct"')));
  assert.ok(r.errors.some(e => e.includes('duplicate id')));
  assert.equal(r.ranked, undefined);
});

test('duplicates: same link, same image, same app and pattern; different platform is not a duplicate', () => {
  const d = findDuplicates([
    { id: '1', link: 'https://mobbin.com/x/1/', app: 'A', pattern: 'Hero' },
    { id: '2', link: 'https://MOBBIN.com/x/1?ref=z', app: 'B', pattern: 'Other' },
    { id: '3', image_url: 'https://img/3.png', app: 'C', pattern: 'p' },
    { id: '4', image_url: 'https://img/3.png', app: 'D', pattern: 'q' },
    { id: '5', app: 'Shop', pattern: 'Filter sidebar, swatches', platform: 'web' },
    { id: '6', app: 'shop', pattern: 'filter sidebar swatches', platform: 'web' },
    { id: '7', app: 'shop', pattern: 'filter sidebar swatches', platform: 'ios' },
  ]);
  assert.deepEqual(d.map(x => [x.a, x.b, x.reason]), [
    ['1', '2', 'same link'], ['3', '4', 'same image'], ['5', '6', 'same app and pattern'],
  ]);
});

test('scenario: event rental shortlist covers every required function and drops duplicates', () => {
  const s = shortlist(fixture('event-rental'));
  assert.deepEqual(s.errors, []);
  assert.ok(s.shortlist.length >= 5 && s.shortlist.length <= 8);
  assert.deepEqual(s.uncovered, []);
  assert.ok(s.dropped.includes('c10') && s.dropped.includes('c13'));
  assert.ok(s.shortlist.some(c => c.id === 'c03' && c.why.startsWith('fills detail')));
  assert.ok(s.skipped.some(x => x.reason === 'replaced to cover detail'));
  const fnCount = {};
  for (const c of s.shortlist) fnCount[c.function] = (fnCount[c.function] ?? 0) + 1;
  assert.ok(Object.values(fnCount).every(n => n <= 2));
});

test('scenario: dental uses custom weights and required functions', () => {
  const s = shortlist(fixture('dental'));
  assert.deepEqual(s.errors, []);
  assert.equal(s.weights.usability, 30);
  assert.deepEqual(s.uncovered, []);
  assert.ok(s.shortlist.some(c => c.function === 'services'));
  assert.ok(s.shortlist.some(c => c.platform === 'ios'));
});

test('scenario: calculator has no detail function and respects per-app limit', () => {
  const s = shortlist(fixture('calculator'));
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.uncovered, []);
  const fintech = s.shortlist.filter(c => c.app === 'Fixture Fintech');
  assert.ok(fintech.length <= 2);
  assert.ok(!s.shortlist.some(c => c.function === 'detail'));
});

test('too few candidates produce warnings, not invented results', () => {
  const data = fixture('dental');
  data.candidates = data.candidates.slice(0, 3);
  const s = shortlist(data);
  assert.equal(s.shortlist.length, 3);
  assert.ok(s.warnings.some(w => w.includes('fewer than the minimum 5')));
  assert.ok(s.warnings.some(w => w.includes('at least 12')));
  assert.ok(s.uncovered.length > 0);
});

test('fixtures are labelled as synthetic', () => {
  for (const f of readdirSync(join(here, 'fixtures'))) {
    const data = JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8'));
    assert.match(data._note, /Not Mobbin data/);
    assert.ok(data.candidates.every(c => c.source === 'fixture'));
  }
});

const goodSpec = SPEC_SECTIONS.map(s => `## ${s}\n`).join('\n')
  .replace('## Approval record\n', '## Approval record\n| Date | By | Decision | Run |\n|---|---|---|---|\n| 2026-10-22 | Owner | A | run1 |\n')
  .replace('## Color tokens\n', '## Color tokens\n--color-bg #FAF7F2 **Approved**\n');

test('spec check passes a complete spec', () => {
  assert.deepEqual(checkSpec(goodSpec), { ok: true, problems: [] });
});

test('spec check reports missing sections, undated approval and no approved items', () => {
  const r = checkSpec('## Project overview\n## Approval record\n| Date |\n|---|\n');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => p.includes('"Color tokens"')));
  assert.ok(r.problems.some(p => p.includes('no dated entry')));
  assert.ok(r.problems.some(p => p.includes('Approved')));
});

test('the spec template has every required section', () => {
  const tpl = readFileSync(join(here, '..', 'templates', 'design-specification.md'), 'utf8');
  const missing = checkSpec(tpl).problems.filter(p => p.startsWith('missing section'));
  assert.deepEqual(missing, []);
});

test('skill structure: frontmatter name matches folder and referenced files exist', () => {
  const r = checkSkill(join(here, '..'));
  assert.deepEqual(r.problems, []);
  assert.ok(r.checked.length >= 10);
});

test('CLI: shortlist --md prints a table and exits 0; bad command exits 2', () => {
  const out = execFileSync(process.execPath, [join(here, 'score.mjs'), 'shortlist', join(here, 'fixtures', 'event-rental.json'), '--md'], { encoding: 'utf8' });
  assert.match(out, /\| Rank \| Id \|/);
  assert.match(out, /Uncovered: none/);
  assert.throws(() => execFileSync(process.execPath, [join(here, 'score.mjs'), 'nope'], { stdio: 'pipe' }), e => e.status === 2);
});

test('CLI: --weights overrides file weights; invalid totals exit 1', () => {
  const f = join(here, 'fixtures', 'event-rental.json');
  const out = JSON.parse(execFileSync(process.execPath, [join(here, 'score.mjs'), 'rank', f, '--weights', 'visual=10,relevance=50,usability=20,mobile=10,distinct=10'], { encoding: 'utf8' }));
  assert.equal(out.weights.relevance, 50);
  assert.throws(() => execFileSync(process.execPath, [join(here, 'score.mjs'), 'rank', f, '--weights', 'visual=10'], { stdio: 'pipe' }), e => e.status === 1);
});
