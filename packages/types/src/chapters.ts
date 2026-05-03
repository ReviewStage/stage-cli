import { z } from "zod";

export const DIFF_SIDE = {
	ADDITIONS: "additions",
	DELETIONS: "deletions",
} as const;
export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

export const hunkReferenceSchema = z.strictObject({
	filePath: z.string().min(1),
	oldStart: z.number().int().nonnegative(),
});
export type HunkReference = z.infer<typeof hunkReferenceSchema>;

export const lineRefSchema = z
	.strictObject({
		filePath: z.string().min(1),
		side: z.enum(DIFF_SIDE),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((v) => v.startLine <= v.endLine, {
		message: "endLine must be greater than or equal to startLine",
		path: ["endLine"],
	});
export type LineRef = z.infer<typeof lineRefSchema>;

// Non-strict (vs. ingestion's z.strictObject in packages/cli/src/schema.ts) so the server
// can add fields the SPA doesn't yet read without rejecting the whole response.
export const KeyChangeSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	content: z.string(),
	lineRefs: z.array(lineRefSchema),
});
export type KeyChange = z.infer<typeof KeyChangeSchema>;

export const ChapterSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	order: z.number().int(),
	title: z.string(),
	summary: z.string(),
	hunkRefs: z.array(hunkReferenceSchema),
	keyChanges: z.array(KeyChangeSchema),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ChapterRunSchema = z.object({
	id: z.string(),
});
export type ChapterRun = z.infer<typeof ChapterRunSchema>;

export const ChaptersResponseSchema = z.object({
	run: ChapterRunSchema,
	chapters: z.array(ChapterSchema),
});
export type ChaptersResponse = z.infer<typeof ChaptersResponseSchema>;
