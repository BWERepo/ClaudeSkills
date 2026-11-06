#!/usr/bin/env node
// Request indexing for a list of URLs in Google Search Console, by driving the
// Search Console web UI (URL Inspection -> "Request indexing") with Playwright.
//
// Google offers no API for the "Request indexing" button, so this automates the
// browser. You sign in yourself once (`--login`); the session is kept in a
// dedicated browser profile and reused on later runs. No password is stored.
//
// Usage:
//   node gsc-request-indexing.mjs --login
//   node gsc-request-indexing.mjs urls.txt
//   node gsc-request-indexing.mjs https://example.com/a https://example.com/b
//   node gsc-request-indexing.mjs urls.txt --property sc-domain:example.com
//
// Run with --help for every option.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

const HELP = `
Request indexing in Google Search Console for a list of URLs.

  node gsc-request-indexing.mjs --login                 Sign in once (opens a browser window)
  node gsc-request-indexing.mjs <url|file>... [options] Request indexing

Inputs: any mix of URLs and files. A file can be .txt (one URL per line) or .csv;
every http(s) URL found on a line is used. Lines starting with # are ignored.

Options:
  -p, --property <id>   Search Console property for ALL URLs, e.g. sc-domain:example.com
                        or https://www.example.com/ . Default: try sc-domain:<host>,
                        then sc-domain:<parent domain>, then https://<host>/ .
      --log <file>      Results CSV, appended to (default: gsc-indexing-log.csv)
      --profile <dir>   Browser profile holding your Google sign-in
                        (default: ~/.gsc-indexer-profile)
      --channel <name>  chrome (default, your installed Google Chrome), msedge,
                        or bundled (Playwright's own Chromium)
      --delay <sec>     Average pause between URLs, randomised +/-25% (default: 20)
      --max <n>         Stop after n successful requests
      --force           Re-request URLs already requested in the last 24 hours
      --headless        Run without a window (only after --login has worked)
      --dry-run         Show what would be requested; do not open a browser
  -h, --help            Show this help

Google allows roughly 10-12 indexing requests per property per day. When the quota
is hit, the remaining URLs for that property are left for the next run.
`;

const BASE = (process.env.GSC_BASE_URL || 'https://search.google.com').replace(/\/$/, '');

const STATUS = {
  REQUESTED: 'requested',
  QUOTA: 'quota_exceeded',
  REJECTED: 'rejected',
  NOT_IN_PROPERTY: 'not_in_property',
  NO_ACCESS: 'no_access',
  INSPECT_FAILED: 'inspect_failed',
  ERROR: 'error',
};

// ---------------------------------------------------------------- arguments

let opt, positionals;
try {
  ({ values: opt, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      property: { type: 'string', short: 'p' },
      log: { type: 'string', default: 'gsc-indexing-log.csv' },
      profile: { type: 'string', default: path.join(os.homedir(), '.gsc-indexer-profile') },
      channel: { type: 'string', default: 'chrome' },
      delay: { type: 'string', default: '20' },
      max: { type: 'string' },
      force: { type: 'boolean', default: false },
      headless: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      login: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }));
} catch (err) {
  console.error(`${err.message}\n${HELP}`);
  process.exit(2);
}

if (opt.help || (!opt.login && positionals.length === 0)) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 2);
}

