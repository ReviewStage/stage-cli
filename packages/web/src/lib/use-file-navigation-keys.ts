import { useEffect } from "react";
import type { PullRequestFile } from "./diff-types";
import { isEditableTarget } from "./keyboard";

const TOPBAR_HEIGHT = 48;
const TABBAR_HEIGHT = 48;
const VIEWPORT_OFFSET = TOPBAR_HEIGHT + TABBAR_HEIGHT + 16;

/**
 * Keyboard navigation between files (j/k). Skips when the focus is inside an
 * editable input so users can still type freely in the file-picker filter.
 */
export function useFileNavigationKeys(
	files: PullRequestFile[],
	onSelectFile: (filePath: string) => void,
	enabled: boolean,
): void {
	useEffect(() => {
		if (!enabled || files.length === 0) return;

		function handler(event: KeyboardEvent): void {
			if (event.key !== "j" && event.key !== "k") return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (isEditableTarget(event.target)) return;

			const currentFilePath = findCurrentFile(files);
			if (!currentFilePath) {
				const first = files[0];
				if (first) onSelectFile(first.path);
				event.preventDefault();
				return;
			}

			const idx = files.findIndex((f) => f.path === currentFilePath);
			if (idx === -1) return;

			if (event.key === "j" && idx < files.length - 1) {
				const next = files[idx + 1];
				if (next) {
					onSelectFile(next.path);
					event.preventDefault();
				}
			} else if (event.key === "k" && idx > 0) {
				const prev = files[idx - 1];
				if (prev) {
					onSelectFile(prev.path);
					event.preventDefault();
				}
			}
		}

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [files, onSelectFile, enabled]);
}

function findCurrentFile(files: PullRequestFile[]): string | null {
	const viewportTop = VIEWPORT_OFFSET;
	const viewportBottom = window.innerHeight;

	for (const file of files) {
		const element = document.getElementById(`file-${file.path}`);
		if (!element) continue;

		const rect = element.getBoundingClientRect();
		if (
			(rect.top <= viewportTop && rect.bottom >= viewportTop) ||
			(rect.top >= viewportTop && rect.top <= viewportBottom)
		) {
			return file.path;
		}
	}

	// Fall back to the last file that has scrolled above the viewport.
	for (let i = files.length - 1; i >= 0; i--) {
		const file = files[i];
		if (!file) continue;
		const element = document.getElementById(`file-${file.path}`);
		if (!element) continue;
		if (element.getBoundingClientRect().top < viewportTop) return file.path;
	}
	return null;
}
