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

Extend existing tables (one Drizzle migration):

- `comment_thread`: add nullable `githubThreadId` (GitHub review-thread / root-comment
  ID for threads published to GitHub) and `pendingReview` boolean (true for
  unpublished PR comments).
- `comment`: add nullable `githubCommentId`.

On a PR run (`chapter_run.prNumber` set), new threads are created with
`pendingReview = true`. Non-PR runs are unchanged.

## Reading GitHub threads (live fetch)

- New module `packages/cli/src/github/review-comments.ts` using the existing `gh()`
  wrapper: `gh api repos/:o/:r/pulls/:n/comments` (plus review summaries). Thread
  resolution state requires the GraphQL `reviewThreads` API via `gh api graphql` —
  REST does not expose it.
- `GET /api/runs/:runId/comment-threads` merges three sources into one response, all
  mapped to the existing wire `CommentThreadSchema` shape with a new `source` tag:
  - `source: "github"` — live-fetched GitHub threads
  - `source: "pending"` — local unpublished threads on a PR run
  - `source: "local"` — local notes on non-PR runs
- **Line mapping:** GitHub's `side: RIGHT/LEFT` + `line`/`start_line` maps directly to
  Stage's `DIFF_SIDE.ADDITIONS/DELETIONS` + `startLine`/`endLine` (both are line
  numbers in the new/old file). No diff-position math needed while the run's `headSha`
  matches the comment's commit. If the PR head moved since import, mismatched threads
  are listed in an "outdated — re-import to view inline" section instead of being
  anchored by guesswork.

## Writing back

- **Compose:** existing composers unchanged; pending threads render with a "Pending"
  badge and stay fully editable/deletable locally.
- **Reply to a GitHub thread:** posts immediately via
  `gh api repos/:o/:r/pulls/:n/comments/:id/replies` through the existing `ghWrite()`
  wrapper. (GitHub's atomic review call cannot batch replies to existing threads;
  immediate replies match GitHub UI's default behavior.)
- **Resolve/unresolve a GitHub thread:** GraphQL `resolveReviewThread` /
  `unresolveReviewThread` mutations.
- **Submit review:** new route `POST /api/runs/:runId/review` with
  `{ event: APPROVE | REQUEST_CHANGES | COMMENT, body }`. Gathers all `pendingReview`
  threads, translates them to GitHub's `comments[]` format, and makes one
  `POST /repos/:o/:r/pulls/:n/reviews` call. On success, the returned GitHub IDs are
  stamped onto local threads and `pendingReview` flips off. On failure nothing is
  lost — comments stay pending and the error surfaces as a toast.
- All writes pass the existing `enforceSameOrigin` guard.

## UI

- **Review toolbar** in the PR header area: pending-comment count plus a "Finish your
  review" button opening a popover with a summary markdown box, verdict radio group,
  and Submit — mirroring GitHub's.
- Thread components: author avatars/names on GitHub comments (viewer type already has
  `avatarUrl`), a "Pending" badge, and edit/delete disabled on other people's GitHub
  comments.
- React Query invalidation after submit/reply/resolve refetches the merged list.

## Error handling

- `gh` missing or unauthenticated: reads degrade gracefully (GitHub threads absent, a
  banner explains why); writes return a clear error.
- Failed submit leaves all pending comments intact locally.

## Testing (per TESTING.md)

Vitest coverage for: line-mapping translation (GitHub ↔ Stage coordinates), the
three-source merge logic in the threads route, submit-review payload construction, and
the pending-flag lifecycle. `gh` calls are mocked at the `gh()` / `ghWrite()` seam.

## Estimated shape

One migration, ~2 new modules under `packages/cli/src/github/`, edits to the
comment-threads route plus one new review route, and moderate web-UI work. Single
implementation plan.
