---
name: iterate-pr
description: Use when a PR is open and the user wants to autonomously monitor and fix PR review comments, CI failures, and rebase conflicts on a recurring loop, or when asked to babysit/iterate on a PR
---

# Iterate PR

Recurring loop that checks a PR each iteration and fixes what's broken. Combines `/fixing-pr-comments`, `/fixing-ci`, and `/rebase-origin-main`.

## WHEN INVOKED — Do These Two Steps Immediately

**STEP 1: Run the iteration checklist once right now** (before setting up the loop).

Execute all condition checks, run the appropriate sub-skills, and report results. Do not skip this — the first pass must happen immediately in the current session.

**STEP 2: After reporting results, always kick off the loop** using `/loop` at the requested interval (default 10m):

```
/loop <INTERVAL> For PR #<NUM> (<OWNER>/<REPO>): run the iterate-pr iteration sequence — check PR state, check for merge conflicts, check for unresolved comments, check for failing CI. Fix what's broken. Cancel the loop when the PR is closed or merged, OR when ALL of the following are simultaneously true: no merge conflicts with origin/main, zero unresolved review threads, no failing CI checks, no pending CI checks, and no commit was pushed this iteration.
```

Replace `<INTERVAL>` with the interval passed to `/iterate-pr` (default `10m`), and `<NUM>`, `<OWNER>`, `<REPO>` with the actual values resolved in Step 1. Do not leave placeholders.

**The loop is mandatory. Never ask the user whether to set it up — always set it up.**

Both steps are mandatory. The loop is not a substitute for Step 1 — it is in addition to it.

---

## Iteration Sequence

Each iteration (including the first one in Step 1 above) follows this sequence:

```
1. VERIFY   → gh pr view; stop loop if closed/merged
2. REBASE   → If merge conflicts with origin/main → /rebase-origin-main
3. COMMENTS → If unresolved threads → /fixing-pr-comments
4. CI       → If CI failing → /fixing-ci
5. REPORT   → Summarize what was checked and what was done (or skipped).
               Cancel the loop when ANY of the following is true:
               - PR is closed or merged
               - ALL of the following are simultaneously true:
                 - No merge conflicts with origin/main
                 - Zero unresolved review threads
                 - No failing CI checks
                 - No pending CI checks
                 - No commit was pushed this iteration
```

Only invoke sub-skills when their condition is met. Skip clean steps.

**Fully autonomous.** No user approval needed — triage, fix, commit, push, reply, resolve.

**Do not ask the user whether to continue or cancel the loop.** Apply the cancellation rule mechanically.

**Exception:** Ambiguous merge conflicts pause for manual resolution.

## Condition Checks

```bash
OWNER=$(gh repo view --json owner -q '.owner.login')
REPO=$(gh repo view --json name -q '.name')
NUM=$(gh pr view --json number -q '.number')

# 1: PR open?
gh pr view --json state -q '.state'
# CLOSED or MERGED → stop loop immediately

# 2: Merge conflicts with main?
git fetch origin main
git merge-tree --write-tree --no-messages HEAD origin/main > /dev/null 2>&1
# Non-zero exit code → conflicts exist → run /rebase-origin-main

# 3: Unresolved comments?
# gh -f/-F flag parsing mangles ! (non-null type annotations); use --input - to pass JSON directly
gh api graphql --input - <<EOF | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length' || echo 0
{"query":"query(\$owner:String!,\$repo:String!,\$pr:Int!){repository(owner:\$owner,name:\$repo){pullRequest(number:\$pr){reviewThreads(first:100){nodes{isResolved}}}}}","variables":{"owner":"$OWNER","repo":"$REPO","pr":$NUM}}
EOF
# Non-zero count → run /fixing-pr-comments

# 4: CI failing?
gh pr checks $NUM --json name,bucket -q '[.[] | select(.bucket == "fail")]'
# Non-empty → run /fixing-ci

# 5: CI pending?
gh pr checks $NUM --json name,bucket -q '[.[] | select(.bucket == "pending")]'
# Non-empty → keep loop alive (do not cancel)
```

## Invocation

- `/iterate-pr` — 10m default
- `/iterate-pr 5m` — every 5 minutes
- `/iterate-pr 2m` — every 2 minutes
