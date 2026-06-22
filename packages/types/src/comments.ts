import { z } from "zod";
import { DIFF_SIDE } from "./chapters.ts";

// Author of a pulled GitHub comment. Local comments carry `author: null`, which
// the UI renders as the local reviewer ("You").
export const CommentAuthorSchema = z.object({
	login: z.string(),
	avatarUrl: z.string().nullable(),
});
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

// A single authored comment. Replies are sibling comments sharing a thread, so a
// comment carries no positional data of its own — the thread owns the anchor.
// `author` is null for locally-authored comments and set for ones pulled from a
// GitHub PR. `githubCommentId` is non-null once the comment is synced to the PR.
// Non-strict (like the other wire response schemas) so the server can add fields
// the SPA doesn't yet read without the response failing to parse.
export const CommentSchema = z.object({
	id: z.string(),
	body: z.string(),
	author: CommentAuthorSchema.nullable(),
	githubCommentId: z.number().int().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

// A line-anchored conversation. `comments` is ordered oldest-first; the first is
// the thread's root. `resolvedAt` is null while the thread is open.
export const CommentThreadSchema = z.object({
	id: z.string(),
	filePath: z.string(),
	side: z.enum(DIFF_SIDE),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
	resolvedAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	comments: z.array(CommentSchema),
});
export type CommentThread = z.infer<typeof CommentThreadSchema>;

export const CommentThreadsResponseSchema = z.array(CommentThreadSchema);
export type CommentThreadsResponse = z.infer<typeof CommentThreadsResponseSchema>;

// Body for creating a thread + its root comment in one request.
export const CreateCommentThreadBodySchema = z
	.object({
		filePath: z.string().min(1),
		side: z.enum(DIFF_SIDE),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		body: z.string().min(1),
	})
	.refine((v) => v.startLine <= v.endLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type CreateCommentThreadBody = z.infer<typeof CreateCommentThreadBodySchema>;

// Body for adding a reply or editing an existing comment.
export const CommentBodySchema = z.object({
	body: z.string().min(1),
});
export type CommentBody = z.infer<typeof CommentBodySchema>;

// Body for toggling a thread's resolved state.
export const ResolveThreadBodySchema = z.object({
	resolved: z.boolean(),
});
export type ResolveThreadBody = z.infer<typeof ResolveThreadBodySchema>;

// ─── GitHub sync ──────────────────────────────────────────────────────────────

// Outcome of importing PR review comments into the local review.
export const PullCommentsResultSchema = z.object({
	// New local comments created from the PR.
	pulled: z.number().int().nonnegative(),
	// PR comments already present locally (matched by GitHub id), left untouched.
	skipped: z.number().int().nonnegative(),
});
export type PullCommentsResult = z.infer<typeof PullCommentsResultSchema>;

// A local comment that couldn't be pushed, with the reason surfaced to the user.
export const PushCommentFailureSchema = z.object({
	filePath: z.string(),
	line: z.number().int(),
	message: z.string(),
});
export type PushCommentFailure = z.infer<typeof PushCommentFailureSchema>;

// Outcome of pushing locally-authored comments to the PR.
export const PushCommentsResultSchema = z.object({
	// Local comments created on the PR by this push.
	pushed: z.number().int().nonnegative(),
	// Local comments already on the PR (already had a GitHub id), left untouched.
	skipped: z.number().int().nonnegative(),
	// Per-comment failures (e.g. line not in the PR diff).
	failed: z.array(PushCommentFailureSchema),
});
export type PushCommentsResult = z.infer<typeof PushCommentsResultSchema>;
