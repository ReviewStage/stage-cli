export const DIFF_SIDE = {
	ADDITIONS: "additions",
	DELETIONS: "deletions",
} as const;
export type DiffSide = (typeof DIFF_SIDE)[keyof typeof DIFF_SIDE];

export const COMMENT_SIDE = {
	LEFT: "LEFT",
	RIGHT: "RIGHT",
} as const;
export type CommentSide = (typeof COMMENT_SIDE)[keyof typeof COMMENT_SIDE];

export const SUBJECT_TYPE = {
	LINE: "LINE",
	FILE: "FILE",
} as const;
export type SubjectType = (typeof SUBJECT_TYPE)[keyof typeof SUBJECT_TYPE];

export const FILE_STATUS = {
	ADDED: "added",
	MODIFIED: "modified",
	DELETED: "deleted",
	RENAMED: "renamed",
	MOVED: "moved",
} as const;
export type FileStatus = (typeof FILE_STATUS)[keyof typeof FILE_STATUS];

export interface DiffLineRecord {
	type: "context" | "addition" | "deletion" | "header";
	content: string;
	oldLineNumber?: number;
	newLineNumber?: number;
}

export interface HunkRecord {
	header: string;
	oldStart: number;
	newStart: number;
	oldLines: number;
	newLines: number;
	lines: DiffLineRecord[];
}

export interface PullRequestFile {
	path: string;
	oldPath?: string;
	filename: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	hunks: HunkRecord[];
	patch?: string;
	isSymlink?: boolean;
	symlinkTarget?: string;
	oldSymlinkTarget?: string;
}

export interface LineRef {
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
}

export interface AnnotatedLineRef extends LineRef {
	keyChangeId: string;
}

export const SIDE_TO_DIFF: Record<CommentSide, DiffSide> = {
	[COMMENT_SIDE.LEFT]: DIFF_SIDE.DELETIONS,
	[COMMENT_SIDE.RIGHT]: DIFF_SIDE.ADDITIONS,
};
