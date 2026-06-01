import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	CHECK_CONCLUSION,
	CHECK_ITEM_SOURCE,
	type CheckItem,
	type ChecksResponse,
	type GitHubPullRequest,
	type MergeStatusInfo,
	PULL_REQUEST_CI_STATUS,
	PULL_REQUEST_REVIEW_STATUS,
	type PullRequestReviewSummary,
	REVIEW_STATE,
	REVIEWER_STATUS,
	type Reviewer,
	type ReviewerStatus,
} from "@stagereview/types/pull-request";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export interface GitHubRepo {
	owner: string;
	repo: string;
}

/**
 * Parse `owner`/`repo` from a github.com origin URL, or null for non-GitHub
 * remotes. Skips the `gh` invocation entirely for GitLab/Bitbucket/self-hosted
 * rather than shelling out only to have `gh` fail. Matches the URL shapes git
 * emits: git@github.com:owner/repo(.git), https://github.com/owner/repo(.git),
 * ssh://git@github.com/owner/repo(.git).
 */
export function parseGitHubRepo(originUrl: string | null): GitHubRepo | null {
	if (!originUrl) return null;
	const match = originUrl.match(/(?:^|@|\/\/)github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
	if (!match) return null;
	const [, owner, repo] = match;
	if (!owner || !repo) return null;
	return { owner, repo };
}

export function isGitHubRemote(originUrl: string | null): boolean {
	return parseGitHubRepo(originUrl) !== null;
}

async function gh(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout;
}

// ─── Pull request ─────────────────────────────────────────────────────────────

const GhAuthorSchema = z
	.object({ login: z.string(), is_bot: z.boolean().optional() })
	.nullable()
	.optional();

const GhPullRequestSchema = z.object({
	number: z.number(),
	title: z.string(),
	url: z.string(),
	state: z.enum(["OPEN", "CLOSED", "MERGED"]),
	isDraft: z.boolean(),
	mergedAt: z.string().nullable().optional(),
	createdAt: z.string(),
	author: GhAuthorSchema,
	headRefName: z.string(),
	headRefOid: z.string(),
	baseRefName: z.string(),
});

const PR_FIELDS = [
	"number",
	"title",
	"url",
	"state",
	"isDraft",
	"mergedAt",
	"createdAt",
	"author",
	"headRefName",
	"headRefOid",
	"baseRefName",
] as const;

/** GitHub serves a user/org avatar at `https://github.com/<login>.png`. */
function avatarUrlForLogin(login: string): string {
	return `https://github.com/${encodeURIComponent(login)}.png`;
}

/**
 * Detect the GitHub PR for the branch currently checked out in `repoRoot`,
 * mapped onto the REST-shaped `GitHubPullRequest` the UI consumes. Returns null
 * whenever detection isn't possible — non-GitHub remote, `gh` missing or
 * unauthenticated, no PR for the branch, or unparseable output — so PR context
 * never breaks the review UI.
 */
export async function getPullRequest(
	repoRoot: string,
	originUrl: string | null,
): Promise<GitHubPullRequest | null> {
	if (!isGitHubRemote(originUrl)) return null;
	try {
		const stdout = await gh(["pr", "view", "--json", PR_FIELDS.join(",")], repoRoot);
		const parsed = GhPullRequestSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) return null;
		const pr = parsed.data;
		const login = pr.author?.login ?? null;
		return {
			number: pr.number,
			title: pr.title,
			html_url: pr.url,
			// REST `state` is open|closed; merged implies closed.
			state: pr.state === "OPEN" ? "open" : "closed",
			draft: pr.isDraft,
			merged_at: pr.mergedAt && pr.mergedAt.length > 0 ? pr.mergedAt : null,
			created_at: pr.createdAt,
			user: login
				? { login, avatar_url: avatarUrlForLogin(login), type: pr.author?.is_bot ? "Bot" : "User" }
				: null,
			head: { ref: pr.headRefName, sha: pr.headRefOid },
			base: { ref: pr.baseRefName },
		};
	} catch {
		return null;
	}
}

// ─── CI checks ──────────────────────────────────────────────────────────────

const GhCheckRunSchema = z.object({
	id: z.number(),
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	started_at: z.string().nullable(),
	completed_at: z.string().nullable(),
	html_url: z.string().nullable(),
	app: z
		.object({ name: z.string().optional(), owner: z.object({ avatar_url: z.string() }).optional() })
		.nullable()
		.optional(),
});
const GhCheckRunsSchema = z.object({ check_runs: z.array(GhCheckRunSchema) });

const COMPLETED_STATUS = "completed";
const FAILED_CONCLUSIONS = new Set<string>([
	CHECK_CONCLUSION.FAILURE,
	CHECK_CONCLUSION.TIMED_OUT,
	CHECK_CONCLUSION.STARTUP_FAILURE,
	CHECK_CONCLUSION.ACTION_REQUIRED,
	CHECK_CONCLUSION.CANCELLED,
]);

