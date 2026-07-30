import type { CommentThread } from "@stagereview/types/comments";
import type { GitHubThread } from "@stagereview/types/github-threads";

// An anchorable GitHub thread — same as GitHubThread but with `anchor` narrowed
// to non-null, since that's the only kind that lands in `byFile`.
type AnchoredGitHubThread = GitHubThread & { anchor: NonNullable<GitHubThread["anchor"]> };

// One entry in the diff's annotation stream: either a local thread (note or
// pending) or an anchorable GitHub thread. The discriminant lets thread
// components pick data source and capabilities (edit/delete vs reply/resolve).
export type DisplayThread =
	| { kind: "local"; thread: CommentThread }
	| { kind: "github"; thread: AnchoredGitHubThread };

export interface MergedThreads {
	byFile: ReadonlyMap<string, DisplayThread[]>;
	/** GitHub threads that can't anchor inline (outdated head, mixed sides). */
	outdated: GitHubThread[];
}

function startLine(entry: DisplayThread): number {
	return entry.kind === "local" ? entry.thread.startLine : entry.thread.anchor.startLine;
}

export function mergeThreads(local: CommentThread[], github: GitHubThread[]): MergedThreads {
	const byFile = new Map<string, DisplayThread[]>();
	const outdated: GitHubThread[] = [];
	const push = (filePath: string, entry: DisplayThread) => {
		const list = byFile.get(filePath);
		if (list) list.push(entry);
		else byFile.set(filePath, [entry]);
	};
	for (const thread of local) push(thread.filePath, { kind: "local", thread });
	for (const thread of github) {
		if (thread.anchor === null) outdated.push(thread);
		else push(thread.filePath, { kind: "github", thread: { ...thread, anchor: thread.anchor } });
	}
	for (const list of byFile.values()) list.sort((a, b) => startLine(a) - startLine(b));
	return { byFile, outdated };
}
