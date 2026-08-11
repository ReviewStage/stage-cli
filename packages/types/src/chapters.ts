import { z } from "zod";
import { PrologueSchema } from "./prologue.ts";

export const DIFF_SIDE = {
	ADDITIONS: "additions",
	DELETIONS: "deletions",
} as const;
export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

export const HEADER_ONLY_OLD_START = 0;

export const hunkReferenceSchema = z.strictObject({
	filePath: z.string().min(1),
	oldStart: z.number().int().nonnegative(),
});
export type HunkReference = z.infer<typeof hunkReferenceSchema>;

export const lineRefSchema = z.strictObject({
	filePath: z.string().min(1),
	side: z.enum(DIFF_SIDE),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
});
export type LineRef = z.infer<typeof lineRefSchema>;

export const RISK_LEVEL = {
	HIGH: "high",
	MEDIUM: "medium",
	LOW: "low",
} as const;
export type RiskLevel = (typeof RISK_LEVEL)[keyof typeof RISK_LEVEL];

export const RISK_LABELS = {
	high: "High",
	medium: "Medium",
	low: "Low",
} as const satisfies Record<RiskLevel, string>;

export const riskLevelSchema = z.enum(RISK_LEVEL);

const RISK_LEVEL_SET: ReadonlySet<string> = new Set(riskLevelSchema.options);
export function isValidRiskLevel(value: string): value is RiskLevel {
	return RISK_LEVEL_SET.has(value);
}

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
	riskLevel: riskLevelSchema.nullable().default(null),
	riskReasons: z.array(z.string()).default([]),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ChapterRunSchema = z.object({
	id: z.string(),
	repoName: z.string(),
});
export type ChapterRun = z.infer<typeof ChapterRunSchema>;

export const ChaptersResponseSchema = z.object({
	run: ChapterRunSchema,
	chapters: z.array(ChapterSchema),
	prologue: PrologueSchema.nullable().optional(),
});
export type ChaptersResponse = z.infer<typeof ChaptersResponseSchema>;
