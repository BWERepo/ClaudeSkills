---
name: BWE-IMPECCABLE
description: Implements a design upgrade of a website by offering a checklist of every installed Impeccable command (default: the seven design stages in order). Every change is PROPOSED: it captures before and after screenshots (1440 and 375 pixels) with a slider, side-by-side, highlighted differences and an HTML report, then asks the user to approve, revise or reject (reject restores only the files of this run), then validates. Supports whole site, one page or component, --audit-only and --staging. Never deploys to production. Use when the user says "run impeccable", "improve the design of the site", or invokes /BWE-IMPECCABLE, in any BWE website repository.
---

# BWE-IMPECCABLE: Impeccable design upgrade, implemented and validated

Reusable in any BWE website repository. Nothing in this file is specific to one site: the site's own rules come from its `CLAUDE.md` and docs, which you read in Phase 1.

## Arguments

| Invocation | Meaning |
|---|---|
| `/BWE-IMPECCABLE` | Whole website. |
| `/BWE-IMPECCABLE <page>` (for example `homepage`) | That page plus the shared components it needs. |
| `/BWE-IMPECCABLE <component>` (for example `navigation`) | That component system only. |
| `/BWE-IMPECCABLE --audit-only` | Phases 1 and 2 plus a ranked recommendation list. Changes no code. Can combine with a page or component. |
| `/BWE-IMPECCABLE polish colorize` | Preselect exactly those Impeccable commands in the checklist (still confirmed before running). |
| `/BWE-IMPECCABLE --staging` | Implement for staging: work on a branch and open a pull request or use the repo's staging route. Never production. |

No argument means the whole site, implemented on a branch for review. Production is never touched in any mode.

## Step 0: find Impeccable and its commands (before anything else)

Impeccable is ONE skill whose commands run as `/impeccable <command>` (for example `/impeccable polish`). It is not a set of separate skills.

1. Find the installed Impeccable skill (session skill list, `.claude/skills/`, `~/.claude/skills/`, installed plugins). Record how it is invoked.
2. **Discover the command list from the installed files**: read the skill's own `SKILL.md` and its command or reference files and take each command's name and a one-line description from them. Never hard-code the list, because versions differ. (One install reported: craft, shape, init, document, extract, critique, audit, polish, bolder, quieter, distill, harden, onboard, animate, colorize, typeset, layout, delight, overdrive, clarify, adapt, optimize, live, generate. Treat that as an example only.)
3. If Impeccable is not installed, or a command the user ticks does not exist, **stop and show the USER INPUT NEEDED block** (below). Do not skip silently and do not write a substitute. Options to offer: install Impeccable and rerun (recommended), or approve doing that stage by hand from its objective, labelled as not Impeccable.
4. The default seven-stage workflow is polish, bolder, distill, arrange, colorize, typeset, adapt. Impeccable has no `arrange` command; the closest is `layout`. Offer `layout` in that slot and say so in the list. Map any other default name that is missing the same way, and ask.
5. Do not assume a slash command can be called from inside a skill. Run a command by loading the Impeccable skill (Skill tool) with the command as its argument, or by following its command file; if that is unsupported, follow the closest equivalent and say so.

## Step 0b: let the user pick the commands (checklist)

Show every discovered command with its one-line explanation and let the user tick any number of them.

- **Where Claude Code has a multi-select prompt (AskUserQuestion with `multiSelect: true`), use it**, so the user sees real checkboxes. Such prompts cap the options per question (about 4) and the number of questions per call (about 4), so split the commands into groups of 4 (for example Core, Refine, Build, Extras), one question per group, and send as many calls as needed.
- **Fallback when no such prompt exists**: print a numbered list with `[ ]` boxes (`[x]` for preselected) and ask the user to reply with the numbers to run, or "ok" to accept the preselection.
- **Default preselection** is the seven stages in order (polish, bolder, distill, layout in the arrange slot, colorize, typeset, adapt). If the user just confirms, run those. If the user passed command names as arguments, preselect exactly those and still confirm.
- Run the ticked commands **in the order shown in the list**, not the order they were ticked. Run only ticked commands. Starting a run needs the user's confirmed selection (the USER INPUT NEEDED block applies).

