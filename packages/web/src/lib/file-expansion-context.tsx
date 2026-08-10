import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";

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
 * Mirrors the hosted app's `expandedFiles` in its pull-request context.
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

	const prevResetKey = useRef(resetKey);
	if (prevResetKey.current !== resetKey) {
		prevResetKey.current = resetKey;
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
