import { z } from "zod";
import { hunkReferenceSchema, lineRefSchema } from "../schema.js";

export const HunkRefSchema = hunkReferenceSchema;
export type HunkRef = z.infer<typeof HunkRefSchema>;

export const LineRefSchema = lineRefSchema;
export type LineRef = z.infer<typeof LineRefSchema>;

// Non-strict (vs. z.strictObject in src/schema.ts) so the server can add fields
// the SPA doesn't yet read without rejecting the whole response.
export const KeyChangeSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	content: z.string(),
	lineRefs: z.array(LineRefSchema),
});
export type KeyChange = z.infer<typeof KeyChangeSchema>;

export const ChapterSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	order: z.number().int(),
	title: z.string(),
	summary: z.string(),
	hunkRefs: z.array(HunkRefSchema),
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
