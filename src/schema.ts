/**
 * Zod schemas for the wire format. The canonical TS shapes live in
 * `./types.ts` (Zod-free, so SPA value imports don't pull Zod into the web
 * bundle). Each schema's inferred output is checked against the matching
 * type from `./types.ts` via the `_drift` block at the bottom of this file,
 * so drift between the two surfaces fails to type-check. Callers can import
 * either file; this file re-exports the types and constants for a single
 * import path on the CLI side.
 */

import { z } from "zod";
import {
  DIFF_SIDE,
  SCOPE_KIND,
  WORKING_TREE_REF,
  type Chapter,
  type ChaptersFile,
  type CommittedScope,
  type HunkReference,
  type KeyChange,
  type LineRef,
  type Scope,
  type WorkingTreeScope,
} from "./types.js";

export {
  DIFF_SIDE,
  SCOPE_KIND,
  WORKING_TREE_REF,
} from "./types.js";
export type {
  Chapter,
  ChaptersFile,
  CommittedScope,
  DiffSide,
  HunkReference,
  KeyChange,
  LineRef,
  Scope,
  ScopeKind,
  WorkingTreeRef,
  WorkingTreeScope,
} from "./types.js";

const fullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, "Expected a full commit SHA");

export const hunkReferenceSchema = z.strictObject({
  filePath: z.string().min(1),
  oldStart: z.number().int().nonnegative(),
});

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

export const keyChangeSchema = z.strictObject({
  id: z.string().min(1),
  content: z.string().min(1),
  lineRefs: z.array(lineRefSchema).min(1),
});

export const chapterSchema = z.strictObject({
  id: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().min(1),
  hunkRefs: z.array(hunkReferenceSchema),
  keyChanges: z.array(keyChangeSchema),
});

export const committedScopeSchema = z.strictObject({
  kind: z.literal(SCOPE_KIND.COMMITTED),
  baseSha: fullShaSchema,
  headSha: fullShaSchema,
  mergeBaseSha: fullShaSchema,
});

export const workingTreeScopeSchema = z.strictObject({
  kind: z.literal(SCOPE_KIND.WORKING_TREE),
  ref: z.enum(WORKING_TREE_REF),
  baseSha: fullShaSchema,
  headSha: fullShaSchema,
  mergeBaseSha: fullShaSchema,
});

export const scopeSchema = z.discriminatedUnion("kind", [
  committedScopeSchema,
  workingTreeScopeSchema,
]);

export const ChaptersFileSchema = z.strictObject({
  scope: scopeSchema,
  chapters: z.array(chapterSchema),
  generatedAt: z.iso.datetime(),
});

// Drift guard: each schema's inferred output must equal the canonical type in
// ./types.ts. Equality (not just assignability) catches both extra and
// missing fields. If types and schemas drift, one of these assignments fails
// to type-check.
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
const _drift: {
  hunkReference: Equals<z.infer<typeof hunkReferenceSchema>, HunkReference>;
  lineRef: Equals<z.infer<typeof lineRefSchema>, LineRef>;
  keyChange: Equals<z.infer<typeof keyChangeSchema>, KeyChange>;
  chapter: Equals<z.infer<typeof chapterSchema>, Chapter>;
  committedScope: Equals<z.infer<typeof committedScopeSchema>, CommittedScope>;
  workingTreeScope: Equals<z.infer<typeof workingTreeScopeSchema>, WorkingTreeScope>;
  scope: Equals<z.infer<typeof scopeSchema>, Scope>;
  chaptersFile: Equals<z.infer<typeof ChaptersFileSchema>, ChaptersFile>;
} = {
  hunkReference: true,
  lineRef: true,
  keyChange: true,
  chapter: true,
  committedScope: true,
  workingTreeScope: true,
  scope: true,
  chaptersFile: true,
};
void _drift;
