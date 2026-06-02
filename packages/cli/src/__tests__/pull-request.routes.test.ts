import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type {
	ChecksResponse,
	MergeStatusResponse,
	PullRequestResponse,
	ReviewsResponse,
} from "@stagereview/types/pull-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { pullRequestRoutes } from "../routes/pull-request.js";
import { SCOPE_KIND } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
let binDir: string;
let originalPath: string | undefined;
const handles: ServerHandle[] = [];

const SHA = "a".repeat(40);
const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

const PR_JSON = JSON.stringify({
	number: 7,
	title: "Add the thing",
	url: "https://github.com/owner/repo/pull/7",
	state: "OPEN",
	isDraft: false,
	mergedAt: null,
	createdAt: "2026-05-01T00:00:00Z",
	author: { login: "octocat", is_bot: false },
	headRefName: "feature",
	headRefOid: SHA,
	baseRefName: "main",
});
// REST PR object: drives the author (real avatar/type) and requested_reviewers.
const REST_PR_JSON = JSON.stringify({
	user: {
		login: "octocat",
		type: "User",
		avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
		html_url: "https://github.com/octocat",
	},
	requested_reviewers: [
		{ login: "bob", type: "User", avatar_url: "https://avatars.githubusercontent.com/u/2?v=4" },
	],
});
// `gh api --paginate --slurp` shape: one array element per page.
// REST reviews: a human approval plus a GitHub App (bot) review with a [bot] login.
const REST_REVIEWS_JSON = JSON.stringify([
	[
		{
			user: {
				login: "alice",
				type: "User",
				avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
			},
			state: "APPROVED",
		},
		{
			user: {
				login: "cursor[bot]",
				type: "Bot",
				avatar_url: "https://avatars.githubusercontent.com/in/1210556?v=4",
			},
			state: "COMMENTED",
		},
	],
]);
const CHECKS_JSON = JSON.stringify([
	{
		check_runs: [
			{
				id: 1,
				name: "build",
				status: "completed",
				conclusion: "success",
				started_at: "2026-05-01T00:00:00Z",
				completed_at: "2026-05-01T00:01:00Z",
				html_url: "https://example.com/run/1",
				app: { name: "GitHub Actions", owner: { avatar_url: "https://example.com/a.png" } },
			},
		],
	},
]);
const MERGE_JSON = JSON.stringify({
	data: {
		repository: {
			autoMergeAllowed: true,
			squashMergeAllowed: true,
			mergeCommitAllowed: true,
			rebaseMergeAllowed: false,
			pullRequest: {
				mergeable: "MERGEABLE",
				mergeStateStatus: "CLEAN",
				reviewDecision: "APPROVED",
				isMergeQueueEnabled: false,
				viewerCanEnableAutoMerge: true,
				viewerCanDisableAutoMerge: false,
				autoMergeRequest: null,
				commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
				mergeQueueEntry: null,
			},
		},
	},
});
// Deployments GraphQL response (newest-first). Exercises dedupe-by-environment,
// skipping non-success and non-https/null URLs.
const DEPLOYMENTS_JSON = JSON.stringify({
	data: {
		repository: {
			object: {
				deployments: {
					nodes: [
						{
							environment: "Preview",
							latestStatus: { state: "SUCCESS", environmentUrl: "https://preview-2.example.app" },
						},
						{
							environment: "Preview",
							latestStatus: { state: "SUCCESS", environmentUrl: "https://preview-1.example.app" },
						},
						{
							environment: "Production",
							latestStatus: { state: "SUCCESS", environmentUrl: "https://prod.example.app" },
						},
						{
							environment: "Staging",
							latestStatus: { state: "FAILURE", environmentUrl: "https://staging.example.app" },
						},
						{ environment: "NoUrl", latestStatus: { state: "SUCCESS", environmentUrl: null } },
					],
				},
			},
		},
	},
});

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-pr-routes-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	binDir = path.join(tmpDir, "bin");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	await fs.mkdir(binDir);
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
	closeDb();
});

