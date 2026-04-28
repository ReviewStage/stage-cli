import {
  type FileDiffMetadata,
  getSingularPatch,
  type Hunk,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  type AnnotatedLineRef,
  COMMENT_SIDE,
  DIFF_SIDE,
  type LineRef,
  SIDE_TO_DIFF,
} from "@/lib/diff-types";
import { resolveSyntaxTheme } from "@/lib/syntax-themes";
import { useDiffSettings } from "@/lib/use-diff-settings";
import { LineHighlightOverlay } from "./hunk-highlight-overlay";

type AppTheme = "light" | "dark";

function detectAppTheme(): AppTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useAppTheme(override?: AppTheme): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => override ?? detectAppTheme());

  useEffect(() => {
    if (override) {
      setTheme(override);
      return;
    }
    if (typeof document === "undefined") return;

    const update = () => setTheme(detectAppTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [override]);

  return theme;
}

/**
 * Computes the first and last addition-side line numbers that are actually
 * rendered in the diff DOM. Lines between hunks are collapsed and don't have
 * DOM nodes, so we must use real hunk boundaries.
 *
 * Returns `null` when hunks are non-contiguous (Pierre cannot resolve a range
 * that spans collapsed lines between hunks) or when the addition side has no
 * lines (deletion-only hunks, e.g. fully-deleted files).
 */
export function getVisibleLineRange(
  hunks: Hunk[],
  expandUnchanged = false,
): { first: number; last: number } | null {
  if (hunks.length === 0) return null;
  if (!expandUnchanged) {
    for (let i = 1; i < hunks.length; i++) {
      const prev = hunks[i - 1];
      const curr = hunks[i];
      if (!prev || !curr) continue;
      const prevEnd = prev.additionStart + prev.additionCount;
      if (curr.additionStart !== prevEnd) return null;
    }
  }
  const firstHunk = hunks[0];
  const lastHunk = hunks[hunks.length - 1];
  if (!firstHunk || !lastHunk) return null;
  if (firstHunk.additionCount === 0 || lastHunk.additionCount === 0) return null;
  return {
    first: firstHunk.additionStart,
    last: lastHunk.additionStart + lastHunk.additionCount - 1,
  };
}

type PierreDiffViewerProps = {
  filePath?: string;
  selectedLines?: SelectedLineRange | null;
  expandUnchanged?: boolean;
  /** All key change line refs grouped by file path. */
  allLineRefsByFile?: Map<string, AnnotatedLineRef[]> | null;
  /** Currently focused key change line refs grouped by file path. */
  focusedLineRefsByFile?: Map<string, LineRef[]> | null;
  focusedKeyChangeId?: string | null;
  isKeyChangeChecked?: (keyChangeId: string) => boolean;
  onMarkKeyChangeChecked?: (keyChangeId: string) => void;
  onUnmarkKeyChangeChecked?: (keyChangeId: string) => void;
  onFocusKeyChange?: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
  /** Force a specific theme. Defaults to detecting `.dark` on `<html>`. */
  appTheme?: AppTheme;
} & ({ patch: string; fileDiff?: never } | { patch?: never; fileDiff: FileDiffMetadata });

const noop = () => {};
const noopChecked = () => false;

export function PierreDiffViewer({
  patch,
  fileDiff,
  filePath,
  selectedLines: selectedLinesProp,
  expandUnchanged = false,
  allLineRefsByFile,
  focusedLineRefsByFile,
  focusedKeyChangeId = null,
  isKeyChangeChecked,
  onMarkKeyChangeChecked,
  onUnmarkKeyChangeChecked,
  onFocusKeyChange,
  appTheme: appThemeProp,
}: PierreDiffViewerProps) {
  const appTheme = useAppTheme(appThemeProp);
  const { viewMode, diffIndicators, lineDiffType, backgrounds, wrap, lineNumbers, syntaxTheme } =
    useDiffSettings();

  // Defer settings so UI controls update instantly while the expensive diff
  // re-renders at lower priority.
  const deferredViewMode = useDeferredValue(viewMode);
  const deferredIndicators = useDeferredValue(diffIndicators);
  const deferredLineDiffType = useDeferredValue(lineDiffType);
  const deferredBackgrounds = useDeferredValue(backgrounds);
  const deferredWrap = useDeferredValue(wrap);
  const deferredLineNumbers = useDeferredValue(lineNumbers);
  const deferredSyntaxTheme = useDeferredValue(syntaxTheme);
  const deferredExpandUnchanged = useDeferredValue(expandUnchanged);

  const diffContainerRef = useRef<HTMLDivElement>(null);

  const focusedLineRefs = useMemo(() => {
    if (!focusedLineRefsByFile || !filePath) return undefined;
    return focusedLineRefsByFile.get(filePath);
  }, [focusedLineRefsByFile, filePath]);

  const allAnnotatedLineRefs = useMemo(() => {
    if (!allLineRefsByFile || !filePath) return undefined;
    return allLineRefsByFile.get(filePath);
  }, [allLineRefsByFile, filePath]);

  const options = useMemo(
    () => ({
      theme: resolveSyntaxTheme(deferredSyntaxTheme, appTheme),
      themeType: appTheme,
      diffStyle: deferredViewMode,
      diffIndicators: deferredIndicators,
      lineDiffType: deferredLineDiffType,
      disableBackground: !deferredBackgrounds,
      disableFileHeader: true,
      disableLineNumbers: !deferredLineNumbers,
      expandUnchanged: deferredExpandUnchanged,
      expansionLineCount: 20,
      overflow: deferredWrap ? ("wrap" as const) : ("scroll" as const),
      enableLineSelection: true,
      enableHoverUtility: false,
    }),
    [
      appTheme,
      deferredSyntaxTheme,
      deferredViewMode,
      deferredIndicators,
      deferredLineDiffType,
      deferredBackgrounds,
      deferredWrap,
      deferredLineNumbers,
      deferredExpandUnchanged,
    ],
  );

  const sharedProps = {
    options,
    selectedLines: selectedLinesProp ?? null,
  };

  // Only mount the overlay when this file actually has refs to highlight.
  // The overlay's click-listener effect polls for Pierre's shadow root on
  // mount, so leaving it on for every diff (e.g. plain /files view, chapter
  // files with no key changes) adds unnecessary work per file.
  const hasLineRefs = (allAnnotatedLineRefs?.length ?? 0) > 0 || (focusedLineRefs?.length ?? 0) > 0;
  const overlay = hasLineRefs ? (
    <LineHighlightOverlay
      allLineRefs={allAnnotatedLineRefs}
      focusedLineRefs={focusedLineRefs}
      focusedKeyChangeId={focusedKeyChangeId}
      isKeyChangeChecked={isKeyChangeChecked ?? noopChecked}
      onMarkKeyChangeChecked={onMarkKeyChangeChecked ?? noop}
      onUnmarkKeyChangeChecked={onUnmarkKeyChangeChecked ?? noop}
      onFocusKeyChange={onFocusKeyChange ?? noop}
      containerRef={diffContainerRef}
    />
  ) : null;

  if (fileDiff) {
    return (
      <div
        className="@container/diff relative isolate overflow-hidden rounded-b-lg border-x border-b border-border"
        ref={diffContainerRef}
      >
        <FileDiff fileDiff={fileDiff} {...sharedProps} />
        {overlay}
      </div>
    );
  }

  return (
    <div
      className="@container/diff relative isolate overflow-hidden rounded-b-lg border-x border-b border-border"
      ref={diffContainerRef}
    >
      <PatchDiff patch={patch} {...sharedProps} />
      {overlay}
    </div>
  );
}

/**
 * Re-exported helper for chapter container components: derive the addition-side
 * line range that covers a key change's hunks. Uses {@link getVisibleLineRange}
 * to clamp to the rendered surface and bail when hunks are non-contiguous.
 */
export function getKeyChangeFileLineRange(
  hunks: Hunk[],
  expandUnchanged = false,
): SelectedLineRange | null {
  const visibleRange = getVisibleLineRange(hunks, expandUnchanged);
  if (!visibleRange) return null;
  return {
    start: visibleRange.first,
    side: SIDE_TO_DIFF[COMMENT_SIDE.RIGHT],
    end: visibleRange.last,
    endSide: SIDE_TO_DIFF[COMMENT_SIDE.RIGHT],
  };
}

/**
 * Look up the hunk containing a line on the addition or deletion side. Useful
 * for parents that need to clamp a selection to its hunk before passing it in.
 */
export function findContainingHunk(
  hunks: Hunk[],
  line: number,
  side: (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE],
): Hunk | undefined {
  return hunks.find((hunk) => {
    const start = side === DIFF_SIDE.ADDITIONS ? hunk.additionStart : hunk.deletionStart;
    const count = side === DIFF_SIDE.ADDITIONS ? hunk.additionCount : hunk.deletionCount;
    return line >= start && line < start + count;
  });
}

/**
 * Re-export {@link getSingularPatch} so chapter parents can pre-compute hunks
 * without taking a direct dependency on `@pierre/diffs`.
 */
export { getSingularPatch };
