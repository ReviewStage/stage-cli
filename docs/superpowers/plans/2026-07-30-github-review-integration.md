# GitHub Review Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-way GitHub PR review integration: display existing GitHub review threads in the Stage diff viewer, reply/resolve them, accumulate pending comments locally, and submit a full review (approve / request changes / comment) in one atomic call.

**Architecture:** Pending comments reuse the existing local `comment_thread`/`comment` tables with one new nullable `prNumber` column (null = local note, set = pending review comment). GitHub threads are never mirrored — a separate live-fetch endpoint (`GET /api/runs/:runId/github-threads`) queries GitHub via the `gh` CLI (GraphQL `reviewThreads`, which carries comments + resolution + outdated state in one call). Submit posts one `POST /repos/:o/:r/pulls/:n/reviews` and deletes local pending threads on success, so GitHub becomes the source of truth. Spec: `docs/superpowers/specs/2026-07-30-github-review-integration-design.md`.

**Tech Stack:** Node 20 ESM, Commander, plain `node:http` routes, Drizzle + better-sqlite3, Zod, React 19 + TanStack Query, Vitest. GitHub access exclusively via the `gh` CLI (no octokit, no tokens).

**Conventions to honor (from CLAUDE.md / TESTING.md):**
- Tabs, double quotes, semicolons, trailing commas, 100-col. `pnpm lint` must pass.
- No `as any`, no non-null `!`, no type-assertion narrowing. `noUncheckedIndexedAccess` is on.
- Validate at boundaries (HTTP bodies, `gh` output) with Zod; trust internal code.
- Route tests hit a real server + temp SQLite. `gh` is faked with a stub binary on `PATH` (see `packages/cli/src/__tests__/pull-request.routes.test.ts` for the pattern) — this is the one allowed external-service mock.
- Max 200 lines per test file; split by behavior group.
- Commit after every green task.

**Spec deviation (intentional, one item):** the spec says local `CommentSchema` gains a derived `pending` boolean; pending-ness is a property of the *thread* (its `prNumber`), so this plan puts `pending: boolean` on `CommentThreadSchema` instead. Everything else follows the spec.

---

## Task 0: Fork + branch setup

**Files:** none (git/remote work only)

- [ ] **Step 1: Fork on GitHub and set remotes**

```bash
cd /Users/djdjo/Documents/mine/stage-cli
gh repo fork --remote --remote-name origin-fork   # creates the fork, adds it as a remote
git remote rename origin upstream
git remote rename origin-fork origin
git remote -v   # expect: origin = your fork, upstream = original repo
```

If `origin` already pointed at a repo you own, skip the fork and just branch.

- [ ] **Step 2: Create the feature branch and move the spec/plan commits onto it**

```bash
git checkout -b feat/github-reviews
git push -u origin feat/github-reviews
```

- [ ] **Step 3: Verify the toolchain**

```bash
pnpm install && pnpm typecheck && pnpm test
```
Expected: all pass before any changes.

---

## Task 1: Schema migration — `comment_thread.prNumber`

**Files:**
- Modify: `packages/cli/src/db/schema/comment-thread.ts`
- Generated: `packages/cli/drizzle/00xx_*.sql` (via `pnpm db:generate`)
- Test: `packages/cli/src/__tests__/comments.routes.test.ts` (extended in Task 3; migration itself is exercised there)

- [ ] **Step 1: Add the column to the Drizzle schema**

In `packages/cli/src/db/schema/comment-thread.ts`, add after `endLine`:

```ts
		/**
		 * Null = a local note. Set = a pending review comment destined for this PR;
		 * it is deleted once the review is submitted (GitHub becomes the source of
		 * truth). Lives on the thread (not the run) because scopeKey survives
		 * re-imports and is shared between PR and non-PR runs of the same diff.
		 */
		prNumber: integer(),
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```
Expected: a new file in `packages/cli/drizzle/` containing `ALTER TABLE \`comment_thread\` ADD \`pr_number\` integer;`. Inspect it.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add packages/cli/src/db/schema/comment-thread.ts packages/cli/drizzle
git commit -m "feat: add comment_thread.prNumber for pending review comments"
```

---

## Task 2: Wire types — pending flag + GitHub thread schemas + review body

**Files:**
- Modify: `packages/types/src/comments.ts`
- Create: `packages/types/src/github-threads.ts`
- Modify: `packages/types/src/index.ts` (add barrel export)

No dedicated tests (trivial schema declarations — TESTING.md "What NOT to Test"); they're exercised by route tests in Tasks 3/5/7.

- [ ] **Step 1: Add `pending` to `CommentThreadSchema`**

In `packages/types/src/comments.ts`, inside `CommentThreadSchema` after `endLine`:

```ts
	/** True when this thread is an unsubmitted review comment for the run's PR. */
	pending: z.boolean(),
```

- [ ] **Step 2: Create `packages/types/src/github-threads.ts`**

```ts
import { z } from "zod";
import { DIFF_SIDE } from "./chapters.ts";

export const REVIEW_EVENT = {
	APPROVE: "APPROVE",
	REQUEST_CHANGES: "REQUEST_CHANGES",
	COMMENT: "COMMENT",
} as const;
export type ReviewEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

// Author of a GitHub review comment. Distinct from the local viewer type — this
// is whoever wrote the comment, not the logged-in user.
export const GitHubCommentAuthorSchema = z.object({
	login: z.string(),
	name: z.string().nullable(),
	avatarUrl: z.string().nullable(),
});
export type GitHubCommentAuthor = z.infer<typeof GitHubCommentAuthorSchema>;

export const GitHubCommentSchema = z.object({
	/** REST database id — the id the replies endpoint addresses. */
	githubCommentId: z.string(),
	body: z.string(),
	author: GitHubCommentAuthorSchema,
	createdAt: z.string(),
	url: z.string(),
	viewerDidAuthor: z.boolean(),
});
export type GitHubComment = z.infer<typeof GitHubCommentSchema>;

// A GitHub review thread mapped into Stage's coordinate space. `anchor` is null
// when the thread can't be shown inline (mixed-side range, outdated, or the PR
// head moved past the imported run) — those render in the "outdated" list.
export const GitHubThreadSchema = z.object({
	/** GraphQL node id — what the resolve/unresolve mutations address. */
	githubThreadId: z.string(),
	filePath: z.string(),
	anchor: z
		.object({
			side: z.enum(DIFF_SIDE),
			startLine: z.number().int().positive(),
			endLine: z.number().int().positive(),
		})
		.nullable(),
	isResolved: z.boolean(),
	comments: z.array(GitHubCommentSchema),
});
export type GitHubThread = z.infer<typeof GitHubThreadSchema>;

// Response of GET /api/runs/:runId/github-threads. `available: false` means gh
// is missing/unauthenticated or the run has no PR — the UI shows a banner
// instead of threads.
export const GitHubThreadsResponseSchema = z.object({
	available: z.boolean(),
	threads: z.array(GitHubThreadSchema),
});
export type GitHubThreadsResponse = z.infer<typeof GitHubThreadsResponseSchema>;

