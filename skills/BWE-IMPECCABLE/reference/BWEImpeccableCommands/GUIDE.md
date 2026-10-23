# BWE-IMPECCABLE commands: the Impeccable command list

Read-only. Shows what `/impeccable <command>` can do. It runs no command, edits nothing and deploys nothing.

## Steps

1. Find the installed Impeccable skill (`.claude/skills/impeccable/`, `~/.claude/skills/`, the session skill list, installed plugins). Read its `SKILL.md` and take the "Commands" table from it. **Never use a hard-coded list**: versions differ, so the installed files decide.
2. Show one table, grouped by the category column when the file has one: `/impeccable <command>` | one-line explanation (use the file's own description; shorten it only if it is long). Mark deprecated aliases as such.
3. Add the extras the same file documents, if present: `pin`/`unpin` (standalone shortcut for a command), `hooks` (design detector hook on/off/status), and `teach` as an alias of `init`.
4. If Impeccable is not installed, say so and stop. Do not invent a list.
5. End with one line: `/BWE-IMPECCABLE` runs a chosen set of these commands with before and after screenshots; type `/impeccable <command>` to run one directly.

## Fallback list

Only if the installed files cannot be read. Impeccable 4.5.2, checked 2026-10-09:

| Command | What it does |
|---|---|
| `shape [feature]` | Plan UX/UI before writing code. |
| `init` | Capture durable product context in PRODUCT.md. |
| `document` | Generate DESIGN.md from existing project code. |
| `extract [target]` | Pull reusable tokens and components into the design system. |
| `critique [target]` | UX design review with heuristic scoring. |
| `audit [target]` | Technical quality checks (accessibility, performance, responsive). |
| `polish [target]` | Final quality pass before shipping. |
| `bolder [target]` | Amplify safe or bland designs. |
| `quieter [target]` | Tone down aggressive or overstimulating designs. |
| `distill [target]` | Strip to essence, remove complexity. |
| `harden [target]` | Production-ready: errors, i18n, edge cases. |
| `onboard [target]` | Design first-run flows, empty states, activation. |
| `animate [target]` | Add purposeful animation and motion. |
| `colorize [target]` | Add strategic color to monochromatic UIs. |
| `typeset [target]` | Improve typography hierarchy and fonts. |
| `layout [target]` | Fix spacing, rhythm and visual hierarchy. |
| `delight [target]` | Add personality and memorable touches. |
| `overdrive [target]` | Push past conventional limits. |
| `clarify [target]` | Improve UX copy, labels and error messages. |
| `adapt [target]` | Adapt for different devices and screen sizes. |
| `optimize [target]` | Diagnose and fix UI performance. |
| `live` | Visual variant mode: pick elements in the browser and iterate on alternatives. |
| `generate [n] [action] [element]` | Variants of a named element to choose from in the live browser. |
| `craft [feature]` | Deprecated alias for an ordinary new-work request. |
