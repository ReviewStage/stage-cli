import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";

interface FileExpansionContextValue {
	/** Files whose unchanged context is expanded (the header's expand toggle). */
	expandedFiles: ReadonlySet<string>;
	toggleFileExpanded: (filePath: string) => void;
}

const FileExpansionContext = createContext<FileExpansionContextValue | null>(null);

/**
 * Holds per-file "expand unchanged lines" state above the virtualized file
 * lists, keyed by file path. Virtuoso unmounts a file's row once it scrolls
 * beyond the overscan window, so state kept inside the row would be lost;
 * keeping it here means an expanded file stays expanded when its row remounts.
 */
export function FileExpansionProvider({
	resetKey,
	children,
}: {
	/** Clears all expansion state when it changes (navigating to a different run). */
	resetKey: string;
	children: ReactNode;
}) {
	const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(new Set());

	// React's "adjust state during render" pattern: the previous key lives in
	// state, not a ref — a ref mutated mid-render leaks when a concurrent
	// render is discarded, clearing expansion state for the wrong run.
	const [prevResetKey, setPrevResetKey] = useState(resetKey);
	if (prevResetKey !== resetKey) {
		setPrevResetKey(resetKey);
		setExpandedFiles(new Set());
	}

	const toggleFileExpanded = useCallback((filePath: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) {
				next.delete(filePath);
			} else {
				next.add(filePath);
			}
			return next;
		});
	}, []);

	const value = useMemo(
		() => ({ expandedFiles, toggleFileExpanded }),
		[expandedFiles, toggleFileExpanded],
	);

	return <FileExpansionContext value={value}>{children}</FileExpansionContext>;
}

export function useFileExpansion(): FileExpansionContextValue {
	const ctx = use(FileExpansionContext);
	if (!ctx) throw new Error("useFileExpansion must be used within a FileExpansionProvider");
	return ctx;
}
