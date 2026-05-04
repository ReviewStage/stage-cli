import type { LineRef } from "@stagereview/types/chapters";
import type { AnnotatedLineRef } from "./diff-types";

// `externalId` (not `id`) because that's what view-state, the side panel, and
// the chapter detail page's focus state all key on. Annotating with the
// internal DB id would silently break overlay ↔ side-panel sync: a side-panel
// click sets focus to externalId, while an overlay click would set it to id,
// and view-state checked-state lookups would never find the row.
interface KeyChangeWithLineRefs {
	externalId: string;
	lineRefs: LineRef[];
}

export function groupLineRefsByFile<T extends LineRef>(
	lineRefs: readonly T[] | null | undefined,
): Map<string, T[]> | null {
	if (!lineRefs || lineRefs.length === 0) return null;

	const map = new Map<string, T[]>();
	for (const lineRef of lineRefs) {
		let refsForFile = map.get(lineRef.filePath);
		if (!refsForFile) {
			refsForFile = [];
			map.set(lineRef.filePath, refsForFile);
		}
		refsForFile.push(lineRef);
	}
	return map;
}

export function groupAnnotatedLineRefsByFile(
	keyChanges: readonly KeyChangeWithLineRefs[] | null | undefined,
): Map<string, AnnotatedLineRef[]> | null {
	if (!keyChanges || keyChanges.length === 0) return null;
	return groupLineRefsByFile(
		keyChanges.flatMap((keyChange) =>
			keyChange.lineRefs.map(
				(lineRef): AnnotatedLineRef => ({ ...lineRef, keyChangeId: keyChange.externalId }),
			),
		),
	);
}
