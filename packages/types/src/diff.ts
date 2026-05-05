export interface FileContent {
	/** Full content of the file on the old/deletion side. `null` for added files. */
	oldContent: string | null;
	/** Full content of the file on the new/addition side. `null` for deleted files. */
	newContent: string | null;
}

/** Map from file path (new-side, post-rename) to full file contents. */
export type FileContentsMap = Record<string, FileContent>;

export interface DiffResponse {
	/** Raw unified diff patch text. */
	patch: string;
	/** Per-file full content for context expansion. */
	fileContents: FileContentsMap;
}