## Before & After Visual Approval Workflow (mandatory whenever an existing site is modified)

Helper: `compare.mjs` in this skill's folder (`.claude/skills/BWE-IMPECCABLE/compare.mjs`). Playwright only (project or global install, installed Chromium). Use it in every BWE repo; do not write a second tool. `<H>` below means `node .claude/skills/BWE-IMPECCABLE/compare.mjs` and `<O>` the run folder `.tmp/impeccable-compare/<run>` (git-ignored; never commit screenshots unless asked). The run's whole state lives in `<O>/state.json`.

**Every change Impeccable makes is PROPOSED until the user approves it. Never deploy, and never continue with more design edits, until the user answers.**

1. **CAPTURE BEFORE and set the rollback point (before any edit).** `<H> begin --out <O> --run <name> --pages "/,/x"` records the current commit, backs up every file that is already uncommitted (so unrelated work is protected) and writes `state.json`. Build or start the site as the repo does, then `<H> capture --label before --out <O> --page / --page /x --serve <built folder>` (or `--base-url http://localhost:PORT`): full-page 1440px desktop and 375px mobile PNGs. Note the files and components in scope. No code changes until both steps succeed.
2. **EXECUTE IMPECCABLE** (Phase 3) on the working branch. Preserve functionality, touch nothing unrelated, no deploy.
3. **CAPTURE AFTER.** Same `--page` list, `--out`, URL, theme/state and viewports (the helper starts at scroll top, disables animations, waits for fonts; reproduce any state such as an open menu or dark theme identically and say so): `<H> capture --label after ...`. Then `<H> changed --out <O>` lists the files this operation changed.
4. **Write `<O>/changes.json`** (Write tool): `[{"change":"...","why":"...","functionality":"..."}]`, one entry per meaningful visual change you actually saw, with why it improves the design and any functionality affected ("None identified" only if checked). Then `<H> report --out <O>` writes `report.html` (labelled BEFORE | AFTER, an interactive comparison slider, a red-highlighted difference image, the change table, the status banner), plus `side-by-side-*.png`, `diff-*.png`, `summary.json`.
5. **Examine the images** (Read the side-by-side and diff PNGs). Describe only what you saw. A percentage alone is not a review.
6. **NO IMPROVEMENT CHECK.** If `summary.json` has `noMeaningfulChange: true` (under 0.5% of pixels changed everywhere; the report shows the banner) or the images look the same, say **"NO MEANINGFUL VISUAL IMPROVEMENT DETECTED."** and claim no improvement. Then look for the reason and make one more round of refinements toward the stated goal before the review (rule 5 of the next section); if that round still shows nothing, explain what was attempted and offer another design pass (that is option 2 below).
7. **USER REVIEW.** Show BEFORE | AFTER (embed or link the side-by-side), the visual improvement validation (next section), CHANGES MADE (from `changes.json`), files modified, the absolute `report.html` path, then run `<H> pending --out <O>` (saves PENDING APPROVAL) and show the gate:

```
========================================
         USER INPUT NEEDED
========================================
Please review the Before & After comparison.
1. APPROVE
2. REQUEST REVISIONS
3. REJECT
Waiting for your decision.
```

   Use AskUserQuestion with those three options where the environment supports it; otherwise print the numbered list and wait for "1", "2" or "3" in chat. The HTML report is for viewing only: **opening it is never approval**, and the report has no working buttons. Silence is not approval. After the gate, do nothing else (no more edits, no deploy) until the user answers.
