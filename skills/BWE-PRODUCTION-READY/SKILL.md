---
name: BWE-PRODUCTION-READY
description: Project-aware production-readiness gate. Answers "Can the exact current version of this project safely be deployed to production?" by discovering the project, auditing it, running every test, safely repairing BLOCKER and HIGH items, re-auditing from the start, and reporting GO / CONDITIONAL GO / NO-GO. It NEVER deploys production, never changes production config, DNS or secrets, never runs destructive migrations, never touches production data. Use when the user says "is this production ready", "production readiness", "can we release", "audit before release", or invokes /BWE-PRODUCTION-READY (optional arguments --audit-only, --quick, --full).
---

# BWE-PRODUCTION-READY

Question to answer: **can the exact current commit be safely deployed to production?** "Make it production ready" NEVER means "deploy it". This skill never deploys.

## Arguments
- (none) / `--full`: the comprehensive flow: DISCOVER, AUDIT, TEST, IDENTIFY, SAFELY FIX, RETEST EVERYTHING, full second audit, final clean verification. This is the default.
- `--audit-only`: stop after the first audit and verdict. Change no file. Recommended for the first run in a project.
- `--quick`: discovery, scope, clean build, static analysis, unit tests, remnants and secrets only. The report must say "QUICK: not a full verdict" and can never be a clean GO.

## Hard safety rules (override everything)
1. Never run a production deploy, release, publish, `wrangler deploy` to a production Worker, `npm run deploy -- --confirm`, any project release skill or command. Never push to a branch that triggers a deploy.
2. Never change production config, DNS, secrets, KV, D1, R2 or any production data. Read-only checks of the live site (GET) are allowed.
3. Never print a secret value. Report only that a variable or secret is present or missing, by NAME.
4. No destructive migrations, no `rm -rf` outside build output, no `git reset --hard`, `git checkout --`, `stash` or force-push. Never commit unless the owner asks.
5. Do not give legal conclusions. Report consistency (what the page says vs what the code does) only.
6. Never report PASS for a phase in which nothing ran. A skipped, disabled or unavailable check is `NOT RUN` with the reason.
7. Respect project switches: if `.deploy-disabled` exists leave it; if `.e2e-disabled` exists do NOT run Playwright by any route (see E2E rule).

## Flow

### 0. Discover (read-only)
Read CLAUDE.md, the project status file, `package.json` scripts, `wrangler.jsonc` / hosting config, test config, registries. Write down: stack, build command, test commands, environments (staging vs production), indexing rules, routes source, secrets by name, third-party services, project switches. Adapters: generic phases below plus project-specific checks found in CLAUDE.md.

### 1. Deployment scope
`git branch --show-current`, `git rev-parse HEAD`, `git status --short`. Record the exact commit. Uncommitted changes, untracked files that the build needs, or a branch that is not the release branch = finding (HIGH; BLOCKER if the build depends on uncommitted files). Scan the working tree and diff for secrets (`.dev.vars`, private-key blocks, key-like strings, tokens).

### 2. Clean production build
Delete only build output (`dist`, caches), then run the production build exactly as the release does (not the staging build). Warnings are listed; a failure is a BLOCKER.

### 3. Static analysis
Type check, lint, the project's `check` script. Errors BLOCKER; warnings listed.

### 4. Complete test suite
Run all unit and built-site tests. Record honest counts: total, passed, failed, skipped. Investigate every skip (why, is it hiding a real gap). Zero tests run = FAIL. Browser (e2e) suites follow the E2E rule.

### 5. Route audit
List every route from the build output and from the registry. Check: each public route returns 200 in a local production preview; every sitemap URL exists; every built page is either in the sitemap or deliberately excluded; no OFF/gated page is linked or listed; counts shown on pages match the registry; no staging-only file exists in the production output; redirects and 404s behave as documented.

### 6. Application integrity (project-specific)
Registries vs routes vs sitemap vs counts agree.

### 7. Browser and runtime errors
Open the production preview in the built-in browser (`mcp__Claude_Browser__*`): console errors, failed requests, mixed content, on every page TYPE (home, a tool, a category, an answer, blog, legal, 404). Skipped when browser tooling is unavailable: `NOT RUN`.

### 8. Responsive and theme
Widths 1440, 1024, 768, 390, 320: no horizontal scroll, controls reachable, text readable. Light and dark themes: contrast and legibility. Use `resize_window`; reset to desktop after.

### 9. Accessibility
Landmarks, headings order, labels on every field, focus order and visible focus, keyboard-only use of the main flow, live-region announcements, no colour-only meaning, alt text, reduced motion.

