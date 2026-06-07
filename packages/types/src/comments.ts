import { z } from "zod";
import { DIFF_SIDE } from "./chapters.ts";

// A single authored comment. Replies are sibling comments sharing a thread, so a
// comment carries no positional data of its own — the thread owns the anchor.
// Non-strict (like the other wire response schemas) so the server can add fields
// the SPA doesn't yet read without the response failing to parse.
export const CommentSchema = z.object({
	id: z.string(),
	body: z.string(),
	authorId: z.string(),
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
