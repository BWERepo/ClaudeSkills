# Using the BWESEO engine from a Claude Project or cloud thread

The engine is an ordinary Git repository. Nothing in it requires a particular folder, drive or machine. A machine (a developer
laptop, a Claude Project, a cloud thread) only has to answer one question: **where is the checkout?** The answer is the environment
variable **`BWESEO_ENGINE_HOME`**.

## 1. Get the engine

Clone the (private) repository into any directory the thread can read and keep for the session, using whatever GitHub access the
Project or machine already has:

```
git clone <repository URL> SEOEngine
cd SEOEngine
npm ci
```

`npm ci` installs exactly what `package-lock.json` pins (the test runner only; the engine has no runtime dependencies). It is needed to
run the engine's own tests and checkpoint. It is **not** needed just to install the engine into a website, which uses Node 18+ alone.

## 2. Tell everything where it is: `BWESEO_ENGINE_HOME`

```
export BWESEO_ENGINE_HOME="$PWD"                      # macOS / Linux / cloud shell
$env:BWESEO_ENGINE_HOME = (Get-Location).Path        # Windows PowerShell (current session)
setx BWESEO_ENGINE_HOME "<path to the checkout>"      # Windows, permanent (open a new terminal afterwards)
```

It must be the directory that contains `VERSION` and `engine-manifest.json`. (`BWESEO_ENGINE` is accepted as an alias.) The lookup
order is: `BWESEO_ENGINE_HOME` → `BWESEO_ENGINE` → the location recorded by `node scripts/register-engine.mjs` in
`~/.claude/bweseo/engine-location.json` → a deprecated legacy folder (flagged). The variable always wins.

A developer machine may keep the engine anywhere (for example a backup drive) and set the variable once; that path is **local
configuration** and is never written into the repository. In a cloud thread, set the variable at the start of every session (a
cloud home directory is normally thrown away between sessions, so do not rely on `register-engine`).

Check it: `node "$BWESEO_ENGINE_HOME/scripts/validate-canonical.mjs"` (add `--run-tests` for the full suite) → `Canonical engine: READY`.

## 3. Make the skills available (`--sync-skills`)

The `/BWESEO…` skills are written once, in the engine's `skills/` folder. Claude Code only loads skills from a skills folder, so they
must be copied into one. Always preview first:

```
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --sync-skills --dry-run
node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --sync-skills
```

By default this installs into the **user-level** skills folder (`~/.claude/skills`). Skills there are available in every project on that
machine. In a cloud thread that folder starts empty each session, so run `--sync-skills` once at the start of the session.

### Repository-local skills (recommended for a Claude Project)

Claude Code also loads **project-level** skills from `.claude/skills/` inside the repository the session is opened in. To make the
skills travel with a customer's website repository instead of a machine, point the installer at that folder:

```
cd <the customer's website repository>
BWESEO_SKILLS_DIR="$PWD/.claude/skills" node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --sync-skills --dry-run
BWESEO_SKILLS_DIR="$PWD/.claude/skills" node "$BWESEO_ENGINE_HOME/installer/bweseo-install.mjs" --sync-skills
```

(PowerShell: `$env:BWESEO_SKILLS_DIR = "$PWD\.claude\skills"` first.) Then commit `.claude/skills/` in that website's repository if the
team wants every checkout to have the same skills. Re-run the command after each engine update (`/BWESEOInstall --dry-run --update`
reports skill drift). Skills contain no customer data; they only describe the workflow and call the engine through
`$BWESEO_ENGINE_HOME`, so that variable must also be set wherever the skills run.

Required setup per Claude Project, in order:
1. the engine checked out somewhere readable, `npm ci` run if the thread will run engine tests;
2. `BWESEO_ENGINE_HOME` set for the session;
3. skills synced (user-level, or `BWESEO_SKILLS_DIR` for repository-local);
4. in the website repository: `/BWESEOInstall --dry-run`, then `/BWESEOInstall`, then `/BWESEOInstall --verify`.

## 4. The engine's own maintenance skills

`/BWESEOBegin`, `/BWESEOCheckpoint`, `/BWESEOEnd` and `/BWESEOAll` maintain the **engine repository itself**. They live in this
repository's `.claude/skills/` and load automatically when Claude Code is opened in the engine checkout. They locate the repository from the
current directory (or `BWESEO_ENGINE_HOME`) and use no fixed paths. They are not installed into customer projects.

If an older copy of these four skills exists in a machine's user-level skills folder, delete it: a user-level skill of the same name may
take precedence over the repository's version.

## 5. Where customer data lives

Never in the engine. Each website keeps its own `seo/` and `docs/seo/`. The engine only keeps, per machine and outside the repository, a
fingerprint registry (`~/.claude/bweseo/registry.json`) used to make sure no customer's identity leaks into engine files. A cloud
thread without that registry skips that one machine-specific check; the committed fictional-customer tests still run.

## Troubleshooting

| Message | Fix |
|---|---|
| `the canonical BWESEO engine cannot be located` | set `BWESEO_ENGINE_HOME` to the directory containing `VERSION` and `engine-manifest.json` |
| `DEPRECATED legacy location` in `--verify` | set `BWESEO_ENGINE_HOME`, or run `node scripts/register-engine.mjs` once |
| `Cannot find package 'vitest'` | run `npm ci` in the engine checkout |
| a skill says `$BWESEO_ENGINE` is unset | the skills read `BWESEO_ENGINE_HOME` (alias `BWESEO_ENGINE`); export it in the session that runs them |
