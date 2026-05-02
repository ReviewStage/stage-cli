---
name: rebase-origin-main
description: Use when rebasing the current branch onto origin/main, including resolving merge conflicts along the way
---

# Rebase with origin/main

## Overview

Fetches the latest origin/main, rebases the current branch onto it, and resolves every conflict that arises — one commit at a time — until the rebase completes cleanly.

## Warning: Rebase Flips ours/theirs

During a rebase, git's labels are **inverted** from what you expect:

| Label | Means |
|-------|-------|
| `HEAD` / `ours` (top of conflict) | origin/main — the base being rebased onto |
| `theirs` (bottom of conflict) | Your commit being replayed |

Always resolve conflicts to **preserve the intent of your commit** while incorporating origin/main's context.

## Workflow

### 1. Fetch & Start

```bash
git fetch origin
git rebase origin/main
```

If the output says `Successfully rebased` — done. No conflicts.

### 2. Detect Conflicts

```bash
git status
```

Look for lines with `both modified`, `added by us`, `deleted by them`, etc.

### 3. Resolve Each Conflicted File

For each conflicted file:

1. **Read the file** — find all conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
2. **Understand both sides:**
   - Above `=======` (HEAD) = origin/main's version
   - Below `=======` = your commit's change
3. **Resolve** by editing the file to the correct merged result — no conflict markers left
4. **Verify** no conflict markers remain: `grep -En "<<<<<<<|=======|>>>>>>>" <file>`
5. **Stage** the resolved file: `git add <file>`

**If a conflict is ambiguous** — where preserving both sides isn't clear — **stop and ask the user** before resolving.

### 4. Continue

After all conflicts in the current commit are staged:

```bash
git rebase --continue
```

Git will either move to the next commit (go back to step 2) or report success.

### 5. Handle Edge Cases

| Situation | Command |
|-----------|---------|
| A commit becomes empty after resolution | `git rebase --skip` |
| You need to abort entirely | `git rebase --abort` |
| Binary file conflict | Show the user and ask which version to keep |

### 6. Verify

After a clean rebase, confirm the branch looks correct:

```bash
git log --oneline origin/main..HEAD
```

### 7. Fix CI

After a successful rebase, run the full CI suite locally to catch any breakage introduced by the rebase:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

If anything fails, follow the **fixing-ci** skill workflow starting from **Step 2 (Fix Loop)** through **Step 3 (Verify All)**: diagnose each failure, fix the root cause, verify, and commit atomically. Do not proceed to push until all checks pass locally — the push is handled by Step 8 below with `--force-with-lease`.

### 8. Push

Force-push with lease (safe force-push — aborts if someone else pushed since your last fetch):

```bash
git push --force-with-lease
```

## Conflict Resolution Principles

- **Prefer explicit over clever** — when in doubt, keep both changes and adjust for correctness
- **Deletions on main win** if you also deleted the same thing (skip your no-op)
- **Your additions win** unless they conflict with a semantic change in main (e.g., a rename)
- **Never silently discard** either side — if a resolution loses meaningful code, flag it to the user

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Leaving conflict markers in file | Grep for `<<<<<<<` before staging |
| Staging before fully reading the file | Read the full file first |
| Assuming `ours` = your branch | It's inverted in rebase — `ours` is origin/main |
| Continuing without reviewing log | Always run `git log --oneline origin/main..HEAD` after |