// Body for POST /api/runs/:runId/review.
export const SubmitReviewBodySchema = z.object({
	event: z.enum(REVIEW_EVENT),
	body: z.string(),
});
export type SubmitReviewBody = z.infer<typeof SubmitReviewBodySchema>;

// Body for replying to an existing GitHub thread.
export const GitHubReplyBodySchema = z.object({
	body: z.string().min(1),
});
export type GitHubReplyBody = z.infer<typeof GitHubReplyBodySchema>;

// Body for toggling a GitHub thread's resolution.
export const GitHubResolveBodySchema = z.object({
	resolved: z.boolean(),
});
export type GitHubResolveBody = z.infer<typeof GitHubResolveBodySchema>;
```

- [ ] **Step 3: Export from the barrel**

In `packages/types/src/index.ts`, add (matching the existing re-export style):

```ts
export * from "./github-threads.ts";
```

- [ ] **Step 4: Typecheck — expect failures in `packages/cli/src/routes/comments.ts`**

```bash
pnpm typecheck
```
Expected: errors that `toThreadDto` doesn't produce `pending`. That's Task 3's job. Do NOT commit yet — Tasks 2+3 commit together so the tree stays green.

---

## Task 3: Local comment routes — creation + visibility rules

**Files:**
- Modify: `packages/cli/src/routes/comments.ts`
- Test: `packages/cli/src/__tests__/comments-pr.routes.test.ts` (new file — keeps `comments.routes.test.ts` under the 200-line cap)

Behavior: threads created on a PR run get that `prNumber` (and report `pending: true`); GET returns local notes (`prNumber` null) always, plus pending threads only when the run's `prNumber` matches.

- [ ] **Step 1: Write failing route tests**

Create `packages/cli/src/__tests__/comments-pr.routes.test.ts`. Copy the harness (beforeEach/afterEach, `send`, `startWithRoutes`, `seedRun`, `makeThreadBody`, `createThread`) from `comments.routes.test.ts` verbatim, then add a PR-run seeder and these tests:

```ts
/** Seed a run and stamp a prNumber on it (insertChaptersFile has no PR path in fixtures). */
function seedPrRun(prNumber: number): string {
	const runId = seedRun();
	const db = getDb({ dbPath });
	db.update(chapterRun).set({ prNumber }).where(eq(chapterRun.id, runId)).run();
	return runId;
}

describe("pending review comments (PR runs)", () => {
	it("stamps the run's prNumber on threads created in a PR run and reports pending", async () => {
		const runId = seedPrRun(7);
		const { port } = await startWithRoutes();
		const thread = await createThread(port, runId);
		expect(thread.pending).toBe(true);
		const db = getDb({ dbPath });
		const [row] = db.select().from(commentThread).all();
		expect(row?.prNumber).toBe(7);
	});

	it("creates plain local notes (pending false, prNumber null) on non-PR runs", async () => {
		const runId = seedRun();
		const { port } = await startWithRoutes();
		const thread = await createThread(port, runId);
		expect(thread.pending).toBe(false);
		const db = getDb({ dbPath });
		expect(db.select().from(commentThread).all()[0]?.prNumber).toBeNull();
	});

	it("hides pending threads from a non-PR run of the same diff, and notes stay visible to both", async () => {
		// Same fixture → same scopeKey for both runs.
		const prRunId = seedPrRun(7);
		const plainRunId = seedRun();
		const { port } = await startWithRoutes();
		await createThread(port, prRunId, { body: "pending comment" });
		await createThread(port, plainRunId, { body: "local note" });

		const plainList = await send(port, "GET", `/api/runs/${plainRunId}/comment-threads`);
		const plainBodies = (plainList.body as CommentThread[]).flatMap((t) =>
			t.comments.map((c) => c.body),
		);
		expect(plainBodies).toEqual(["local note"]);

		const prList = await send(port, "GET", `/api/runs/${prRunId}/comment-threads`);
		const prBodies = (prList.body as CommentThread[]).flatMap((t) => t.comments.map((c) => c.body));
		expect(prBodies).toEqual(expect.arrayContaining(["pending comment", "local note"]));
	});

	it("hides pending threads for PR 7 from a run targeting PR 8", async () => {
		const run7 = seedPrRun(7);
		const run8 = seedPrRun(8);
		const { port } = await startWithRoutes();
		await createThread(port, run7, { body: "for pr 7" });
		const list = await send(port, "GET", `/api/runs/${run8}/comment-threads`);
		expect((list.body as CommentThread[]).length).toBe(0);
	});
});
```

Needed imports beyond the copied harness: `chapterRun` from `../db/schema/index.js`, `eq` from `drizzle-orm`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run packages/cli/src/__tests__/comments-pr.routes.test.ts
```
Expected: FAIL — `pending` undefined, prNumber never stamped, visibility not filtered.

- [ ] **Step 3: Implement in `packages/cli/src/routes/comments.ts`**

1. Change `resolveRunScopeKey` to return the run's PR context too. Replace it with:

```ts
interface RunCommentScope {
	scopeKey: string;
	prNumber: number | null;
}

function resolveRunCommentScope(db: StageDb, runId: string | undefined): RunCommentScope | null {
	if (!runId) return null;
	const [run] = db
		.select({
			scopeKind: chapterRun.scopeKind,
			workingTreeRef: chapterRun.workingTreeRef,
			baseSha: chapterRun.baseSha,
			headSha: chapterRun.headSha,
			mergeBaseSha: chapterRun.mergeBaseSha,
			prNumber: chapterRun.prNumber,
		})
		.from(chapterRun)
		.where(eq(chapterRun.id, runId))
		.limit(1)
		.all();
	if (!run) return null;
	return { scopeKey: deriveScopeKey(run), prNumber: run.prNumber };
}
```

2. GET handler: use the visibility rule. Replace `listThreads(db, scopeKey)` call with `listThreads(db, scope)` and change the query:

```ts
function listThreads(db: StageDb, scope: RunCommentScope): CommentThreadDto[] {
	const visible =
		scope.prNumber === null
			? isNull(commentThread.prNumber)
			: or(isNull(commentThread.prNumber), eq(commentThread.prNumber, scope.prNumber));
	const threads = db
		.select()
		.from(commentThread)
		.where(and(eq(commentThread.scopeKey, scope.scopeKey), visible))
		.orderBy(asc(commentThread.createdAt))
		.all();
	// ...rest unchanged (comment fetch + grouping)
}
```

Imports: add `and`, `isNull`, `or` to the `drizzle-orm` import.

3. POST handler: stamp the run's prNumber into the insert `values({ scopeKey, prNumber: scope.prNumber, ... })`.

4. `toThreadDto`: add `pending: thread.prNumber !== null,` to the returned object.

5. Update both handlers' variable names (`scopeKey` → `scope`, use `scope.scopeKey`).

- [ ] **Step 4: Run all comment tests**

