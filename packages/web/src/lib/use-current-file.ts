import { useCallback, useEffect, useState } from "react";
import type { PullRequestFile } from "@/lib/diff-types";

export function useCurrentFile(files: PullRequestFile[]) {
	const [currentFilePath, setCurrentFilePath] = useState<string | undefined>();
	const [isFileKeyboardMode, setIsFileKeyboardMode] = useState(false);

	useEffect(() => {
		if (currentFilePath === undefined) return;
		if (files.some((file) => file.path === currentFilePath)) return;
		setCurrentFilePath(undefined);
		setIsFileKeyboardMode(false);
	}, [files, currentFilePath]);

	const selectFile = useCallback(
		(filePath: string) => {
			if (!files.some((file) => file.path === filePath)) return false;
			setCurrentFilePath(filePath);
			setIsFileKeyboardMode(false);
			return true;
		},
		[files],
	);

	const focusFile = useCallback(
		(filePath: string) => {
			if (!files.some((file) => file.path === filePath)) return false;
			setCurrentFilePath(filePath);
			setIsFileKeyboardMode(true);
			return true;
		},
		[files],
	);

	const clearKeyboardFocus = useCallback(() => {
		setIsFileKeyboardMode(false);
	}, []);

	return {
		currentFilePath,
		keyboardFocusedFilePath: isFileKeyboardMode ? currentFilePath : undefined,
		isFileKeyboardMode,
		selectFile,
		focusFile,
		clearKeyboardFocus,
	};
}
