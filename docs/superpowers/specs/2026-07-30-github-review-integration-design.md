# GitHub Review Integration — Design

**Date:** 2026-07-30
**Status:** Approved

## Goal

Fork stage-cli and add two-way GitHub review integration: display existing GitHub PR
review comments in the Stage diff viewer, reply to and resolve them, write new pending
review comments, and submit a full review (approve / request changes / comment) — the
same workflow GitHub's own PR UI offers.

## Decisions (settled with the user)

- **Scope:** full two-way — read existing GitHub threads, reply, write new comments,
  submit reviews.
- **Draft model:** pending batch. New comments on a PR run accumulate locally as
  "pending", then one Submit Review action publishes them all with a verdict and
  summary body.
- **Local notes on PR runs:** none — on PR runs every new comment is a pending review
  comment. Non-PR runs keep today's local-only comment behavior unchanged.
- **Sync model:** live fetch. GitHub threads are fetched at request time via `gh`
  (matching the PR-header pattern); nothing from GitHub is mirrored into SQLite.
- **Pending store:** local until submit. Pending comments live in Stage's SQLite;
  Submit makes one atomic `POST /repos/:o/:r/pulls/:n/reviews` call.
- **Code management:** GitHub fork under the user's account with the original repo as
  an `upstream` remote; feature work on a branch (e.g. `feat/github-reviews`).

## Data model

`comment_thread` is keyed by `scopeKey`, not run id, and a scope key deliberately
survives re-imports — so two runs of the same diff (one with `--pr`, one without)
share threads. The PR association must therefore live on the thread itself, not be
inferred from the run.

One Drizzle migration:

- `comment_thread`: add nullable `prNumber`. `null` = local note (today's behavior);
  set = a pending review comment destined for that PR.

That's the whole schema change. No `githubThreadId`, no `pendingReview` flag, no
`comment.githubCommentId` — GitHub-published threads are never mirrored locally (see
"Submit review" below), so local rows only ever represent notes or pending comments.

**Visibility rule:** a run shows local-note threads (`prNumber` null) matching its
scopeKey, plus — only when the run has a matching `chapter_run.prNumber` — pending
threads with that `prNumber`. A pending comment created in a PR run never appears as
a local note in a non-PR run of the same diff, and vice versa.

**Creation rule:** new threads on a PR run get the run's `prNumber`; on non-PR runs
they get `null`.

## Reading GitHub threads (live fetch)

- New module `packages/cli/src/github/review-comments.ts` using the existing `gh()`
  wrapper: `gh api repos/:o/:r/pulls/:n/comments` (plus review summaries). Thread
  resolution state requires the GraphQL `reviewThreads` API via `gh api graphql` —
  REST does not expose it.
- **Separate endpoint**, not merged into the local route:
  `GET /api/runs/:runId/github-threads`. The existing
  `GET /api/runs/:runId/comment-threads` stays a cheap SQLite read that the UI
  refetches after every comment edit; the GitHub endpoint is its own React Query
  query with a long `staleTime` (matching the PR-header pattern), refetched only on
  demand (submit, reply, resolve, manual refresh). The web client merges the two
  sources for display.
- **Wire types:** GitHub threads get their own schemas in `packages/types`
  (`GitHubThreadSchema` / `GitHubCommentSchema`) rather than reusing
  `CommentSchema` — GitHub comments carry `author: { login, name, avatarUrl }`,
  `githubCommentId`, resolution state, and `viewerCanEdit`/`viewerDidAuthor`, none of
  which local comments have. Local `CommentSchema` gains only a derived
  `pending: boolean` (from the thread's `prNumber`).
- **Line mapping:** GitHub's `side` + `line`/`start_line` translates to Stage's
  `DIFF_SIDE.ADDITIONS/DELETIONS` + `startLine`/`endLine` (both are line numbers in
  the new/old file) — but GitHub ranges carry a per-end side (`side` for the end
  line, `start_side` for the start) and can span LEFT and RIGHT; Stage threads have
  one side. Rules:
  - Same-side range, comment commit matches the run's `headSha`: anchor inline.
  - Mixed-side range, or the PR head moved since import: treat as unanchorable and
    list in an "outdated / not viewable inline — re-import to update" section.

## Writing back

- **Compose:** existing composers unchanged; pending threads render with a "Pending"
  badge and stay fully editable/deletable locally.
- **Reply to a GitHub thread:** posts immediately via
  `gh api repos/:o/:r/pulls/:n/comments/:id/replies` through `ghWrite()` — currently
  module-private in `github/mutations.ts`, so export it as part of this work.
  (GitHub's atomic review call cannot batch replies to existing threads; immediate
  replies match GitHub UI's default behavior.)
- **Resolve/unresolve a GitHub thread:** GraphQL `resolveReviewThread` /
  `unresolveReviewThread` mutations.
- **Submit review:** new route `POST /api/runs/:runId/review` with
  `{ event: APPROVE | REQUEST_CHANGES | COMMENT, body }`. Gathers all threads with
  the run's `prNumber` and matching scopeKey, translates them to GitHub's
  `comments[]` format, and makes one `POST /repos/:o/:r/pulls/:n/reviews` call.
  - **On success, the local pending threads are deleted.** GitHub becomes the source
    of truth and the live `github-threads` fetch shows them from then on. This
    avoids both the dedup problem (local copy + live copy of the same thread) and
    the ID-stamping problem (the reviews endpoint doesn't return a per-input comment
    ID mapping — matching IDs back by path+line would be fragile busywork).
  - On failure nothing is deleted — comments stay pending and the error surfaces as
    a toast.
- All writes pass the existing `enforceSameOrigin` guard.

## UI

- **Review toolbar** in the PR header area: pending-comment count plus a "Finish your
  review" button opening a popover with a summary markdown box, verdict radio group,
  and Submit — mirroring GitHub's.
- Thread components: author avatars/names on GitHub comments (viewer type already has
  `avatarUrl`), a "Pending" badge, and edit/delete disabled on other people's GitHub
  comments.
- Two React Query queries: the existing local threads query (invalidated on local
  CRUD, stays instant) and the github-threads query (long staleTime, invalidated on
  submit/reply/resolve or manual refresh). The client merges them for display.

## Error handling

- `gh` missing or unauthenticated: reads degrade gracefully (GitHub threads absent, a
  banner explains why); writes return a clear error.
- Failed submit leaves all pending comments intact locally.

## Testing (per TESTING.md)

Vitest coverage for: line-mapping translation (GitHub ↔ Stage coordinates, including
mixed-side and stale-head unanchorable cases), the thread visibility rule
(prNumber × run type), submit-review payload construction, and the
delete-on-successful-submit lifecycle. `gh` becomes the codebase's first
external-service boundary; mock at the `gh()` / `ghWrite()` seam.

## Estimated shape

One migration (a single nullable column), ~2 new modules under
`packages/cli/src/github/`, one new github-threads route plus one new review route
(local comment-threads route only gains the visibility filter), and moderate web-UI
work. Single implementation plan.