```bash
pnpm vitest run packages/cli/src/__tests__/comments-pr.routes.test.ts packages/cli/src/__tests__/comments.routes.test.ts
```
Expected: PASS (the old file's assertions don't mention `pending`, and the schemas are non-strict, so nothing breaks).

- [ ] **Step 5: Typecheck, lint, commit (Tasks 2+3 together)**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add packages/types packages/cli/src/routes/comments.ts packages/cli/src/__tests__/comments-pr.routes.test.ts
git commit -m "feat: pending review comments — thread prNumber, visibility rule, wire types"
```

---

## Task 4: `github/review-comments.ts` — fetch + map GitHub review threads

**Files:**
- Create: `packages/cli/src/github/review-comments.ts`
- Test: `packages/cli/src/__tests__/review-comments-mapping.test.ts` (pure mapping logic)

One GraphQL query gets threads, comments, resolution, and outdated state in a single call (REST can't return resolution). Mapping to Stage coordinates is a pure function — test it directly.

- [ ] **Step 1: Write failing mapping tests**

Create `packages/cli/src/__tests__/review-comments-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	type GhReviewThreadNode,
	mapReviewThread,
} from "../github/review-comments.js";

const HEAD = "2".repeat(40);

function makeNode(over: Partial<GhReviewThreadNode> = {}): GhReviewThreadNode {
	return {
		id: "RT_node1",
		isResolved: false,
		isOutdated: false,
		path: "src/foo.ts",
		line: 10,
		startLine: null,
		diffSide: "RIGHT",
		startDiffSide: null,
		comments: {
			nodes: [
				{
					fullDatabaseId: "12345",
					body: "Looks wrong",
					url: "https://github.com/o/r/pull/7#discussion_r12345",
					createdAt: "2026-07-01T00:00:00Z",
					viewerDidAuthor: false,
					author: { login: "octocat", avatarUrl: "https://a.example/x.png", name: "Octo Cat" },
				},
			],
		},
		...over,
	};
}

describe("mapReviewThread", () => {
	it("anchors a RIGHT single-line thread to additions when heads match", () => {
		const t = mapReviewThread(makeNode(), { runHeadSha: HEAD, prHeadSha: HEAD });
		expect(t.anchor).toEqual({ side: "additions", startLine: 10, endLine: 10 });
		expect(t.comments[0]?.author.login).toBe("octocat");
	});

	it("maps LEFT ranges to deletions with start/end lines", () => {
		const node = makeNode({ diffSide: "LEFT", startDiffSide: "LEFT", line: 12, startLine: 8 });
		const t = mapReviewThread(node, { runHeadSha: HEAD, prHeadSha: HEAD });
		expect(t.anchor).toEqual({ side: "deletions", startLine: 8, endLine: 12 });
	});

	it("does not anchor a mixed-side range", () => {
		const node = makeNode({ diffSide: "RIGHT", startDiffSide: "LEFT", startLine: 8 });
		expect(mapReviewThread(node, { runHeadSha: HEAD, prHeadSha: HEAD }).anchor).toBeNull();
	});

	it("does not anchor when GitHub marks the thread outdated or line is gone", () => {
		expect(
			mapReviewThread(makeNode({ isOutdated: true }), { runHeadSha: HEAD, prHeadSha: HEAD }).anchor,
		).toBeNull();
		expect(
			mapReviewThread(makeNode({ line: null }), { runHeadSha: HEAD, prHeadSha: HEAD }).anchor,
		).toBeNull();
	});

	it("does not anchor any thread when the PR head moved past the imported run", () => {
		const t = mapReviewThread(makeNode(), { runHeadSha: HEAD, prHeadSha: "f".repeat(40) });
		expect(t.anchor).toBeNull();
	});

	it("substitutes a ghost author when the account is deleted", () => {
		const node = makeNode();
		node.comments.nodes[0] = { ...node.comments.nodes[0]!, author: null };
		const t = mapReviewThread(node, { runHeadSha: HEAD, prHeadSha: HEAD });
		expect(t.comments[0]?.author.login).toBe("ghost");
	});
});
```

Note: the `node.comments.nodes[0]!` above violates the no-non-null rule — write it instead as:

```ts
		const first = node.comments.nodes[0];
		if (!first) throw new Error("fixture has no comments");
		node.comments.nodes[0] = { ...first, author: null };
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run packages/cli/src/__tests__/review-comments-mapping.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `packages/cli/src/github/review-comments.ts`**

```ts
import { DIFF_SIDE, type DiffSide } from "@stagereview/types/chapters";
import type { GitHubThread } from "@stagereview/types/github-threads";
import { z } from "zod";
import { gh } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

// GraphQL is the only API that exposes thread resolution; it also carries
// comments, outdated state, and per-end diff sides in one round trip.
const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
	repository(owner: $owner, name: $repo) {
		pullRequest(number: $number) {
			headRefOid
			reviewThreads(first: 50, after: $cursor) {
				pageInfo { hasNextPage endCursor }
				nodes {
					id
					isResolved
					isOutdated
					path
					line
					startLine
					diffSide
					startDiffSide
					comments(first: 100) {
						nodes {
							fullDatabaseId
							body
							url
							createdAt
							viewerDidAuthor
							author {
								login
								avatarUrl
								... on User { name }
							}
						}
					}
				}
			}
		}
	}
}`;

const GhCommentNodeSchema = z.object({
	fullDatabaseId: z.string(),
	body: z.string(),
	url: z.string(),
	createdAt: z.string(),
	viewerDidAuthor: z.boolean(),
	author: z
		.object({
			login: z.string(),
			avatarUrl: z.string().nullable(),
			name: z.string().nullable().optional(),
		})
		.nullable(),
});

const GhThreadNodeSchema = z.object({
	id: z.string(),
	isResolved: z.boolean(),
	isOutdated: z.boolean(),
	path: z.string(),
	line: z.number().int().nullable(),
	startLine: z.number().int().nullable(),
	diffSide: z.enum(["LEFT", "RIGHT"]),
	startDiffSide: z.enum(["LEFT", "RIGHT"]).nullable(),
	comments: z.object({ nodes: z.array(GhCommentNodeSchema) }),
});
export type GhReviewThreadNode = z.infer<typeof GhThreadNodeSchema>;

const GhResponseSchema = z.object({
	data: z.object({
		repository: z
			.object({
				pullRequest: z
					.object({
						headRefOid: z.string(),
						reviewThreads: z.object({
							pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
							nodes: z.array(GhThreadNodeSchema),
						}),
					})
					.nullable(),
			})
			.nullable(),
	}),
});

const SIDE_FROM_GH: Record<"LEFT" | "RIGHT", DiffSide> = {
	RIGHT: DIFF_SIDE.ADDITIONS,
	LEFT: DIFF_SIDE.DELETIONS,
};

export interface AnchorContext {
	runHeadSha: string;
	prHeadSha: string;
}

/**
 * Map one GraphQL review thread into Stage's wire shape. `anchor` is null when
 * the thread can't render inline: GitHub already marks it outdated, the range
 * spans both diff sides (Stage threads are single-side), the line was removed,
 * or the PR head moved past the head this run was imported at (GraphQL line
 * numbers are relative to the current head, so they'd anchor to wrong lines).
 */
