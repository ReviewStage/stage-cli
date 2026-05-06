import type {
	DiffLine,
	FileStatus,
	Hunk,
	LineType,
	PullRequestFile,
} from "@stagereview/types/parsed-diff";
import { FILE_STATUS, LINE_TYPE } from "@stagereview/types/parsed-diff";
import parseDiff from "parse-diff";

interface ParseDiffFile {
	from?: string;
	to?: string;
	additions: number;
	deletions: number;
	new?: boolean;
	deleted?: boolean;
	chunks: ParseDiffChunk[];
}

interface ParseDiffChunk {
	content: string;
	changes: ParseDiffChange[];
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
}

interface ParseDiffChange {
	type: "add" | "del" | "normal";
	content: string;
	ln?: number;
	ln1?: number;
	ln2?: number;
}

function determineFileStatus(file: ParseDiffFile): FileStatus {
	if (file.new) return FILE_STATUS.ADDED;
	if (file.deleted) return FILE_STATUS.DELETED;
	if (file.from !== file.to && file.from && file.to) {
		const hasContentChanges = file.additions > 0 || file.deletions > 0;
		return hasContentChanges ? FILE_STATUS.RENAMED : FILE_STATUS.MOVED;
	}
	return FILE_STATUS.MODIFIED;
}

function getFilePath(file: ParseDiffFile): string {
	if (file.deleted) {
		if (!file.from) throw new Error("Deleted file is missing 'from' path");
		return file.from.replace(/^a\//, "");
	}
	const filePath = file.to ?? file.from;
	if (!filePath) throw new Error("File is missing both 'to' and 'from' paths");
	return filePath.replace(/^[ab]\//, "");
}

function getFilename(filePath: string): string {
	return filePath.split("/").at(-1) ?? filePath;
}

function transformChange(change: ParseDiffChange): DiffLine {
	let type: LineType;
	let oldLineNumber: number | undefined;
	let newLineNumber: number | undefined;

	switch (change.type) {
		case "add":
			type = LINE_TYPE.ADDITION;
			newLineNumber = change.ln;
			break;
		case "del":
			type = LINE_TYPE.DELETION;
			oldLineNumber = change.ln;
			break;
		default:
			type = LINE_TYPE.CONTEXT;
			oldLineNumber = change.ln1;
			newLineNumber = change.ln2;
	}

	let content = change.content;
	if (content.startsWith("+") || content.startsWith("-") || content.startsWith(" ")) {
		content = content.slice(1);
	}

	return { type, content, oldLineNumber, newLineNumber };
}

function transformChunk(chunk: ParseDiffChunk): Hunk {
	return {
		header: chunk.content,
		oldStart: chunk.oldStart,
		newStart: chunk.newStart,
		oldLines: chunk.oldLines,
		newLines: chunk.newLines,
		lines: chunk.changes.map(transformChange),
	};
}

function getOldPath(file: ParseDiffFile): string | undefined {
	if (!file.from) return undefined;
	return file.from.replace(/^a\//, "");
}

function isSymlinkPatch(patch: string): boolean {
	const headerEnd = patch.indexOf("@@");
	const header = headerEnd === -1 ? patch : patch.slice(0, headerEnd);
	return /(?:new file mode|deleted file mode|old mode|new mode|index [0-9a-f]+\.\.[0-9a-f]+) 120000\b/m.test(
		header,
	);
}

function extractSymlinkTargets(file: ParseDiffFile): {
	symlinkTarget: string | undefined;
	oldSymlinkTarget: string | undefined;
} {
	let symlinkTarget: string | undefined;
	let oldSymlinkTarget: string | undefined;

	for (const chunk of file.chunks) {
		for (const change of chunk.changes) {
			const content = change.content.replace(/^[+-]/, "").trim();
			if (content === "\\ No newline at end of file") continue;
			if (change.type === "add" && file.additions === 1) {
				symlinkTarget = content;
			} else if (change.type === "del" && file.deletions === 1) {
				oldSymlinkTarget = content;
			}
		}
	}

	return { symlinkTarget, oldSymlinkTarget };
}

function transformFile(file: ParseDiffFile, patch: string): PullRequestFile {
	const filePath = getFilePath(file);
	const status = determineFileStatus(file);
	const isPathChange = status === FILE_STATUS.RENAMED || status === FILE_STATUS.MOVED;
	const isSymlink = isSymlinkPatch(patch);

	return {
		path: filePath,
		oldPath: isPathChange ? getOldPath(file) : undefined,
		filename: getFilename(filePath),
		status,
		additions: file.additions,
		deletions: file.deletions,
		hunks: file.chunks.map(transformChunk),
		patch,
		...(isSymlink && {
			isSymlink: true,
			...extractSymlinkTargets(file),
		}),
	};
}

function findNextDiffMarker(text: string, startIndex: number): number {
	const marker = "diff --git ";
	let pos = startIndex;

	while (pos < text.length) {
		const idx = text.indexOf(marker, pos);
		if (idx === -1) return -1;
		if (idx === 0 || text[idx - 1] === "\n") return idx;
		pos = idx + marker.length;
	}

	return -1;
}

function splitRawPatches(diffOutput: string): string[] {
	const patches: string[] = [];
	let start = findNextDiffMarker(diffOutput, 0);

	while (start !== -1) {
		const next = findNextDiffMarker(diffOutput, start + 1);
		const segment = next === -1 ? diffOutput.slice(start) : diffOutput.slice(start, next);
		patches.push(segment.trimEnd());
		start = next;
	}

	return patches;
}

export function parseGitDiff(diffOutput: string): PullRequestFile[] {
	if (!diffOutput || diffOutput.trim() === "") {
		return [];
	}

	const rawPatches = splitRawPatches(diffOutput);
	return rawPatches.map((patch, index) => {
		const parsed = parseDiff(patch) as ParseDiffFile[];
		const file = parsed[0];
		if (!file) {
			throw new Error(`Failed to parse patch at index ${index}`);
		}
		return transformFile(file, patch);
	});
}

export function calculateDiffStats(files: PullRequestFile[]): {
	totalAdditions: number;
	totalDeletions: number;
	fileCount: number;
} {
	return files.reduce(
		(acc, file) => ({
			totalAdditions: acc.totalAdditions + file.additions,
			totalDeletions: acc.totalDeletions + file.deletions,
			fileCount: acc.fileCount + 1,
		}),
		{ totalAdditions: 0, totalDeletions: 0, fileCount: 0 },
	);
}