afterEach(async () => {
	while (handles.length > 0) {
		const h = handles.pop();
		if (h) await h.close();
	}
	closeDb();
	process.env.PATH = originalPath;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Fake `gh` that dispatches by argv to fixture files; exits 1 when a fixture is absent. */
async function writeFakeGh(fixtures: {
	pr?: string;
	restPr?: string;
	reviews?: string;
	checks?: string;
	merge?: string;
	deployments?: string;
}): Promise<void> {
	const dir = path.join(binDir, "fixtures");
	await fs.mkdir(dir, { recursive: true });
	const write = async (name: string, value?: string) => {
		if (value !== undefined) await fs.writeFile(path.join(dir, name), value);
	};
	await Promise.all([
		write("pr.json", fixtures.pr),
		write("rest-pr.json", fixtures.restPr),
		write("reviews.json", fixtures.reviews),
		write("checks.json", fixtures.checks),
		write("merge.json", fixtures.merge),
		write("deployments.json", fixtures.deployments),
	]);
	const script = `#!/bin/sh
dir="${dir}"
emit() { [ -f "$dir/$1" ] && cat "$dir/$1" || exit 1; }
all="$*"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then emit pr.json
elif [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$all" in *deployments*) emit deployments.json ;; *) emit merge.json ;; esac
elif [ "$1" = "api" ]; then
  case "$all" in
    *check-runs*) emit checks.json ;;
    */reviews*) emit reviews.json ;;
    *) emit rest-pr.json ;;
  esac
else exit 1; fi
`;
	const file = path.join(binDir, "gh");
	await fs.writeFile(file, script);
	await fs.chmod(file, 0o755);
}

function insertRun(originUrl: string | null): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			originUrl,
			scopeKind: SCOPE_KIND.COMMITTED,
			workingTreeRef: null,
			baseSha: SHA,
			headSha: SHA,
			mergeBaseSha: SHA,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

async function start(): Promise<number> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: pullRequestRoutes(db) });
	handles.push(handle);
	return handle.port;
}

