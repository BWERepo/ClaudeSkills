---
name: BWEOCAGit
description: Commits the current work in the One Click Answers project (Z:\Backup\websites\OneClickAnswers) to git and pushes it to the remote, and does nothing else. No build, no tests, no deploy, no version bump. Use when the user says "commit and push", "git it", or invokes /BWEOCAGit, in the context of the One Click Answers project.
---

# BWEOCAGit

> **Where it runs (local or cloud):** `Z:\Backup\websites\OneClickAnswers` below is the owner's local Windows checkout and is optional. In any other checkout (a cloud Claude Code project, Linux or macOS) use the repository root, the folder that holds `CLAUDE.md`; nothing in this skill needs the `Z:` drive. See docs/CLAUDE-PROJECT-MIGRATION.md.
>
> **Cloud sessions:** commit and push only the session's own branch (never `main`) and hand the change over through a pull request.

Commit the current working tree in `Z:\Backup\websites\OneClickAnswers` and push it. Nothing else. This is `/BWEOCACommit` plus a push.

## Do
1. Run `git status --short`, `git diff --stat` and `git branch --show-current`. The repo's working branch is `main`; if on another branch, say so and use that branch.
2. If there is nothing to commit, skip to step 6 (push any unpushed commits) and say there was nothing new to commit.
3. Check that nothing sensitive is being committed: no `.dev.vars`, secrets, passwords, API keys or tokens (also scan the staged diff for private-key blocks and key-like strings); no `seo/data/`, `seo/sources/`, `test-results/`, `dist/`, `node_modules/`, `.wrangler/`, `.tmp/`. Staging-only files must not be in `public/` (see CLAUDE.md "Indexing"). If anything looks wrong, stop and report: do not commit and do not push.
4. Stage everything with `git add -A`.
5. Commit with a clear message: a short imperative summary line, then a few lines describing what changed and why, grouped by feature (read `docs/QUEUE.md` and the diff; invent nothing the diff does not show). End with:
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
   Use a heredoc. Never `--no-verify`, never amend, never skip signing. If a hook fails, fix the cause and make a new commit.
6. Push the current branch to its remote with a plain `git push` (use `git push -u origin <branch>` only if no upstream is set). Never force-push (`--force`, `--force-with-lease`). If the push is rejected because the remote has new commits, stop and report; do not rebase, merge or force on your own.
7. Report: the commit hash (if one was made), the files changed, the branch pushed and the remote URL, and `git status` afterwards (clean, and not ahead of the remote). Include the GitHub link to the commit.

## Do not
- Do not build, run tests, deploy to staging or production, or bump `version.json`. Those belong to `/BWEOCACheckpoint` and `npm run deploy:staging`.
- Do not open a PR, tag, or touch any branch other than the current one.
- Do not edit files or "clean up" before committing. Commit exactly what is there.
- Do not ask questions unless step 3 finds a problem or the push is rejected.
