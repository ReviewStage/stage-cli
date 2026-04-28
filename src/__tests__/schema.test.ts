import { describe, expect, it } from "vitest";
import { ChaptersFileSchema } from "../schema.js";

const SHA = {
  base: "1111111111111111111111111111111111111111",
  head: "2222222222222222222222222222222222222222",
  mergeBase: "3333333333333333333333333333333333333333",
} as const;

function makeLineRef(over: Record<string, unknown> = {}) {
  return {
    filePath: "src/foo.ts",
    side: "additions",
    startLine: 5,
    endLine: 10,
    ...over,
  };
}

function makeHunkRef(over: Record<string, unknown> = {}) {
  return { filePath: "src/foo.ts", oldStart: 1, ...over };
}

function makeKeyChange(over: Record<string, unknown> = {}) {
  return {
    content: "Should orgId fall back to the user's primary org when not provided?",
    lineRefs: [makeLineRef()],
    ...over,
  };
}

function makeChapter(over: Record<string, unknown> = {}) {
  return {
    id: "chapter-0",
    order: 1,
    title: "Wire org ID through the API layer",
    summary: "Threads orgId through request handlers so tenant queries scope correctly.",
    hunkRefs: [makeHunkRef()],
    keyChanges: [makeKeyChange()],
    ...over,
  };
}

function makeCommittedScope(over: Record<string, unknown> = {}) {
  return {
    kind: "committed",
    baseSha: SHA.base,
    headSha: SHA.head,
    mergeBaseSha: SHA.mergeBase,
    ...over,
  };
}

function makeWorkingTreeScope(over: Record<string, unknown> = {}) {
  return {
    kind: "workingTree",
    ref: "work",
    baseSha: SHA.base,
    headSha: SHA.head,
    mergeBaseSha: SHA.mergeBase,
    ...over,
  };
}

function makeFixture(over: Record<string, unknown> = {}) {
  return {
    scope: makeCommittedScope(),
    chapters: [makeChapter()],
    generatedAt: "2026-04-26T12:00:00.000Z",
    ...over,
  };
}

function expectInvalidAt(input: unknown, path: string) {
  const result = ChaptersFileSchema.safeParse(input);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(path);
  }
}

describe("ChaptersFileSchema", () => {
  it("accepts the committed-scope chapters contract", () => {
    const result = ChaptersFileSchema.parse(makeFixture());

    expect(result.scope.kind).toBe("committed");
    expect(result.scope.mergeBaseSha).toBe(SHA.mergeBase);
    expect(result.chapters[0]?.keyChanges[0]?.lineRefs[0]?.side).toBe("additions");
  });

  it.each(["work", "staged", "unstaged"] as const)(
    "accepts workingTree scope for %s changes",
    (ref) => {
      const result = ChaptersFileSchema.parse(
        makeFixture({ scope: makeWorkingTreeScope({ ref }) }),
      );

      expect(result.scope.kind).toBe("workingTree");
      if (result.scope.kind === "workingTree") {
        expect(result.scope.ref).toBe(ref);
      }
    },
  );

  it("allows empty chapter lists and chapters without anchored hunks", () => {
    expect(() => ChaptersFileSchema.parse(makeFixture({ chapters: [] }))).not.toThrow();
    expect(() =>
      ChaptersFileSchema.parse(
        makeFixture({ chapters: [makeChapter({ hunkRefs: [], keyChanges: [] })] }),
      ),
    ).not.toThrow();
  });

  it("rejects stored diff payloads", () => {
    expectInvalidAt({ ...makeFixture(), diff: "diff --git ..." }, "");
    expectInvalidAt(
      makeFixture({ scope: { ...makeCommittedScope(), diff: "diff --git ..." } }),
      "scope",
    );
    expectInvalidAt(
      makeFixture({ scope: { ...makeWorkingTreeScope(), diff: "diff --git ..." } }),
      "scope",
    );
  });

  it("rejects non-canonical scope references", () => {
    expectInvalidAt(
      makeFixture({ scope: makeCommittedScope({ headSha: "HEAD" }) }),
      "scope.headSha",
    );
    expectInvalidAt(
      makeFixture({ scope: makeCommittedScope({ headSha: SHA.head.slice(0, 7) }) }),
      "scope.headSha",
    );
    expectInvalidAt(
      makeFixture({
        scope: makeCommittedScope({
          headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".toUpperCase(),
        }),
      }),
      "scope.headSha",
    );
    expectInvalidAt(makeFixture({ scope: makeWorkingTreeScope({ ref: "tracked" }) }), "scope.ref");
  });

  it("rejects unparseable generatedAt timestamps", () => {
    expectInvalidAt(makeFixture({ generatedAt: "yesterday" }), "generatedAt");
  });

  it("rejects line references the UI cannot anchor safely", () => {
    expectInvalidAt(
      makeFixture({
        chapters: [
          makeChapter({
            keyChanges: [
              makeKeyChange({ lineRefs: [makeLineRef({ startLine: 100, endLine: 5 })] }),
            ],
          }),
        ],
      }),
      "chapters.0.keyChanges.0.lineRefs.0.endLine",
    );
    expectInvalidAt(
      makeFixture({
        chapters: [makeChapter({ keyChanges: [makeKeyChange({ lineRefs: [] })] })],
      }),
      "chapters.0.keyChanges.0.lineRefs",
    );
  });
});
