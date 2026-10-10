#!/usr/bin/env node
// BWEImpeccable visual comparison helper. Reusable in any BWE website repo. No dependencies except Playwright.
//
//   node compare.mjs capture --label before|after --out <dir> --page <path> [--page <path>...]
//        (--base-url http://localhost:4321 | --serve <built-folder>) [--wait-ms 500] [--selector-ready <css>]
//   node compare.mjs report  --out <dir> [--threshold 12]
//   capture extras: [--inject-css <file>] (preview a design without editing source) [--script <file.mjs>] (default export async (page) sets an app state)
//                   [--state-name <name>] (screenshots go to <page>~<name>/)  Every screenshot gets a .meta.json (url, viewport, browser, scroll, state).
//   node compare.mjs begin   --out <dir> --run <name> [--pages "/,/x"] [--force]   rollback point + state.json
//   node compare.mjs changed --out <dir>                      files this operation changed (vs the rollback point)
//   node compare.mjs pending --out <dir>                      mark PENDING APPROVAL (after report)
//   node compare.mjs status  --out <dir>                      print state (resume an interrupted session)
//   node compare.mjs decide  --out <dir> approve|revise|reject  (only after the USER chose; see SKILL.md)
//   node compare.mjs restore --out <dir>                      reject: restore ONLY this operation's files, then verify
//
// capture: full-page screenshots at 1440 (desktop) and 375 (mobile) -> <dir>/<page-slug>/<label>-<viewport>.png
// report:  for every page/viewport that has BOTH before and after: side-by-side.png (labelled BEFORE | AFTER),
//          diff.png (changed pixels in red over a faded AFTER), summary.json and report.html (open it in a browser).
// Exit codes: 0 ok, 2 bad usage, 3 could not capture or compare (never fabricate; report the problem).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } };

function fail(msg, code = 3) { console.error('COMPARE FAILED: ' + msg); process.exit(code); }

function parseArgs(argv) {
  const a = { _: [], page: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const k = t.slice(2); const nx = argv[i + 1]; const v = (nx === undefined || nx.startsWith('--')) ? true : argv[++i];
    if (k === 'page') a.page.push(v); else a[k] = v;
  }
  return a;
}

async function loadPlaywright() {
  const tries = [() => import('playwright'), () => import('@playwright/test')];
  for (const t of tries) { try { const m = await t(); if (m.chromium) return m; } catch {} }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    for (const n of ['playwright', '@playwright/test']) {
      try { const m = createRequire(path.join(root, 'x.js'))(n); if (m.chromium) return m; } catch {}
    }
  } catch {}
  fail('Playwright is not installed (project or global). Install it, or report that screenshots cannot be captured.');
}

async function launch(pw) {
  const opts = { headless: true };
  try { return await pw.chromium.launch(opts); } catch (e1) {
    const cands = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
    for (const p of cands) { if (fs.existsSync(p)) { try { return await pw.chromium.launch({ ...opts, executablePath: p }); } catch {} } }
    try { return await pw.chromium.launch({ ...opts, channel: 'chrome' }); } catch {}
    fail('no Chromium could be launched: ' + String(e1.message).split('\n')[0]);
  }
}

function serve(dir) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
  const root = path.resolve(dir);
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    for (const c of [f, f + '.html', path.join(f, 'index.html')]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) { res.writeHead(200, { 'content-type': types[path.extname(c)] || 'application/octet-stream' }); return fs.createReadStream(c).pipe(res); }
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, base: 'http://127.0.0.1:' + srv.address().port })));
}

const slug = p => (p.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'home').toLowerCase();

