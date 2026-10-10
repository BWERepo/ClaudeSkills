#!/usr/bin/env node
// BWEWow helper. Project-agnostic, no dependencies (Node 18+). Screenshots, rollback and the report come from bweimpeccable's compare.mjs, not from here.
//   node wow.mjs inspect [--root .]                       framework, design system hints, breakpoints, tests, deploy files (facts read from files)
//   node wow.mjs detect (--file page.html | --url http://...) [--mode tools]   page mode with the evidence for it
//   node wow.mjs gallery --dir <previews dir> --out <file.html> --dirs A,B,C      HTML picker of direction previews (viewing only; never an approval)
//   node wow.mjs find-compare [--root .]                  print the path of compare.mjs, or exit 1
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MODES = ['general', 'tools', 'landing', 'ecommerce', 'dashboard', 'forms', 'content', 'navigation', 'portfolio', 'custom'];
const args = (() => { const a = { _: [] }; const v = process.argv.slice(3); for (let i = 0; i < v.length; i++) { if (v[i].startsWith('--')) { const n = v[i + 1]; a[v[i].slice(2)] = (n === undefined || n.startsWith('--')) ? true : v[++i]; } else a._.push(v[i]); } return a; })();
const cmd = process.argv[2];
const rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function walk(dir, depth, out) {
  if (depth < 0) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', '.tmp', '.next', '.astro', '.cache'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth - 1, out); else out.push(p);
  }
  return out;
}