function toCheckItem(run: z.infer<typeof GhCheckRunSchema>): CheckItem {
	const status =
		run.status === "completed"
			? "completed"
			: run.status === "in_progress"
				? "in_progress"
				: "queued";
	const conclusion = run.conclusion;
	const isKnownConclusion = (value: string | null): value is CheckItem["conclusion"] =>
		value !== null && Object.values(CHECK_CONCLUSION).includes(value as never);
	return {
		source: CHECK_ITEM_SOURCE.CHECK_RUN,
		id: run.id,
		name: run.name,
		status,
		conclusion: isKnownConclusion(conclusion) ? conclusion : null,
		startedAt: run.started_at,
		completedAt: run.completed_at,
		url: run.html_url,
		avatarUrl: run.app?.owner?.avatar_url ?? null,
		appName: run.app?.name ?? "",
	};
}

function deriveCiState(items: CheckItem[]): ChecksResponse["state"] {
	if (items.length === 0) return PULL_REQUEST_CI_STATUS.NONE;
	let anyPending = false;
	for (const item of items) {
		if (item.status !== COMPLETED_STATUS) {
			anyPending = true;
			continue;
		}
		if (item.conclusion && FAILED_CONCLUSIONS.has(item.conclusion)) {
			return PULL_REQUEST_CI_STATUS.FAILURE;
		}
	}
	return anyPending ? PULL_REQUEST_CI_STATUS.PENDING : PULL_REQUEST_CI_STATUS.SUCCESS;
}

/**
 * CI check runs for `headSha`. Deployment links require a GitHub App
 * integration the CLI doesn't have, so `deploymentLinks` is always empty here.
 */
export async function getChecks(
	repoRoot: string,
	repo: GitHubRepo,
	headSha: string,
): Promise<ChecksResponse> {
	const empty: ChecksResponse = {
		state: PULL_REQUEST_CI_STATUS.NONE,
		items: [],
		deploymentLinks: [],
	};
	try {
		const stdout = await gh(
			["api", `repos/${repo.owner}/${repo.repo}/commits/${headSha}/check-runs`, "--paginate"],
			repoRoot,
		);
		const parsed = GhCheckRunsSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) return empty;
		const items = parsed.data.check_runs.map(toCheckItem);
		return { state: deriveCiState(items), items, deploymentLinks: [] };
	} catch {
		return empty;
	}
}

// ─── Reviews ────────────────────────────────────────────────────────────────

const GhReviewSchema = z.object({
	author: z.object({ login: z.string(), is_bot: z.boolean().optional() }).nullable(),
	state: z.string(),
});
const GhReviewRequestSchema = z.object({ login: z.string().optional() });
const GhReviewsSchema = z.object({
	latestReviews: z.array(GhReviewSchema).optional(),
	reviewRequests: z.array(GhReviewRequestSchema).optional(),
});

const KNOWN_REVIEW_STATES = new Set<string>(Object.values(REVIEW_STATE));

function reviewerStatusFor(state: string): ReviewerStatus | null {
	if (state === "PENDING") return null;
	return KNOWN_REVIEW_STATES.has(state) ? (state as ReviewerStatus) : null;
}

function summarizeReviews(reviewers: Reviewer[]): PullRequestReviewSummary["status"] {
	if (reviewers.some((r) => r.status === REVIEWER_STATUS.CHANGES_REQUESTED)) {
		return PULL_REQUEST_REVIEW_STATUS.CHANGES_REQUESTED;
	}
	if (reviewers.some((r) => r.status === REVIEWER_STATUS.APPROVED)) {
		return PULL_REQUEST_REVIEW_STATUS.APPROVED;
	}
	if (reviewers.length > 0) return PULL_REQUEST_REVIEW_STATUS.IN_REVIEW;
	return PULL_REQUEST_REVIEW_STATUS.NO_REVIEWS;
}

export async function getReviews(
	repoRoot: string,
	prNumber: number,
): Promise<PullRequestReviewSummary | null> {
	try {
		const stdout = await gh(
			["pr", "view", String(prNumber), "--json", "latestReviews,reviewRequests"],
			repoRoot,
		);
		const parsed = GhReviewsSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) return null;

		const byLogin = new Map<string, Reviewer>();
		for (const review of parsed.data.latestReviews ?? []) {
			if (!review.author) continue;
			const status = reviewerStatusFor(review.state);
			if (!status) continue;
			const login = review.author.login;
			byLogin.set(login, {
				user: {
					login,
					avatar_url: avatarUrlForLogin(login),
					type: review.author.is_bot ? "Bot" : "User",
				},
				status,
			});
		}
		for (const request of parsed.data.reviewRequests ?? []) {
			if (!request.login || byLogin.has(request.login)) continue;
			byLogin.set(request.login, {
				user: { login: request.login, avatar_url: avatarUrlForLogin(request.login), type: "User" },
				status: REVIEWER_STATUS.REQUESTED,
			});
		}

		const reviewers = [...byLogin.values()];
		return { status: summarizeReviews(reviewers), reviewers };
	} catch {
		return null;
	}
}

