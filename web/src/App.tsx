import { FileHeader, PierreDiffViewer } from "@/components/chapter";
import {
  type AnnotatedLineRef,
  DIFF_SIDE,
  FILE_STATUS,
  type LineRef,
  type PullRequestFile,
} from "@/lib/diff-types";
import { useCallback, useMemo, useState } from "react";

const SAMPLE_PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,5 +1,7 @@
-export function greet(name: string) {
-  return "Hello, " + name + "!";
+export function greet(name: string): string {
+  if (!name) {
+    throw new Error("name is required");
+  }
+  return \`Hello, \${name}!\`;
 }
`;

const SAMPLE_FILE: PullRequestFile = {
  path: "src/greet.ts",
  filename: "greet.ts",
  status: FILE_STATUS.MODIFIED,
  additions: 5,
  deletions: 2,
  hunks: [],
  patch: SAMPLE_PATCH,
};

const KEY_CHANGE_ID = "kc-1";

const FIXTURE_LINE_REFS: AnnotatedLineRef[] = [
  {
    keyChangeId: KEY_CHANGE_ID,
    filePath: SAMPLE_FILE.path,
    side: DIFF_SIDE.ADDITIONS,
    startLine: 2,
    endLine: 4,
  },
];

const ALL_LINE_REFS_BY_FILE: Map<string, AnnotatedLineRef[]> = new Map([
  [SAMPLE_FILE.path, FIXTURE_LINE_REFS],
]);

export function App() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isViewed, setIsViewed] = useState(false);
  const [viewedKeyChangeIds, setViewedKeyChangeIds] = useState<Set<string>>(new Set());
  const [focusedKeyChangeId, setFocusedKeyChangeId] = useState<string | null>(null);

  const focusedLineRefsByFile = useMemo<Map<string, LineRef[]> | null>(() => {
    if (focusedKeyChangeId !== KEY_CHANGE_ID) return null;
    return new Map([
      [
        SAMPLE_FILE.path,
        FIXTURE_LINE_REFS.map(
          (ref): LineRef => ({
            filePath: ref.filePath,
            side: ref.side,
            startLine: ref.startLine,
            endLine: ref.endLine,
          }),
        ),
      ],
    ]);
  }, [focusedKeyChangeId]);

  const onToggleKeyChangeViewed = useCallback((keyChangeId: string) => {
    setViewedKeyChangeIds((prev) => {
      const next = new Set(prev);
      if (next.has(keyChangeId)) {
        next.delete(keyChangeId);
      } else {
        next.add(keyChangeId);
      }
      return next;
    });
  }, []);

  const onFocusKeyChange = useCallback((keyChangeId: string | null) => {
    setFocusedKeyChangeId(keyChangeId);
  }, []);

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Chapter UI fixture</h1>
        <p className="text-muted-foreground text-sm">
          Hand-crafted prop data exercising the vendored chapter components.
        </p>
        <div>
          <FileHeader
            file={SAMPLE_FILE}
            isCollapsed={isCollapsed}
            isExpanded={isExpanded}
            isViewed={isViewed}
            onToggle={() => setIsCollapsed((prev) => !prev)}
            onToggleAll={() => setIsCollapsed((prev) => !prev)}
            onToggleExpand={() => setIsExpanded((prev) => !prev)}
            onComment={() => {}}
            onToggleViewed={() => setIsViewed((prev) => !prev)}
          />
          {!isCollapsed && (
            <PierreDiffViewer
              patch={SAMPLE_PATCH}
              filePath={SAMPLE_FILE.path}
              expandUnchanged={isExpanded}
              allLineRefsByFile={ALL_LINE_REFS_BY_FILE}
              focusedLineRefsByFile={focusedLineRefsByFile}
              focusedKeyChangeId={focusedKeyChangeId}
              viewedKeyChangeIds={viewedKeyChangeIds}
              onToggleKeyChangeViewed={onToggleKeyChangeViewed}
              onFocusKeyChange={onFocusKeyChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