const delaySec = Number(opt.delay);
const maxRequests = opt.max ? Number(opt.max) : Infinity;
if (!(delaySec >= 0) || !(maxRequests > 0)) {
  console.error('--delay must be >= 0 and --max must be > 0');
  process.exit(2);
}

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function readUrls(inputs) {
  const urls = [];
  for (const input of inputs) {
    if (/^https?:\/\//i.test(input)) {
      urls.push(input);
      continue;
    }
    if (!fs.existsSync(input)) throw new Error(`Not a URL and no such file: ${input}`);
    for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      for (const m of line.matchAll(/https?:\/\/[^\s,"'<>]+/gi)) urls.push(m[0]);
    }
  }
  const unique = [];
  for (const u of urls) {
    try {
      const norm = new URL(u).href;
      if (!unique.includes(norm)) unique.push(norm);
    } catch {
      console.warn(`Skipping invalid URL: ${u}`);
    }
  }
  return unique;
}

function candidateProperties(url) {
  if (opt.property) return [opt.property];
  const { hostname, origin } = new URL(url);
  const host = hostname.replace(/^www\./i, '');
  const labels = host.split('.');
  const list = [`sc-domain:${host}`];
  // shop.example.com is usually covered by the sc-domain:example.com property.
  if (labels.length > 2) list.push(`sc-domain:${labels.slice(1).join('.')}`);
  list.push(`${origin}/`);
  return list;
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function appendLog(row) {
  const header = 'timestamp,url,property,status,detail\n';
  if (!fs.existsSync(opt.log)) fs.writeFileSync(opt.log, header);
  const line = [new Date().toISOString(), row.url, row.property, row.status, row.detail ?? '']
    .map(csvCell)
    .join(',');
  fs.appendFileSync(opt.log, line + '\n');
}

// URLs successfully requested in the last 24 hours, read from the log.
function recentlyRequested() {
  const done = new Set();
  if (!fs.existsSync(opt.log)) return done;
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const line of fs.readFileSync(opt.log, 'utf8').split(/\r?\n/).slice(1)) {
    const [ts, url, , status] = line.split(',');
    if (status === STATUS.REQUESTED && Date.parse(ts) > cutoff) done.add(url);
  }
  return done;
}

// Poll until one of the patterns is visible on the page; returns its key or null.
async function waitForAny(page, patterns, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const [key, re] of Object.entries(patterns)) {
      const loc = page.getByText(re).first();
      if (await loc.isVisible().catch(() => false)) return key;
    }
    await sleep(500);
  }
  return null;
}

async function clickIfVisible(page, nameRe) {
  const btn = page.getByRole('button', { name: nameRe }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    return true;
  }
  return false;
}