### 10. Security
Secrets in repo and build output; XSS (any `innerHTML` with user text, reflected input); SSRF on every endpoint that fetches a URL: localhost, 127.0.0.1, `[::1]`, private ranges (10/8, 172.16/12, 192.168/16), link-local 169.254/16, cloud metadata 169.254.169.254, decimal/octal/hex IP forms, DNS names resolving to private addresses, and redirects that bounce to a blocked target; admin routes require auth and are not linked, not in the sitemap, `noindex`; rate limits exist on public write/fetch endpoints; same-origin and size limits; security headers. Test with the project's own tests and local requests only, never against third parties.

### 11. Database and storage
Read-only: bindings declared, migrations present and non-destructive, production and staging namespaces separate, no production ids in test fixtures. Never connect to production data.

### 12. Environment and hosting
Checklist by NAME: required vars and secrets, bindings, cron triggers (plan limits), compatibility date, routes and custom domains, redirect Workers. Report missing items; never read or print values.

### 13. Third-party services
List every external host the pages or Workers call; each must be documented (privacy page, licence record) and have a failure fallback. An undocumented third party is a HIGH finding.

### 14. SEO and indexing
Production: no noindex header or meta, robots.txt allows crawling and lists the sitemap, canonicals point to the production origin, titles/descriptions unique, no staging URL anywhere in the production output (BLOCKER). Staging: noindex everywhere. Run `/BWE-SEO` when the project has it and include its findings.

### 15. Links
Check internal links and anchors in the built output; external links must be intentional. Broken internal link = HIGH.

### 16. Performance
Build size, largest assets, scripts loaded per page, fonts self-hosted, no render-blocking third party, images sized. Report numbers, flag outliers; never invent timings.

### 17. Privacy and legal consistency
Compare what Privacy, Terms, FAQ and disclaimers say with what the code does (storage, cookies, forms, third parties, analytics, ads, AI). Mismatch = HIGH. No legal conclusions.

### 18. Analytics and error handling
Analytics events carry only what the policy allows. Every endpoint and every tool handles blank, invalid, huge and malicious input and failures with a clear message; no stack traces or internals shown.

### 19. Production remnants
Search the production OUTPUT (not only source) for: TODO, FIXME, console.log, debugger, localhost, 127.0.0.1, staging, test@, lorem ipsum, example.com placeholders, "coming soon", demo/test banners, source maps if not intended.

### 20. Rollback credibility
DESCRIBE (never execute) how to roll back: previous version id or commit, how it would be redeployed, what data would not roll back, who does it. No credible rollback = HIGH.

### 21. Preliminary verdict and repair
Classify every finding: BLOCKER (must fix), HIGH (fix before release), MEDIUM, LOW. Auto-repair BLOCKER and HIGH only when ALL are true: local, understood, testable, non-destructive, inside this repository, and `--audit-only` was not given. Never auto-fix: secrets/config on any platform, DNS, data, anything needing a product or legal decision, anything you cannot test. After EVERY fix run the affected tests and then the full suite; a regression is reverted by editing the change back (no destructive git commands) and reported. Do not commit.

### 22. Second audit and final verification
Repeat phases 1 to 20 from the start on the fixed tree. Then a final clean verification of the exact commit state: clean build, static analysis, full tests, remnant and secret scan. The verdict is based only on this final run.

## E2E rule
If `.e2e-disabled` (or the project's equivalent switch) exists: browser suites are `NOT RUN`, and the verdict can NOT be a clean GO. Best verdict is CONDITIONAL GO with "browser tests NOT RUN" as a condition, unless the owner runs `/BWE-OCA-E2E-ENABLE` first. Direct browser-pane checks in phases 7 to 9 are manual inspections, not the suite; say which was which.

## Budget
Per phase: stop and report `NOT COMPLETED (budget)` rather than looping. Defaults: build 10 min, full unit suite 15 min, browser pass 20 min, everything else 5 min each. Say when a limit cut a phase short; a cut phase counts as NOT RUN.

## Verdict
- **GO**: no BLOCKER, no HIGH, every phase ran, tests honest and green.
- **CONDITIONAL GO**: no BLOCKER; HIGH items fixed or listed as conditions the owner can accept; or some phases NOT RUN (e.g. browser tests disabled).
- **NO-GO**: any BLOCKER remaining, failing tests, or a failed final verification.

## Final report format (always exactly this)
```
VERDICT: GO | CONDITIONAL GO | NO-GO
Project: <name>   Commit: <hash>   Branch: <branch>   Mode: full | audit-only | quick
Summary: blockers N, high N, medium N, low N, phases run N/22, phases NOT RUN N
Tests: total N, passed N, failed N, skipped N (reasons)
Automatic fixes made: <file: what and why, or "none">
Blockers remaining: <list or none>
High items: <list>
Non-blocking items: <list>
Production checklist (owner actions, by name, no values): <list>
Phases NOT RUN and why: <list>
Has production been deployed? NO. Production has NOT been deployed by this skill.
```
