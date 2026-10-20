---
name: BWEOCABackup
description: Backs up the One Click Answers project (Z:\Backup\websites\OneClickAnswers) to timestamped zip files in Z:\Backup\Websites\OCA\Backup - a zip of the project folder with its git history, and a zip of the production Cloudflare KV data that is not in git (business details, logo, favicon, settings). Runs daily at 11:00 PM as a Windows Task Scheduler job. Use when the user says "back up OCA", "OCA backup", or invokes /BWEOCABackup, in the context of the One Click Answers project.
---

# BWEOCABackup

> **Machine-only (added 2026-10-06 for the repository copy):** this skill runs only on the owner's Windows machine (`Z:\Backup\websites\OneClickAnswers`); it needs Windows PowerShell, the `Z:` backup drive, `C:\Users\Admin\.claude\skills\BWEOCABackup\backup.ps1` and the Wrangler login; the repository itself is already kept on GitHub. The local behaviour below is unchanged. **In a cloud Claude Code project, do not attempt it:** say that it is local-only and stop. See docs/WORKFLOW.md "Local and cloud sessions" and docs/CLAUDE-PROJECT-MIGRATION.md.

When this skill is invoked, treat it exactly as if the user sent this message:

> Run a full backup of the One Click Answers project folder and its production Cloudflare data, to timestamped files.

Carry out that instruction directly with the PowerShell tool, no confirmation needed: the script only reads the project and Cloudflare and writes new timestamped files.

## Run
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Admin\.claude\skills\BWEOCABackup\backup.ps1"
```
It can take a few minutes; a long run is not a hang. Do not edit or delete anything else.

## What it produces (one shared timestamp, `yyyyMMddHHmm`)
1. `Z:\Backup\Websites\OCA\Backup\<timestamp>OCA.zip`: the whole project folder including `.git` (full history), docs, tests and seed data. Left out because they are rebuilt or hold secrets: `node_modules`, `dist`, `.astro`, `.wrangler`, `.tmp`, `test-results`, `playwright-report`, `shots`, `.dev.vars` and any `.env*`.
2. `Z:\Backup\Websites\OCA\Backup\<timestamp>OCA-kv.zip`: the PRODUCTION Cloudflare KV values that are not in git (business details, logo, favicon, the site-login switch, pending category and publication requests), plus `_manifest.json` listing what was saved and what was left out. Left out on purpose: password hashes (`cred:*`, `site-accounts`), signing secrets (`secret:*`), reset tokens, rate-limit counters and the cached crawler ranges. If production data is ever lost, the owner re-sets the admin password through the reset link and re-creates the visitor accounts.

Afterwards the script keeps the newest 30 backups of each kind and deletes only older files it made itself (matching `????????????OCA.zip` and `????????????OCA-kv.zip`).

## Report
Both file paths and sizes, how many files went into the project zip, how many KV keys were saved and left out, and anything pruned. If a step failed, say which and show the real error text. Never print a token or password (the script never reads one; Wrangler uses the owner's own login).

## Schedule
Runs every day at 11:00 PM local time as a WINDOWS TASK SCHEDULER job named `BWEOCABackup` (it runs `backup.ps1` directly with Windows PowerShell as the user Admin, only while Admin is logged on; no Claude session is needed). If the PC was off or asleep at 11 PM, it runs as soon as it can after (StartWhenAvailable). Each run appends its output, and any error, to `Z:\Backup\Websites\OCA\Backup\backup.log`. The script works from the project folder because a scheduled run starts in `C:\Windows\System32`, where Wrangler cannot write its logs. Manage it in Task Scheduler, or with `Get-ScheduledTask BWEOCABackup`, `Start-ScheduledTask BWEOCABackup` and `Unregister-ScheduledTask BWEOCABackup`. The earlier Claude scheduled task was removed.

## Do not
- Do not back up secrets, tokens, password hashes or `.dev.vars` into the zips.
- Do not commit, push, deploy or change any project file.
- Do not restore anything from a backup unless the owner asks.
