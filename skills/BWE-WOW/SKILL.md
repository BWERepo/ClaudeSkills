---
name: BWE-WOW
description: Universal website visual enhancement with a real WOW factor. Detects the page type (tools, landing, ecommerce, dashboard, forms, content, navigation, portfolio, general, custom), proposes up to three genuinely different design directions with rendered previews, implements the chosen one, then shows real BEFORE and AFTER screenshots in a local HTML report. Two mandatory approval gates (pick a design, approve the result); reject restores only this run's files. Works in any site repository and never deploys. Use when the user says "wow", "make this page memorable", "redesign this page", or invokes /BWE-WOW [mode] [polish|enhance|transform].
---

# BWE-WOW: visual enhancement engine with approval gates

Portable: nothing here names a site, framework, host or colour. Read the repository's own instructions (`CLAUDE.md`, `AGENTS.md`, `README`, design docs) first; where they conflict with this file, they win. BWE-WOW is not a CSS polish pass: ENHANCE and TRANSFORM may recompose the page. WOW means memorable, professional, distinctive, easy to understand and use, and true to the page's purpose. It does not mean extra animation, random gradients, decoration, oversized controls, empty space or generic AI-looking design.

Reference files (read the ones you need): `reference/design-guide.md` (assessment, modes, patterns, direction briefs), `reference/quality-checklist.md` (accessibility, performance, SEO, functionality, QA, report). Helper: `wow.mjs` in this folder (inspect, detect, gallery, find-compare). Screenshots, rollback, approval state and the report come from **BWE-IMPECCABLE's `compare.mjs`**; this skill does not contain a second copy. Installed as a Claude Code skill, it is invoked as `/BWE-WOW`; the name is case independent.

## Invocation

`/BWE-WOW [mode] [intensity] [page]` in any order. Mode: `general tools landing ecommerce dashboard forms content navigation portfolio custom`. Intensity: `polish`, `enhance` (default), `transform`. No mode means detect it. A page is a URL path, file, route or component name; none means the page or component the user is on or named in the message, never the whole site (see Scope).

| Example | Meaning |
|---|---|
| `/BWE-WOW` | Detect the mode, ENHANCE the current page |
| `/BWE-WOW tools` | TOOLS mode, ENHANCE |
| `/BWE-WOW tools transform` | TOOLS mode, TRANSFORM |
| `/BWE-WOW landing enhance` | LANDING mode, ENHANCE |
| `/BWE-WOW ecommerce polish` | ECOMMERCE mode, POLISH |
| `/BWE-WOW dashboard transform` | DASHBOARD mode, TRANSFORM |

Intensity: **POLISH** keeps the design direction and improves type, spacing, alignment, colour, borders, shadows, consistency, accessibility. **ENHANCE** produces a noticeable improvement and may change layout, hierarchy, components, type, colour relationships, controls, results and navigation. **TRANSFORM** may redesign composition, component architecture, visual identity within the brand, interaction patterns, hierarchy and storytelling. Every level preserves functionality and essential workflows.

## Rules that never bend

- Nothing is accepted until the user explicitly approves it. Silence is not approval; opening a report is not approval; never auto-approve.
- Never deploy. Deployment needs a separate, explicit authorization. A cloud session without deploy access hands over through a pull request.
- Never change business logic, calculations (especially financial), authentication, authorization, data access, APIs, search, filtering or form handling. Visual and structural presentation only, unless the user explicitly authorizes more.
- Never fabricate screenshots, previews or test results. If something cannot be captured or run, say so and show USER INPUT NEEDED.
- Do not invent content, claims, facts, ratings or statistics. Keep existing copy unless the user allows rewriting.
- Keep the brand identity unless the user explicitly authorizes rebranding. Do not make unrelated sites look alike.
- Do not touch the same files as the user's other uncommitted work (the rollback step protects it).

## USER INPUT NEEDED block

When a decision blocks work, put this at the top of the message and stop. Do nothing else until the user answers.

```
========================================
         USER INPUT NEEDED
========================================
Action Required: <decision>
Options: <numbered choices>
Recommendation: <choice and why>
Awaiting your response before proceeding.
```

Use a multiple-choice prompt (AskUserQuestion) where available; otherwise print the numbered list and wait for the number.

## Workflow

`<C>` means `node <path printed by: node .claude/skills/BWE-WOW/wow.mjs find-compare>` (project, user folder or bootstrap copy). `<W>` is `node <this folder>/wow.mjs`. `<O>` is the run folder `.tmp/bewow/<run>` (git-ignored; never commit screenshots unless asked). `<P>` is `<O>-previews`. Run state lives in `<O>/state.json`.