export function mapReviewThread(node: GhReviewThreadNode, ctx: AnchorContext): GitHubThread {
	const mixedSides = node.startDiffSide !== null && node.startDiffSide !== node.diffSide;
	const anchorable =
		!node.isOutdated && !mixedSides && node.line !== null && ctx.prHeadSha === ctx.runHeadSha;
	return {
		githubThreadId: node.id,
		filePath: node.path,
		anchor:
			anchorable && node.line !== null
				? {
						side: SIDE_FROM_GH[node.diffSide],
						startLine: node.startLine ?? node.line,
						endLine: node.line,
					}
				: null,
		isResolved: node.isResolved,
		comments: node.comments.nodes.map((c) => ({
			githubCommentId: c.fullDatabaseId,
			body: c.body,
			url: c.url,
			createdAt: c.createdAt,
			viewerDidAuthor: c.viewerDidAuthor,
			// A deleted account comes back as a null author; GitHub's UI shows "ghost".
			author: c.author
				? { login: c.author.login, name: c.author.name ?? null, avatarUrl: c.author.avatarUrl }
				: { login: "ghost", name: null, avatarUrl: null },
		})),
	};
}

/**
 * Fetch all review threads for a PR, paginating the GraphQL connection.
 * Returns null when gh is missing/unauthenticated or the query fails —
 * matching the swallow-reads convention in pull-request.ts.
 */
export async function fetchReviewThreads(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
	runHeadSha: string,
): Promise<GitHubThread[] | null> {
	try {
		const threads: GitHubThread[] = [];
		let cursor: string | null = null;
		for (;;) {
			const args = [
				"api",
				"graphql",
				"-f",
				`query=${REVIEW_THREADS_QUERY}`,
				"-F",
				`owner=${repo.owner}`,
				"-F",
				`repo=${repo.repo}`,
				"-F",
				`number=${prNumber}`,
			];
			if (cursor !== null) args.push("-F", `cursor=${cursor}`);
			const stdout = await gh(args, repoRoot);
			const parsed = GhResponseSchema.safeParse(JSON.parse(stdout));
			if (!parsed.success) return null;
			const pr = parsed.data.data.repository?.pullRequest;
			if (!pr) return null;
			const ctx: AnchorContext = { runHeadSha, prHeadSha: pr.headRefOid };
			for (const node of pr.reviewThreads.nodes) threads.push(mapReviewThread(node, ctx));
			if (!pr.reviewThreads.pageInfo.hasNextPage) return threads;
			cursor = pr.reviewThreads.pageInfo.endCursor;
			if (cursor === null) return threads;
		}
	} catch {
		return null;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/cli/src/__tests__/review-comments-mapping.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add packages/cli/src/github/review-comments.ts packages/cli/src/__tests__/review-comments-mapping.test.ts
git commit -m "feat: fetch and map GitHub review threads via gh GraphQL"
```

---

## Task 5: `GET /api/runs/:runId/github-threads` route

**Files:**
- Create: `packages/cli/src/routes/github-threads.ts`
- Modify: `packages/cli/src/show.ts` (register routes)
- Test: `packages/cli/src/__tests__/github-threads.routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `packages/cli/src/__tests__/github-threads.routes.test.ts` following the fake-`gh`-binary harness in `pull-request.routes.test.ts`: create a `binDir` with an executable `gh` script that inspects its args and prints canned JSON, prepend it to `PATH` in `beforeEach`, restore in `afterEach`. Seed a run with `insertChaptersFile(db, makeFixture(), makeRepoContext({ originUrl: "git@github.com:owner/repo.git" }))` then stamp `prNumber` (as in Task 3's `seedPrRun`).

The fake `gh` for the success case (run head = fixture head SHA `"2".repeat(40)`):

```bash
#!/bin/sh
# Any graphql invocation returns one page of review threads.
cat <<'EOF'
{"data":{"repository":{"pullRequest":{"headRefOid":"2222222222222222222222222222222222222222","reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"RT_1","isResolved":false,"isOutdated":false,"path":"src/foo.ts","line":10,"startLine":null,"diffSide":"RIGHT","startDiffSide":null,"comments":{"nodes":[{"fullDatabaseId":"111","body":"hm","url":"https://x","createdAt":"2026-07-01T00:00:00Z","viewerDidAuthor":false,"author":{"login":"octocat","avatarUrl":null,"name":null}}]}}]}}}}}
EOF
```

Tests:
1. **Returns mapped threads** — GET returns 200, `available: true`, one thread with `anchor.side === "additions"`, `anchor.startLine === 10`.
2. **`available: false` with empty threads when the run has no PR** — seed without stamping `prNumber`; the fake gh must not even be needed.
3. **`available: false` when gh fails** — point the fake `gh` at `exit 1`.
4. **404 for an unknown run.**

Assert response shapes by parsing with `GitHubThreadsResponseSchema` from `@stagereview/types/github-threads`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run packages/cli/src/__tests__/github-threads.routes.test.ts
```
Expected: FAIL — route module doesn't exist.

- [ ] **Step 3: Implement `packages/cli/src/routes/github-threads.ts`** (GET portion)

```ts
import type { GitHubThreadsResponse } from "@stagereview/types/github-threads";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { parseGitHubRepo } from "../github/index.js";
import { fetchReviewThreads } from "../github/review-comments.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import { resolveRun } from "./pull-request-shared.js";

const UNAVAILABLE: GitHubThreadsResponse = { available: false, threads: [] };

export function gitHubThreadRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/github-threads",
			handler: async (_req, res, params) => {
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = parseGitHubRepo(run.originUrl);
				if (!repo || run.prNumber === null) {
					writeJson(res, 200, UNAVAILABLE);
					return;
				}
				const [row] = db
					.select({ headSha: chapterRun.headSha })
					.from(chapterRun)
					.where(eq(chapterRun.id, params.runId ?? ""))
					.limit(1)
					.all();
				if (!row) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				const threads = await fetchReviewThreads(run.repoRoot, repo, run.prNumber, row.headSha);
				if (threads === null) {
					writeJson(res, 200, UNAVAILABLE);
					return;
				}
				writeJson(res, 200, { available: true, threads } satisfies GitHubThreadsResponse);
			},
		},
	];
}
```

(Cleaner: extend `RunRepo` in `pull-request-shared.ts` with `headSha: string` — `resolveRun` already selects the full row — and drop the second query. Do that instead if the diff stays small: add `headSha: run.headSha` to `resolveRun`'s return and the interface.)

- [ ] **Step 4: Register the routes**

In `packages/cli/src/show.ts`, after `...pullRequestMutationRoutes(db),` add:

```ts
			...gitHubThreadRoutes(db),
