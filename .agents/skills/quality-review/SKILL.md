---
name: quality-review
description: Use when reviewing code changes against AGENTS.md implementation quality standards, or when asked to do an implementation quality review
metadata:
  internal: true
---

# Quality Review

## Overview

Dispatches one parallel Sonnet agent per bullet point in the `## Implementation Quality` section of the nearest `AGENTS.md`. Each agent independently discovers what changed and checks the codebase against exactly one criterion. A triage pass then removes false positives, duplicates, and contradictions before the final report.

## Workflow

```
1. PARSE    → Extract each bullet point from ## Implementation Quality in AGENTS.md
2. DISPATCH → One Task agent per criterion (all in parallel, single message)
3. TRIAGE   → Review all raw findings: drop false positives, duplicates, and contradictions
4. REPORT   → Compile cleaned findings into summary table
```

## Step 1: Parse Criteria from AGENTS.md

Read the project's `AGENTS.md` and extract every bullet point under `## Implementation Quality`. Stop at the next `##` heading — do not include bullets from any other section. Each `-` line becomes one criterion.

Do not hardcode criteria — always read from the current project's AGENTS.md so the skill stays in sync with the project's actual standards.

## Step 2: Dispatch Parallel Agents

**CRITICAL: All agents must be launched in a SINGLE message with multiple Task tool calls.** Do not loop sequentially.

Use `subagent_type: "Explore"` and `model: "sonnet"` on every Task call.

**Agent prompt template** for each criterion (set `model: "sonnet"` on every Task call):

```
You are a focused code reviewer responsible for checking ONE specific quality criterion.

Criterion:
{criterion_text}

Your job:
1. Discover what changed — start with `git diff origin/main...HEAD` or `git diff main...HEAD`.
2. Feel free to explore the broader codebase or search the web for anything — do as much research as needed to make a confident judgment.
3. Check whether the changes comply with your assigned criterion.
4. Report ALL violations you find — do not stop at the first one.

Output format (exactly this structure, nothing else):
**{criterion_short_name}**: PASS | WARN | FAIL
- `file:line` — description of violation  (repeat for every violation found)
(omit bullet lines entirely if PASS)
```

Replace `{criterion_short_name}` with a 2-5 word label derived from the criterion.

## Step 3: Triage Raw Findings

After all agents complete, review their combined output **before** building the report table. Apply each filter below and silently drop any finding that fails:

| Filter | Rule |
|--------|------|
| **False positive** | The flagged code is correct per the criterion when its full context is understood (e.g., a "one-time abstraction" that is actually reused elsewhere, framework-generated boilerplate the author didn't write, or a WARN that the criterion explicitly permits). |
| **Duplicate** | Two or more findings point to the same file+line for the same root cause, regardless of which criterion reported it. Keep only the most specific one. |
| **Contradiction** | A finding is itself in tension with another principle in AGENTS.md — e.g., flagging missing abstraction under DRY when adding it would violate YAGNI, or flagging missing error handling when the code correctly follows "fail fast." Drop the finding if following its recommendation would violate a different criterion. |

After filtering, re-evaluate each criterion's overall verdict:
- If all its violations were dropped → change verdict to PASS.
- If only FAIL violations were dropped but WARNs remain → change verdict to WARN.

Do not modify the verdict of a finding you decide to keep.

## Step 4: Compile Report

Output a table with one row per violation — if a criterion has multiple violations, give each its own row. Criteria with no violations get a single PASS row.

```
## Quality Review

| Criterion | Verdict | Finding |
|-----------|---------|---------|
| Engineered enough / YAGNI | WARN | `src/bar.ts:10` — abstraction added for single use case |
| Engineered enough / YAGNI | WARN | `src/baz.ts:88` — second violation of same criterion |
| DRY | PASS | |
| ... | | |

**Result: N criteria checked. X passed, Y warnings, Z failures.**
```

Each violation gets its own row, even when multiple violations share a criterion. List FAILs first, then WARNs, then PASSes so issues surface immediately.

If all pass: `✓ All N criteria passed.`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Launching agents sequentially | All Task calls in ONE message — that's the whole point |
| Hardcoding criteria | Always read from AGENTS.md — criteria drift over time |
| Passing the diff to agents | Don't — agents discover changes themselves via git |
| Agents checking multiple criteria | Each agent gets exactly one criterion |
| Skipping PASS rows in output | Include all criteria so nothing appears missed |
| Including TypeScript safety rules | Only parse `## Implementation Quality` — stop at the next `##` heading |
| Skipping triage | Always run Step 3 — subagents can't see each other's output and will produce overlapping findings |
| Dropping findings without justification | Each dropped finding must match a specific triage filter; do not drop findings just because they seem minor |