function inspect(root) {
  const pkg = JSON.parse(rd(path.join(root, 'package.json')) || '{}');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = n => n in deps;
  const files = walk(root, 4, []).map(f => path.relative(root, f).split(path.sep).join('/'));
  const any = re => files.filter(f => re.test(f));
  const frameworks = [['astro', 'Astro'], ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'], ['vite', 'Vite'], ['gatsby', 'Gatsby'], ['@11ty/eleventy', 'Eleventy'], ['tailwindcss', 'Tailwind CSS']].filter(([k]) => has(k)).map(([, n]) => n);
  if (!frameworks.length && any(/\.html$/).length) frameworks.push('plain HTML/CSS');
  if (any(/\.php$/).length && any(/wp-content|functions\.php/).length) frameworks.push('WordPress/PHP');
  const css = any(/\.(css|scss|sass|less)$/);
  let bp = new Set(); let tokens = 0;
  for (const f of css.slice(0, 60)) { const t = rd(path.join(root, f)) || ''; for (const m of t.matchAll(/@media[^{]*?(?:min|max)-width:\s*(\d+(?:\.\d+)?)(px|em|rem)/g)) bp.add(m[2] === 'px' ? m[1] + 'px' : m[1] + m[2]); tokens += (t.match(/--[\w-]+\s*:/g) || []).length; }
  const brand = [...any(/(^|\/)(BRAND|DESIGN|STYLEGUIDE|STYLE_GUIDE)[\w.-]*\.md$/i), ...any(/(^|\/)docs?\/.*(design|brand|style)[\w.-]*\.md$/i)];
  const tests = [...any(/\.(test|spec)\.[jt]sx?$/), ...any(/playwright\.config|vitest\.config|jest\.config|cypress\.config/)];
  const deploy = [...any(/wrangler\.(jsonc|toml)$|netlify\.toml$|vercel\.json$|Dockerfile$|firebase\.json$/), ...any(/^\.github\/workflows\//)];
  console.log(JSON.stringify({
    root: path.resolve(root), frameworks, packageManagerScripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
    designSystemHints: { stylesheets: css.length, cssCustomProperties: tokens, tokenFiles: any(/tokens?\.(css|json|ts|js)$|theme\.(css|ts|js)$|tailwind\.config/), componentFolders: [...new Set(any(/(^|\/)components?\/[^/]+\.(astro|jsx|tsx|vue|svelte)$/).map(f => f.replace(/\/[^/]+$/, '')))].slice(0, 8), darkModeHints: css.some(f => /prefers-color-scheme|data-theme/.test(rd(path.join(root, f)) || '')) },
    breakpoints: [...bp].sort((a, b) => parseFloat(a) - parseFloat(b)),
    brandGuidelineFiles: brand.slice(0, 8), instructionFiles: ['CLAUDE.md', 'AGENTS.md', 'README.md'].filter(f => fs.existsSync(path.join(root, f))),
    testFiles: { count: any(/\.(test|spec)\.[jt]sx?$/).length, configs: tests.filter(f => /config/.test(f)) },
    deploymentFiles: deploy.slice(0, 10),
    note: 'Facts read from files only. Accessibility requirements, critical workflows and brand rules still come from reading the repo instructions and the page itself.'
  }, null, 2));
}

function detect(html) {
  const c = re => (html.match(re) || []).length;
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const text = body.replace(/<[^>]+>/g, ' ').toLowerCase();
  const ev = {}; const sc = Object.fromEntries(MODES.map(m => [m, 0]));
  const add = (m, n, why) => { if (n > 0) { sc[m] += n; (ev[m] ||= []).push(why); } };
  const inputs = c(/<(input|select|textarea)\b(?![^>]*type=["']?(hidden|submit|button|search|checkbox)["']?)/gi), forms = c(/<form\b/gi), tables = c(/<table\b/gi);
  const h2 = c(/<h2\b/gi), paras = c(/<p\b/gi), imgs = c(/<img\b/gi), nav = c(/<nav\b/gi), art = c(/<article\b/gi);
  const results = c(/(aria-live|role=["']?(status|alert)|id=["'][^"']*(result|answer|output)|class=["'][^"']*(result|answer|output))/gi);
  const calc = c(/\b(calculat|convert|generator|estimator|checker|counter|converter)\w*/gi);
  add('tools', Math.min(inputs, 6) + results * 2 + Math.min(calc, 6), `${inputs} input fields, ${results} result/answer/live-region markers, ${calc} calculator-style words`);
  add('forms', forms * 2 + (inputs > 6 ? 4 : 0) + c(/<label\b/gi) / 3, `${forms} forms, ${inputs} fields, many labels`); if (results) sc.forms -= results;
  add('ecommerce', c(/\b(add to cart|add to bag|buy now|checkout|in stock|sku)\b/gi) * 3 + c(/[$€£]\s?\d/g) + c(/\bproduct\b/gi), 'cart/price/product wording');
  add('landing', c(/\b(get started|sign up|free trial|book a demo|learn more|pricing|testimonial)\b/gi) * 2 + (h2 >= 3 && inputs === 0 ? 2 : 0) + c(/<section\b/gi), 'call-to-action wording, several marketing sections, no inputs');
  add('dashboard', tables * 3 + c(/\b(dashboard|analytics|filter|status|metrics|kpi|admin)\b/gi) * 2 + c(/<canvas\b|<svg\b/gi), `${tables} tables, dashboard wording, charts`);
  add('content', art * 4 + Math.min(paras, 25) / 2 + h2 + c(/\b(faq|documentation|guide|published|updated|read more)\b/gi), `${paras} paragraphs, ${h2} sub-headings, article/guide wording`);
  add('navigation', nav * 2 + c(/<(ul|li)\b/gi) / 12 - Math.min(paras, 10) / 3, `${nav} nav elements, mostly links`);
  add('portfolio', Math.min(imgs, 12) + c(/\b(portfolio|gallery|case stud|my work|projects)\b/gi) * 3, `${imgs} images, portfolio/gallery wording`);
  sc.general = 3;
  const ranked = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const [top, topS] = ranked[0], second = ranked[1];
  const confident = topS >= 8 && topS - second[1] >= 3;
  return { mode: confident ? top : (topS < 5 ? 'general' : top), confident, scores: Object.fromEntries(ranked.filter(r => r[1] > 0).map(([k, v]) => [k, +v.toFixed(1)])), evidence: ev[top] || [], note: confident ? 'Clear winner.' : 'Weak or close scores: state this to the user and let them pick the mode; custom is for pages that fit none.' };
}

async function main() {
  if (cmd === 'inspect') return inspect(args.root || '.');
  if (cmd === 'detect') {
    let html = args.file ? rd(args.file) : null;
    if (!html && args.url) html = await (await fetch(args.url)).text();
    if (!html) { console.error('detect needs --file or --url that can be read'); process.exit(2); }
    if (args.mode) { if (!MODES.includes(args.mode)) { console.error('unknown mode; use one of ' + MODES.join(', ')); process.exit(2); } console.log(JSON.stringify({ mode: args.mode, source: 'chosen by the user', suggestion: detect(html) }, null, 2)); return; }
    return console.log(JSON.stringify(detect(html), null, 2));
  }
  if (cmd === 'find-compare') {
    const root = args.root || '.';
    const c = [path.join(root, '.claude/skills/bweimpeccable/compare.mjs'), path.join(os.homedir(), '.claude/skills/bweimpeccable/compare.mjs'), path.join(root, '.claude/skills/BWEWow/compare.mjs'), path.join(os.homedir(), '.claude/skills/bewow/compare.mjs'), path.join(root, '.claude/skills/bewow/compare.mjs')].find(f => fs.existsSync(f));
    if (!c) { console.error('compare.mjs not found: install the bweimpeccable skill, or write the bootstrap copy from the BWEWow SKILL.md'); process.exit(1); }
    return console.log(path.resolve(c));
  }
  if (cmd === 'gallery') {
    if (!args.dir || !args.out) { console.error('gallery needs --dir and --out'); process.exit(2); }
    const dirs = String(args.dirs || 'A,B,C').split(',');
    const cards = dirs.map(d => {
      const base = path.join(args.dir, d);
      const sub = fs.existsSync(base) ? fs.readdirSync(base).find(x => fs.statSync(path.join(base, x)).isDirectory()) : null;
      const have = sub ? ['desktop', 'mobile'].filter(v => fs.existsSync(path.join(base, sub, `after-${v}.png`))) : [];
      if (!sub || !have.length) return `<section><h2>Design ${esc(d)}</h2><p class="warn">No rendered preview exists for this design. Nothing is shown rather than a made-up picture.</p></section>`;
      const note = rd(path.join(args.dir, `${d}.txt`)) || '';
      return `<section><h2>Design ${esc(d)}</h2><p>${esc(note)}</p><div class="row">${have.map(v => `<figure class="${v}"><figcaption>${v === 'desktop' ? 'Desktop 1440px' : 'Mobile 375px'}</figcaption><img src="${esc(path.relative(path.dirname(args.out), path.join(base, sub, `after-${v}.png`)).split(path.sep).join('/'))}" alt="Design ${esc(d)} ${v} preview"></figure>`).join('')}</div></section>`;
    }).join('');
    fs.writeFileSync(args.out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BWEWow design directions</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#f4f4f7;color:#111}img{max-width:100%;height:auto;border:1px solid #bbb;background:#fff;display:block}.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}.desktop{flex:3 1 480px}.mobile{flex:1 1 200px;max-width:320px}.warn{background:#fff3cd;padding:8px 12px;border-radius:6px}section{margin-bottom:32px}</style></head><body><h1>Design directions</h1><p class="warn"><b>Viewing only.</b> Choose in Claude Code (USER INPUT NEEDED). Opening this page selects nothing and approves nothing. Each picture is a real render of the current page with that direction's styles applied.</p>${cards}</body></html>`);
    return console.log('GALLERY OK: ' + path.resolve(args.out));
  }
  console.error('usage: node wow.mjs inspect|detect|gallery|find-compare (see header)'); process.exit(2);
}
main();
