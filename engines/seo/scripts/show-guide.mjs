// Prints the operating guide (docs/OPERATING-GUIDE.md) in the terminal, so a person can read it without opening GitHub or Claude,
// and checks that the guide still matches the engine.
//
//   npm run guide                  the whole guide
//   npm run guide -- <section>     one section, by number ("8") or by a word in its heading ("troubleshooting")
//   npm run guide -- --list        the section headings only
//   npm run guide -- --check       exit 1 if the guide has drifted from the engine (also part of validate-canonical)
//
// The check works in both directions. Everything the guide tells a person to run must exist: scripts, npm scripts, seo/tools
// commands and their subcommands and flags, installer flags, skills, linked files. And everything a person can run must be in the
// guide: every maintenance script, every npm script, every command-line tool shipped to seo/tools/, every installer flag, every
// maintenance skill. So a change that adds, renames or removes any of those fails validation until the guide is updated.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_PATH = join("docs", "OPERATING-GUIDE.md");
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (root, p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const listDir = (root, d, re) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((n) => re.test(n)).sort() : []);

// The command-line tools installed into a website's seo/tools/: engine sources whose own usage text runs them from there.
const seoTools = (root) =>
  listDir(root, "src", /^[^.]+\.mjs$/).filter((n) => !n.endsWith(".test.mjs") && read(root, `src/${n}`).includes(`node seo/tools/${n}`));

// The installer's documented flags: every --flag in its usage header (from "Usage" to "Exit codes").
const installerFlags = (root) => {
  const src = read(root, "installer/bweseo-install.mjs");
  const header = src.slice(src.indexOf("// Usage"), src.indexOf("// Exit codes"));
  return [...new Set(header.match(/--[a-z][a-z-]*/g) ?? [])];
};

const skillNames = (root) => [
  ...listDir(root, "skills", /^BWESEO/).filter((n) => existsSync(join(root, "skills", n, "SKILL.md"))),
  ...listDir(root, ".claude/skills", /^BWESEO/).filter((n) => existsSync(join(root, ".claude", "skills", n, "SKILL.md"))),
];

// The command-like pieces of one guide line: its `code spans`, or the whole line inside a fenced block (minus a # comment).
const segmentsOf = (line, fenced) => (fenced ? [line.replace(/\s#.*$/, "")] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));

export function checkGuide(root = defaultRoot) {
  const problems = [];
  if (!existsSync(join(root, GUIDE_PATH))) return [`${GUIDE_PATH} does not exist`];
  const guide = read(root, GUIDE_PATH);
  const pkg = JSON.parse(read(root, "package.json"));
  const npmScripts = Object.keys(pkg.scripts ?? {});
  const tools = seoTools(root);
  const skills = new Set(skillNames(root));
  const installerSrc = read(root, "installer/bweseo-install.mjs");
  const say = (p) => problems.includes(p) || problems.push(p);

  // ---- 1. everything the guide refers to exists
  for (const m of guide.matchAll(/\b((?:scripts|installer|templates|src)\/[\w./-]+\.(?:mjs|json|md))\b/g))
    if (!existsSync(join(root, m[1]))) say(`the guide refers to ${m[1]}, which does not exist`);
  for (const m of guide.matchAll(/seo\/tools\/([\w.-]+\.mjs)/g))
    if (!existsSync(join(root, "src", m[1]))) say(`the guide refers to seo/tools/${m[1]}, but there is no src/${m[1]}`);
  for (const m of guide.matchAll(/npm run ([\w:-]+)/g)) if (!npmScripts.includes(m[1])) say(`the guide uses "npm run ${m[1]}", which is not a script in package.json`);
  for (const m of guide.matchAll(/\]\((?!https?:|#)([^)]+)\)/g))
    if (!existsSync(resolve(root, "docs", m[1]))) say(`the guide links to ${m[1]}, which does not exist`);
  for (const m of new Set(guide.match(/\/BWESEO[A-Za-z]*/g) ?? []))
    if (!skills.has(m.slice(1))) say(`the guide mentions ${m}, which is not a skill in this repository`);
  for (const name of ["ENGINE_VERSION", "SCHEMA_VERSION"])
    if (guide.includes(name) && !new RegExp(`export const ${name}\\b`).test(read(root, "src/validate-seo-data.mjs"))) say(`the guide mentions ${name}, which src/validate-seo-data.mjs no longer defines`);

  // Subcommands and flags, line by line: on a line that runs a seo/tools command or the installer, every subcommand and flag must
  // appear in that tool's source.
  let fenced = false;
  for (const line of guide.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    const tool = /seo\/tools\/([\w.-]+\.mjs)/.exec(line)?.[1];
    const installer = line.includes("bweseo-install.mjs");
    if (!tool && !installer) continue;
    const src = installer ? installerSrc : existsSync(join(root, "src", tool)) ? read(root, `src/${tool}`) : null;
    if (src == null) continue;
    const name = installer ? "installer/bweseo-install.mjs" : `seo/tools/${tool}`;
    for (const seg of segmentsOf(line, fenced)) {
      const rest = seg.replace(/^.*?(?:seo\/tools\/[\w.-]+\.mjs|bweseo-install\.mjs)"?\s*/, "").trim();
      for (const flag of rest.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? []) if (!src.includes(flag)) say(`the guide gives ${name} the flag ${flag}, which it does not support`);
      const word = /^([a-z][a-z-]*)(?:\s|$)/.exec(rest)?.[1];
      if (!installer && word && !src.includes(`"${word}"`) && !src.includes(`'${word}'`)) say(`the guide gives ${name} the subcommand "${word}", which it does not have`);
    }
  }

  // ---- 2. everything a person can run is in the guide
  for (const s of listDir(root, "scripts", /\.mjs$/))
    if (!guide.includes(`scripts/${s}`) && !npmScripts.some((n) => (pkg.scripts[n] ?? "").includes(`scripts/${s}`) && guide.includes(`npm run ${n}`)))
      say(`scripts/${s} is not in the guide`);
  for (const n of npmScripts) if (!guide.includes(n === "test" ? "npm test" : `npm run ${n}`)) say(`the npm script "${n}" is not in the guide`);
  for (const t of tools) if (!guide.includes(`seo/tools/${t}`)) say(`the command-line tool seo/tools/${t} is not in the guide`);
  for (const f of installerFlags(root)) if (!guide.includes(f)) say(`the installer flag ${f} is not in the guide`);
  for (const s of listDir(root, ".claude/skills", /^BWESEO/)) if (!guide.includes(`/${s}`)) say(`the maintenance skill /${s} is not in the guide`);

  return problems;
}

function sections(text) {
  const out = [];
  let current = { heading: null, lines: [] };
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      out.push(current);
      current = { heading: line.slice(3).trim(), lines: [line] };
    } else current.lines.push(line);
  }
  out.push(current);
  return out.filter((s) => s.heading);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).join(" ").trim();
  const text = read(defaultRoot, GUIDE_PATH);
  if (!arg) {
    process.stdout.write(text);
  } else if (arg === "--check") {
    const problems = checkGuide(defaultRoot);
    problems.forEach((p) => console.error(`✗ ${p}`));
    if (problems.length) process.exit(1);
    console.log(`✓ ${GUIDE_PATH} matches the engine's scripts, tools, flags and skills`);
  } else if (arg === "--list") {
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
    process.stdout.write(match.lines.join("\n").trimEnd() + "\n");
  }
}
