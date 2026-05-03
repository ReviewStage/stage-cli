import { execFileSync } from "node:child_process";
import path from "node:path";

export class NotInGitRepoError extends Error {
	constructor() {
		super("stage-cli must be run inside a git repository");
		this.name = "NotInGitRepoError";
	}
}

/**
 * Snapshot of the git context a chapter run was generated against. Captured
 * at import time and stored on `chapter_run` so the run keeps reading
 * consistently even if the repo's remote is later renamed or detached.
 */
export interface RepoContext {
	/** Absolute path to the worktree root (`git rev-parse --show-toplevel`). */
	root: string;
	/** `origin` remote URL, or null when no `origin` is configured. */
	originUrl: string | null;
}

export function readRepoContext(): RepoContext {
	const root = readRepoRoot();
	return { root, originUrl: readOriginUrl(root) };
}

export function readRepoRoot(): string {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		throw new NotInGitRepoError();
	}
}

function readOriginUrl(repoRoot: string): string | null {
	try {
		const out = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out || null;
	} catch {
		return null;
	}
}

/**
 * Derive the repo's display name from its origin URL, falling back to the
 * worktree directory's basename when the URL is missing or unparseable.
 *
 * Handles the URL shapes git emits in practice:
 *   git@github.com:owner/repo(.git)
 *   https://github.com/owner/repo(.git)
 *   ssh://git@github.com/owner/repo(.git)
 */
export function parseRepoName(originUrl: string | null, repoRoot: string): string {
	if (originUrl) {
		const trimmed = originUrl.replace(/\.git$/, "");
		const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf(":"));
		const segment = trimmed.slice(lastSeparator + 1);
		if (segment) return segment;
	}
	return path.basename(repoRoot);
}
