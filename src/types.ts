/**
 * Wire-format types shared between the CLI (which validates them with Zod in
 * `./schema.ts`) and the SPA (which imports them via the `@stage/*` path
 * alias). Kept Zod-free so `import`s from the web bundle don't pull Zod in.
 */

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
  /** A judgment-call question for a human reviewer, not source code. */
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

export interface ChaptersFile {
  scope: Scope;
  chapters: Chapter[];
  generatedAt: string;
}