async function capture(a) {
  if (!['before', 'after'].includes(a.label)) fail('--label must be before or after', 2);
  if (!a.out) fail('--out <comparison dir> is required', 2);
  if (!a.page.length) fail('at least one --page <path> is required', 2);
  let base = a['base-url']; let server;
  if (a.serve) { server = await serve(a.serve); base = server.base; }
  if (!base) fail('give --base-url or --serve <folder>', 2);
  const pw = await loadPlaywright();
  const browser = await launch(pw);
  const waitMs = Number(a['wait-ms'] ?? 500);
  const written = [];
  try {
    for (const page of a.page) {
      for (const [vp, size] of Object.entries(VIEWPORTS)) {
        const ctx = await browser.newContext({ viewport: size, reducedMotion: 'reduce', deviceScaleFactor: 1 });
        const pg = await ctx.newPage();
        const resp = await pg.goto(new URL(page, base).href, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => fail(`cannot open ${page}: ${e.message.split('\n')[0]}`));
        if (!resp || resp.status() >= 400) fail(`${page} answered HTTP ${resp ? resp.status() : 'none'}; no screenshot taken`);
        if (a['selector-ready']) await pg.waitForSelector(a['selector-ready'], { timeout: 15000 }).catch(() => fail('ready selector never appeared: ' + a['selector-ready']));
        await pg.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
        if (a['inject-css']) await pg.addStyleTag({ content: fs.readFileSync(a['inject-css'], 'utf8') });
        if (a.script) { const mod = await import(pathToFileURL(path.resolve(a.script)).href); await mod.default(pg, { viewport: vp }); }
        await pg.evaluate(() => document.fonts && document.fonts.ready);
        await pg.evaluate(() => window.scrollTo(0, 0));
        await pg.waitForTimeout(waitMs);
        const dir = path.join(a.out, slug(page) + (a['state-name'] ? '~' + slug(String(a['state-name'])) : '')); fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${a.label}-${vp}.png`);
        await pg.screenshot({ path: file, fullPage: true });
        fs.writeFileSync(file.replace(/\.png$/, '.meta.json'), JSON.stringify({ url: pg.url(), viewport: size, browser: 'chromium ' + browser.version(), scrollY: await pg.evaluate(() => window.scrollY), state: a['state-name'] || 'initial', script: a.script || null, injectedCss: a['inject-css'] || null, captured: new Date().toISOString() }, null, 2));
        const bytes = fs.statSync(file).size;
        if (bytes < 1000) fail(`${file} is empty (${bytes} bytes)`);
        written.push(file); console.log(`captured ${file} (${size.width}px, ${bytes} bytes)`);
        await ctx.close();
      }
    }
  } finally { await browser.close(); if (server) server.srv.close(); }
  console.log(`CAPTURE OK: ${written.length} screenshots (${a.label}).`);
}

// Runs inside the browser: pixel diff + labelled side by side, returned as PNG data URLs.
const IN_PAGE = async ({ b64a, b64b, threshold }) => {
  const load = s => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image decode failed')); i.src = 'data:image/png;base64,' + s; });
  const [A, B] = [await load(b64a), await load(b64b)];
  const W = Math.max(A.width, B.width), H = Math.max(A.height, B.height);
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const read = img => { const c = cv(W, H), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H); };
  const da = read(A), db = read(B);
  const out = cv(W, H), ox = out.getContext('2d'); const od = ox.createImageData(W, H);
  let changed = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
    if (d > threshold) { changed++; od.data[i] = 255; od.data[i + 1] = 0; od.data[i + 2] = 60; od.data[i + 3] = 255; }
    else { const g = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3; const f = 235 + g * 0.06; od.data[i] = od.data[i + 1] = od.data[i + 2] = Math.min(255, f); od.data[i + 3] = 255; }
  }
  ox.putImageData(od, 0, 0);
  const gap = 24, head = 44, s = cv(W * 2 + gap, H + head), sx = s.getContext('2d');
  sx.fillStyle = '#e9e9ee'; sx.fillRect(0, 0, s.width, s.height);
  sx.fillStyle = '#111'; sx.font = 'bold 26px sans-serif'; sx.textBaseline = 'middle';
  sx.fillText('BEFORE  (' + A.width + 'x' + A.height + ')', 10, head / 2); sx.fillText('AFTER  (' + B.width + 'x' + B.height + ')', W + gap + 10, head / 2);
  sx.fillStyle = '#fff'; sx.fillRect(0, head, W, H); sx.fillRect(W + gap, head, W, H);
  sx.drawImage(A, 0, head); sx.drawImage(B, W + gap, head);
  return { diff: out.toDataURL('image/png'), side: s.toDataURL('image/png'), changed, total: W * H, sizeA: [A.width, A.height], sizeB: [B.width, B.height] };
};

async function report(a) {
  if (!a.out) fail('--out <comparison dir> is required', 2);
  const threshold = Number(a.threshold ?? 12);
  const pages = fs.existsSync(a.out) ? fs.readdirSync(a.out).filter(d => d !== 'rollback' && fs.statSync(path.join(a.out, d)).isDirectory()) : [];
  const pw = await loadPlaywright(); const browser = await launch(pw);
  const ctx = await browser.newContext(); const pg = await ctx.newPage();
  const rows = []; const missing = [];
  try {
    for (const p of pages) for (const vp of Object.keys(VIEWPORTS)) {
      const fa = path.join(a.out, p, `before-${vp}.png`), fb = path.join(a.out, p, `after-${vp}.png`);
      if (!fs.existsSync(fa) || !fs.existsSync(fb)) { missing.push(`${p} ${vp}: ${!fs.existsSync(fa) ? 'before' : 'after'} screenshot missing`); continue; }
      const r = await pg.evaluate(IN_PAGE, { b64a: fs.readFileSync(fa).toString('base64'), b64b: fs.readFileSync(fb).toString('base64'), threshold });
      const save = (n, url) => fs.writeFileSync(path.join(a.out, p, n), Buffer.from(url.split(',')[1], 'base64'));
      save(`side-by-side-${vp}.png`, r.side); save(`diff-${vp}.png`, r.diff);
      rows.push({ page: p, viewport: vp, changedPixels: r.changed, totalPixels: r.total, changedPercent: +(100 * r.changed / r.total).toFixed(3), before: r.sizeA, after: r.sizeB });
      console.log(`${p} ${vp}: ${(100 * r.changed / r.total).toFixed(2)}% pixels changed; size ${r.sizeA.join('x')} -> ${r.sizeB.join('x')}`);
    }
  } finally { await browser.close(); }
  if (!rows.length) fail('no page has both before and after screenshots; nothing was compared. ' + missing.join('; '));
  const minPct = Number(a['min-percent'] ?? 0.5);
  const noImprovement = rows.every(r => r.changedPercent < minPct);
  fs.writeFileSync(path.join(a.out, 'summary.json'), JSON.stringify({ generated: new Date().toISOString(), threshold, minPercent: minPct, noMeaningfulChange: noImprovement, rows, missing }, null, 2));
  let changes = []; try { changes = JSON.parse(fs.readFileSync(path.join(a.out, 'changes.json'), 'utf8')); } catch {}
  let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(a.out, 'state.json'), 'utf8')); } catch {}
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual comparison report</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#f4f4f7;color:#111}h1{margin:0 0 4px}h2{margin-top:32px}h3{margin:20px 0 6px}
img{max-width:100%;height:auto;border:1px solid #bbb;background:#fff;display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.lab{font-weight:700;margin:4px 0}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 10px;text-align:left}.warn{background:#fff3cd;padding:8px 12px;border-radius:6px}
.cmp{position:relative;max-width:900px;overflow:hidden}.cmp img{width:100%}.cmp .bf{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--pos)) 0 0)}.cmp input{position:absolute;left:0;right:0;bottom:8px;width:100%}.tag{position:absolute;top:6px;background:#111;color:#fff;padding:2px 8px;font-size:13px}.tag.l{left:6px}.tag.r{right:6px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body>
<h1>Visual comparison report</h1>
<p class="warn"><b>PROPOSED, not approved.</b> Opening this report is NOT approval. Decide in Claude Code: 1 APPROVE, 2 REQUEST REVISIONS, 3 REJECT.${st.status ? ' State: ' + esc(st.status) + '.' : ''}</p>
${noImprovement ? `<p class="warn"><b>NO MEANINGFUL VISUAL IMPROVEMENT DETECTED.</b> Under ${minPct}% of pixels changed on every page and viewport. Do not read this as an improvement; request another design pass if wanted.</p>` : ''}
<h2>Changes made</h2>${changes.length ? `<table><tr><th>Change</th><th>Why it improves the design</th><th>Functionality affected</th></tr>${changes.map(c => `<tr><td>${esc(c.change)}</td><td>${esc(c.why)}</td><td>${esc(c.functionality || 'None identified')}</td></tr>`).join('')}</table>` : '<p>No change list was recorded (changes.json missing).</p>'}
${st.files ? '<p>Files modified: ' + esc((st.filesChanged || []).join(', ') || 'see state.json') + '</p>' : ''}
<p>Generated ${esc(new Date().toISOString())}. Red in a diff image marks pixels that differ by more than ${threshold} (summed RGB). Full-page screenshots, 1440px desktop and 375px mobile.</p>
${missing.length ? `<p class="warn">Not compared: ${esc(missing.join('; '))}</p>` : ''}
<table><tr><th>Page</th><th>Viewport</th><th>Changed pixels</th><th>Size before</th><th>Size after</th></tr>${rows.map(r => `<tr><td>${esc(r.page)}</td><td>${r.viewport}</td><td>${r.changedPercent}%</td><td>${r.before.join('x')}</td><td>${r.after.join('x')}</td></tr>`).join('')}</table>
${rows.map(r => `<h2>${esc(r.page)} · ${r.viewport}</h2><h3>Slider (drag; keyboard: arrow keys)</h3><div class="cmp" style="--pos:50%"><img src="${esc(r.page)}/after-${r.viewport}.png" alt="After"><div class="bf"><img src="${esc(r.page)}/before-${r.viewport}.png" alt="Before"></div><input type="range" min="0" max="100" value="50" aria-label="Before and after slider, ${esc(r.page)} ${r.viewport}" oninput="this.parentNode.style.setProperty('--pos',this.value+'%')"><span class="tag l">BEFORE</span><span class="tag r">AFTER</span></div><h3>BEFORE | AFTER</h3><div class="grid"><div><div class="lab">BEFORE</div><img loading="lazy" src="${esc(r.page)}/before-${r.viewport}.png" alt="Before, ${esc(r.page)}, ${r.viewport}"></div><div><div class="lab">AFTER</div><img loading="lazy" src="${esc(r.page)}/after-${r.viewport}.png" alt="After, ${esc(r.page)}, ${r.viewport}"></div></div>
<h3>Difference (red = changed)</h3><img loading="lazy" src="${esc(r.page)}/diff-${r.viewport}.png" alt="Difference image, ${esc(r.page)}, ${r.viewport}"><h3>Labelled side-by-side file</h3><p><a href="${esc(r.page)}/side-by-side-${r.viewport}.png">side-by-side-${r.viewport}.png</a></p>`).join('')}
</body></html>`;
  fs.writeFileSync(path.join(a.out, 'report.html'), html);
  console.log(`REPORT OK: ${path.resolve(a.out, 'report.html')}`);
}

// ---- approval workflow: rollback point, pending state, restore ----
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\n$/, '');
const sha = f => fs.existsSync(f) ? crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex') : null;
const statePath = out => path.join(out, 'state.json');
const readState = out => { try { return JSON.parse(fs.readFileSync(statePath(out), 'utf8')); } catch { fail('no state.json in ' + out + '; run begin first', 2); } };
const writeState = (out, st) => { st.updated = new Date().toISOString(); fs.writeFileSync(statePath(out), JSON.stringify(st, null, 2)); };
// dirty = every path git sees as modified or untracked now, minus the comparison folder itself
function dirtyFiles(out) {
  const top = git('rev-parse', '--show-toplevel'); const skip = path.relative(top, path.resolve(out)).split(path.sep).join('/');
  const raw = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], { encoding: 'utf8', cwd: top }).split('\0').filter(Boolean);
  const files = []; for (let i = 0; i < raw.length; i++) { const e = raw[i]; files.push(e.slice(3)); if (e[0] === 'R' || e[0] === 'C') i++; }
  return { top, files: files.filter(f => !(skip && (f === skip || f.startsWith(skip + '/')))) };
}
function begin(a) {
  if (!a.out || !a.run) fail('--out and --run are required', 2);
  fs.mkdirSync(a.out, { recursive: true }); // a new run folder: the state file is written into it below
  if (fs.existsSync(statePath(a.out)) && !a.force) {
    const old = readState(a.out); if (!['approved', 'rejected'].includes(old.status)) fail(`an operation is already ${old.status} in ${a.out}; resume it (status) or pass --force to abandon it`, 2);
  }
  const { top, files } = dirtyFiles(a.out);
  const roll = path.join(a.out, 'rollback'); fs.rmSync(roll, { recursive: true, force: true });
  const pre = {};
  for (const f of files) { const abs = path.join(top, f); pre[f] = sha(abs); if (pre[f]) { fs.mkdirSync(path.dirname(path.join(roll, f)), { recursive: true }); fs.copyFileSync(abs, path.join(roll, f)); } }
  const st = { run: a.run, status: 'capturing-before', revision: 0, head: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), top, pages: (a.pages || '').split(',').filter(Boolean), preexistingDirty: pre, started: new Date().toISOString() };
  writeState(a.out, st);
  console.log(`BEGIN OK: rollback point ${st.head.slice(0, 10)} on ${st.branch}; ${files.length} pre-existing uncommitted file(s) backed up to ${roll} and protected from restore.`);
}
function changedSince(st, out) {
  const { top, files } = dirtyFiles(out); const res = [];
  for (const f of new Set([...files, ...Object.keys(st.preexistingDirty)])) {
    const now = sha(path.join(top, f)), was = f in st.preexistingDirty ? st.preexistingDirty[f] : undefined;
    if (was === undefined) res.push(f);                 // newly dirty: changed by this operation
    else if (was !== now) res.push(f);                  // dirty before and edited again by this operation
  }
  return res.sort();
}
function changed(a) {
  const st = readState(a.out); const list = changedSince(st, a.out); st.filesChanged = list; st.files = true; writeState(a.out, st);
  console.log(list.length ? 'FILES CHANGED BY THIS OPERATION:\n' + list.join('\n') : 'NO FILES CHANGED since the rollback point.');
}
function pending(a) {
  const st = readState(a.out); st.status = 'pending-approval'; st.filesChanged = changedSince(st, a.out); st.files = true; writeState(a.out, st);
  console.log(`STATE: pending-approval (revision ${st.revision}). Waiting for the user. If this session is interrupted, run: node compare.mjs status --out ${a.out}`);
}
function status(a) { const st = readState(a.out); console.log(JSON.stringify({ run: st.run, status: st.status, revision: st.revision, head: st.head, filesChanged: st.filesChanged || [], report: path.resolve(a.out, 'report.html') }, null, 2)); if (st.status === 'pending-approval') console.log('\nPENDING APPROVAL: re-show the USER INPUT NEEDED gate; do not treat anything as approved.');
  if (st.status === 'approved' && st.approvedHashes) { const stale = Object.entries(st.approvedHashes).filter(([f, h]) => sha(path.join(st.top, f)) !== h).map(([f]) => f); const extra = changedSince(st, a.out).filter(f => !(f in st.approvedHashes)); if (stale.length || extra.length) console.log('\nAPPROVAL STALE: files changed after approval (' + [...stale, ...extra].join(', ') + '). The approval covered an earlier revision; ask for a new review.'); else console.log('\nApproval still matches the current files.'); } }