8. **1 APPROVE:** `<H> decide approve --out <O>`; keep the changes on the working branch; run the Phase 4 regression and accessibility checks; report final status. Production still needs a separate deployment authorization.
9. **2 REQUEST REVISIONS:** `<H> decide revise --out <O>`; ask what to change (USER INPUT NEEDED), keep the before PNGs and the rollback point, apply the revisions, recapture AFTER with the same arguments, regenerate `changes.json` and `report`, run `pending` and show the gate again.
10. **3 REJECT:** `<H> decide reject --out <O>` then `<H> restore --out <O>`. Restore touches only files changed by this operation: tracked files return to the rollback commit, files created by the operation are removed, and files that were already uncommitted return to their pre-operation content. The command verifies every restored file and that every pre-existing uncommitted file is byte-identical, and exits non-zero otherwise. Optionally recapture and compare to prove the page matches BEFORE. Report the rollback results from its output.
11. **Interrupted session:** the pending state survives in `state.json`. At the start of a run, and when resuming, check `<H> status --out <O>`: if it says `pending-approval`, show the report path and the gate again and wait; `revising` means continue the revision; `rejecting` means run restore. `begin` refuses to overwrite an unfinished operation (`--force` abandons it).
12. **Failure handling:** if a screenshot cannot be captured (no Playwright or browser, build fails, HTTP error, empty file) the helper exits non-zero and says why. Report the problem plainly and show USER INPUT NEEDED. Never fabricate or mock screenshots, never reuse screenshots of another page or state, and never say a comparison was done unless you opened the images. Pages not captured are listed as not compared.
13. `--audit-only` captures BEFORE only (no comparison, no approval gate).

## Visual improvement validation (mandatory after running Impeccable)

After running Impeccable (after each stage when the user reviews the stages one at a time, and always for the whole run), compare the BEFORE and AFTER screenshots. A stage reviewed on its own uses the previous stage's AFTER (or the merged site) as its BEFORE.

1. **Identify and describe every meaningful visual improvement**, page by page and viewport by viewport.
2. **Verify that each improvement is actually visible in the screenshots.** Open the side-by-side images with the Read tool and say where each one shows (page, viewport, theme, part of the page). What cannot be seen in a captured image is not reported as an improvement. When a change sits below the first screen, in another theme or at another width, capture that view too.
3. **If the screenshots appear virtually identical, report `NO MEANINGFUL VISUAL IMPROVEMENT DETECTED`** in those words, for that page and viewport or for the whole run.
4. **Do not claim the design was improved simply because code was modified.** A changed file, a passing test or a percentage of changed pixels is not evidence that a visitor sees something better.
5. **If no improvement is detected, investigate why** (the rule did not apply: wrong selector, overridden, stale build or cache; the change only shows in a state, theme or width that was not captured; or it was too slight to matter) **and attempt additional refinements appropriate to the requested design goals**, then capture AFTER again and repeat this validation, all before the USER REVIEW gate (step 7 above), so the refinement is part of the same proposal. If a second round still shows no meaningful improvement, stop, say why, and show the review gate.
6. **Never introduce arbitrary changes merely to make screenshots look different.** Every refinement serves the stage's objective and the user's stated goals, and obeys the protection rules.
7. **Provide a summary of exactly what changed and why it improves the user experience**: for each improvement, what it looked like before, what it looks like now, where it is visible, and why it helps a visitor (faster to scan, easier to tap, a clearer answer, easier to read, more consistent).

## Phase 1: website discovery

Read the repo's `CLAUDE.md` and design docs first, then identify: framework and frontend architecture, design system and tokens, global styles and themes, shared components, home and primary page layouts, navigation and footer, responsive breakpoints, branding and visual assets. List the pages and components the chosen scope affects. Keep the existing branding unless a change is clearly justified.

## Phase 2: baseline review

