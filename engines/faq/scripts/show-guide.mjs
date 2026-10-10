// Prints the user manual (docs/USER_MANUAL.md) in the terminal, and checks that it still matches the engine.
//
//   npm run guide                  the whole manual
//   npm run guide -- <section>     one section, by number ("5") or by a word in its heading ("troubleshooting")
//   npm run guide -- --list        the section headings only
//   npm run guide -- --check       exit 1 if the manual has drifted from the engine (CLI commands, flags, scripts, skills, linked files)
//
// The check works in both directions. Everything the manual tells a person to run must exist, and everything a person can run
// (every CLI command, installer flag, npm script, maintenance script and skill) must be in the manual.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUIDE_PATH = join('docs', 'USER_MANUAL.md');
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (root, p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const listDir = (root, d, re) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((n) => re.test(n)).sort() : []);

/** CLI commands: the names in the usage line of src/cli.mjs. */
const cliCommands = (root) => (/Usage: faq-engine <([a-z|-]+)>/.exec(read(root, 'src/cli.mjs'))?.[1] ?? '').split('|').filter(Boolean);

/** Installer flags: every --flag in the usage header of src/install.mjs. */
const installerFlags = (root) => {
  const src = read(root, 'src/install.mjs');
  const header = src.slice(src.indexOf('// Modes'), src.indexOf('import '));
  return [...new Set(header.match(/--[a-z][a-z-]*/g) ?? [])];
};

const skillNames = (root) => [
  ...listDir(root, 'skills', /^BWEFAQ/).filter((n) => existsSync(join(root, 'skills', n, 'SKILL.md'))),
  ...listDir(root, '.claude/skills', /^BWEFAQ/).filter((n) => existsSync(join(root, '.claude', 'skills', n, 'SKILL.md'))),
];

export function checkGuide(root = defaultRoot) {
  const problems = [];
  if (!existsSync(join(root, GUIDE_PATH))) return [`${GUIDE_PATH} does not exist`];
  const guide = read(root, GUIDE_PATH);
  const prose = guide.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, ''); // examples in code are not links to check
  const pkg = JSON.parse(read(root, 'package.json'));
  const npmScripts = Object.keys(pkg.scripts ?? {});
  const skills = new Set(skillNames(root));
  const commands = cliCommands(root);
  const cliSrc = read(root, 'src/cli.mjs') + read(root, 'src/install.mjs');
  const say = (p) => problems.includes(p) || problems.push(p);

  // ---- 1. everything the manual refers to exists
  for (const m of guide.matchAll(/\b((?:scripts|templates|src|client|docs|skills)\/[\w./-]+\.(?:mjs|js|css|json|md))\b/g))
    if (!existsSync(join(root, m[1])) && !existsSync(join(root, 'docs', m[1].replace(/^docs\//, '')))) say(`the manual refers to ${m[1]}, which does not exist`);
  for (const m of guide.matchAll(/npm run ([\w:-]+)/g)) if (!npmScripts.includes(m[1])) say(`the manual uses "npm run ${m[1]}", which is not a script in package.json`);
  for (const m of prose.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) if (!existsSync(resolve(root, 'docs', m[1].split('#')[0]))) say(`the manual links to ${m[1]}, which does not exist`);
  for (const m of new Set(guide.match(/\/BWEFAQ[A-Za-z]*/g) ?? [])) if (!skills.has(m.slice(1))) say(`the manual mentions ${m}, which is not a skill in this repository`);
  for (const line of guide.split('\n')) {
    if (!/cli\.mjs/.test(line)) continue;
    for (const flag of line.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? []) if (!cliSrc.includes(flag)) say(`the manual gives the CLI the flag ${flag}, which it does not support`);
    const word = /cli\.mjs\s+([a-z][a-z-]*)/.exec(line)?.[1];
    if (word && !commands.includes(word)) say(`the manual runs "cli.mjs ${word}", which is not a CLI command`);
  }

  // ---- 2. everything a person can run is in the manual
  for (const c of commands) if (!guide.includes(`\`${c}\``) && !new RegExp(`cli\\.mjs ${c}\\b`).test(guide)) say(`the CLI command "${c}" is not in the manual`);
  for (const f of installerFlags(root)) if (!guide.includes(f)) say(`the installer flag ${f} is not in the manual`);
  for (const n of npmScripts) if (!guide.includes(n === 'test' ? 'npm test' : `npm run ${n}`)) say(`the npm script "${n}" is not in the manual`);
  for (const s of listDir(root, 'scripts', /\.mjs$/)) if (!guide.includes(`scripts/${s}`) && !guide.includes('npm run guide')) say(`scripts/${s} is not in the manual`);
  for (const s of skills) if (!guide.includes(`/${s}`)) say(`the skill /${s} is not in the manual`);
  return problems;
}

function sections(text) {
  const out = [];
  let current = { heading: null, lines: [] };
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      out.push(current);
      current = { heading: line.slice(3).trim(), lines: [line] };
    } else current.lines.push(line);
  }
  out.push(current);
  return out.filter((s) => s.heading);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).join(' ').trim();
  const text = read(defaultRoot, GUIDE_PATH);
  if (!arg) {
    process.stdout.write(text);
  } else if (arg === '--check') {
    const problems = checkGuide(defaultRoot);
    problems.forEach((p) => console.error(`✗ ${p}`));
    if (problems.length) process.exit(1);
    console.log(`✓ ${GUIDE_PATH} matches the engine's commands, flags, scripts and skills`);
  } else if (arg === '--list') {
    for (const s of sections(text)) console.log(s.heading);
  } else {
    const want = arg.toLowerCase();
    const all = sections(text);
    const match = all.find((s) => s.heading.startsWith(`${want}.`)) ?? all.find((s) => s.heading.toLowerCase().includes(want));
    if (!match) {
      console.error(`No section matches "${arg}". Sections:`);
      for (const s of all) console.error(`  ${s.heading}`);
      process.exit(3);
    }
    process.stdout.write(match.lines.join('\n').trimEnd() + '\n');
  }
}
