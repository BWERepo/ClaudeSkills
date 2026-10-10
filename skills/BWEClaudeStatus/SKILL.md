---
name: BWEClaudeStatus
description: Summarizes the current status of this Claude session: what Claude itself (the main session) is working on right now, and a one-line description of what each agent (subagent, teammate or other local Claude session) is doing, with its state (running, idle, done). Use when the user says "status", "what is Claude doing", "what are the agents doing", "who is working", or invokes /BWEClaudeStatus, in any project.
---

# BWEClaudeStatus

Give the owner a quick, honest picture of everything that is going on in this session: Claude's own work first, then each agent.

## Do
1. Call the `ListAgents` tool (no arguments) to get every agent you can message: subagents spawned in this session, teammates and other local Claude sessions. Use each row's name and its running / idle / completed state exactly as listed.
2. Also use what you already know from this conversation: the task you gave each agent you spawned (its description and the queue item it was given) and any hand-back report you have already received. Never guess a result you have not received; a running agent's outcome is unknown until its completion notice arrives. A subagent that `ListAgents` no longer lists but whose report you received is "done (reported)".
3. Work out what YOU (the main Claude) are doing right now: the task or queue item in progress, the step you are on, and what is left, from the current conversation and your own task list. If you are idle and waiting for the owner, say what you are waiting for (an answer, a "go").
4. Reply in this shape and nothing longer:
   **Claude (main):** one or two plain sentences: what it is working on now, which step it is on, and what comes next.
   Then ONE short table, one row per agent, ONE line each:
   | Agent | What it is doing (one line, plain English, under about 15 words) | State |
   State is one of: running, idle, done (reported), failed, waiting. Name agents by their task (for example "Item 59: Contact and Reviews"), not by internal ids; never print raw agent ids or ref codes.
5. If there are no agents, write "No agents are running or listed." instead of the table.
6. Add at most one final line for anything the owner must act on (an agent waiting on an answer, two agents editing the same files, a failure, or Claude waiting on the owner). Do not repeat the agents' reports and do not restate the work queue unless the owner asked for it.

## Do not
- Do not read an agent's output file or transcript (they can be huge); rely on `ListAgents`, your own spawn prompts and hand-back messages.
- Do not start, stop, message or resume any agent as part of this report, and do not edit any file.
- Do not invent progress: if you do not know, say "working, no report yet".
