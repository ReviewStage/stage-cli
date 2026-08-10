import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { pullRequestRoutes } from "../routes/pull-request.js";
import { SCOPE_KIND } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

export const SHA = "a".repeat(40);
export const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

export const PR_JSON = JSON.stringify({
	number: 7,
	title: "Add the thing",
	body: "This PR adds the thing.\n\nDetails here.",
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

export const REST_PR_JSON = JSON.stringify({
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

export const REST_REVIEWS_JSON = JSON.stringify([
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

export const CHECKS_JSON = JSON.stringify([
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

export const MERGE_JSON = JSON.stringify({
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

export const DEPLOYMENTS_JSON = JSON.stringify({
	data: {
		repository: {
			object: {
				deployments: {
					nodes: [
						{
							environment: "Preview",
							latestStatus: {
								state: "SUCCESS",
								environmentUrl: "https://preview-2.example.app",
							},
						},
						{
							environment: "Preview",
							latestStatus: {
								state: "SUCCESS",
								environmentUrl: "https://preview-1.example.app",
							},
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

interface GhFixtures {
	pr?: string;
	restPr?: string;
	reviews?: string;
	checks?: string;
	merge?: string;
	deployments?: string;
}

export class PullRequestRouteHarness {
	private tmpDir = "";
	private dbPath = "";
	private webDist = "";
	private repoRoot = "";
	private binDir = "";
	private originalPath: string | undefined;
	private readonly handles: ServerHandle[] = [];

	async setup(): Promise<void> {
		this.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-pr-routes-"));
		this.dbPath = path.join(this.tmpDir, "db.sqlite");
		this.webDist = path.join(this.tmpDir, "web-dist");
		this.repoRoot = path.join(this.tmpDir, "repo");
		this.binDir = path.join(this.tmpDir, "bin");
		await fs.mkdir(this.webDist);
		await fs.writeFile(path.join(this.webDist, "index.html"), "<html></html>");
		await fs.mkdir(this.repoRoot);
		await fs.mkdir(this.binDir);
		this.originalPath = process.env.PATH;
		process.env.PATH = `${this.binDir}${path.delimiter}${this.originalPath ?? ""}`;
		closeDb();
	}

	async teardown(): Promise<void> {
		while (this.handles.length > 0) {
			const handle = this.handles.pop();
			if (handle) await handle.close();
		}
		closeDb();
		process.env.PATH = this.originalPath;
		await fs.rm(this.tmpDir, { recursive: true, force: true });
	}

	async writeFakeGh(fixtures: GhFixtures): Promise<void> {
		const fixtureDir = path.join(this.binDir, "fixtures");
		await fs.mkdir(fixtureDir, { recursive: true });
		const write = async (name: string, value?: string) => {
			if (value !== undefined) await fs.writeFile(path.join(fixtureDir, name), value);
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
dir="${fixtureDir}"
echo "$@" >> "${this.binDir}/gh-argv.log"
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
		const executable = path.join(this.binDir, "gh");
		await fs.writeFile(executable, script);
		await fs.chmod(executable, 0o755);
	}

	insertRun(originUrl: string | null = GITHUB_ORIGIN, prNumber: number | null = null): string {
		const db = getDb({ dbPath: this.dbPath });
		const [row] = db
			.insert(chapterRun)
			.values({
				repoRoot: this.repoRoot,
				originUrl,
				prNumber,
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

	async start(): Promise<number> {
		const db = getDb({ dbPath: this.dbPath });
		const handle = await startServer({ webDistPath: this.webDist, routes: pullRequestRoutes(db) });
		this.handles.push(handle);
		return handle.port;
	}

	request(port: number, requestPath: string): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{ hostname: LOOPBACK_HOST, port, method: "GET", path: requestPath, agent: false },
				(res) => {
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () =>
						resolve({
							status: res.statusCode ?? 0,
							body: Buffer.concat(chunks).toString("utf8"),
						}),
					);
				},
			);
			req.on("error", reject);
			req.end();
		});
	}

	async argv(): Promise<string> {
		return fs.readFile(path.join(this.binDir, "gh-argv.log"), "utf8");
	}
}
