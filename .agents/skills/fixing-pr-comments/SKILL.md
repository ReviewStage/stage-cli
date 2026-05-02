---
name: fixing-pr-comments
description: Use when a pull request has unresolved review comments that need to be addressed, or when asked to fix PR feedback
---

# Fixing PR Comments

Fetch all unresolved PR threads, triage, fix blockers, resolve the rest.

## Workflow

```
1. DETECT  → PR number/repo from current branch
2. FETCH   → Unresolved review threads (GraphQL)
3. TRIAGE  → Classify each: FIX / RESOLVE / CLARIFY
4. PRESENT → Show triage table, proceed immediately
5. FIX     → Implement → verify → commit → reply → resolve (one commit per fix)
6. PUSH    → Push all commits
7. RESPOND → Reply to RESOLVE (+ resolve) and CLARIFY threads
```

## Detect & Fetch

```bash
gh pr view --json number,url

# GraphQL required — REST lacks isResolved
# Use --input - to avoid gh's -f flag mangling ! in non-null type annotations
gh api graphql --input - <<'GRAPHQL'
{
  "query": "query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{id isResolved path line comments(first:10){nodes{id databaseId body author{login}}}}}}}}",
  "variables": {"owner": "OWNER", "repo": "REPO", "pr": NUM}
}
GRAPHQL
```

Filter to `isResolved: false` only.

## Triage

**Default to RESOLVE.** Only FIX what genuinely blocks merge. Resolve everything else with reasoning. Don't gold-plate — ship it.

| Category | Criteria | Action |
|----------|----------|--------|
| **FIX** | Bugs, security issues, correctness problems — blocks merge | Implement + commit + resolve |
| **RESOLVE** | Nits, style, "consider X", minor suggestions, pedantic bot feedback, already addressed | Reply with reasoning + resolve |
| **CLARIFY** | Ambiguous, needs context | Ask in thread, leave open |

**Quality flag during triage:** If a comment requests something that violates a principle in the **Implementation Quality** section of AGENTS.md, categorize it as **RESOLVE** and cite the specific principle it conflicts with.

Present triage table, then proceed immediately:

```
| # | File:Line | Summary | Category | Reasoning |
```

## Fix Loop

For each FIX:
1. Implement the change
2. **Apply forward** — find the same pattern elsewhere in the codebase and fix those too
3. **Quality gate** — evaluate the fix against every principle in the **Implementation Quality** section of AGENTS.md. If any principle is violated, revise before committing.
4. Verify it compiles/passes
5. Commit (one per fix)
6. Reply + resolve:

```bash
# Reply (REST — uses databaseId)
gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
  -f body="Fixed in <commit_sha>."

# Resolve (GraphQL — REST can't)
gh api graphql --input - <<'GRAPHQL'
{"query": "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}","variables": {"id": "THREAD_NODE_ID"}}
GRAPHQL
```

Then `git push`.

## Respond to Remaining

- **RESOLVE**: Reply with reasoning, then resolve.
- **CLARIFY**: Ask question, leave open.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Fixing before triaging | Triage everything first |
| Fixing nits | RESOLVE with reasoning |
| Accepting quality-violating feedback | RESOLVE comments that conflict with Implementation Quality principles in AGENTS.md |
| Introducing quality violations in fixes | Run quality gate before committing |
| Performative replies ("Great catch!") | State what changed or why not |
| One big commit | One commit per fix |
| Skipping verification | Verify before committing |
| Implementing unclear feedback | CLARIFY, ask first |
| Using REST for resolve | GraphQL required |
| Mixing up ID types | `databaseId` for REST, `id` (node ID) for GraphQL |
| RESOLVE without explanation | Always explain |
| Fixing only the flagged line | Search for same pattern, fix all |
