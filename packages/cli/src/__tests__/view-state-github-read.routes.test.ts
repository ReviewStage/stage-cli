import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileView } from "../db/schema/index.js";
import { FILE_VIEWED_STATE } from "../github/index.js";
import { makeViewedFilesPage, ViewStateGitHubHarness } from "./view-state-github-harness.js";

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

	it("never calls gh for runs without a PR number", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, { prNumber: null });
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(await harness.graphqlCalls()).toEqual([]);
	});

	it("never calls gh for runs without a GitHub remote", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, {
			originUrl: "git@gitlab.com:owner/repo.git",
		});
		const port = await harness.start();

		const res = await harness.request(port, "GET", `/api/runs/${runId}/view-state`);

		expect(res.status).toBe(200);
		expect(await harness.graphqlCalls()).toEqual([]);
	});
});
