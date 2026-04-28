import {
  type AnnotatedLineRef,
  COMMENT_SIDE,
  DIFF_SIDE,
  type LineRef,
  SIDE_TO_DIFF,
} from "@/lib/diff-types";
import {
  type FileDiffMetadata,
  type Hunk,
  type SelectedLineRange,
  getSingularPatch,
} from "@pierre/diffs";
import { FileDiff, PatchDiff } from "@pierre/diffs/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { LineHighlightOverlay } from "./hunk-highlight-overlay";

type AppTheme = "light" | "dark";

const DEFAULT_SYNTAX_THEME_LIGHT = "pierre-light";
const DEFAULT_SYNTAX_THEME_DARK = "pierre-dark";

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
 * Returns `null` when hunks are non-contiguous because Pierre cannot resolve
 * a selection range that spans collapsed (non-rendered) lines between hunks.
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
  return {
    first: firstHunk.additionStart,
    last: lastHunk.additionStart + lastHunk.additionCount - 1,
  };
}

type PierreDiffViewerProps = {
  filePath?: string;
  selectedLines?: SelectedLineRange | null;
  expandUnchanged?: boolean;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  /** All key change line refs grouped by file path. */
  allLineRefsByFile?: Map<string, AnnotatedLineRef[]> | null;
  /** Currently focused key change line refs grouped by file path. */
  focusedLineRefsByFile?: Map<string, LineRef[]> | null;
  focusedKeyChangeId?: string | null;
  viewedKeyChangeIds?: Set<string>;
  onToggleKeyChangeViewed?: (keyChangeId: string) => void;
  onFocusKeyChange?: (keyChangeId: string | null, scrollTarget?: LineRef | null) => void;
  /** Force a specific theme. Defaults to detecting `.dark` on `<html>`. */
  appTheme?: AppTheme;
} & ({ patch: string; fileDiff?: never } | { patch?: never; fileDiff: FileDiffMetadata });

const noop = () => {};

export function PierreDiffViewer({
  patch,
  fileDiff,
  filePath,
  selectedLines: selectedLinesProp,
  expandUnchanged = false,
  onLineSelected,
  allLineRefsByFile,
  focusedLineRefsByFile,
  focusedKeyChangeId = null,
  viewedKeyChangeIds,
  onToggleKeyChangeViewed,
  onFocusKeyChange,
  appTheme: appThemeProp,
}: PierreDiffViewerProps) {
  const appTheme = useAppTheme(appThemeProp);
  const deferredExpandUnchanged = useDeferredValue(expandUnchanged);

  const diffContainerRef = useRef<HTMLDivElement>(null);

  const isHoveringRef = useRef(false);

  // Suppress onLineSelected during hover — Pierre fires it when the selectedLines
  // prop changes, but hover highlights shouldn't trigger any selection logic.
  const guardedOnLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      if (isHoveringRef.current) return;
      if (!range) {
        onLineSelected?.(null);
        return;
      }
      const normalized: SelectedLineRange =
        range.start <= range.end
          ? range
          : {
              start: range.end,
              side: range.endSide ?? range.side,
              end: range.start,
              endSide: range.side,
            };
      onLineSelected?.(normalized);
    },
    [onLineSelected],
  );

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
      theme: appTheme === "dark" ? DEFAULT_SYNTAX_THEME_DARK : DEFAULT_SYNTAX_THEME_LIGHT,
      themeType: appTheme,
      diffStyle: "split" as const,
      disableFileHeader: true,
      expandUnchanged: deferredExpandUnchanged,
      expansionLineCount: 20,
      overflow: "wrap" as const,
      enableLineSelection: true,
      enableHoverUtility: false,
      onLineSelected: guardedOnLineSelected,
    }),
    [appTheme, deferredExpandUnchanged, guardedOnLineSelected],
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
  const overlay =
    hasLineRefs && viewedKeyChangeIds ? (
      <LineHighlightOverlay
        allLineRefs={allAnnotatedLineRefs}
        focusedLineRefs={focusedLineRefs}
        focusedKeyChangeId={focusedKeyChangeId}
        viewedKeyChangeIds={viewedKeyChangeIds}
        onToggleKeyChangeViewed={onToggleKeyChangeViewed ?? noop}
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
