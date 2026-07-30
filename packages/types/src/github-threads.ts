import { z } from "zod";
import { DIFF_SIDE } from "./chapters.ts";

export const REVIEW_EVENT = {
	APPROVE: "APPROVE",
	REQUEST_CHANGES: "REQUEST_CHANGES",
	COMMENT: "COMMENT",
} as const;
export type ReviewEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

// Author of a GitHub review comment. Distinct from the local viewer type
// (`Viewer` in ./viewer.ts) — this is whoever wrote the comment, not the
// logged-in user.
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