async function screenshot(page, label) {
  const dir = 'gsc-screenshots';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

const isSignInPage = (u) =>
  /accounts\.google\.com|ServiceLogin|\/search-console\/(about|welcome)/i.test(u);

// If Google sends us to a sign-in page, let the user sign in in the open window.
async function ensureSignedIn(page, target) {
  await sleep(1500);
  if (!isSignInPage(page.url())) return;
  if (opt.headless) {
    throw new Error('Not signed in to Google. Run once with --login (without --headless).');
  }
  log('Not signed in. Please sign in to Google in the browser window (waiting up to 5 minutes)...');
  const deadline = Date.now() + 5 * 60 * 1000;
  while (isSignInPage(page.url())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for Google sign-in.');
    await sleep(2000);
  }
  await page.goto(target, { waitUntil: 'domcontentloaded' });
}

// ---------------------------------------------------------------- core

async function requestIndexing(page, url, property) {
  const target =
    `${BASE}/search-console/inspect?resource_id=${encodeURIComponent(property)}` +
    `&id=${encodeURIComponent(url)}&hl=en`;
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await ensureSignedIn(page, target);

  // 1. Wait for the URL Inspection result.
  const inspected = await waitForAny(
    page,
    {
      notInProperty: /URL not in property/i,
      noAccess: /don.t have access to (this )?property|property (is )?not (found|verified)/i,
      ready: /^\s*request indexing\s*$/i,
    },
    90_000,
  );
  if (inspected === 'notInProperty') return { status: STATUS.NOT_IN_PROPERTY };
  if (inspected === 'noAccess') return { status: STATUS.NO_ACCESS };
  if (!inspected) {
    return { status: STATUS.INSPECT_FAILED, detail: `inspection did not load (${await screenshot(page, 'inspect')})` };
  }

  const body = await page.locator('body').innerText().catch(() => '');
  const indexState = (body.match(/URL is (?:on|not on|unknown to) Google[^\n]*/i) || [''])[0].trim();

  // 2. Click "Request indexing".
  let button = page.getByRole('button', { name: /request indexing/i }).first();
  if (!(await button.isVisible().catch(() => false))) {
    button = page.getByText(/^\s*request indexing\s*$/i).first();
  }
  await button.click();

  // 3. Google runs a live test (often 1-2 minutes), then shows the outcome.
  const outcome = await waitForAny(
    page,
    {
      quota: /quota exceeded|exceeded your daily quota/i,
      rejected: /indexing request rejected/i,
      requested: /indexing requested|added to a priority crawl queue/i,
      error: /something went wrong/i,
    },
    300_000,
  );
  await clickIfVisible(page, /got it|dismiss|close|ok/i);

  switch (outcome) {
    case 'requested':
      return { status: STATUS.REQUESTED, detail: indexState };
    case 'quota':
      return { status: STATUS.QUOTA, detail: 'daily quota for this property reached' };
    case 'rejected':
      return { status: STATUS.REJECTED, detail: `live test found indexing issues (${await screenshot(page, 'rejected')})` };
    case 'error':
      return { status: STATUS.ERROR, detail: `"Something went wrong" (${await screenshot(page, 'error')})` };
    default:
      return { status: STATUS.ERROR, detail: `no result after 5 minutes (${await screenshot(page, 'timeout')})` };
  }
}

async function openBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright is not installed. Run: npm install   (in this folder)');
    process.exit(1);
  }
  fs.mkdirSync(opt.profile, { recursive: true });
  try {
    return await chromium.launchPersistentContext(opt.profile, {
      channel: opt.channel === 'bundled' ? undefined : opt.channel,
      headless: opt.headless,
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
      // Google refuses sign-in in browsers that announce automation.
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    if (/executable doesn't exist|is not found|distribution .* not found/i.test(err.message)) {
      console.error(
        `Could not start browser channel "${opt.channel}". Install Google Chrome, or use ` +
          '--channel msedge, or --channel bundled (after: npx playwright install chromium).',
      );
      process.exit(1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------- main

async function loginOnly() {
  const context = await openBrowser();
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${BASE}/search-console?hl=en`, { waitUntil: 'domcontentloaded' });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(
    '\nSign in to the Google account that owns your Search Console properties in the\n' +
      'browser window. When you can see Search Console, press Enter here to save the session. ',
  );
  rl.close();
  await context.close();
  console.log(`Session saved in ${opt.profile}. You can now run the script with your URL list.`);
}

async function main() {
  if (opt.login) return loginOnly();

  const urls = readUrls(positionals);
  const already = opt.force ? new Set() : recentlyRequested();
  const todo = urls.filter((u) => !already.has(u));
  const skipped = urls.length - todo.length;

  console.log(`${urls.length} URL(s) found; ${skipped} already requested in the last 24h; ${todo.length} to do.`);
  if (opt['dry-run']) {
    for (const u of todo) console.log(`  ${u}   [${candidateProperties(u).join(' | ')}]`);
    return;
  }
  if (todo.length === 0) return;

  const context = await openBrowser();
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30_000);

  const workingProperty = new Map(); // host -> property that accepted its URLs
  const exhausted = new Set(); // properties whose daily quota is used up
  const counts = {};
  let requested = 0;

  try {
    for (const [i, url] of todo.entries()) {
      if (requested >= maxRequests) {
        log(`Reached --max ${maxRequests}; stopping.`);
        break;
      }
      const host = new URL(url).host;
      const candidates = workingProperty.has(host) ? [workingProperty.get(host)] : candidateProperties(url);
      if (candidates.some((p) => exhausted.has(p))) {
        counts.left_for_tomorrow = (counts.left_for_tomorrow || 0) + 1;
        continue;
      }

      log(`[${i + 1}/${todo.length}] ${url}`);
      let result;
      let property;
      for (property of candidates) {
        try {
          result = await requestIndexing(page, url, property);
        } catch (err) {
          result = { status: STATUS.ERROR, detail: err.message.split('\n')[0] };
          if (/Not signed in|Timed out waiting for Google sign-in/.test(err.message)) {
            console.error(err.message);
            appendLog({ url, property, ...result });
            return;
          }
        }
        // Wrong property for this URL: try the next candidate.
        const wrongProperty = [STATUS.NOT_IN_PROPERTY, STATUS.NO_ACCESS, STATUS.INSPECT_FAILED];
        if (!wrongProperty.includes(result.status)) break;
      }

      if (result.status === STATUS.REQUESTED || result.status === STATUS.QUOTA || result.status === STATUS.REJECTED) {
        workingProperty.set(host, property);
      }
      if (result.status === STATUS.QUOTA) {
        exhausted.add(property);
        log(`   Daily quota reached for ${property}; its remaining URLs are left for the next run.`);
        counts.left_for_tomorrow = (counts.left_for_tomorrow || 0) + 1;
        appendLog({ url, property, ...result });
        continue;
      }

      counts[result.status] = (counts[result.status] || 0) + 1;
      appendLog({ url, property, ...result });
      log(`   ${result.status}${result.detail ? ` - ${result.detail}` : ''}`);
      if (result.status === STATUS.REQUESTED) requested++;

      if (i < todo.length - 1) {
        await sleep(delaySec * 1000 * (0.75 + Math.random() * 0.5));
      }
    }
  } finally {
    await context.close();
  }

  console.log('\nSummary:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (skipped) console.log(`  already_requested_last_24h: ${skipped}`);
  console.log(`Log: ${path.resolve(opt.log)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
