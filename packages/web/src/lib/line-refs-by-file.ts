import type { LineRef } from "@stage-cli/types/chapters";
import type { AnnotatedLineRef } from "./diff-types";

interface KeyChangeWithLineRefs {
	id: string;
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
				(lineRef): AnnotatedLineRef => ({ ...lineRef, keyChangeId: keyChange.id }),
			),
		),
	);
}
