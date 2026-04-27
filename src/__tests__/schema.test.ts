import { describe, expect, it } from "vitest";
import { ChaptersFileSchema } from "../schema.js";

type LineRefInput = {
  filePath: string;
  side: string;
  startLine: number;
  endLine: number;
};

type HunkRefInput = {
  filePath: string;
  oldStart: number;
};

type KeyChangeInput = {
  content: string;
  lineRefs: LineRefInput[];
};

type ChapterInput = {
  id: string;
  order: number;
  title: string;
  summary: string;
  hunkRefs: HunkRefInput[];
  keyChanges: KeyChangeInput[];
};

type CommittedScopeInput = {
  kind: "committed";
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
};

type WorkingTreeScopeInput = {
  kind: "workingTree";
  ref: string;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
};

type ScopeInput = CommittedScopeInput | WorkingTreeScopeInput;

type FixtureInput = {
  scope: ScopeInput;
  chapters: ChapterInput[];
  generatedAt: string;
};

function makeLineRef(over: Partial<LineRefInput> = {}): LineRefInput {
  return {
    filePath: "src/foo.ts",
    side: "additions",
    startLine: 5,
    endLine: 10,
    ...over,
  };
}

function makeHunkRef(over: Partial<HunkRefInput> = {}): HunkRefInput {
  return { filePath: "src/foo.ts", oldStart: 1, ...over };
}

function makeKeyChange(over: Partial<KeyChangeInput> = {}): KeyChangeInput {
  return {
    content: "Should orgId fall back to the user's primary org when not provided?",
    lineRefs: [makeLineRef()],
    ...over,
  };
}

function makeChapter(over: Partial<ChapterInput> = {}): ChapterInput {
  return {
    id: "chapter-0",
    order: 1,
    title: "Wire org ID through the API layer",
    summary: "Threads orgId through the request handlers so multi-tenant queries scope correctly.",
    hunkRefs: [makeHunkRef()],
    keyChanges: [makeKeyChange()],
    ...over,
  };
}

function makeCommittedScope(
  over: Partial<Omit<CommittedScopeInput, "kind">> = {},
): CommittedScopeInput {
  return {
    kind: "committed",
    baseSha: "1111111111111111111111111111111111111111",
    headSha: "2222222222222222222222222222222222222222",
    mergeBaseSha: "3333333333333333333333333333333333333333",
    ...over,
  };
}

function makeWorkingTreeScope(
  over: Partial<Omit<WorkingTreeScopeInput, "kind">> = {},
): WorkingTreeScopeInput {
  return {
    kind: "workingTree",
    ref: "work",
    baseSha: "1111111111111111111111111111111111111111",
    headSha: "2222222222222222222222222222222222222222",
    mergeBaseSha: "3333333333333333333333333333333333333333",
    ...over,
  };
}

function makeFixture(over: Partial<FixtureInput> = {}): FixtureInput {
  return {
    scope: makeCommittedScope(),
    chapters: [makeChapter()],
    generatedAt: "2026-04-26T12:00:00.000Z",
    ...over,
  };
}

function pathsOf(result: ReturnType<typeof ChaptersFileSchema.safeParse>): string[] {
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join("."));
}

