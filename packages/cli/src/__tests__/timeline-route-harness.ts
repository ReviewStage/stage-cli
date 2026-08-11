import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { timelineRoutes } from "../routes/timeline.js";
import { SCOPE_KIND } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

export const SHA = "a".repeat(40);
export const GITHUB_ORIGIN = "git@github.com:owner/repo.git";

const OCTOCAT = {
	login: "octocat",
	avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
	type: "User",
};
const ALICE = {
	login: "alice",
	avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
	type: "User",
};
const BOB = {
	login: "bob",
	avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
	type: "User",
};

// `--paginate --slurp` output: one JSON array of pages.
export const TIMELINE_JSON = JSON.stringify([
	[
		{
			event: "committed",
			sha: "b".repeat(40),
			message: "feat: add the thing\n\nLonger body.",
			author: { name: "Octo Cat", email: "octo@example.com", date: "2026-05-01T09:00:00Z" },
			html_url: "https://github.com/owner/repo/commit/bbbb",
		},
		{
			event: "commented",
			id: 11,
			node_id: "IC_1",
			user: OCTOCAT,
			body: "First!",
			body_html: "<p>First!</p>",
			created_at: "2026-05-01T10:00:00Z",
			updated_at: "2026-05-01T10:00:00Z",
			html_url: "https://github.com/owner/repo/pull/7#issuecomment-11",
		},
		{
			event: "labeled",
			id: 12,
			actor: OCTOCAT,
			label: { name: "bug", color: "d73a4a" },
			created_at: "2026-05-01T11:00:00Z",
		},
		{
			event: "reviewed",
			id: 100,
			node_id: "PRR_1",
			user: ALICE,
			body: "Please fix the naming.",
			body_html: "<p>Please fix the naming.</p>",
			state: "changes_requested",
			html_url: "https://github.com/owner/repo/pull/7#pullrequestreview-100",
			submitted_at: "2026-05-02T10:00:00Z",
		},
		{
			// Ghost review created by GitHub for the inline reply below — must be
			// skipped once its comment is reassigned to review 100.
			event: "reviewed",
			id: 200,
			node_id: "PRR_2",
			user: BOB,
			body: null,
			state: "commented",
			html_url: "https://github.com/owner/repo/pull/7#pullrequestreview-200",
			submitted_at: "2026-05-03T10:00:00Z",
		},
		{
			event: "merged",
			id: 13,
			actor: OCTOCAT,
			commit_id: "c".repeat(40),
			created_at: "2026-05-04T10:00:00Z",
		},
		{ event: "totally_unknown", id: 99 },
	],
]);

export const REVIEW_COMMENTS_JSON = JSON.stringify([
	[
		{
			id: 1,
			node_id: "PRRC_1",
			pull_request_review_id: 100,
			user: ALICE,
			body: "Rename this.",
			body_html: "<p>Rename this.</p>",
			created_at: "2026-05-02T10:00:00Z",
			html_url: "https://github.com/owner/repo/pull/7#discussion_r1",
			path: "src/a.ts",
			diff_hunk: "@@ -1,2 +1,2 @@\n-old\n+new",
			line: 2,
			original_line: 2,
			side: "RIGHT",
			subject_type: "line",
		},
		{
			id: 2,
			node_id: "PRRC_2",
			pull_request_review_id: 200,
			in_reply_to_id: 1,
			user: BOB,
			body: "Done.",
			body_html: "<p>Done.</p>",
			created_at: "2026-05-03T10:00:00Z",
			html_url: "https://github.com/owner/repo/pull/7#discussion_r2",
			path: "src/a.ts",
			diff_hunk: "@@ -1,2 +1,2 @@\n-old\n+new",
			line: 2,
			original_line: 2,
			side: "RIGHT",
		},
	],
]);

export const THREAD_METADATA_JSON = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				reactions: { nodes: [{ content: "THUMBS_UP", user: { login: "alice" } }] },
				comments: {
					nodes: [
						{
							databaseId: 11,
							reactions: {
								nodes: [
									{ content: "HEART", user: { login: "bob" } },
									{ content: "HEART", user: { login: "alice" } },
								],
							},
						},
					],
				},
				reviewThreads: {
					pageInfo: { hasNextPage: false, endCursor: null },
					nodes: [
						{
							id: "PRRT_1",
							isResolved: true,
							resolvedBy: { login: "octocat" },
							comments: {
								nodes: [
									{
										databaseId: 1,
										reactions: { nodes: [{ content: "ROCKET", user: { login: "bob" } }] },
									},
									{ databaseId: 2, reactions: { nodes: [] } },
								],
							},
						},
					],
				},
			},
		},
	},
});

interface GhFixtures {
	timeline?: string;
	reviewComments?: string;
	threadMetadata?: string;
}

export class TimelineRouteHarness {
	private tmpDir = "";
	private dbPath = "";
	private webDist = "";
	private repoRoot = "";
	private binDir = "";
	private originalPath: string | undefined;
	private readonly handles: ServerHandle[] = [];

	async setup(): Promise<void> {
		this.tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-timeline-routes-"));
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
			write("timeline.json", fixtures.timeline),
			write("review-comments.json", fixtures.reviewComments),
			write("thread-metadata.json", fixtures.threadMetadata),
		]);
		const script = `#!/bin/sh
dir="${fixtureDir}"
# One printf per invocation: a single O_APPEND write keeps concurrent gh calls
# (Promise.all in getPullRequestTimeline) from interleaving log lines.
printf '%s\\n' "$*" >> "${this.binDir}/gh-argv.log"
emit() { [ -f "$dir/$1" ] && cat "$dir/$1" || { echo "gh: not authenticated" >&2; exit 1; }; }
all="$*"
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then emit thread-metadata.json
elif [ "$1" = "api" ]; then
  case "$all" in
    */timeline*) emit timeline.json ;;
    */comments*) emit review-comments.json ;;
    *) exit 1 ;;
  esac
else exit 1; fi
`;
		const executable = path.join(this.binDir, "gh");
		await fs.writeFile(executable, script);
		await fs.chmod(executable, 0o755);
	}

	insertRun(originUrl: string | null = GITHUB_ORIGIN, prNumber: number | null = 7): string {
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
		const handle = await startServer({ webDistPath: this.webDist, routes: timelineRoutes(db) });
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
