import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Manages file collapse state using a symmetric-difference (XOR) model:
 * the visible collapsed set is `defaultCollapsedIds XOR overrides`.
 *
 * When defaults change (e.g. a file is marked viewed), overrides that now
 * conflict are pruned so already-collapsed files stay collapsed and
 * already-expanded files stay expanded.
 */
export function useFileCollapseState(
	defaultCollapsedIds: ReadonlySet<string>,
	allFilePaths: readonly string[],
	resetKey: string,
) {
	const [overrides, setOverrides] = useState<Set<string>>(new Set());
	const prevResetKey = useRef(resetKey);
	if (prevResetKey.current !== resetKey) {
		prevResetKey.current = resetKey;
		setOverrides(new Set());
	}

	// When a file transitions in/out of defaults, any existing override for it
	// would flip the intended state (XOR). Remove stale overrides so the
	// visible collapsed set stays consistent with the user's last action.
	const prevDefaultsRef = useRef(defaultCollapsedIds);
	if (prevDefaultsRef.current !== defaultCollapsedIds) {
		const prev = prevDefaultsRef.current;
		prevDefaultsRef.current = defaultCollapsedIds;
		setOverrides((current) => {
			let pruned: Set<string> | null = null;
			for (const id of current) {
				const wasDefault = prev.has(id);
				const isDefault = defaultCollapsedIds.has(id);
				if (wasDefault !== isDefault) {
					pruned ??= new Set(current);
					pruned.delete(id);
				}
			}
			return pruned ?? current;
		});
	}

	const collapsedFiles = useMemo(() => {
		const result = new Set(defaultCollapsedIds);
		for (const id of overrides) {
			if (result.has(id)) {
				result.delete(id);
			} else {
				result.add(id);
			}
		}
		return result;
	}, [defaultCollapsedIds, overrides]);

	const toggleFileCollapsed = useCallback((filePath: string) => {
		setOverrides((prev) => {
			const next = new Set(prev);
			if (next.has(filePath)) {
				next.delete(filePath);
			} else {
				next.add(filePath);
			}
			return next;
		});
	}, []);

	const collapseAllFiles = useCallback(() => {
		// Overrides XOR defaults = all file paths → overrides = paths NOT in defaults
		const next = new Set<string>();
		for (const path of allFilePaths) {
			if (!defaultCollapsedIds.has(path)) {
				next.add(path);
			}
		}
		setOverrides(next);
	}, [allFilePaths, defaultCollapsedIds]);

	const expandAllFiles = useCallback(() => {
		// Overrides XOR defaults = empty → overrides = defaults (cancels them out)
		setOverrides(new Set(defaultCollapsedIds));
	}, [defaultCollapsedIds]);

	return useMemo(
		() => ({ collapsedFiles, toggleFileCollapsed, collapseAllFiles, expandAllFiles }),
		[collapsedFiles, toggleFileCollapsed, collapseAllFiles, expandAllFiles],
	);
}
