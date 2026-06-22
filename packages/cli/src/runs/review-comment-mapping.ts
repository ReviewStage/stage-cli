import { GITHUB_DIFF_SIDE, type GitHubDiffSide, type ReviewComment } from "../github/index.js";
import { DIFF_SIDE, type DiffSide } from "../schema.js";

// LEFT is GitHub's base/deletion side, RIGHT the head/addition side.
export function toGitHubSide(side: DiffSide): GitHubDiffSide {
	return side === DIFF_SIDE.DELETIONS ? GITHUB_DIFF_SIDE.LEFT : GITHUB_DIFF_SIDE.RIGHT;
}

export function fromGitHubSide(side: GitHubDiffSide | null | undefined): DiffSide {
	return side === GITHUB_DIFF_SIDE.LEFT ? DIFF_SIDE.DELETIONS : DIFF_SIDE.ADDITIONS;
}

export interface PulledThread {
	root: ReviewComment;
	replies: ReviewComment[];
	filePath: string;
	side: DiffSide;
	startLine: number;
	endLine: number;
}

/**
 * Group flat review comments into threads. GitHub sets `in_reply_to_id` on every
 * reply, pointing at the thread's root. Comments without an anchorable line
 * (outdated, or whole-file) are dropped — the local model is line-anchored.
 */
export function groupReviewComments(comments: ReviewComment[]): PulledThread[] {
	const repliesByRoot = new Map<number, ReviewComment[]>();
	const roots: ReviewComment[] = [];
	for (const c of comments) {
		if (c.in_reply_to_id != null) {
			const list = repliesByRoot.get(c.in_reply_to_id);
			if (list) list.push(c);
			else repliesByRoot.set(c.in_reply_to_id, [c]);
		} else {
			roots.push(c);
		}
	}
	const threads: PulledThread[] = [];
	for (const root of roots) {
		if (root.line == null) continue;
		const replies = (repliesByRoot.get(root.id) ?? []).sort((a, b) =>
			a.created_at.localeCompare(b.created_at),
		);
		threads.push({
			root,
			replies,
			filePath: root.path,
			side: fromGitHubSide(root.side),
			startLine: root.start_line ?? root.line,
			endLine: root.line,
		});
	}
	return threads;
}
