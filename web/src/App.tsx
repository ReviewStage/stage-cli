import { useCallback, useMemo, useState } from "react";
import { FileHeader, PierreDiffViewer } from "@/components/chapter";
import {
  type AnnotatedLineRef,
  DIFF_SIDE,
  FILE_STATUS,
  type LineRef,
  type PullRequestFile,
} from "@/lib/diff-types";
import { DiffSettingsProvider } from "@/lib/use-diff-settings";

const SAMPLE_PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,6 @@
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

function ChapterFixture() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isViewed, setIsViewed] = useState(false);
  const [checkedKeyChangeIds, setCheckedKeyChangeIds] = useState<Set<string>>(new Set());
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

  const isKeyChangeChecked = useCallback(
    (id: string) => checkedKeyChangeIds.has(id),
    [checkedKeyChangeIds],
  );

  const onMarkKeyChangeChecked = useCallback((id: string) => {
    setCheckedKeyChangeIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const onUnmarkKeyChangeChecked = useCallback((id: string) => {
    setCheckedKeyChangeIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const onFocusKeyChange = useCallback((id: string | null) => setFocusedKeyChangeId(id), []);

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="font-semibold text-2xl">Chapter UI fixture</h1>
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
              isKeyChangeChecked={isKeyChangeChecked}
              onMarkKeyChangeChecked={onMarkKeyChangeChecked}
              onUnmarkKeyChangeChecked={onUnmarkKeyChangeChecked}
              onFocusKeyChange={onFocusKeyChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <DiffSettingsProvider>
      <ChapterFixture />
    </DiffSettingsProvider>
  );
}
