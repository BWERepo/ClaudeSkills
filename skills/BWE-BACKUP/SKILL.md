---
name: BWE-BACKUP
description: Backs up the current project folder to a timestamped zip file, including git history, and leaves out rebuildable folders and secrets. Use when the user says "back up this project", "backup", or invokes /BWE-BACKUP, in any project. For the One Click Answers project use BWE-OCA-BACKUP instead.
---

# BWE-BACKUP

Make a safe, timestamped copy of the current project so the owner can recover it. The skill only reads the project and writes one new zip file.

> **Local-only:** a backup needs the owner's machine and backup drive. In a cloud Claude Code project, do not attempt it: say that the backup is local-only, remind the owner that the repository itself is kept on GitHub, and stop.

## Do
1. Identify the project folder (the current working directory) and its name.
2. Find the backup destination: use the folder named in the project's `CLAUDE.md` or docs (look for "backup"), otherwise ask the owner once. Never guess a destination, and never write the zip inside the project folder.
3. Pick one timestamp, `yyyyMMddHHmm`, and create `<destination>/<timestamp><ProjectName>.zip` containing the whole project folder, including `.git` (full history), docs, tests and data.
4. Leave out folders that are rebuilt and files that hold secrets: `node_modules`, `dist`, `build`, `.astro`, `.next`, `.wrangler`, `.cache`, `.tmp`, `test-results`, `playwright-report`, `coverage`, `.dev.vars` and any `.env*`.
5. Verify the zip: it exists, its size is not zero, and listing it shows `.git` and the top-level project files. If a step fails, say which one and show the real error text.

## Report
The zip path and size, how many files went in, and which folders and files were left out. Never print a token or password.

## Do not
- Do not back up secrets, tokens, password hashes, `.dev.vars` or `.env*` files.
- Do not delete or overwrite any earlier backup, and do not prune old backups unless the owner asks.
- Do not commit, push, deploy or change any project file.
- Do not restore anything from a backup unless the owner asks.
