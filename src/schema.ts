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
  /** A judgment-call question for a human reviewer, not source code. */
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

// Pin each Zod schema's inferred shape to the plain interface in ./types.ts.
// If anyone changes one without the other, this block fails to typecheck —
// so the SPA's type imports and the CLI's runtime validation can't drift.
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;
type _SchemaTypeChecks = [
  Expect<Equal<z.infer<typeof hunkReferenceSchema>, HunkReference>>,
  Expect<Equal<z.infer<typeof lineRefSchema>, LineRef>>,
  Expect<Equal<z.infer<typeof keyChangeSchema>, KeyChange>>,
  Expect<Equal<z.infer<typeof chapterSchema>, Chapter>>,
  Expect<Equal<z.infer<typeof committedScopeSchema>, CommittedScope>>,
  Expect<Equal<z.infer<typeof workingTreeScopeSchema>, WorkingTreeScope>>,
  Expect<Equal<z.infer<typeof scopeSchema>, Scope>>,
  Expect<Equal<z.infer<typeof ChaptersFileSchema>, ChaptersFile>>,
];
