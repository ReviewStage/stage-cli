import { z } from "zod";
import { hunkReferenceSchema, lineRefSchema, SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";

// Timestamps arrive as ISO strings, not Date objects: JSON.stringify converts
// Drizzle's Date columns on the way out.
const isoDateString = z.iso.datetime();

export const HunkRefSchema = hunkReferenceSchema;
export type HunkRef = z.infer<typeof HunkRefSchema>;

export const LineRefSchema = lineRefSchema;
export type LineRef = z.infer<typeof LineRefSchema>;

// Non-strict (vs. z.strictObject in src/schema.ts) so the server can add fields
// the SPA doesn't yet read without rejecting the whole response.
export const KeyChangeSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	chapterId: z.string(),
	content: z.string(),
	lineRefs: z.array(LineRefSchema).default([]),
	createdAt: isoDateString,
	updatedAt: isoDateString,
});
export type KeyChange = z.infer<typeof KeyChangeSchema>;

export const ChapterSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	runId: z.string(),
	chapterIndex: z.number().int(),
	title: z.string(),
	summary: z.string(),
	hunkRefs: z.array(HunkRefSchema),
	keyChanges: z.array(KeyChangeSchema),
	createdAt: isoDateString,
	updatedAt: isoDateString,
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ChapterRunSchema = z.object({
	id: z.string(),
	repoRoot: z.string(),
	scopeKind: z.enum([SCOPE_KIND.COMMITTED, SCOPE_KIND.WORKING_TREE]),
	workingTreeRef: z
		.enum([WORKING_TREE_REF.WORK, WORKING_TREE_REF.STAGED, WORKING_TREE_REF.UNSTAGED])
		.nullable(),
	baseSha: z.string(),
	headSha: z.string(),
	mergeBaseSha: z.string(),
	generatedAt: isoDateString,
	createdAt: isoDateString,
	updatedAt: isoDateString,
});
export type ChapterRun = z.infer<typeof ChapterRunSchema>;

export const ChaptersResponseSchema = z.object({
	run: ChapterRunSchema,
	chapters: z.array(ChapterSchema),
});
export type ChaptersResponse = z.infer<typeof ChaptersResponseSchema>;
