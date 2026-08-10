import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileView } from "../db/schema/index.js";
import { FILE_VIEWED_STATE } from "../github/index.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import { makeFixture, SHA } from "./fixtures.js";
import {
	makeViewedFilesPage,
	PR_NUMBER,
	ViewStateGitHubHarness,
} from "./view-state-github-harness.js";

const harness = new ViewStateGitHubHarness();

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

function filePaths(body: string): string[] {
	return (JSON.parse(body) as { filePaths: string[] }).filePaths;
}

describe("GET /api/runs/:runId/view-state GitHub merge", () => {
	it("unions GitHub's VIEWED paths with local file views without seeding rows", async () => {
		await harness.writeGhShim([
			makeViewedFilesPage([
				{ path: "gh-viewed.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED },
				{ path: "gh-unviewed.ts", viewerViewedState: FILE_VIEWED_STATE.UNVIEWED },
				{ path: "gh-dismissed.ts", viewerViewedState: FILE_VIEWED_STATE.DISMISSED },
			]),
		]);
		const { runId } = harness.seedRun();
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "local.ts" });

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(filePaths(res.body).sort()).toEqual(["gh-viewed.ts", "local.ts"]);
		// Read-side merge only: GitHub-viewed paths never become local file_view rows.
		const rows = harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all();
		expect(rows.map((r) => r.filePath)).toEqual(["local.ts"]);
	});

	it("paginates through every viewed-files page", async () => {
		await harness.writeGhShim([
			makeViewedFilesPage(
				[{ path: "page-one.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED }],
				"cursor1",
			),
			makeViewedFilesPage([{ path: "page-two.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED }]),
		]);
		const { runId } = harness.seedRun();
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(filePaths(res.body).sort()).toEqual(["page-one.ts", "page-two.ts"]);
		const calls = await harness.graphqlCalls();
		const pageCalls = calls.filter((c) => c.name === "GetPullRequestViewedFiles");
		expect(pageCalls).toHaveLength(2);
		expect(pageCalls[1]?.fields.after).toBe("cursor1");
	});

	it("tolerates null file nodes in GitHub's response", async () => {
		await harness.writeGhShim([
			makeViewedFilesPage([
				null,
				{ path: "gh-viewed.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED },
				null,
			]),
		]);
		const { runId } = harness.seedRun();
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(filePaths(res.body)).toEqual(["gh-viewed.ts"]);
	});

	it("degrades to local paths when GitHub reports the pull request missing", async () => {
		await harness.writeGhShim([{ data: { repository: { pullRequest: null } } }]);
		const { runId } = harness.seedRun();
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "local.ts" });

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(filePaths(res.body)).toEqual(["local.ts"]);
	});

	it("degrades to local paths when gh fails", async () => {
		await harness.writeFailingGhShim();
		const { runId } = harness.seedRun();
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "local.ts" });

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(filePaths(res.body)).toEqual(["local.ts"]);
	});

	it("resolves the checked-out branch's PR and merges its viewed paths for runs without a PR number", async () => {
		await harness.writeGhShim([
			makeViewedFilesPage([{ path: "gh-viewed.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED }]),
		]);
		const { runId } = harness.seedRun(undefined, { prNumber: null });
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "local.ts" });

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(filePaths(res.body).sort()).toEqual(["gh-viewed.ts", "local.ts"]);
		const viewedFilesCalls = (await harness.graphqlCalls()).filter(
			(c) => c.name === "GetPullRequestViewedFiles",
		);
		expect(viewedFilesCalls[0]?.fields.number).toBe(String(PR_NUMBER));
	});

	it("degrades to local paths when the checked-out branch has no PR", async () => {
		await harness.writeGhShim(undefined, { branchPrNumber: null });
		const { runId } = harness.seedRun(undefined, { prNumber: null });
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "local.ts" });

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(filePaths(res.body)).toEqual(["local.ts"]);
		expect(await harness.graphqlCalls()).toEqual([]);
	});

	it("still merges GitHub's viewed paths when the run's head is no longer the PR's head", async () => {
		await harness.writeGhShim(
			[
				makeViewedFilesPage([
					{ path: "gh-viewed.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED },
				]),
			],
			{ prHeadSha: "9".repeat(40) },
		);
		const { runId } = harness.seedRun();
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		// The freshness gate only guards writes; reading GitHub's viewed state is
		// harmless for a stale run.
		expect(res.status).toBe(200);
		expect(filePaths(res.body)).toEqual(["gh-viewed.ts"]);
	});

	it("still merges GitHub's viewed paths for working-tree runs", async () => {
		await harness.writeGhShim([
			makeViewedFilesPage([{ path: "gh-viewed.ts", viewerViewedState: FILE_VIEWED_STATE.VIEWED }]),
		]);
		const { runId } = harness.seedRun(
			makeFixture({
				scope: {
					kind: SCOPE_KIND.WORKING_TREE,
					ref: WORKING_TREE_REF.WORK,
					baseSha: SHA.base,
					headSha: SHA.head,
					mergeBaseSha: SHA.mergeBase,
				},
			}),
		);
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(filePaths(res.body)).toEqual(["gh-viewed.ts"]);
	});

	it("never calls gh for runs without a GitHub remote", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, {
			originUrl: "git@gitlab.com:owner/repo.git",
		});
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(await harness.rawCalls()).toEqual([]);
	});
});
