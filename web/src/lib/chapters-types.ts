/**
 * Wire-format types for `/api/data.json`. Mirrors the runtime schema in
 * `src/schema.ts`; the CLI (`stage-cli show`) validates with Zod before
 * serving, so the SPA can trust the shape and only treats parse failures as
 * errors.
 */

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

export const DIFF_SIDE = {
  ADDITIONS: "additions",
  DELETIONS: "deletions",
} as const;
export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

export interface CommittedScope {
  kind: typeof SCOPE_KIND.COMMITTED;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
}

export interface WorkingTreeScope {
  kind: typeof SCOPE_KIND.WORKING_TREE;
  ref: WorkingTreeRef;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
}

export type Scope = CommittedScope | WorkingTreeScope;

export interface HunkReference {
  filePath: string;
  oldStart: number;
}

export interface LineRef {
  filePath: string;
  side: DiffSide;
  startLine: number;
  endLine: number;
}

export interface KeyChange {
  content: string;
  lineRefs: LineRef[];
}

export interface Chapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  hunkRefs: HunkReference[];
  keyChanges: KeyChange[];
}

export interface ChaptersFile {
  scope: Scope;
  chapters: Chapter[];
  generatedAt: string;
}
