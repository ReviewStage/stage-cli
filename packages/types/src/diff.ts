export interface FileContent {
	/** Full content of the file on the old/deletion side. `null` for added files. */
	oldContent: string | null;
	/** Full content of the file on the new/addition side. `null` for deleted files. */
	newContent: string | null;
	/**
	 * How the content strings are encoded. Absent means UTF-8 text; "base64"
	 * is used for binary image files so the browser can render them.
	 */
	encoding?: "base64";
}

/** Map from file path (new-side, post-rename) to full file contents. */
export type FileContentsMap = Record<string, FileContent>;

export interface DiffResponse {
	/** Raw unified diff patch text. */
	patch: string;
	/** Per-file full content for context expansion. */
	fileContents: FileContentsMap;
}