function request(port: number, p: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "GET", path: p, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("pull-request API", () => {
	it("maps the gh PR payload onto the REST-shaped wire type", async () => {
		await writeFakeGh({ pr: PR_JSON, restPr: REST_PR_JSON });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), `/api/runs/${runId}/pull-request`);
		expect(res.status).toBe(200);
		const { pullRequest } = JSON.parse(res.body) as PullRequestResponse;
		expect(pullRequest).toEqual({
			number: 7,
			title: "Add the thing",
			html_url: "https://github.com/owner/repo/pull/7",
			state: "open",
			draft: false,
			merged_at: null,
			created_at: "2026-05-01T00:00:00Z",
			// Author sourced from REST: real avatar_url, not a fabricated github.com/<login>.png.
			user: {
				login: "octocat",
				type: "User",
				avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
			},
			head: { ref: "feature", sha: SHA },
			base: { ref: "main" },
		});
	});

	it("returns null when gh finds no PR for the branch", async () => {
		await writeFakeGh({});
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), `/api/runs/${runId}/pull-request`);
		expect(res.status).toBe(200);
		expect((JSON.parse(res.body) as PullRequestResponse).pullRequest).toBeNull();
	});

	it("returns null for non-GitHub remotes without invoking gh", async () => {
		await writeFakeGh({ pr: PR_JSON });
		const runId = insertRun("git@gitlab.com:owner/repo.git");
		const res = await request(await start(), `/api/runs/${runId}/pull-request`);
		expect((JSON.parse(res.body) as PullRequestResponse).pullRequest).toBeNull();
	});

	it("returns 404 for an unknown runId", async () => {
		const res = await request(
			await start(),
			"/api/runs/00000000-0000-0000-0000-000000000000/pull-request",
		);
		expect(res.status).toBe(404);
	});

	it("returns mapped CI check items for a valid headSha", async () => {
		await writeFakeGh({ checks: CHECKS_JSON });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(
			await start(),
			`/api/runs/${runId}/pull-request/checks?headSha=${SHA}`,
		);
		expect(res.status).toBe(200);
		const body = JSON.parse(res.body) as ChecksResponse;
		expect(body.state).toBe("success");
		expect(body.items).toHaveLength(1);
		expect(body.items[0]).toMatchObject({
			source: "check_run",
			name: "build",
			conclusion: "success",
			avatarUrl: "https://example.com/a.png",
			appName: "GitHub Actions",
		});
	});

	it("returns one deployment link per environment (latest success, https only)", async () => {
		await writeFakeGh({ checks: CHECKS_JSON, deployments: DEPLOYMENTS_JSON });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(
			await start(),
			`/api/runs/${runId}/pull-request/checks?headSha=${SHA}`,
		);
		expect(res.status).toBe(200);
		const body = JSON.parse(res.body) as ChecksResponse;
		// Preview deduped to the newest success; Production kept; Staging (failure)
		// and NoUrl (null url) dropped.
		expect(body.deploymentLinks).toEqual([
			{ environment: "Preview", url: "https://preview-2.example.app" },
			{ environment: "Production", url: "https://prod.example.app" },
		]);
	});

	it("rejects a checks request without a valid headSha", async () => {
		await writeFakeGh({ checks: CHECKS_JSON });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), `/api/runs/${runId}/pull-request/checks?headSha=nope`);
		expect(res.status).toBe(400);
	});

	it("maps reviews and requested reviewers, preserving bot identity from REST", async () => {
		await writeFakeGh({ reviews: REST_REVIEWS_JSON, restPr: REST_PR_JSON });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), `/api/runs/${runId}/pull-request/reviews?number=7`);
		expect(res.status).toBe(200);
		const { reviews } = JSON.parse(res.body) as ReviewsResponse;
		expect(reviews?.status).toBe("approved");
		expect(reviews?.reviewers).toEqual([
			{
				user: {
					login: "alice",
					type: "User",
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				},
				status: "APPROVED",
			},
			{
				// Bot reviewer keeps its [bot] login, "Bot" type, and real app avatar.
				user: {
					login: "cursor[bot]",
					type: "Bot",
					avatar_url: "https://avatars.githubusercontent.com/in/1210556?v=4",
				},
				status: "COMMENTED",
			},
			{
				user: {
					login: "bob",
					type: "User",
					avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
				},
				status: "REQUESTED",
			},
		]);
	});

	it("treats a re-requested reviewer as awaiting review even if they already reviewed", async () => {
		// alice has an APPROVED review AND is in requested_reviewers (re-requested).
		const restPr = JSON.stringify({
			user: { login: "octocat", type: "User", avatar_url: "https://example.com/o.png" },
			requested_reviewers: [
				{
					login: "alice",
					type: "User",
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				},
			],
		});
		await writeFakeGh({ reviews: REST_REVIEWS_JSON, restPr });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), `/api/runs/${runId}/pull-request/reviews?number=7`);
		const { reviews } = JSON.parse(res.body) as ReviewsResponse;
		const alice = reviews?.reviewers.find((r) => r.user.login === "alice");
		expect(alice?.status).toBe("REQUESTED");
	});

	it("keeps a re-requested CHANGES_REQUESTED review blocking, not 'awaiting'", async () => {
		const reviews = JSON.stringify([
			[
				{
					user: { login: "carol", type: "User", avatar_url: "https://example.com/c.png" },
					state: "CHANGES_REQUESTED",
				},
			],
		]);
		const restPr = JSON.stringify({
			user: { login: "octocat", type: "User", avatar_url: "https://example.com/o.png" },
			requested_reviewers: [
				{ login: "carol", type: "User", avatar_url: "https://example.com/c.png" },
			],
		});
		await writeFakeGh({ reviews, restPr });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(await start(), `/api/runs/${runId}/pull-request/reviews?number=7`);
		const body = JSON.parse(res.body) as ReviewsResponse;
		expect(body.reviews?.reviewers.find((r) => r.user.login === "carol")?.status).toBe(
			"CHANGES_REQUESTED",
		);
		expect(body.reviews?.status).toBe("changes_requested");
	});

	it("maps the merge-status GraphQL response", async () => {
		await writeFakeGh({ merge: MERGE_JSON });
		const runId = insertRun(GITHUB_ORIGIN);
		const res = await request(
			await start(),
			`/api/runs/${runId}/pull-request/merge-status?number=7`,
		);
		expect(res.status).toBe(200);
		const { mergeStatus } = JSON.parse(res.body) as MergeStatusResponse;
		expect(mergeStatus).toMatchObject({
			mergeable: "MERGEABLE",
			mergeStateStatus: "CLEAN",
			reviewDecision: "APPROVED",
			checkRollupState: "SUCCESS",
			isInMergeQueue: false,
			allowedMergeMethods: ["MERGE", "SQUASH"],
		});
	});
});
