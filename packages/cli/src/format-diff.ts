import { type Hunk, LINE_TYPE, type LineType } from "@stagereview/types/parsed-diff";

const LINE_PREFIX: Partial<Record<LineType, string>> = {
	[LINE_TYPE.ADDITION]: "+",
	[LINE_TYPE.DELETION]: "-",
};

export function formatHunkDiff(hunk: Hunk): string {
	return hunk.lines.map((line) => `${LINE_PREFIX[line.type] ?? " "}${line.content}`).join("\n");
}

export function formatHunkDiffWithLineNumbers(hunk: Hunk): string {
	const maxOld = hunk.oldStart + Math.max(hunk.oldLines - 1, 0);
	const maxNew = hunk.newStart + Math.max(hunk.newLines - 1, 0);
	const colWidth = Math.max(String(maxOld).length, String(maxNew).length);

	return hunk.lines
		.map((line) => {
			const prefix = LINE_PREFIX[line.type] ?? " ";
			const oldNum =
				line.oldLineNumber != null
					? String(line.oldLineNumber).padStart(colWidth)
					: " ".repeat(colWidth);
			const newNum =
				line.newLineNumber != null
					? String(line.newLineNumber).padStart(colWidth)
					: " ".repeat(colWidth);
			return `${oldNum} ${newNum} |${prefix}${line.content}`;
		})
		.join("\n");
}

export function countHunkLines(hunk: Hunk): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const line of hunk.lines) {
		if (line.type === LINE_TYPE.ADDITION) added++;
		else if (line.type === LINE_TYPE.DELETION) deleted++;
	}
	return { added, deleted };
}
