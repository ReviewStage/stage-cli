import { useCallback, useRef } from "react";
import type { FileDiffListHandle } from "@/components/files/file-diff-list";
import type { PullRequestFile } from "@/lib/diff-types";
import { useCurrentFile } from "@/lib/use-current-file";
import { useFileCollapseKeys } from "@/lib/use-file-collapse-keys";
import { useFileKeyboardModeExitKey } from "@/lib/use-file-keyboard-mode-exit-key";
import { useFileNavigationKeys } from "@/lib/use-file-navigation-keys";
import { useFileViewedKey } from "@/lib/use-file-viewed-key";

interface FileCollapseControls {
	collapsedFiles: Set<string>;
	toggleFileCollapsed: (filePath: string) => void;
	collapseAllFiles: () => void;
	expandAllFiles: () => void;
}

interface UseFileDiffNavigationOptions {
	/** Files in the order they should be navigated — tree order, reading order, etc. */
	files: PullRequestFile[];
	/** Marks a file viewed/unviewed. PR-wide on the Files tab, chapter-scoped on a chapter. */
	onToggleViewed: (filePath: string) => void;
	/** Collapse controls for the same set of files (PR-level or chapter-scoped). */
	collapse: FileCollapseControls;
	/** Base gate for every shortcut, ANDed with a non-empty file list. Defaults to true. */
	enabled?: boolean;
	/** Extra gate for `v`: until viewed state is writable, toggling no-ops. Defaults to true. */
	canToggleViewed?: boolean;
}

/**
 * Wires keyboard-driven file navigation (j/k, v, ;, Shift+;, Esc) plus click-to-scroll
 * for a list-of-file-diffs view, keeping focus/selection in sync with the diff viewer's
 * scroll position.
 *
 * The Files-changed tab and the chapter detail page render the same {@link FileDiffList}
 * over a list of files; they differ only in the file ordering, the viewed-state and
 * collapse controls, and the enablement gates. This hook owns the shared wiring — the
 * diff viewer ref and the selection state the view binds to — and takes those
 * differences as inputs.
 */
export function useFileDiffNavigation({
	files,
	onToggleViewed,
	collapse,
	enabled = true,
	canToggleViewed = true,
}: UseFileDiffNavigationOptions) {
	const diffListRef = useRef<FileDiffListHandle>(null);
	const { currentFilePath, keyboardFocusedFilePath, selectFile, focusFile, clearKeyboardFocus } =
		useCurrentFile(files);

	const handleSelectFile = useCallback(
		(filePath: string) => {
			if (!selectFile(filePath)) return;
			diffListRef.current?.scrollToFile(filePath);
		},
		[selectFile],
	);

	const handleKeyboardFocusFile = useCallback(
		(filePath: string) => {
			focusFile(filePath);
			diffListRef.current?.scrollToFile(filePath);
		},
		[focusFile],
	);

	// `v` marks the file viewed and advances focus to the next file so the user
	// can keep pressing `v`. The just-marked file stays pinned to the top so the
	// view doesn't jump as files collapse.
	const handleMarkViewedAndAdvance = useCallback(
		(markedFilePath: string, nextFilePath: string | undefined) => {
			onToggleViewed(markedFilePath);
			focusFile(nextFilePath ?? markedFilePath);
			diffListRef.current?.scrollToFile(markedFilePath);
		},
		[onToggleViewed, focusFile],
	);

	const { collapsedFiles, toggleFileCollapsed, collapseAllFiles, expandAllFiles } = collapse;
	const handleToggleCollapsed = useCallback(
		(filePath: string) => {
			toggleFileCollapsed(filePath);
			focusFile(filePath);
		},
		[toggleFileCollapsed, focusFile],
	);

	const hasFiles = files.length > 0;
	const navEnabled = enabled && hasFiles;
	const allCollapsed = hasFiles && collapsedFiles.size >= files.length;

	useFileNavigationKeys(files, currentFilePath, handleKeyboardFocusFile, navEnabled);
	// Gate `v` on viewed-state readiness so advancing never walks past files
	// without marking them.
	useFileViewedKey(
		files,
		currentFilePath,
		handleMarkViewedAndAdvance,
		navEnabled && canToggleViewed,
	);
	useFileCollapseKeys(
		files,
		currentFilePath,
		handleToggleCollapsed,
		collapseAllFiles,
		expandAllFiles,
		allCollapsed,
		navEnabled,
	);
	useFileKeyboardModeExitKey(clearKeyboardFocus, navEnabled);

	// Stable wrappers around the viewer's imperative scroll API so callers can drive
	// line-level scrolling from effects without reaching into `diffListRef.current`
	// themselves (which the dependency linter can't see through across the boundary).
	const scrollToLine = useCallback((...args: Parameters<FileDiffListHandle["scrollToLine"]>) => {
		diffListRef.current?.scrollToLine(...args);
	}, []);
	const cancelScrollToLine = useCallback(() => {
		diffListRef.current?.cancelScrollToLine();
	}, []);

	return {
		diffListRef,
		currentFilePath,
		keyboardFocusedFilePath,
		selectFile,
		handleSelectFile,
		scrollToLine,
		cancelScrollToLine,
	};
}