describe("ChaptersFileSchema", () => {
  describe("valid inputs", () => {
    it("accepts a known-good committed-scope fixture", () => {
      const result = ChaptersFileSchema.parse(makeFixture());
      expect(result.scope.kind).toBe("committed");
      expect(result.chapters).toHaveLength(1);
      expect(result.scope.mergeBaseSha).toBe("3333333333333333333333333333333333333333");
      const firstSide = result.chapters[0]?.keyChanges[0]?.lineRefs[0]?.side;
      expect(firstSide).toBe("additions");
    });

    it("accepts a known-good workingTree-scope fixture with a live work ref", () => {
      const fixture = makeFixture({ scope: makeWorkingTreeScope() });
      const result = ChaptersFileSchema.parse(fixture);
      expect(result.scope.kind).toBe("workingTree");
      if (result.scope.kind === "workingTree") {
        expect(result.scope.ref).toBe("work");
      }
    });

    it("accepts staged and unstaged workingTree refs", () => {
      expect(() =>
        ChaptersFileSchema.parse(makeFixture({ scope: makeWorkingTreeScope({ ref: "staged" }) })),
      ).not.toThrow();
      expect(() =>
        ChaptersFileSchema.parse(makeFixture({ scope: makeWorkingTreeScope({ ref: "unstaged" }) })),
      ).not.toThrow();
    });

    it("accepts an empty chapters array", () => {
      expect(() => ChaptersFileSchema.parse(makeFixture({ chapters: [] }))).not.toThrow();
    });

    it("accepts a chapter with empty hunkRefs", () => {
      const fixture = makeFixture({ chapters: [makeChapter({ hunkRefs: [] })] });
      expect(() => ChaptersFileSchema.parse(fixture)).not.toThrow();
    });

    it("accepts a chapter with empty keyChanges", () => {
      const fixture = makeFixture({ chapters: [makeChapter({ keyChanges: [] })] });
      expect(() => ChaptersFileSchema.parse(fixture)).not.toThrow();
    });

    it("accepts oldStart = 0 (fully-new files)", () => {
      const fixture = makeFixture({
        chapters: [makeChapter({ hunkRefs: [makeHunkRef({ oldStart: 0 })] })],
      });
      expect(() => ChaptersFileSchema.parse(fixture)).not.toThrow();
    });

    it("accepts startLine === endLine (single-line range)", () => {
      const fixture = makeFixture({
        chapters: [
          makeChapter({
            keyChanges: [
              makeKeyChange({ lineRefs: [makeLineRef({ startLine: 7, endLine: 7 })] }),
            ],
          }),
        ],
      });
      expect(() => ChaptersFileSchema.parse(fixture)).not.toThrow();
    });

    it("accepts deletions side", () => {
      const fixture = makeFixture({
        chapters: [
          makeChapter({
            keyChanges: [makeKeyChange({ lineRefs: [makeLineRef({ side: "deletions" })] })],
          }),
        ],
      });
      expect(() => ChaptersFileSchema.parse(fixture)).not.toThrow();
    });
  });

  describe("rejects malformed inputs with field path", () => {
    it("rejects when a top-level required field is missing", () => {
      const { chapters: _chapters, ...withoutChapters } = makeFixture();
      const result = ChaptersFileSchema.safeParse(withoutChapters);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters");
    });

    it("rejects when scope.kind is missing", () => {
      const { kind: _kind, ...scopeWithoutKind } = makeCommittedScope();
      const fixture = { ...makeFixture(), scope: scopeWithoutKind };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.kind");
    });

    it("rejects when scope.kind is unknown", () => {
      const fixture = {
        ...makeFixture(),
        scope: { ...makeCommittedScope(), kind: "garbage" as unknown as "committed" },
      };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.kind");
    });

    it("rejects top-level diff", () => {
      const fixture = { ...makeFixture(), diff: "should not be accepted" };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("");
    });

    it("rejects committed scope with extraneous diff", () => {
      const fixture = {
        ...makeFixture(),
        scope: { ...makeCommittedScope(), diff: "should not be accepted" },
      };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope");
    });

    it("rejects workingTree scope without ref", () => {
      const { ref: _ref, ...scopeWithoutRef } = makeWorkingTreeScope();
      const fixture = { ...makeFixture(), scope: scopeWithoutRef };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.ref");
    });

    it("rejects unknown workingTree ref", () => {
      const fixture = makeFixture({ scope: makeWorkingTreeScope({ ref: "tracked" }) });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.ref");
    });

    it("rejects when scope.mergeBaseSha is missing (committed variant)", () => {
      const { mergeBaseSha: _mb, ...scopeWithoutMergeBase } = makeCommittedScope();
      const fixture = { ...makeFixture(), scope: scopeWithoutMergeBase };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.mergeBaseSha");
    });

    it("rejects empty headSha in scope (workingTree variant)", () => {
      const fixture = makeFixture({ scope: makeWorkingTreeScope({ headSha: "" }) });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.headSha");
    });

    it("rejects ref-like SHA values", () => {
      const fixture = makeFixture({ scope: makeCommittedScope({ headSha: "HEAD" }) });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("scope.headSha");
    });

    it("rejects wrong type on chapters", () => {
      const fixture = { ...makeFixture(), chapters: 42 };
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters");
    });

    it("rejects wrong type on oldStart (string instead of number)", () => {
      const fixture = makeFixture({
        chapters: [
          makeChapter({
            hunkRefs: [{ filePath: "src/foo.ts", oldStart: "1" as unknown as number }],
          }),
        ],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.hunkRefs.0.oldStart");
    });

    it("rejects negative startLine", () => {
      const fixture = makeFixture({
        chapters: [
          makeChapter({
            keyChanges: [makeKeyChange({ lineRefs: [makeLineRef({ startLine: -5 })] })],
          }),
        ],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.keyChanges.0.lineRefs.0.startLine");
    });

    it("rejects negative oldStart", () => {
      const fixture = makeFixture({
        chapters: [makeChapter({ hunkRefs: [makeHunkRef({ oldStart: -1 })] })],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.hunkRefs.0.oldStart");
    });

    it("rejects inverted range (startLine > endLine)", () => {
      const fixture = makeFixture({
        chapters: [
          makeChapter({
            keyChanges: [
              makeKeyChange({ lineRefs: [makeLineRef({ startLine: 100, endLine: 5 })] }),
            ],
          }),
        ],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.keyChanges.0.lineRefs.0.endLine");
    });

    it("rejects non-ISO generatedAt", () => {
      const fixture = makeFixture({ generatedAt: "yesterday" });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("generatedAt");
    });

    it("rejects empty filePath in hunkRef", () => {
      const fixture = makeFixture({
        chapters: [makeChapter({ hunkRefs: [makeHunkRef({ filePath: "" })] })],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.hunkRefs.0.filePath");
    });

    it("rejects unknown side value", () => {
      const fixture = makeFixture({
        chapters: [
          makeChapter({
            keyChanges: [makeKeyChange({ lineRefs: [makeLineRef({ side: "context" })] })],
          }),
        ],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.keyChanges.0.lineRefs.0.side");
    });

    it("rejects a keyChange with empty lineRefs", () => {
      const fixture = makeFixture({
        chapters: [makeChapter({ keyChanges: [makeKeyChange({ lineRefs: [] })] })],
      });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.keyChanges.0.lineRefs");
    });

    it("rejects non-integer order", () => {
      const fixture = makeFixture({ chapters: [makeChapter({ order: 1.5 })] });
      const result = ChaptersFileSchema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(pathsOf(result)).toContain("chapters.0.order");
    });
  });
});