function decide(a) {
  const d = a._[0]; const st = readState(a.out);
  if (!['approve', 'revise', 'reject'].includes(d)) fail('decide needs approve|revise|reject', 2);
  if (st.status !== 'pending-approval') fail(`state is ${st.status}, not pending-approval; refusing to record a decision`, 2);
  if (d === 'approve') { st.status = 'approved'; st.approvedAt = new Date().toISOString(); st.approvedHashes = {}; for (const f of changedSince(st, a.out)) st.approvedHashes[f] = sha(path.join(st.top, f)); }
  if (d === 'revise') { st.status = 'revising'; st.revision++; }          // baseline (before-*.png, rollback/) is kept
  if (d === 'reject') { st.status = 'rejecting'; }
  writeState(a.out, st); console.log('DECISION RECORDED: ' + d + ' -> ' + st.status + (d === 'reject' ? '. Now run restore.' : ''));
}
function restore(a) {
  const st = readState(a.out); if (st.status !== 'rejecting') fail(`state is ${st.status}; restore runs only after the user chose REJECT (decide reject)`, 2);
  const list = changedSince(st, a.out); const top = st.top; const log = [];
  for (const f of list) {
    const abs = path.join(top, f), bak = path.join(a.out, 'rollback', f);
    if (f in st.preexistingDirty) { if (fs.existsSync(bak)) { fs.copyFileSync(bak, abs); log.push('restored (pre-operation uncommitted version) ' + f); } else { fs.rmSync(abs, { force: true }); log.push('removed ' + f); } }
    else { let tracked = true; try { execFileSync('git', ['cat-file', '-e', `${st.head}:${f}`], { stdio: 'ignore' }); } catch { tracked = false; }
      if (tracked) { git('checkout', st.head, '--', f); log.push('restored from rollback commit ' + f); } else { fs.rmSync(abs, { force: true }); log.push('removed new file ' + f); } }
  }
  const left = changedSince(st, a.out); const bad = [];
  for (const [f, h] of Object.entries(st.preexistingDirty)) if (sha(path.join(top, f)) !== h) bad.push('unrelated file changed: ' + f);
  if (left.length) bad.push('still differs from the rollback point: ' + left.join(', '));
  log.forEach(l => console.log(l));
  if (bad.length) { console.error('RESTORE VERIFICATION FAILED:\n' + bad.join('\n')); process.exit(3); }
  st.status = 'rejected'; st.restored = log; writeState(a.out, st);
  console.log(`RESTORE VERIFIED: ${log.length} file(s) restored; ${Object.keys(st.preexistingDirty).length} unrelated uncommitted file(s) untouched (hashes match).`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (cmd === 'capture') await capture(args);
else if (cmd === 'report') await report(args);
else if (cmd === 'begin') begin(args);
else if (cmd === 'changed') changed(args);
else if (cmd === 'pending') pending(args);
else if (cmd === 'status') status(args);
else if (cmd === 'decide') decide(args);
else if (cmd === 'restore') restore(args);
else { console.error('usage: node compare.mjs capture|report|begin|changed|pending|status|decide|restore ... (see header of this file)'); process.exit(2); }
