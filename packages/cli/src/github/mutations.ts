import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	PULL_REQUEST_MERGE_METHOD,
	type PullRequestMergeMethod,
} from "@stagereview/types/pull-request";
import type { GitHubRepo } from "./repo.js";

const execFileAsync = promisify(execFile);

/**
 * Run a `gh` write command in `repoRoot`. Unlike the read adapters in
 * pull-request.ts (which swallow errors to null), writes surface failures so
 * the UI can toast them — the user explicitly asked to mutate their PR.
 */
async function ghWrite(args: string[], repoRoot: string): Promise<void> {
	try {
		await execFileAsync("gh", args, { cwd: repoRoot, encoding: "utf8" });
	} catch (err: unknown) {
		const stderr =
			typeof err === "object" && err !== null && "stderr" in err && typeof err.stderr === "string"
				? err.stderr.trim()
				: "";
		throw new Error(stderr || (err instanceof Error ? err.message : "gh command failed"));
	}
}

const MERGE_METHOD_FLAG: Record<PullRequestMergeMethod, string> = {
	[PULL_REQUEST_MERGE_METHOD.MERGE]: "--merge",
	[PULL_REQUEST_MERGE_METHOD.SQUASH]: "--squash",
	[PULL_REQUEST_MERGE_METHOD.REBASE]: "--rebase",
};

export function editTitle(repoRoot: string, number: number, title: string): Promise<void> {
	return ghWrite(["pr", "edit", String(number), "--title", title], repoRoot);
}

export function closePullRequest(repoRoot: string, number: number): Promise<void> {
	return ghWrite(["pr", "close", String(number)], repoRoot);
}

export function reopenPullRequest(repoRoot: string, number: number): Promise<void> {
	return ghWrite(["pr", "reopen", String(number)], repoRoot);
}

export function setDraft(repoRoot: string, number: number, draft: boolean): Promise<void> {
	// `gh pr ready` marks ready; `--undo` converts back to draft.
	const args = ["pr", "ready", String(number)];
	if (draft) args.push("--undo");
	return ghWrite(args, repoRoot);
}

export function mergePullRequest(
	repoRoot: string,
	number: number,
	mergeMethod: PullRequestMergeMethod,
	expectedHeadOid?: string,
): Promise<void> {
	const args = ["pr", "merge", String(number), MERGE_METHOD_FLAG[mergeMethod]];
	if (expectedHeadOid) args.push("--match-head-commit", expectedHeadOid);
	return ghWrite(args, repoRoot);
}

/**
 * Enable/disable auto-merge. On merge-queue repos `gh pr merge --auto` enqueues
 * when ready, so the UI's enqueue/dequeue toggles map onto this too.
 */
export function setAutoMerge(
	repoRoot: string,
	number: number,
	enabled: boolean,
	mergeMethod?: PullRequestMergeMethod,
	expectedHeadOid?: string,
): Promise<void> {
	if (!enabled) return ghWrite(["pr", "merge", String(number), "--disable-auto"], repoRoot);
	const args = ["pr", "merge", String(number), "--auto"];
	if (mergeMethod) args.push(MERGE_METHOD_FLAG[mergeMethod]);
	// Guard against enabling auto-merge for a stale head the user hasn't seen.
	if (expectedHeadOid) args.push("--match-head-commit", expectedHeadOid);
	return ghWrite(args, repoRoot);
}

export function addReviewers(repoRoot: string, number: number, logins: string[]): Promise<void> {
	return ghWrite(["pr", "edit", String(number), "--add-reviewer", logins.join(",")], repoRoot);
}

export function removeReviewers(repoRoot: string, number: number, logins: string[]): Promise<void> {
	return ghWrite(["pr", "edit", String(number), "--remove-reviewer", logins.join(",")], repoRoot);
}

const COLLABORATOR_FIELDS = "login,type,avatar_url";

interface Collaborator {
	login: string;
	avatar_url: string;
	type: string;
}

/** Repo collaborators eligible as reviewers, for the reviewer picker. */
export async function listCollaborators(
	repoRoot: string,
	repo: GitHubRepo,
): Promise<Collaborator[]> {
	try {
		const { stdout } = await execFileAsync(
			"gh",
			[
				"api",
				`repos/${repo.owner}/${repo.repo}/collaborators`,
				"--paginate",
				"--jq",
				`[.[] | {${COLLABORATOR_FIELDS}}]`,
			],
			{ cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
		);
		// --paginate with --jq emits one JSON array per page; concat them.
		const collaborators: Collaborator[] = [];
		for (const line of stdout.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const page: unknown = JSON.parse(trimmed);
			if (Array.isArray(page)) {
				for (const c of page) {
					if (
						c &&
						typeof c.login === "string" &&
						typeof c.avatar_url === "string" &&
						typeof c.type === "string"
					) {
						collaborators.push({ login: c.login, avatar_url: c.avatar_url, type: c.type });
					}
				}
			}
		}
		return collaborators;
	} catch {
		return [];
	}
}
