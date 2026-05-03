import { useCallback, useEffect, useRef, useState } from "react";
import type { PullRequestFile } from "./diff-types";

const HEADER_OFFSET = 96;
// Generous enough to outlast browser-defined smooth-scroll animations
// (typically 300–500ms) so the scrollend that fires when the click-driven
// scroll settles can't override the user's manual selection.
const MANUAL_SELECTION_SUPPRESS_MS = 800;

/**
 * Tracks which file diff is currently active based on scroll position.
 *
 * Uses `scrollend` events for reliable, flicker-free updates — the active file
 * advances once when scrolling settles, not continuously during the animation.
 *
 * Returns `activeFilePath` plus `setActiveFileManually` for clicks/keyboard nav.
 */
export function useActiveFileOnScroll(files: PullRequestFile[]) {
	const [activeFilePath, setActiveFilePath] = useState<string | undefined>();
	const suppressUntilRef = useRef(0);

	const setActiveFileManually = useCallback((path: string) => {
		setActiveFilePath(path);
		// Suppress the next scrollend so a click-driven smooth scroll doesn't
		// re-pick a different file when its animation settles.
		suppressUntilRef.current = Date.now() + MANUAL_SELECTION_SUPPRESS_MS;
	}, []);

	useEffect(() => {
		if (files.length === 0) return;

		const handleScrollEnd = () => {
			if (Date.now() < suppressUntilRef.current) return;

			const path = findActiveFile(files);
			if (path) setActiveFilePath(path);
		};

		handleScrollEnd();

		window.addEventListener("scrollend", handleScrollEnd, { passive: true });
		return () => window.removeEventListener("scrollend", handleScrollEnd);
	}, [files]);

	return { activeFilePath, setActiveFileManually };
}

function findActiveFile(files: PullRequestFile[]): string | undefined {
	let bestPath: string | undefined;
	let bestDistance = Infinity;

	for (const file of files) {
		const el = document.getElementById(`file-${file.path}`);
		if (!el) continue;

		const rect = el.getBoundingClientRect();
		const distance = rect.top - HEADER_OFFSET;
		// Element is a candidate if any part is still visible below the sticky header.
		if (rect.bottom > HEADER_OFFSET && Math.abs(distance) < bestDistance) {
			bestDistance = Math.abs(distance);
			bestPath = file.path;
		}
	}

	return bestPath;
}