### 0. Resume check
If `<O>/state.json` exists run `<C> status --out <O>`. `pending-approval`: show the report path and gate 2 again and wait. `revising`: continue the revision. `rejecting`: run restore. `approved` with an APPROVAL STALE line: files changed after approval, so ask for a new review.

### 1. Analyse (before any edit)
1. `<W> inspect --root .` for framework, design-system hints, breakpoints, tests and deploy files, then read the repo's instruction and design docs. Note brand rules, accessibility rules, wording rules, critical workflows, relevant tests and environments.
2. Detect the mode: `<W> detect --file <built html> ` or `--url`. With an explicit mode, use it and still read the evidence. If the scores are close, tell the user and let them pick; use `custom` only when nothing fits.
3. Inspect the page rendered, not only its source. Assess: first impression, personality, typography, colour, hierarchy, layout, whitespace, density, navigation, buttons, forms, results, mobile, accessibility, perceived professionalism. List specific weaknesses seen. Do not invent problems to justify a change. Give a concise design assessment, and decide the design personality (professional, elegant, playful, technical, creative, luxurious, friendly, minimal, bold, editorial, modern, traditional) from audience, purpose, brand and tasks.
4. Check the working tree (`git status`). Build or serve the site the way the repo does.

### 2. Baseline (never edit these afterwards)
`<C> begin --out <O> --run <name> --pages "<paths>"` writes the rollback point and protects existing uncommitted files. Then `<C> capture --label before --out <O> --page <path> (--serve <built folder> | --base-url <url>)` for 1440px desktop and 375px mobile. Add `--wait-ms`, `--selector-ready`, and for interactive pages `--script <file.mjs>` (a default-exported `async (page) => {}` that types fixed inputs and clicks) with `--state-name initial|input|results|expanded|error`, one capture call per state, identical for before and after. Each PNG gets a `.meta.json` (URL, viewport, browser, scroll, state). Use deterministic data. If screenshots are impossible (no Playwright or browser), report the limitation and stop at USER INPUT NEEDED; never substitute pictures.

### 3. Directions and gate 1
- TRANSFORM: three substantially different directions. ENHANCE: three when layout or visual identity change meaningfully, otherwise one. POLISH: one, no gate unless the user asks. Starting points (not templates), see `reference/design-guide.md`: **A Premium Refined**, **B Bold Distinctive**, **C Modern Interactive**. They must genuinely differ in composition and hierarchy, not just colour.
- Make real previews without editing source: write `<P>/A.css`, `B.css`, `C.css` (override styles for the page) and render each with `<C> capture --label after --out <P>/A --inject-css <P>/A.css --page <path> ...`. If a direction needs markup changes that CSS cannot show, build a scratch copy of the page outside the source tree and say so. Write one line per direction into `<P>/A.txt`, `B.txt`, `C.txt`, then `<W> gallery --dir <P> --out <P>/directions.html --dirs A,B,C`. View the PNGs yourself (Read) before describing them, and list the absolute path of `directions.html`. Never describe text as if it were a preview.
- Gate 1 (skip for POLISH): 1 DESIGN A, 2 DESIGN B, 3 DESIGN C, 4 REQUEST DIFFERENT DESIGNS, 5 CANCEL. Show it with the assessment and preview paths. Wait. 4: produce three new, different directions. 5: stop, change nothing.

### 4. Implement (only after gate 1)
Apply the chosen direction to the real source, preferring shared tokens, components and existing dependencies over per-page hacks. Where the Impeccable skill exists, refine with its commands (next section). Per mode (details in the design guide): TOOLS make the primary answer the centerpiece with a quick answer and optional detailed answer, minimal steps, copy/share where it already fits; LANDING a memorable first screen, clear value, one primary call to action, trust elements that already exist; ECOMMERCE product presentation, options, purchase clarity, mobile buying; DASHBOARD hierarchy, readable data, tables, filters, status, actions; FORMS labels, grouping, validation feedback, low friction; CONTENT readability, hierarchy, callouts, in-page navigation; NAVIGATION discoverability, structure, search, mobile menu, less clutter. Respect `prefers-reduced-motion`, keep focus states, no heavy libraries for decoration, preserve SEO markup and metadata.

