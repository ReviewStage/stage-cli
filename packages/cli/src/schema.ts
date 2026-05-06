import { hunkReferenceSchema, lineRefSchema } from "@stagereview/types/chapters";
import { PrologueSchema } from "@stagereview/types/prologue";
import { z } from "zod";

export type { DiffSide, HunkReference, LineRef } from "@stagereview/types/chapters";
export { DIFF_SIDE, hunkReferenceSchema, lineRefSchema } from "@stagereview/types/chapters";

export const SCOPE_KIND = {
	COMMITTED: "committed",
	WORKING_TREE: "workingTree",
} as const;
export type ScopeKind = (typeof SCOPE_KIND)[keyof typeof SCOPE_KIND];

export const WORKING_TREE_REF = {
	WORK: "work",
	STAGED: "staged",
	UNSTAGED: "unstaged",
} as const;
export type WorkingTreeRef = (typeof WORKING_TREE_REF)[keyof typeof WORKING_TREE_REF];

const fullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "Expected a full commit SHA");

export const keyChangeSchema = z.strictObject({
	/** A judgment-call question for a human reviewer, not source code. */
	content: z.string().min(1),
	lineRefs: z.array(lineRefSchema).min(1),
});
export type KeyChange = z.infer<typeof keyChangeSchema>;

export const chapterSchema = z.strictObject({
	id: z.string().min(1),
	order: z.number().int().positive(),
	title: z.string().min(1),
	summary: z.string().min(1),
	hunkRefs: z.array(hunkReferenceSchema),
	keyChanges: z.array(keyChangeSchema),
});
export type Chapter = z.infer<typeof chapterSchema>;

export const committedScopeSchema = z.strictObject({
	kind: z.literal(SCOPE_KIND.COMMITTED),
	baseSha: fullShaSchema,
	headSha: fullShaSchema,
	mergeBaseSha: fullShaSchema,
});
export type CommittedScope = z.infer<typeof committedScopeSchema>;

export const workingTreeScopeSchema = z.strictObject({
	kind: z.literal(SCOPE_KIND.WORKING_TREE),
	ref: z.enum(WORKING_TREE_REF),
	baseSha: fullShaSchema,
	headSha: fullShaSchema,
	mergeBaseSha: fullShaSchema,
});
export type WorkingTreeScope = z.infer<typeof workingTreeScopeSchema>;

export const scopeSchema = z.discriminatedUnion("kind", [
	committedScopeSchema,
	workingTreeScopeSchema,
]);
export type Scope = z.infer<typeof scopeSchema>;

export const ChaptersFileSchema = z.strictObject({
	scope: scopeSchema,
	chapters: z.array(chapterSchema),
	prologue: PrologueSchema.optional(),
	generatedAt: z.iso.datetime(),
});
export type ChaptersFile = z.infer<typeof ChaptersFileSchema>;

export const AgentOutputSchema = z.strictObject({
	chapters: z.array(chapterSchema),
	prologue: PrologueSchema.optional(),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;
