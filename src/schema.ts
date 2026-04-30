/**
 * Wire-format schemas and types shared between the CLI (which validates with
 * Zod) and the SPA (which imports the inferred types). Single source of truth.
 */

import { z } from "zod";

export const DIFF_SIDE = {
  ADDITIONS: "additions",
  DELETIONS: "deletions",
} as const;
export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

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

export const keyChangeSchema = z.strictObject({
  // Stable across re-runs of the same diff (the SPA uses it as a localStorage
  // key for "checked" state). Generators must derive it from content, not
  // index, or state migrates onto whichever item lands at the same position.
  id: z.string().min(1),
  // A judgment-call question for a human reviewer, not source code.
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
  generatedAt: z.iso.datetime(),
});
export type ChaptersFile = z.infer<typeof ChaptersFileSchema>;