### 5. Validate, compare, gate 2
1. Run the repo's own checks (type check, lint, unit and built-site tests, build; browser tests unless the repo disables them). Report only what ran. Run the checklist in `reference/quality-checklist.md` (console errors, overflow at 375 and 320px, keyboard, contrast, functionality, SEO tags unchanged, shared-component dependants).
2. `<C> capture --label after ...` with exactly the same pages, states, scripts, viewports and theme as before. `<C> changed --out <O>`.
3. Write `<O>/changes.json` (`[{"change","why","functionality"}]`, only changes you actually saw) then `<C> report --out <O>`: slider, side-by-side, highlighted differences, change table, status banner. View the side-by-side and diff PNGs before describing them.
4. Judge improvement on hierarchy, professionalism, brand fit, readability, usability, memorability, accessibility and clarity, not on pixel percent. If `summary.json` has `noMeaningfulChange: true` or it looks the same, state **NO MEANINGFUL VISUAL IMPROVEMENT DETECTED**: what was tried, why it was limited, what else could help. For ENHANCE and TRANSFORM, evaluate further before presenting. Never add arbitrary changes to make pictures differ.
5. `<C> pending --out <O>`, then show the BWEWOW DESIGN REPORT (below) with the report path and gate 2: 1 APPROVE CHANGES, 2 REQUEST REVISIONS, 3 REJECT & RESTORE ORIGINAL, 4 TRY ANOTHER DESIGN. Stop.

### 6. After gate 2
- **1 Approve:** `<C> decide approve --out <O>` (records the approved files' hashes), finish validation, keep changes on the working branch, state not deployed. If files affecting the design change later, `status` prints APPROVAL STALE and a new review is needed.
- **2 Revise:** `<C> decide revise --out <O>`, ask what to change (USER INPUT NEEDED), keep the before captures and rollback point, apply, recapture AFTER, rewrite `changes.json`, `report`, `pending`, gate 2 again.
- **3 Reject:** `<C> decide reject --out <O>` then `<C> restore --out <O>`. Only this run's files are restored (tracked files return to the rollback commit, files this run created are removed, earlier uncommitted work is byte-identical); the command verifies and exits non-zero otherwise. Optionally recapture to prove the page matches BEFORE. Report the output.
- **4 Another design:** reject and restore as in 3 (the before PNGs survive), then `<C> begin --out <O> --run <name>-2 ...` and go back to step 3 with a new direction; archive the old `after-*` and report files first (`mv`). The baseline stays the original.

## Impeccable integration (optional, never required)
Detect it: a skill named `impeccable` in the session list, `.claude/skills/`, `~/.claude/skills/` or a plugin. Read its own `SKILL.md` and command files and take the real command list from them; never assume. Useful when present, by purpose: polish, bolder, distill, colorize, typeset, adapt, critique/audit; for the "arrange" job use `layout` (some versions have no `arrange`; use whatever the installed list actually offers). Run a command by loading the skill with the command as its argument. It refines the selected direction; BWE-WOW still owns direction, comparison, gates and final validation. Avoid duplicate or conflicting edits (do not run polish after a TRANSFORM has re-set the same styles). Without Impeccable, do the work with native capabilities and say nothing is missing.

## Scope
Default to the current page or component. Website-wide: inventory page types, find shared components, choose representative pages, propose a rollout, get approval, implement a limited pilot, validate it, and ask again before widening. Prefer design-system changes (tokens, shared components) over editing hundreds of pages; test representative dependants.

## BWEWOW DESIGN REPORT (final output format)
```
BWEWOW DESIGN REPORT
Website:  Page:  Detected Mode:  Intensity:
ORIGINAL DESIGN: brief assessment
DESIGN CHANGES: summary
VISUAL COMPARISON: path of report.html (and directions.html)
FILES MODIFIED: list (from `changed`)
TEST RESULTS: passed / failed / not executed, each with the command
ACCESSIBILITY: findings
PERFORMANCE: findings
APPROVAL STATUS: Pending / Approved / Rejected
DEPLOYMENT STATUS: Not deployed
NEXT STEPS: concise
```

## Bootstrap when BWE-IMPECCABLE is not installed
`wow.mjs find-compare` fails only when no `compare.mjs` exists. The repository that ships this skill also ships BWE-IMPECCABLE; copy `.claude/skills/BWE-IMPECCABLE/compare.mjs` next to this file (`.claude/skills/BWE-WOW/compare.mjs`) or install BWE-IMPECCABLE. An account-level install of this skill carries the full helper inline at the end of its SKILL.md; write it to `.claude/skills/BWE-WOW/compare.mjs` then run `npm i -D playwright` only if Playwright is missing and the user agrees.
