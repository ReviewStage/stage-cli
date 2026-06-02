// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_STATUS, type PullRequestFile } from "@/lib/diff-types";
import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";
import { useCurrentFile } from "@/lib/use-current-file";
import { useFileCollapseKeys } from "@/lib/use-file-collapse-keys";
import { useFileDiffNavigation } from "@/lib/use-file-diff-navigation";
import { useFileKeyboardModeExitKey } from "@/lib/use-file-keyboard-mode-exit-key";
import { useFileNavigationKeys } from "@/lib/use-file-navigation-keys";
import { useFileViewedKey } from "@/lib/use-file-viewed-key";

const hotkeys = vi.hoisted(() => new Map<string, () => void>());

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: (hotkey: string, callback: () => void) => {
		hotkeys.set(hotkey, callback);
	},
}));

function file(path: string): PullRequestFile {
	return {
		path,
		filename: path,
		status: FILE_STATUS.MODIFIED,
		additions: 1,
		deletions: 0,
		hunks: [],
	};
}

function press(hotkey: string) {
	const callback = hotkeys.get(hotkey);
	expect(callback).toBeDefined();
	callback?.();
}

describe("explicit file focus shortcuts", () => {
	beforeEach(() => {
		hotkeys.clear();
	});

	it("keeps current file empty until explicitly set", () => {
		const files = [file("a.ts"), file("b.ts")];
		const { result } = renderHook(() => useCurrentFile(files));

		expect(result.current.currentFilePath).toBeUndefined();
		expect(result.current.keyboardFocusedFilePath).toBeUndefined();
		expect(result.current.isFileKeyboardMode).toBe(false);
	});

	it("tracks pointer-selected files without entering keyboard mode", () => {
		const files = [file("a.ts"), file("b.ts")];
		const { result } = renderHook(() => useCurrentFile(files));

		act(() => result.current.selectFile("b.ts"));

		expect(result.current.currentFilePath).toBe("b.ts");
		expect(result.current.keyboardFocusedFilePath).toBeUndefined();
		expect(result.current.isFileKeyboardMode).toBe(false);
	});

	it("tracks keyboard-focused files and exposes the diff focus target", () => {
		const files = [file("a.ts"), file("b.ts")];
		const { result } = renderHook(() => useCurrentFile(files));

		act(() => result.current.focusFile("b.ts"));

		expect(result.current.currentFilePath).toBe("b.ts");
		expect(result.current.keyboardFocusedFilePath).toBe("b.ts");
		expect(result.current.isFileKeyboardMode).toBe(true);
	});

	it("clears keyboard mode without clearing the current file", () => {
		const files = [file("a.ts"), file("b.ts")];
		const { result } = renderHook(() => useCurrentFile(files));

		act(() => result.current.focusFile("b.ts"));
		act(() => result.current.clearKeyboardFocus());

		expect(result.current.currentFilePath).toBe("b.ts");
		expect(result.current.keyboardFocusedFilePath).toBeUndefined();
		expect(result.current.isFileKeyboardMode).toBe(false);
	});

	it("clears current file and keyboard mode when the current file leaves the file set", () => {
		const files = [file("a.ts"), file("b.ts")];
		const { result, rerender } = renderHook(({ currentFiles }) => useCurrentFile(currentFiles), {
			initialProps: { currentFiles: files },
		});

		act(() => result.current.focusFile("b.ts"));
		expect(result.current.currentFilePath).toBe("b.ts");
		expect(result.current.isFileKeyboardMode).toBe(true);

		rerender({ currentFiles: [file("a.ts")] });
		expect(result.current.currentFilePath).toBeUndefined();
		expect(result.current.keyboardFocusedFilePath).toBeUndefined();
		expect(result.current.isFileKeyboardMode).toBe(false);
	});

	it("focuses the first file on j when no current file is selected", () => {
		const onFocusFile = vi.fn();
		renderHook(() => useFileNavigationKeys([file("a.ts"), file("b.ts")], undefined, onFocusFile));

		press(KEYBOARD_SHORTCUTS.NEXT_FILE.hotkey);

		expect(onFocusFile).toHaveBeenCalledWith("a.ts");
	});

	it("focuses the last file on k when no current file is selected", () => {
		const onFocusFile = vi.fn();
		renderHook(() => useFileNavigationKeys([file("a.ts"), file("b.ts")], undefined, onFocusFile));

		press(KEYBOARD_SHORTCUTS.PREV_FILE.hotkey);

		expect(onFocusFile).toHaveBeenCalledWith("b.ts");
	});

	it("moves relative to the current file for j and k", () => {
		const onFocusFile = vi.fn();
		const { rerender } = renderHook(
			({ currentFilePath }) =>
				useFileNavigationKeys(
					[file("a.ts"), file("b.ts"), file("c.ts")],
					currentFilePath,
					onFocusFile,
				),
			{ initialProps: { currentFilePath: "b.ts" } },
		);

		press(KEYBOARD_SHORTCUTS.NEXT_FILE.hotkey);
		expect(onFocusFile).toHaveBeenLastCalledWith("c.ts");

		rerender({ currentFilePath: "b.ts" });
		press(KEYBOARD_SHORTCUTS.PREV_FILE.hotkey);
		expect(onFocusFile).toHaveBeenLastCalledWith("a.ts");
	});

	it("keeps keyboard mode target at the file list boundaries", () => {
		const onFocusFile = vi.fn();
		const files = [file("a.ts"), file("b.ts")];
		const { rerender } = renderHook(
			({ currentFilePath }) => useFileNavigationKeys(files, currentFilePath, onFocusFile),
			{ initialProps: { currentFilePath: "a.ts" } },
		);

		press(KEYBOARD_SHORTCUTS.PREV_FILE.hotkey);
		expect(onFocusFile).toHaveBeenLastCalledWith("a.ts");

		rerender({ currentFilePath: "b.ts" });
		press(KEYBOARD_SHORTCUTS.NEXT_FILE.hotkey);
		expect(onFocusFile).toHaveBeenLastCalledWith("b.ts");
	});

	it("marks the first file as viewed when no file is focused", () => {
		const onMarkViewed = vi.fn();
		renderHook(() => useFileViewedKey([file("a.ts"), file("b.ts")], undefined, onMarkViewed));

		press(KEYBOARD_SHORTCUTS.MARK_FILE_AS_VIEWED.hotkey);

		expect(onMarkViewed).toHaveBeenCalledWith("a.ts", "b.ts");
	});

	it("marks the current file as viewed and reports the next file to advance to", () => {
		const onMarkViewed = vi.fn();
		renderHook(() =>
			useFileViewedKey([file("a.ts"), file("b.ts"), file("c.ts")], "b.ts", onMarkViewed),
		);

		press(KEYBOARD_SHORTCUTS.MARK_FILE_AS_VIEWED.hotkey);

		expect(onMarkViewed).toHaveBeenCalledWith("b.ts", "c.ts");
	});

	it("enables viewed keyboard toggling by default for writable viewed state", () => {
		const onToggleViewed = vi.fn();
		renderHook(() =>
			useFileDiffNavigation({
				files: [file("a.ts"), file("b.ts")],
				onToggleViewed,
				collapse: {
					collapsedFiles: new Set<string>(),
					toggleFileCollapsed: vi.fn(),
					collapseAllFiles: vi.fn(),
					expandAllFiles: vi.fn(),
				},
			}),
		);

		press(KEYBOARD_SHORTCUTS.MARK_FILE_AS_VIEWED.hotkey);

		expect(onToggleViewed).toHaveBeenCalledWith("a.ts");
	});

	it("reports no next file when marking the last file as viewed", () => {
		const onMarkViewed = vi.fn();
		renderHook(() => useFileViewedKey([file("a.ts"), file("b.ts")], "b.ts", onMarkViewed));

		press(KEYBOARD_SHORTCUTS.MARK_FILE_AS_VIEWED.hotkey);

		expect(onMarkViewed).toHaveBeenCalledWith("b.ts", undefined);
	});

	it("toggles the first file's collapse state when no file is focused", () => {
		const onToggleCollapsed = vi.fn();
		renderHook(() =>
			useFileCollapseKeys(
				[file("a.ts"), file("b.ts")],
				undefined,
				onToggleCollapsed,
				vi.fn(),
				vi.fn(),
				false,
			),
		);

		press(KEYBOARD_SHORTCUTS.TOGGLE_FILE_COLLAPSED.hotkey);

		expect(onToggleCollapsed).toHaveBeenCalledWith("a.ts");
	});

	it("toggles the current file's collapse state", () => {
		const onToggleCollapsed = vi.fn();
		renderHook(() =>
			useFileCollapseKeys(
				[file("a.ts"), file("b.ts")],
				"b.ts",
				onToggleCollapsed,
				vi.fn(),
				vi.fn(),
				false,
			),
		);

		press(KEYBOARD_SHORTCUTS.TOGGLE_FILE_COLLAPSED.hotkey);

		expect(onToggleCollapsed).toHaveBeenCalledWith("b.ts");
	});

	it("clears keyboard mode with Escape", () => {
		const onExitKeyboardMode = vi.fn();
		renderHook(() => useFileKeyboardModeExitKey(onExitKeyboardMode));

		press(KEYBOARD_SHORTCUTS.EXIT_FILE_KEYBOARD_MODE.hotkey);

		expect(onExitKeyboardMode).toHaveBeenCalled();
	});
});