```

with the matching import `import { gitHubThreadRoutes } from "./routes/github-threads.js";`.

- [ ] **Step 5: Run tests, typecheck, lint, commit**

```bash
pnpm vitest run packages/cli/src/__tests__/github-threads.routes.test.ts && pnpm typecheck && pnpm lint
git add packages/cli/src/routes/github-threads.ts packages/cli/src/show.ts packages/cli/src/routes/pull-request-shared.ts packages/cli/src/__tests__/github-threads.routes.test.ts
git commit -m "feat: live-fetch GitHub review threads endpoint"
```

---

## Task 6: GitHub write helpers — export `ghWrite`, reply, resolve, submit review

**Files:**
- Modify: `packages/cli/src/github/mutations.ts`
- Test: covered at the route layer (Task 7) via the fake `gh` binary — these helpers are thin arg-builders around `ghWrite`, and route tests assert the exact `gh` argv (the fake logs its args to a file the test reads), which is the cheapest layer that catches arg-construction bugs.

- [ ] **Step 1: Export `ghWrite` and add a JSON-input variant**

In `packages/cli/src/github/mutations.ts`, change `async function ghWrite` to `export async function ghWrite`, and add below it. The promisified `execFileAsync` doesn't expose stdin, and `--input -` reads the JSON payload from stdin, so use the callback form of `execFile` (already imported at the top of the file) wrapped in a Promise:

```ts
/**
 * Run a `gh api` write with a JSON request body fed over stdin (`--input -`).
 * Used where flag-per-field encoding can't express the payload (e.g. the
 * review submit call's nested comments array). Returns parsed stdout.
 */
export function ghWriteJson(args: string[], repoRoot: string, input: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"gh",
			[...args, "--input", "-"],
			{ cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
			(err, stdout) => {
				if (err) {
					reject(new Error(ghErrorMessage(err)));
					return;
				}
				resolve(stdout.trim() ? JSON.parse(stdout) : null);
			},
		);
		child.stdin?.end(JSON.stringify(input));
	});
}
```

- [ ] **Step 2: Add the three review write functions** (same file, bottom):

```ts
/** Reply to an existing review thread (REST addresses the root comment's database id). */
export function replyToReviewComment(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
	commentId: string,
	body: string,
): Promise<void> {
	return ghWrite(
		[
			"api",
			"--method",
			"POST",
			`repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments/${commentId}/replies`,
			"-f",
			`body=${body}`,
		],
		repoRoot,
	);
}

/** Resolve/unresolve a review thread. Only GraphQL exposes resolution. */
export function setReviewThreadResolved(
	repoRoot: string,
	threadNodeId: string,
	resolved: boolean,
): Promise<void> {
	const mutation = resolved
		? "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }"
		: "mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }";
	return ghWrite(["api", "graphql", "-f", `query=${mutation}`, "-F", `id=${threadNodeId}`], repoRoot);
}

export interface ReviewCommentInput {
	path: string;
	body: string;
	line: number;
	side: "LEFT" | "RIGHT";
	start_line?: number;
	start_side?: "LEFT" | "RIGHT";
}

/**
 * Submit a review in one atomic call: verdict + summary + all pending
 * comments. `commit_id` pins the review to the head the user actually
 * reviewed. Throws (with gh's stderr) on failure so callers keep local state.
 */
export function submitReview(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
	payload: {
		commit_id: string;
		event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
		body: string;
		comments: ReviewCommentInput[];
	},
): Promise<unknown> {
	return ghWriteJson(
		["api", "--method", "POST", `repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/reviews`],
		repoRoot,
		payload,
	);
}
```

Add `import type { ReviewEvent } from "@stagereview/types/github-threads";` and type `event` as `ReviewEvent` instead of the inline union.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/cli/src/github/mutations.ts
git commit -m "feat: gh write helpers for review replies, resolution, and submission"
```

---

## Task 7: Write routes — submit review, reply, resolve

**Files:**
- Modify: `packages/cli/src/routes/github-threads.ts` (add three routes)
- Test: `packages/cli/src/__tests__/github-review-submit.routes.test.ts` (submit lifecycle) and `packages/cli/src/__tests__/github-thread-writes.routes.test.ts` (reply/resolve) — two files to respect the 200-line cap

- [ ] **Step 1: Write failing submit tests**

`github-review-submit.routes.test.ts`, same fake-`gh` harness. The fake `gh` logs `"$@"` to `args.log` (one line per invocation) and prints `{"id": 99}` for the reviews POST. Seed a PR run (origin `git@github.com:owner/repo.git`, `prNumber` 7) and create pending threads through the local comments route (mount `commentRoutes(db)` alongside `gitHubThreadRoutes(db)` in `startServer`).

Tests:

```ts
it("submits pending threads as one review and deletes them locally", async () => {
	const runId = seedPrRun(7);
	const { port } = await startWithRoutes();
	await createThread(port, runId, { body: "pending A", startLine: 5, endLine: 5 });
	await createThread(port, runId, { body: "pending B", startLine: 6, endLine: 10 });

	const res = await send(port, "POST", `/api/runs/${runId}/review`, {
		event: "REQUEST_CHANGES",
		body: "Overall summary",
	});
	expect(res.status).toBe(200);

	// The review call carried both comments (payload was piped via --input -).
	const argsLog = await fs.readFile(path.join(binDir, "args.log"), "utf8");
	expect(argsLog).toContain("repos/owner/repo/pulls/7/reviews");
	const payload = JSON.parse(await fs.readFile(path.join(binDir, "stdin.log"), "utf8"));
	expect(payload.event).toBe("REQUEST_CHANGES");
	expect(payload.comments).toHaveLength(2);
	expect(payload.comments[1]).toMatchObject({
		path: "src/foo.ts",
		line: 10,
		side: "RIGHT",
		start_line: 6,
		start_side: "RIGHT",
	});

	// Pending threads are gone; GitHub is now the source of truth.
	const db = getDb({ dbPath });
	expect(db.select().from(commentThread).all()).toHaveLength(0);
});

it("keeps pending threads when gh fails", async () => {
	// fake gh: exit 1 with stderr for the reviews call
	const runId = seedPrRun(7);
	const { port } = await startWithRoutes();
	await createThread(port, runId, { body: "pending A" });
	const res = await send(port, "POST", `/api/runs/${runId}/review`, {
		event: "APPROVE",
		body: "",
	});
	expect(res.status).toBe(502);
	const db = getDb({ dbPath });
	expect(db.select().from(commentThread).all()).toHaveLength(1);
});

it("leaves local notes (prNumber null) untouched by submit", async () => {
	const prRunId = seedPrRun(7);
	const plainRunId = seedRun(); // same scopeKey
	const { port } = await startWithRoutes();
	await createThread(port, prRunId, { body: "pending" });
	await createThread(port, plainRunId, { body: "note" });
	await send(port, "POST", `/api/runs/${prRunId}/review`, { event: "COMMENT", body: "x" });
	const db = getDb({ dbPath });
	const rows = db.select().from(commentThread).all();
	expect(rows).toHaveLength(1);
	expect(rows[0]?.prNumber).toBeNull();
});

it("rejects a cross-origin submit with 403 before any mutation", async () => {
	const { port } = await startWithRoutes();
	const res = await send(
		port,
		"POST",
		"/api/runs/any/review",
		{ event: "COMMENT", body: "x" },
		{ Origin: "http://evil.example" },
	);
	expect(res.status).toBe(403);
});

it("returns 404 for an unknown run", async () => {
	const { port } = await startWithRoutes();
	const res = await send(port, "POST", "/api/runs/missing/review", { event: "COMMENT", body: "x" });
	expect(res.status).toBe(404);
});
```

