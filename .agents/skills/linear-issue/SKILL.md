---
name: linear-issue
description: Use when creating a Linear issue from the current coding context, or when the user invokes /linear-issue. Infers team, priority, status, and relationships from conversation context, working directory, and git branch.
---

# Creating Linear Issues

Single-pass workflow: gather context, search existing issues, infer fields informed by what's already filed, create issue.

## Workflow

```
1. CONTEXT  → Gather signals: args, conversation, directory, git branch
2. SEARCH   → list_issues broadly to find duplicates, related issues, and inform inference
3. TEAMS    → list_teams to get available teams (informed by search results)
4. INFER    → Determine title, description, team, priority, status, labels, project, links, relationships
5. CREATE   → create_issue with inferred fields + relationships
6. REPORT   → Display created issue summary
```

## Step 1: CONTEXT

Gather all available signals:
- **Args**: Description provided after `/linear-issue` — primary signal
- **Conversation**: If no args, summarize current discussion as issue description
- **Directory**: Current working directory/package (e.g. `packages/ai/` suggests AI-related team)
- **Git branch**: Branch name often encodes feature/bug context

## Step 2: SEARCH

Search existing issues **before** anything else — what's already filed informs every downstream decision including team selection.

1. Call `list_issues` with keywords extracted from the context (args, conversation summary, branch name)
2. Search broadly across teams — no team filter yet, since search results may reveal the correct team
3. Collect results into three buckets:

| Bucket | Criteria | Used for |
|--------|----------|----------|
| **Duplicates** | Same intent and scope as new issue | Stop and warn user |
| **Related** | Same area, overlapping context | Relationship inference in Step 4 |
| **Informative** | Same team/area but different scope | Team/priority/status inference in Step 4 |

**If a strong duplicate is found** (same intent and scope): STOP. Do not proceed to Step 4. Report the existing issue:

```
Possible duplicate found — did not create.
Existing: TEAM-99 "Add retry logic to extraction agent"
Status: In Progress  |  Assignee: @charles
URL: https://linear.app/...

Reply if you still want to create a new issue.
```

## Step 3: TEAMS

```
Call list_teams → get all workspace teams
```

Use search results from Step 2 to guide matching — if related issues belong to a specific team, that's strong evidence for the correct team.

## Step 4: INFER

Use context from Step 1, search results from Step 2, and team list from Step 3 to determine all fields.

### Team
- Primary signal: which team do related/informative issues belong to?
- Secondary signal: directory/package name fuzzy-matched against team names from Step 3
- Fallback: broadest team

### Priority

| Signal | Priority |
|--------|----------|
| "ASAP", "urgent", "blocking", "broken", "critical", "P0", "production down" | 1 (Urgent) |
| "soon", "important", "next few days", "high priority", "P1" | 2 (High) |
| No urgency signal / default | 3 (Normal) |
| "low priority", "nice to have", "when we get to it", "P3", "minor" | 4 (Low) |

Also consider: what priority are related issues set to? Match the neighborhood.

### Status

| Signal | Status |
|--------|--------|
| "needs discussion", "RFC", "should we", "not sure if", "explore", "maybe" | Backlog |
| Default / clear actionable task | Todo |
| "I'm working on", "currently", "in progress", "started" | In Progress |

### Title
Extract or generate a concise title in imperative form, under 80 characters.

### Description
Format as markdown. Include:
- What the issue is about
- Context: branch name, relevant file/package, conversation summary
- Any acceptance criteria apparent from context

### Labels

Infer labels from context and search results:
- **From description**: "bug"/"broken"/"error" → bug label, "feature"/"add"/"new" → feature label, "refactor"/"tech debt"/"cleanup" → tech-debt label
- **From related issues**: If related issues share a common label, apply it to the new issue too
- Call `list_issue_labels` with the inferred team to verify labels exist before applying. Only use labels that actually exist in the workspace.

### Project

- If related issues from Step 3 belong to a project, add the new issue to the same project
- If the conversation or args explicitly mention a project name, use that
- Otherwise, leave unset

### Links

Add traceability links back to the development context:
- If on a branch with an open PR, link to the PR URL
- If the conversation references a specific file or commit, link to it on GitHub
- Use `links: [{url, title}]` format

### Relationships

Analyze related issues from Step 3:

**Sub-issue** (`parentId`) — New issue is a specific task within a broader existing issue.
Example: "fix retry in extraction agent" is a sub-issue of "improve chapter generation reliability"

**Parent** — New issue encompasses existing smaller issues. After creating, call `update_issue` on each child to set their `parentId`.

**Blocking / Blocked-by** (`blocks` / `blockedBy`) — Use when:
- Explicit dependency language: "this blocks X", "can't do Y until this is done"
- Technical dependency: "migrate DB schema" blocks "add new column"

**Related** (`relatedTo`) — Same area, shared context, but neither blocks the other.

## Step 5: CREATE

Call `create_issue` with:

| Field | Value |
|-------|-------|
| `title` | Inferred title (imperative, <80 chars) |
| `description` | Markdown description with context |
| `team` | Matched team name |
| `priority` | Numeric: 1=Urgent, 2=High, 3=Normal, 4=Low |
| `state` | Status name: "Backlog", "Todo", "In Progress" |
| `labels` | Array of label names inferred from context |
| `project` | Project name (if related issues share a project) |
| `links` | Array of `{url, title}` linking to PR/branch/commit |
| `parentId` | Parent issue identifier (if sub-issue) |
| `blocks` | Array of issue identifiers this blocks |
| `blockedBy` | Array of issue identifiers blocking this |
| `relatedTo` | Array of related issue identifiers |

If this issue is a **parent** of existing issues, after creation call `update_issue` on each child to set `parentId`.

## Step 6: REPORT

```
Created: TEAM-123 "Add retry logic to chapter generation"
Team: Product  |  Priority: Normal  |  Status: Todo
Labels: bug, ai-pipeline  |  Project: Chapter Gen V2
Parent: TEAM-100 "Improve chapter generation reliability"
Related: TEAM-98 "Audit error handling in AI pipeline"
Links: PR #42 "feat: add retry logic"
URL: https://linear.app/...
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Inferring fields before searching existing issues | Always search first — existing issues inform team, priority, and relationships |
| Creating without checking duplicates | Step 3 catches duplicates before any inference work |
| Setting priority too high by default | Default is Normal (3), only escalate with clear urgency signals |
| Guessing team instead of looking up | Always call `list_teams` and match against actual teams |
| Searching only within one team | Search broadly first — related issues may be in a different team |
| Forgetting to set relationships | Check related bucket from Step 3 for parent/blocking/related |
| Using IDs instead of names for state | `create_issue` accepts state names directly ("Backlog", "Todo") |
| Skipping description context | Always include branch, directory, and conversation context |
| Creating parent without updating children | After creating a parent issue, call `update_issue` on children |
| Applying labels that don't exist | Call `list_issue_labels` to verify labels exist before using them |
| Ignoring project from related issues | If related issues share a project, add the new issue to it |
| Not linking back to PR/branch | Always check for an open PR with `gh pr view` and link it |