Before editing: inspect the current design, list visual weaknesses and inconsistencies, note reusable components, and record the baseline (build output; the BEFORE captures from the visual comparison section, plus extra widths such as 390 and 320 pixels and each theme the site has, when useful). Use a real build and a browser tool (Playwright with the installed Chromium) when available. **Only claim what was actually rendered or examined**; list pages not inspected. In `--audit-only`, finish here with a ranked list and stop.

## Phase 3: run the selected commands, in list order

The stages below describe the default seven; for any other ticked command use the objective in its own Impeccable command file. Run each with `/impeccable <command>`, considering what earlier stages changed, and prefer fixing a shared component over per-page edits. Do not touch the same component repeatedly without a reason.

1. **Polish** (`polish`): borders, shadows, spacing, details; consistency across components; remove unfinished or unprofessional styling.
2. **Bolder**: stronger visual identity, memorable emphasis, nothing generic or AI-looking.
3. **Distill**: remove clutter, excess whitespace, redundant elements and over-complex layouts; keep all essential content and function.
4. **Arrange** (`layout`; Impeccable has no `arrange`): hierarchy, logical order, card sizes and spacing; primary actions instantly recognisable.
5. **Colorize**: palette, contrast and accessibility (4.5:1 text, 3:1 large), purposeful colour, recognisable brand colours kept, never colour as the only signal.
6. **Typeset**: font hierarchy, line spacing, readability, consistent type, headings and key facts stand out.
7. **Adapt**: desktop, tablet and mobile; no horizontal overflow; navigation and controls usable at 320 pixels.

Update the progress block after each stage, and mark a stage Complete only after its work was done and its visual improvement validation was run (each improvement seen in the screenshots, or `NO MEANINGFUL VISUAL IMPROVEMENT DETECTED` reported).

## Protection rules (mandatory)

Do not remove functionality, change business logic or calculator formulas, delete pages or tools, break navigation, remove SEO metadata, change sitemap behaviour, remove structured data, change authentication or authorization, or alter production configuration. No new dependency without a stated justification. Obey the repo's own rules (for example theme, wording, time-format, indexing and deploy rules in its `CLAUDE.md`). **Never deploy to production without the owner's explicit authorization**; a deploy in `--staging` mode follows the repo's own staging route only, and cloud sessions without deploy access open a pull request instead.

## Phase 4: validation

Run the repo's own checks (type check, lint, unit tests, build, and its built-site tests; browser tests unless the repo disables them). Then verify navigation and interactive components, responsive behaviour and overflow, visual regressions: run the AFTER capture and the `report` step of the Before & After workflow, then the visual improvement validation, accessibility (contrast, focus, labels), and that SEO elements (titles, descriptions, canonicals, structured data, sitemap) are unchanged. Fix problems this work caused. List every check that could not run and why.

## USER INPUT NEEDED block

Whenever a decision, approval or missing tool blocks work, put this at the top of the message, not inside progress text, and wait:

```
# 🚨 USER INPUT NEEDED 🚨
Action Required: <decision>
Options: <choices>
Recommendation: <choice and why>
Consequences: <what each option does>
Awaiting your response before proceeding.
```

Group several questions under one block. Do not continue the blocked operation until the user answers.

## Progress report format

```
BWEIMPECCABLE — PROGRESS
- Polish: Complete / Running / Pending
- Bolder: ...
- Distill: ...
- Arrange: ...
- Colorize: ...
- Typeset: ...
- Adapt: ...
- Validation: ...
```

At the end report: 1) summary of design improvements, 2) files modified, 3) tests performed and results, 4) remaining issues and anything not verified, 5) the BEFORE | AFTER summary, the visual improvement validation (every improvement and where it is visible, or `NO MEANINGFUL VISUAL IMPROVEMENT DETECTED`) and the `report.html` path, 6) deployment status (state plainly that production was not deployed).


## Command list
To only list the installed Impeccable commands with a one-line explanation of each, read `reference/BWEImpeccableCommands/GUIDE.md` and follow it.
