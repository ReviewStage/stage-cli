import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ChapterRunRow } from "./db/schema/chapter-run.js";
import { SCOPE_KIND, type Scope, WORKING_TREE_REF } from "./schema.js";

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

export function buildDiffArgs(run: ChapterRunRow): string[] {
	if (run.scopeKind === SCOPE_KIND.COMMITTED) {
		return ["diff", "--no-color", `${run.baseSha}..${run.headSha}`];
	}
	if (run.workingTreeRef === null) {
		throw new Error("workingTree run is missing workingTreeRef");
	}
	switch (run.workingTreeRef) {
		case WORKING_TREE_REF.UNSTAGED:
			return ["diff", "--no-color"];
		case WORKING_TREE_REF.STAGED:
			return ["diff", "--no-color", "--cached"];
		case WORKING_TREE_REF.WORK:
			return ["diff", "--no-color", "HEAD"];
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

export function detectBaseRef(): string {
	const candidates: string[][] = [
		["rev-parse", "--abbrev-ref", "origin/HEAD"],
		["rev-parse", "--verify", "main"],
		["rev-parse", "--verify", "master"],
		["rev-parse", "--verify", "origin/main"],
		["rev-parse", "--verify", "origin/master"],
	];

	for (const args of candidates) {
		try {
			const out = execFileSync("git", args, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			if (out) return out;
		} catch {
			// try next candidate
		}
	}

	throw new Error(
		"No default branch detected. Tried origin/HEAD, main, master, origin/main, and origin/master.",
	);
}

export function resolveMergeBase(base: string): string {
	return execFileSync("git", ["merge-base", base, "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

export function resolveHead(): string {
	return execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

export function getRawDiff(args: string[]): string {
	return execFileSync("git", ["diff", "--no-color", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		maxBuffer: 50 * 1024 * 1024,
	});
}

export function getUntrackedFiles(): string[] {
	const out = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
	return out ? out.split("\n") : [];
}

function hasStringStdout(err: unknown): err is { stdout: string } {
	return (
		typeof err === "object" && err !== null && "stdout" in err && typeof err.stdout === "string"
	);
}

export function getUntrackedDiff(files: string[]): string {
	const patches: string[] = [];
	for (const file of files) {
		try {
			execFileSync("git", ["diff", "--no-index", "--no-color", "--", "/dev/null", file], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch (err: unknown) {
			if (hasStringStdout(err)) {
				patches.push(err.stdout);
			}
		}
	}
	return patches.join("\n");
}

export function getCommitMessages(mergeBase: string): string {
	return execFileSync("git", ["log", "--oneline", `${mergeBase}..HEAD`], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

export function hasUncommittedChanges(): boolean {
	const out = execFileSync("git", ["status", "--porcelain"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
	return out.length > 0;
}

export interface ResolvedScope {
	scope: Scope;
	mergeBaseSha: string;
	rawDiff: string;
}

export function resolveScope(): ResolvedScope {
	const base = detectBaseRef();
	const mergeBaseSha = resolveMergeBase(base);
	const headSha = resolveHead();
	const uncommitted = hasUncommittedChanges();

	if (uncommitted) {
		let rawDiff = getRawDiff([mergeBaseSha]);
		const untrackedFiles = getUntrackedFiles();
		if (untrackedFiles.length > 0) {
			const untrackedDiff = getUntrackedDiff(untrackedFiles);
			if (untrackedDiff) {
				rawDiff = rawDiff ? `${rawDiff}\n${untrackedDiff}` : untrackedDiff;
			}
		}
		return {
			scope: {
				kind: SCOPE_KIND.WORKING_TREE,
				ref: WORKING_TREE_REF.WORK,
				baseSha: mergeBaseSha,
				headSha,
				mergeBaseSha,
			},
			mergeBaseSha,
			rawDiff,
		};
	}

	return {
		scope: {
			kind: SCOPE_KIND.COMMITTED,
			baseSha: mergeBaseSha,
			headSha,
			mergeBaseSha,
		},
		mergeBaseSha,
		rawDiff: getRawDiff([`${mergeBaseSha}..${headSha}`]),
	};
}