The fake `gh` script for the success case (logs args and stdin):

```bash
#!/bin/sh
echo "$@" >> "$(dirname "$0")/args.log"
case "$*" in
	*"/reviews"*) cat > "$(dirname "$0")/stdin.log"; echo '{"id": 99}';;
	*) echo '{}';;
esac
```

- [ ] **Step 2: Write failing reply/resolve tests**

`github-thread-writes.routes.test.ts`:
1. `POST /api/runs/:runId/github-threads/:commentId/replies` with `{ body: "reply" }` → 200, and `args.log` contains `repos/owner/repo/pulls/7/comments/111/replies`.
2. `PATCH /api/github-threads/:threadNodeId/resolve` with `{ resolved: true }` → 200, `args.log` contains `resolveReviewThread`; with `{ resolved: false }` → `unresolveReviewThread`.
3. gh failure → 502, error message from stderr in the body.
4. Cross-origin → 403.

Note the resolve route addresses the GraphQL node id directly (no run needed for the mutation itself), but it still needs a `repoRoot` to run `gh` in — so scope it under the run: `PATCH /api/runs/:runId/github-threads/:threadNodeId/resolve`.

- [ ] **Step 3: Run both test files to verify they fail**

```bash
pnpm vitest run packages/cli/src/__tests__/github-review-submit.routes.test.ts packages/cli/src/__tests__/github-thread-writes.routes.test.ts
```
Expected: FAIL — routes don't exist.

- [ ] **Step 4: Implement the three routes in `packages/cli/src/routes/github-threads.ts`**

Add to the array returned by `gitHubThreadRoutes(db)`:

```ts
		{
			method: "POST",
			pattern: "/api/runs/:runId/review",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				if (run.prNumber === null) {
					writeJson(res, 400, { error: "Run has no associated pull request" });
					return;
				}
				const body = await parseJsonBody(req, res, SubmitReviewBodySchema);
				if (!body) return;

				const scope = resolveRunCommentScope(db, params.runId);
				if (!scope) {
					writeJson(res, 404, { error: `Run ${params.runId} not found` });
					return;
				}
				const pending = listPendingThreads(db, scope.scopeKey, run.prNumber);
				const comments = pending.map(toReviewCommentInput);
				try {
					await submitReview(run.repoRoot, repo, run.prNumber, {
						commit_id: run.headSha,
						event: body.event,
						body: body.body,
						comments,
					});
				} catch (err) {
					// Nothing was deleted — pending comments survive a failed submit.
					writeJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
					return;
				}
				// GitHub accepted the review: it is now the source of truth, so drop
				// the local pending rows (the live github-threads fetch shows them).
				db.delete(commentThread)
					.where(
						inArray(
							commentThread.id,
							pending.map((t) => t.thread.id),
						),
					)
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "POST",
			pattern: "/api/runs/:runId/github-threads/:commentId/replies",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				const repo = requireRepo(run, res);
				if (!repo) return;
				if (run.prNumber === null || !params.commentId) {
					writeJson(res, 400, { error: "Run has no associated pull request" });
					return;
				}
				const body = await parseJsonBody(req, res, GitHubReplyBodySchema);
				if (!body) return;
				try {
					await replyToReviewComment(run.repoRoot, repo, run.prNumber, params.commentId, body.body);
				} catch (err) {
					writeJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
					return;
				}
				writeJson(res, 200, {});
			},
		},
		{
			method: "PATCH",
			pattern: "/api/runs/:runId/github-threads/:threadNodeId/resolve",
			handler: async (req, res, params) => {
				if (!enforceSameOrigin(req, res)) return;
				const run = resolveRun(db, params, res);
				if (!run) return;
				if (!params.threadNodeId) {
					writeJson(res, 400, { error: "Missing threadNodeId" });
					return;
				}
				const body = await parseJsonBody(req, res, GitHubResolveBodySchema);
				if (!body) return;
				try {
					await setReviewThreadResolved(run.repoRoot, params.threadNodeId, body.resolved);
				} catch (err) {
					writeJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
					return;
				}
				writeJson(res, 200, {});
			},
		},
```

Supporting pieces in the same file:

```ts
interface PendingThread {
	thread: CommentThreadRow;
	comments: CommentRow[];
}

/** Pending threads for this scope + PR, each with its ordered comments. */
function listPendingThreads(db: StageDb, scopeKey: string, prNumber: number): PendingThread[] {
	const threads = db
		.select()
		.from(commentThread)
		.where(and(eq(commentThread.scopeKey, scopeKey), eq(commentThread.prNumber, prNumber)))
		.orderBy(asc(commentThread.createdAt))
		.all();
	return threads.map((thread) => ({
		thread,
		comments: db
			.select()
			.from(comment)
			.where(eq(comment.threadId, thread.id))
			.orderBy(asc(comment.createdAt))
			.all(),
	}));
}

const GH_SIDE: Record<CommentThreadRow["side"], "LEFT" | "RIGHT"> = {
	[DIFF_SIDE.ADDITIONS]: "RIGHT",
	[DIFF_SIDE.DELETIONS]: "LEFT",
};

/**
 * A local thread (root + local replies) becomes one review comment — GitHub's
 * atomic review call has no reply concept, so reply bodies are appended.
 */
function toReviewCommentInput(p: PendingThread): ReviewCommentInput {
	const side = GH_SIDE[p.thread.side];
	const input: ReviewCommentInput = {
		path: p.thread.filePath,
		body: p.comments.map((c) => c.body).join("\n\n---\n\n"),
		line: p.thread.endLine,
		side,
	};
	if (p.thread.startLine !== p.thread.endLine) {
		input.start_line = p.thread.startLine;
		input.start_side = side;
	}
	return input;
}
```

`resolveRunCommentScope` must be exported from `routes/comments.ts` (change its declaration to `export function`). New imports in `github-threads.ts`: `SubmitReviewBodySchema`, `GitHubReplyBodySchema`, `GitHubResolveBodySchema` from `@stagereview/types/github-threads`; `DIFF_SIDE` from `../schema.js`; `and`, `asc`, `inArray` from `drizzle-orm`; `comment`, `commentThread`, `CommentRow`, `CommentThreadRow` from `../db/schema/index.js`; `replyToReviewComment`, `setReviewThreadResolved`, `submitReview`, type `ReviewCommentInput` from `../github/mutations.js`; `enforceSameOrigin`, `requireRepo` from `./pull-request-shared.js`; `parseJsonBody` from `./json.js`; `resolveRunCommentScope` from `./comments.js`. Also extend `RunRepo`/`resolveRun` with `headSha: string` if not already done in Task 5.

