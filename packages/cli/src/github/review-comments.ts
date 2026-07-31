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
	const anchor =
		!node.isOutdated && !mixedSides && node.line !== null && ctx.prHeadSha === ctx.runHeadSha
			? {
					side: SIDE_FROM_GH[node.diffSide],
					startLine: node.startLine ?? node.line,
					endLine: node.line,
				}
			: null;
	return {
		githubThreadId: node.id,
		filePath: node.path,
		anchor,
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
			// `owner`/`repo`/`cursor` are String! variables: `-f` (raw-field) sends
			// them as-is. `-F` would coerce an all-digit owner/repo name to a JSON
			// number (breaking the query) and treats a leading `@` as "read from
			// file". `number` is a genuine Int!, so it keeps `-F`.
			const args = [
				"api",
				"graphql",
				"-f",
				`query=${REVIEW_THREADS_QUERY}`,
				"-f",
				`owner=${repo.owner}`,
				"-f",
				`repo=${repo.repo}`,
				"-F",
				`number=${prNumber}`,
			];
			if (cursor !== null) args.push("-f", `cursor=${cursor}`);
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
