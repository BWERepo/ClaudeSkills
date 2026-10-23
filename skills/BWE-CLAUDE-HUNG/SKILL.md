---
name: BWE-CLAUDE-HUNG
description: Diagnoses whether another Claude Code session is hung (waiting for something that will never happen) or still working, and reports what it is doing. Run it from a SECOND session while the first looks stuck. Use when the user says "is claude hung", "is it stuck", "is it still running", "what is claude doing", or invokes /BWE-CLAUDE-HUNG (optionally with a project folder name, session id, or "all").
---

# BWE-CLAUDE-HUNG

Read-only diagnosis. Never kill, stop, message or modify the target session or any process unless the user asks afterwards.
A hung session cannot run this skill itself, so it inspects the target from outside: its transcript and its processes.

## 1. Pick the target
- Argument given (project folder fragment or session id): use it.
- No argument: transcripts live in `C:\Users\Admin\.claude\projects\<project>\<session-id>.jsonl` (subagents in `<session-id>\subagents\`). List the 5 most recently modified, EXCLUDING this session (this session's id is in your scratchpad path), and take the newest. If two are within a minute of each other, report both.
- `all`: report every transcript modified in the last 2 hours, one block each.

```powershell
Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter *.jsonl |
  Where-Object { $_.FullName -notmatch '\\subagents\\' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5 FullName, LastWriteTime, Length
```
The session-management tools (`list_sessions`, `get_session`, `list_events`; load with ToolSearch) may give a status directly; use them as a cross-check, but the transcript and processes are the evidence.

## 2. Read the end of the transcript
Tail about 40 lines of the .jsonl (`Get-Content -Tail 40`). Each line is JSON with `type`, `timestamp`, and `message.content` blocks. Work out the LAST event and how old it is (now minus its timestamp, in UTC):

| Last event | Meaning |
|---|---|
| assistant `tool_use`, no matching `tool_result` | A tool is running or waiting. Note the tool name and input (for Bash: the command). |
| assistant `tool_use` named AskUserQuestion / ExitPlanMode, or any tool that needs approval | Waiting for the USER (permission prompt or question). Not hung. |
| `tool_result` or user message, no assistant reply after | Waiting on the model/API. |
| assistant text with `stop_reason: end_turn` | Finished, idle, waiting for the user. Not hung. |
| assistant `tool_use` of Agent, plus fresh files in `subagents\` | A subagent is working; judge it by the subagent transcript's age instead. |

Also note the previous 3 or 4 events, so you can say what it was doing (files edited, commands run, the task).

## 3. Check processes (only when a tool call is pending)
Find the target's Claude process and its descendants, then sample CPU twice, 10 seconds apart:

```powershell
$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate
# claude / node roots, then walk ParentProcessId to collect children (bash, node, npm, wrangler, playwright, chrome, python ...)
$a = Get-Process -Id $ids | Select-Object Id,ProcessName,CPU,WorkingSet64,StartTime
Start-Sleep 10
$b = Get-Process -Id $ids | Select-Object Id,ProcessName,CPU,WorkingSet64
```
For each child record: name, command line (trim long ones), age, CPU delta over the 10 seconds, and whether it has established TCP connections (`Get-NetTCPConnection -OwningProcess`). Several sessions may be open, so match the right Claude root: the one whose child command line matches the pending tool input, or whose working directory matches the project.

## 4. Verdict
Choose exactly one:

- **RUNNING**: transcript changed in the last 60 s, or the pending command's process tree used CPU or has traffic, and it is within a plausible time for that command (builds, tests, deploys, `npm run deploy:staging`, Playwright e2e: several minutes is normal).
- **WAITING ON YOU**: a permission prompt, AskUserQuestion, plan approval, or a finished turn. Say exactly what it is asking.
- **WAITING ON THE MODEL**: last event is a tool result or user message, no reply, under 3 minutes. Over 5 minutes with no transcript change = **HUNG (stalled API request)**.
- **HUNG**: waiting on something that will not happen. Typical proofs: a pending tool whose process no longer exists (the result will never arrive); a child with zero CPU delta, no network connections and far beyond its normal duration (for example 10+ minutes for a command that should take seconds); a command reading stdin or waiting at a prompt (`Read-Host`, `git rebase -i`, `npm init`, a `y/n` question, an editor); a dev server or watcher run in the foreground; a deploy retrying a network failure; a subagent whose transcript has been untouched for 10+ minutes.
- **UNCLEAR**: say what evidence is missing and what to look at next.

Be honest about uncertainty. Quiet is not proof of a hang: some builds are silent for minutes. Say how sure you are.

## 5. Report
Short, plain, specific:

```
Target: <project> / <session id first 8 chars>   Last activity: <h:mm:ss AM/PM> (<N min ago>)
Verdict: RUNNING | WAITING ON YOU | WAITING ON THE MODEL | HUNG | UNCLEAR  (confidence: high/medium/low)
What it is doing: <task in one or two sentences, from the last few events>
Current step: <tool, command or file; process name, age, CPU delta, connections>
Why I think so: <the one or two facts that decide it>
Suggested action: <wait N more minutes | answer its prompt | press Esc / stop the session | kill PID x (ask first) | resume with a message>
```
Use 12-hour times with AM/PM. Never paste secrets that appear in command lines (tokens, passwords, API keys): redact them. Do not take any action on the target; offer the suggested action and wait for the user.
