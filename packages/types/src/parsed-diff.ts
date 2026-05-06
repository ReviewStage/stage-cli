import { z } from "zod";

export const FILE_STATUS = {
	ADDED: "added",
	MODIFIED: "modified",
	DELETED: "deleted",
	RENAMED: "renamed",
	MOVED: "moved",
} as const;
export type FileStatus = (typeof FILE_STATUS)[keyof typeof FILE_STATUS];

export const LINE_TYPE = {
	CONTEXT: "context",
	ADDITION: "addition",
	DELETION: "deletion",
	HEADER: "header",
} as const;
export type LineType = (typeof LINE_TYPE)[keyof typeof LINE_TYPE];

export const diffLineSchema = z.object({
	type: z.enum(LINE_TYPE),
	content: z.string(),
	oldLineNumber: z.number().optional(),
	newLineNumber: z.number().optional(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

export const hunkSchema = z.object({
	header: z.string(),
	oldStart: z.number(),
	newStart: z.number(),
	oldLines: z.number(),
	newLines: z.number(),
	lines: z.array(diffLineSchema),
});
export type Hunk = z.infer<typeof hunkSchema>;

export const pullRequestFileSchema = z.object({
	path: z.string(),
	oldPath: z.string().optional(),
	filename: z.string(),
	status: z.enum(FILE_STATUS),
	additions: z.number(),
	deletions: z.number(),
	hunks: z.array(hunkSchema),
	patch: z.string().optional(),
	isSymlink: z.boolean().optional(),
	symlinkTarget: z.string().optional(),
	oldSymlinkTarget: z.string().optional(),
});
export type PullRequestFile = z.infer<typeof pullRequestFileSchema>;