// ─── Merge status ─────────────────────────────────────────────────────────────

const MERGE_STATUS_QUERY = `query GetMergeStatus($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    autoMergeAllowed
    squashMergeAllowed
    mergeCommitAllowed
    rebaseMergeAllowed
    pullRequest(number: $number) {
      mergeable
      mergeStateStatus
      reviewDecision
      isMergeQueueEnabled
      viewerCanEnableAutoMerge
      viewerCanDisableAutoMerge
      autoMergeRequest { enabledAt }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      mergeQueueEntry { id position estimatedTimeToMerge }
    }
  }
}`;

const GhMergeStatusSchema = z.object({
	data: z.object({
		repository: z.object({
			autoMergeAllowed: z.boolean(),
			squashMergeAllowed: z.boolean(),
			mergeCommitAllowed: z.boolean(),
			rebaseMergeAllowed: z.boolean(),
			pullRequest: z.object({
				mergeable: z.string(),
				mergeStateStatus: z.string(),
				reviewDecision: z.string().nullable(),
				isMergeQueueEnabled: z.boolean(),
				viewerCanEnableAutoMerge: z.boolean(),
				viewerCanDisableAutoMerge: z.boolean(),
				autoMergeRequest: z.object({ enabledAt: z.string().nullable() }).nullable(),
				commits: z.object({
					nodes: z.array(
						z.object({
							commit: z.object({
								statusCheckRollup: z.object({ state: z.string() }).nullable(),
							}),
						}),
					),
				}),
				mergeQueueEntry: z
					.object({
						id: z.string(),
						position: z.number(),
						estimatedTimeToMerge: z.number().nullable(),
					})
					.nullable(),
			}),
		}),
	}),
});

function asEnum<T extends Record<string, string>>(
	obj: T,
	value: string,
	fallback: T[keyof T],
): T[keyof T] {
	return Object.values(obj).includes(value) ? (value as T[keyof T]) : fallback;
}

export async function getMergeStatus(
	repoRoot: string,
	repo: GitHubRepo,
	prNumber: number,
): Promise<MergeStatusInfo | null> {
	try {
		const stdout = await gh(
			[
				"api",
				"graphql",
				"-f",
				`query=${MERGE_STATUS_QUERY}`,
				"-F",
				`owner=${repo.owner}`,
				"-F",
				`repo=${repo.repo}`,
				"-F",
				`number=${prNumber}`,
			],
			repoRoot,
		);
		const parsed = GhMergeStatusSchema.safeParse(JSON.parse(stdout));
		if (!parsed.success) return null;
		const { repository } = parsed.data.data;
		const pr = repository.pullRequest;
		const allowedMergeMethods: MergeStatusInfo["allowedMergeMethods"] = [];
		if (repository.mergeCommitAllowed) allowedMergeMethods.push("MERGE");
		if (repository.squashMergeAllowed) allowedMergeMethods.push("SQUASH");
		if (repository.rebaseMergeAllowed) allowedMergeMethods.push("REBASE");
		const rollupState = pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;
		return {
			mergeable: asEnum(
				{ CONFLICTING: "CONFLICTING", MERGEABLE: "MERGEABLE", UNKNOWN: "UNKNOWN" } as const,
				pr.mergeable,
				"UNKNOWN",
			),
			mergeStateStatus: asEnum(
				{
					BEHIND: "BEHIND",
					BLOCKED: "BLOCKED",
					CLEAN: "CLEAN",
					DIRTY: "DIRTY",
					DRAFT: "DRAFT",
					HAS_HOOKS: "HAS_HOOKS",
					UNKNOWN: "UNKNOWN",
					UNSTABLE: "UNSTABLE",
				} as const,
				pr.mergeStateStatus,
				"UNKNOWN",
			),
			reviewDecision:
				pr.reviewDecision === null
					? null
					: asEnum(
							{
								APPROVED: "APPROVED",
								CHANGES_REQUESTED: "CHANGES_REQUESTED",
								REVIEW_REQUIRED: "REVIEW_REQUIRED",
							} as const,
							pr.reviewDecision,
							"REVIEW_REQUIRED",
						),
			checkRollupState:
				rollupState === null
					? null
					: asEnum(
							{
								SUCCESS: "SUCCESS",
								PENDING: "PENDING",
								FAILURE: "FAILURE",
								ERROR: "ERROR",
								EXPECTED: "EXPECTED",
							} as const,
							rollupState,
							"PENDING",
						),
			autoMergeEnabled: pr.autoMergeRequest !== null,
			autoMergeAllowed: repository.autoMergeAllowed,
			viewerCanEnableAutoMerge: pr.viewerCanEnableAutoMerge,
			viewerCanDisableAutoMerge: pr.viewerCanDisableAutoMerge,
			isMergeQueueEnabled: pr.isMergeQueueEnabled,
			isInMergeQueue: pr.mergeQueueEntry !== null,
			entry: pr.mergeQueueEntry,
			allowedMergeMethods,
		};
	} catch {
		return null;
	}
}