- [ ] **Step 5: Run tests, full suite, commit**

```bash
pnpm vitest run packages/cli/src/__tests__/github-review-submit.routes.test.ts packages/cli/src/__tests__/github-thread-writes.routes.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add packages/cli/src packages/cli/drizzle
git commit -m "feat: submit review, reply, and resolve routes for GitHub threads"
```

---

## Task 8: Web — github-threads query hook + merge logic

**Files:**
- Create: `packages/web/src/lib/use-github-threads.ts`
- Create: `packages/web/src/lib/merge-threads.ts`
- Test: `packages/web/src/lib/__tests__/merge-threads.test.ts` (pure logic, no mocks)

- [ ] **Step 1: Write failing merge tests**

The diff viewer renders threads by file + anchor. Merging = combining local threads (already `CommentThread[]`) with anchorable GitHub threads into one per-file map, and collecting unanchorable GitHub threads separately. `packages/web/src/lib/__tests__/merge-threads.test.ts`:

```ts
import type { CommentThread } from "@stagereview/types/comments";
import type { GitHubThread } from "@stagereview/types/github-threads";
import { describe, expect, it } from "vitest";
import { type DisplayThread, mergeThreads } from "../merge-threads";

function makeLocal(over: Partial<CommentThread> = {}): CommentThread {
	return {
		id: "t1",
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 5,
		endLine: 5,
		pending: true,
		resolvedAt: null,
		createdAt: "2026-07-01T00:00:00Z",
		updatedAt: "2026-07-01T00:00:00Z",
		comments: [],
		...over,
	};
}

function makeGitHub(over: Partial<GitHubThread> = {}): GitHubThread {
	return {
		githubThreadId: "RT_1",
		filePath: "src/foo.ts",
		anchor: { side: "additions", startLine: 10, endLine: 10 },
		isResolved: false,
		comments: [],
		...over,
	};
}

describe("mergeThreads", () => {
	it("groups local and anchored GitHub threads by file", () => {
		const { byFile, outdated } = mergeThreads([makeLocal()], [makeGitHub()]);
		const threads = byFile.get("src/foo.ts") ?? [];
		expect(threads).toHaveLength(2);
		expect(threads.map((t: DisplayThread) => t.kind)).toEqual(["local", "github"]);
		expect(outdated).toHaveLength(0);
	});

	it("routes unanchorable GitHub threads to the outdated list", () => {
		const { byFile, outdated } = mergeThreads([], [makeGitHub({ anchor: null })]);
		expect(byFile.size).toBe(0);
		expect(outdated).toHaveLength(1);
	});

	it("sorts threads within a file by anchor start line", () => {
		const { byFile } = mergeThreads(
			[makeLocal({ startLine: 20, endLine: 20 })],
			[makeGitHub({ anchor: { side: "additions", startLine: 3, endLine: 3 } })],
		);
		const threads = byFile.get("src/foo.ts") ?? [];
		expect(threads[0]?.kind).toBe("github");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run packages/web/src/lib/__tests__/merge-threads.test.ts
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `packages/web/src/lib/merge-threads.ts`**

```ts
import type { CommentThread } from "@stagereview/types/comments";
import type { GitHubThread } from "@stagereview/types/github-threads";

// One entry in the diff's annotation stream: either a local thread (note or
// pending) or an anchorable GitHub thread. The discriminant lets thread
// components pick data source and capabilities (edit/delete vs reply/resolve).
export type DisplayThread =
	| { kind: "local"; thread: CommentThread }
	| { kind: "github"; thread: GitHubThread };

export interface MergedThreads {
	byFile: ReadonlyMap<string, DisplayThread[]>;
	/** GitHub threads that can't anchor inline (outdated head, mixed sides). */
	outdated: GitHubThread[];
}

function startLine(t: DisplayThread): number {
	return t.kind === "local" ? t.thread.startLine : (t.thread.anchor?.startLine ?? 0);
}

export function mergeThreads(local: CommentThread[], github: GitHubThread[]): MergedThreads {
	const byFile = new Map<string, DisplayThread[]>();
	const outdated: GitHubThread[] = [];
	const push = (filePath: string, entry: DisplayThread) => {
		const list = byFile.get(filePath);
		if (list) list.push(entry);
		else byFile.set(filePath, [entry]);
	};
	for (const thread of local) push(thread.filePath, { kind: "local", thread });
	for (const thread of github) {
		if (thread.anchor === null) outdated.push(thread);
		else push(thread.filePath, { kind: "github", thread });
	}
	for (const list of byFile.values()) list.sort((a, b) => startLine(a) - startLine(b));
	return { byFile, outdated };
}
```

- [ ] **Step 4: Implement `packages/web/src/lib/use-github-threads.ts`**

Mirror `use-comment-threads.ts`'s shape:

```ts
import {
	type GitHubThreadsResponse,
	GitHubThreadsResponseSchema,
	type SubmitReviewBody,
} from "@stagereview/types/github-threads";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { jsonFetch } from "./use-view-state";

const GITHUB_THREADS_ROOT = "github-threads";

export function gitHubThreadsQueryKey(runId: string): readonly unknown[] {
	return [GITHUB_THREADS_ROOT, runId];
}

async function fetchGitHubThreads(runId: string): Promise<GitHubThreadsResponse> {
	const raw = await jsonFetch<unknown>(`/api/runs/${encodeURIComponent(runId)}/github-threads`);
	return GitHubThreadsResponseSchema.parse(raw);
}

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: body === undefined ? undefined : JSON.stringify(body),
});

export interface UseGitHubThreadsResult {
	available: boolean;
	threads: GitHubThreadsResponse["threads"];
	isLoading: boolean;
	error: unknown;
	refresh: () => Promise<void>;
	submitReview: (input: SubmitReviewBody) => Promise<void>;
	replyToGitHubThread: (input: { commentId: string; body: string }) => Promise<void>;
	setGitHubThreadResolved: (input: { threadNodeId: string; resolved: boolean }) => Promise<void>;
}

/**
 * Live-fetched GitHub review threads for a PR run. Unlike the local threads
 * query (instant SQLite reads, refetched on every edit), this one shells out
 * to gh — so it stays fresh only on demand: submit, reply, resolve, or an
 * explicit refresh.
 */
