---
name: fixing-ci
description: Use when CI is failing on a branch and you need to diagnose failures from GitHub, fix them locally with iterative verification, and re-push clean commits.
metadata:
  internal: true
---

# Fixing CI

## Overview

Diagnose failing CI from GitHub logs, fix each issue with an atomic commit, and iterate locally until the full suite is green — then push once.

**Principle:** One fix, one commit. Never push until all checks pass locally.

## Workflow

```
1. DIAGNOSE      → Pull failure logs from GitHub, list all failures
2. For each failure:
   a. REPRODUCE  → Run the failing check locally to confirm you see it
   b. FIX        → Fix root cause (not downstream symptoms)
   c. VERIFY FIX → Re-run the check to confirm it passes
   d. COMMIT     → Atomic commit for this fix
3. VERIFY ALL    → Run the full suite locally
   ↳ If anything fails → go back to step 2
   ↳ All green → proceed
4. PUSH          → Push all commits
```

## Step 1: Diagnose

```bash
# See recent CI runs on current branch
gh run list --branch $(git branch --show-current) --limit 5

# View failing run (find run-id from above)
gh run view <run-id>

# Stream logs from only the failed steps
gh run view <run-id> --log-failed
```

Read top-to-bottom and list all distinct failures before fixing any of them. Find the **first** error in each job — not symptoms that cascade from it.

## Step 2: Fix Loop (repeat per failure)

### a. Reproduce

Check the project's AGENTS.md for exact commands. Common mappings:

| CI Job     | Typical Local Command     |
|------------|---------------------------|
| Lint       | `pnpm lint`               |
| Typecheck  | `pnpm typecheck`          |
| Tests      | `pnpm test`               |
| Build      | `pnpm build`              |

Run the failing check and confirm you see the same error locally before touching code.

### b. Fix

- Fix the **root cause** — lint errors often cascade from a single type error upstream
- Don't fix just to silence the error; understand why it's wrong
- If the fix is unclear, read the relevant library docs or AGENTS.md before guessing

### c. Verify the Fix

Re-run the specific check to confirm it passes before committing.

### d. Commit

```bash
git add -p                          # Review every hunk before staging
git commit -m "fix: <what broke>"   # Specific message, not "fix CI"
```

Use `git add -p` to catch accidental debug code or unrelated changes. Then loop back to the next failure.

## Step 3: Verify All Checks (gate before push)

After all individual fixes are committed, run the full suite:

```bash
# Run all checks (adapt to project — check AGENTS.md)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**If anything fails here, go back to step 2.** A fix in one area can break another. Do not push until this full pass is clean.

## Step 4: Push

Only push once the full suite is green locally:

```bash
git push
```

**STOP here.** Do not poll GitHub to check if CI passed remotely. Local verification is sufficient — if all checks pass locally, the push is done. Only revisit if the user explicitly reports CI is still failing, then start from Step 1 with the new run ID.

## Common Mistakes

- **Polling GitHub after pushing** — do NOT run `gh run list`, `gh run watch`, or any GitHub polling after pushing. Local green = done.
- **Pushing before the full suite passes** — the verify-all step is a hard gate, not optional
- **One giant commit** — commit after each fix; atomic history is easier to bisect
- **Pushing without reproducing locally** — if you can't reproduce it, you can't verify the fix
- **Fixing symptoms not root cause** — a cascade of 10 lint errors is often one bad import
- **Vague commit messages** — "fix CI" is useless; "fix: remove unused import breaking typecheck" is not
- **Staging with `git add .`** — use `git add -p` to review and avoid committing debug code