export function useGitHubThreads(runId: string): UseGitHubThreadsResult {
	const queryClient = useQueryClient();
	const queryKey = useMemo(() => gitHubThreadsQueryKey(runId), [runId]);

	const { data, isLoading, error } = useQuery<GitHubThreadsResponse>({
		queryKey,
		queryFn: () => fetchGitHubThreads(runId),
		enabled: runId !== "",
		staleTime: Number.POSITIVE_INFINITY,
	});

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey });
	};

	const submitMutation = useMutation({
		mutationFn: async (input: SubmitReviewBody) => {
			await jsonFetch(`/api/runs/${encodeURIComponent(runId)}/review`, jsonRequest("POST", input));
		},
		onSuccess: invalidate,
	});

	const replyMutation = useMutation({
		mutationFn: async ({ commentId, body }: { commentId: string; body: string }) => {
			await jsonFetch(
				`/api/runs/${encodeURIComponent(runId)}/github-threads/${encodeURIComponent(commentId)}/replies`,
				jsonRequest("POST", { body }),
			);
		},
		onSuccess: invalidate,
	});

	const resolveMutation = useMutation({
		mutationFn: async ({ threadNodeId, resolved }: { threadNodeId: string; resolved: boolean }) => {
			await jsonFetch(
				`/api/runs/${encodeURIComponent(runId)}/github-threads/${encodeURIComponent(threadNodeId)}/resolve`,
				jsonRequest("PATCH", { resolved }),
			);
		},
		onSuccess: invalidate,
	});

	return useMemo(
		() => ({
			available: data?.available ?? false,
			threads: data?.threads ?? [],
			isLoading,
			error,
			refresh: invalidate,
			submitReview: submitMutation.mutateAsync,
			replyToGitHubThread: replyMutation.mutateAsync,
			setGitHubThreadResolved: resolveMutation.mutateAsync,
		}),
		[
			data,
			isLoading,
			error,
			submitMutation.mutateAsync,
			replyMutation.mutateAsync,
			resolveMutation.mutateAsync,
		],
	);
}
```

Submit must also invalidate the **local** threads query (pending rows were deleted server-side): in `submitMutation.onSuccess`, additionally call `queryClient.invalidateQueries({ queryKey: commentThreadsQueryKey(runId) })` (import from `./use-comment-threads`).

- [ ] **Step 5: Run tests, typecheck, lint, commit**

```bash
pnpm vitest run packages/web/src/lib/__tests__/merge-threads.test.ts && pnpm typecheck && pnpm lint
git add packages/web/src/lib
git commit -m "feat(web): github-threads query hook and thread merge logic"
```

---

## Task 9: Web — render GitHub threads, pending badges, review toolbar

**Files:**
- Modify: `packages/web/src/lib/comment-threads-context.tsx` (expose GitHub threads + merged map)
- Modify: `packages/web/src/components/chapter/pierre-diff-viewer.tsx` (render `DisplayThread`s instead of only local threads)
- Modify: `packages/web/src/components/comments/comment-thread.tsx` (GitHub author display, Pending badge, capability gating)
- Create: `packages/web/src/components/comments/review-toolbar.tsx` (pending count + "Finish your review" popover)
- Create: `packages/web/src/components/comments/outdated-threads.tsx` (list of unanchorable GitHub threads)

UI wiring — TDD optional per TESTING.md ("straightforward CRUD wiring"; visual-only pieces need no tests). Before styling, invoke the `deslop-ui` skill per CLAUDE.md routing. Read each component before modifying; the steps below describe the required behavior, and the implementer follows existing component patterns (shadcn/ui, Tailwind, lucide icons).

- [ ] **Step 1: Extend the context**

In `comment-threads-context.tsx`, call `useGitHubThreads(runId)` next to the existing `useCommentThreads(runId)` and expose through the context value: `github` (the `UseGitHubThreadsResult`) and `merged` (`useMemo(() => mergeThreads(threads, github.available ? github.threads : []), [threads, github.available, github.threads])`). Keep the existing fields untouched so current consumers compile unchanged.

- [ ] **Step 2: Render merged threads in the diff viewer**

In `pierre-diff-viewer.tsx`, wherever `threadsByFile` is consumed to build annotation rows, switch to `merged.byFile`. A `DisplayThread` with `kind: "github"` renders with the GitHub thread component variant; anchor fields come from `thread.anchor` (non-null here by construction). Local threads keep today's behavior exactly.

- [ ] **Step 3: Thread component variants**

In `comment-thread.tsx` (and `comment-actions.tsx` as needed):
- GitHub comments show `author.avatarUrl` (fall back to initial), `author.name ?? author.login`, and link the timestamp to `comment.url`.
- GitHub threads: reply box wired to `replyToGitHubThread` (root comment's `githubCommentId`), resolve toggle wired to `setGitHubThreadResolved`, **no** edit/delete controls (editing other people's GitHub comments is out of scope; even own-comment editing is deferred — YAGNI).
- Local threads with `pending: true`: render a small "Pending" badge (amber, matching GitHub's) in the thread header. Edit/delete/resolve behave as today.

- [ ] **Step 4: Review toolbar**

`review-toolbar.tsx`, mounted in the PR header area (find where the PR header from PR #62 renders, `packages/web/src/components/` — follow its placement conventions):
- Hidden entirely when the run has no PR or `github.available` is false and there are no pending threads.
- Shows pending count (`merged` local threads where `pending`), and a "Finish your review" button opening a shadcn Popover containing: markdown textarea (reuse `comment-markdown-editor.tsx`), a RadioGroup for `REVIEW_EVENT` (Comment / Approve / Request changes — disable Approve/Request-changes on your own PRs is a GitHub rule, but let the server error surface it rather than pre-checking; YAGNI), and a Submit button calling `submitReview`. Disable Submit while the mutation is in flight; on error, toast the message (follow the existing toast pattern in `comment-threads-context.tsx`); on success, close the popover and toast "Review submitted".
- If `github.available` is false but pending comments exist, show the toolbar with a banner line: "GitHub unavailable — install/authenticate `gh` to submit" (mirror the read-degradation convention).

- [ ] **Step 5: Outdated threads list**

`outdated-threads.tsx`: when `merged.outdated` is non-empty, render a collapsible section (below the file list or at the end of the review page — follow the page's existing layout blocks) listing each thread: file path, first comment's author + body, "View on GitHub" link (first comment's `url`), and the hint "Not viewable inline — re-import to update". Mount it in the same route component where the diff viewer lives (`packages/web/src/routes/app/runs.$runId.tsx` or wherever the chapter view composes).

- [ ] **Step 6: Manual verification**

```bash
pnpm build
node packages/cli/dist/index.js show <some-chapters-file> --pr <a-real-pr>   # against a scratch repo/PR you own
```
Verify: GitHub threads render inline with authors; new comments show Pending; Finish-your-review submits and threads flip from pending to GitHub-sourced; reply and resolve round-trip; outdated section appears when the PR head has moved.

- [ ] **Step 7: Lint, typecheck, full tests, commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add packages/web
git commit -m "feat(web): GitHub review threads, pending badges, and review submission UI"
```

---

## Task 10: Final integration pass

**Files:** none new

- [ ] **Step 1: Full local gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: all green.

- [ ] **Step 2: End-to-end smoke against a real PR** (repeat Task 9 Step 6 on a fresh DB: `rm` the app-data SQLite first so migrations run from scratch — path per `packages/cli/src/db/path.ts`).

- [ ] **Step 3: Push and open a PR on the fork**

```bash
git push origin feat/github-reviews
gh pr create --repo <your-fork> --title "feat: GitHub review integration" --body "..."
```
PR body follows the repo format: Summary / Changes / Testing.
