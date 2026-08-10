import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chapterView, fileView } from "../db/schema/index.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import { makeFixture, SHA } from "./fixtures.js";
import { PR_NODE_ID, PR_NUMBER, ViewStateGitHubHarness } from "./view-state-github-harness.js";

const harness = new ViewStateGitHubHarness();

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

function twoChapterFixture() {
	return makeFixture({
		chapters: [
			{
				id: "ch-a",
				order: 1,
				title: "A",
				summary: "chapter summary",
				hunkRefs: [
					{ filePath: "shared.ts", oldStart: 1 },
					{ filePath: "only-a.ts", oldStart: 1 },
				],
				keyChanges: [],
			},
			{
				id: "ch-b",
				order: 2,
				title: "B",
				summary: "chapter summary",
				hunkRefs: [{ filePath: "shared.ts", oldStart: 50 }],
				keyChanges: [],
			},
		],
	});
}

async function markCalls() {
	return (await harness.graphqlCalls()).filter((c) => c.name === "MarkFileAsViewed");
}

describe("GitHub mark sync", () => {
	it("POST /api/runs/:runId/file-views marks the path on GitHub after the local insert", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun();
		const port = await harness.start();

		const res = await harness.request(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		const calls = await harness.graphqlCalls();
		expect(calls.map((c) => c.name)).toEqual(["GetPullRequestIdentity", "MarkFileAsViewed"]);
		expect(calls[1]?.fields).toEqual({ pullRequestId: PR_NODE_ID, path: "src/foo.ts" });
	});

	it("POST /api/chapter-view/:chapterId marks only fully covered files on GitHub", async () => {
		await harness.writeGhShim();
		const { chapters } = harness.seedRun(twoChapterFixture());
		const chapterA = chapters.find((c) => c.chapterIndex === 0);
		const chapterB = chapters.find((c) => c.chapterIndex === 1);
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters");
		const port = await harness.start();

		// Chapter A alone doesn't complete coverage of shared.ts (B also contains it),
		// so only only-a.ts reaches GitHub — hosted's every-chapter-viewed mark rule.
		await harness.request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		expect((await markCalls()).map((c) => c.fields.path)).toEqual(["only-a.ts"]);

		// Chapter B closes the coverage → shared.ts is marked.
		await harness.request(port, "POST", `/api/chapter-view/${chapterB.id}`);
		expect((await markCalls()).map((c) => c.fields.path)).toEqual(["only-a.ts", "shared.ts"]);
	});

	it("resolves the pull request node id once per request across multiple marks", async () => {
		await harness.writeGhShim();
		const { chapters } = harness.seedRun(
			makeFixture({
				chapters: [
					{
						id: "ch-multi",
						order: 1,
						title: "Multi",
						summary: "chapter summary",
						hunkRefs: [
							{ filePath: "x.ts", oldStart: 1 },
							{ filePath: "y.ts", oldStart: 1 },
						],
						keyChanges: [],
					},
				],
			}),
		);
		const [chapterRow] = chapters;
		if (!chapterRow) throw new Error("seed: missing chapter");
		const port = await harness.start();

		await harness.request(port, "POST", `/api/chapter-view/${chapterRow.id}`);

		const calls = await harness.graphqlCalls();
		expect(calls.filter((c) => c.name === "GetPullRequestIdentity")).toHaveLength(1);
		expect((await markCalls()).map((c) => c.fields.path).sort()).toEqual(["x.ts", "y.ts"]);
	});

	it("resolves the checked-out branch's PR via gh pr view for runs without a PR number", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, { prNumber: null });
		const port = await harness.start();

		const res = await harness.request(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		const prViewCalls = (await harness.rawCalls()).filter(
			(args) => args[0] === "pr" && args[1] === "view",
		);
		expect(prViewCalls).toHaveLength(1);
		const calls = await harness.graphqlCalls();
		expect(calls.map((c) => c.name)).toEqual(["GetPullRequestIdentity", "MarkFileAsViewed"]);
		expect(calls[0]?.fields.number).toBe(String(PR_NUMBER));
		expect(calls[1]?.fields).toEqual({ pullRequestId: PR_NODE_ID, path: "src/foo.ts" });
	});

	it("skips GitHub when the checked-out branch has no PR but keeps the local mark", async () => {
		await harness.writeGhShim(undefined, { branchPrNumber: null });
		const { runId } = harness.seedRun(undefined, { prNumber: null });
		const port = await harness.start();

		const res = await harness.request(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		expect(await harness.graphqlCalls()).toEqual([]);
		const rows = harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all();
		expect(rows.map((r) => r.filePath)).toEqual(["src/foo.ts"]);
	});

	it("skips the GitHub mark when the run's head is no longer the PR's head", async () => {
		await harness.writeGhShim(undefined, { prHeadSha: "9".repeat(40) });
		const { runId } = harness.seedRun();
		const port = await harness.start();

		const res = await harness.request(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		// The stale run reviewed old contents, so GitHub is left untouched while
		// the local mark still lands.
		expect(res.status).toBe(200);
		expect((await harness.graphqlCalls()).map((c) => c.name)).toEqual(["GetPullRequestIdentity"]);
		const rows = harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all();
		expect(rows.map((r) => r.filePath)).toEqual(["src/foo.ts"]);
	});

	it("skips the GitHub mark for working-tree runs without any gh call", async () => {
		await harness.writeGhShim();
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

		const res = await harness.request(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		expect(await harness.rawCalls()).toEqual([]);
		const rows = harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all();
		expect(rows.map((r) => r.filePath)).toEqual(["src/foo.ts"]);
	});

	it("never mutates GitHub when the marked externalId spans multiple runs", async () => {
		await harness.writeGhShim();
		// Identical fixtures share a scope key, so the two runs' chapter rows
		// share an externalId: a local-only run plus a fresh PR run.
		const local = harness.seedRun(undefined, { originUrl: null, prNumber: null });
		const pr = harness.seedRun();
		const [localChapter] = local.chapters;
		const [prChapter] = pr.chapters;
		if (!localChapter || !prChapter) throw new Error("seed: missing chapters");
		expect(prChapter.externalId).toBe(localChapter.externalId);
		const port = await harness.start();

		// The request names only the shared externalId, so the initiating run —
		// the one the user was actually reviewing — is unknown. The fresh PR run
		// must not be picked as the target: the user may have been reviewing the
		// local-only sibling.
		const res = await harness.request(port, "POST", `/api/chapter-view/${localChapter.externalId}`);

		expect(res.status).toBe(200);
		expect(await harness.rawCalls()).toEqual([]);
		// The local fan-out is unaffected: rows for both runs still update.
		const viewedChapterIds = harness.db
			.select()
			.from(chapterView)
			.all()
			.map((r) => r.chapterId)
			.sort();
		expect(viewedChapterIds).toEqual([localChapter.id, prChapter.id].sort());
		const viewedRunIds = harness.db
			.select()
			.from(fileView)
			.all()
			.map((r) => r.runId)
			.sort();
		expect(viewedRunIds).toEqual([local.runId, pr.runId].sort());
	});

	it("syncs the initiating fresh run's PR even when a no-PR sibling shares the externalId", async () => {
		await harness.writeGhShim();
		harness.seedRun(undefined, { originUrl: null, prNumber: null });
		const pr = harness.seedRun();
		const [prChapter] = pr.chapters;
		if (!prChapter) throw new Error("seed: missing chapter");
		const port = await harness.start();

		// Acting through the PR run's own routes pins the initiating run, so the
		// sibling's existence never blocks the sync: via the file-view route...
		const res = await harness.request(port, "POST", `/api/runs/${pr.runId}/file-views`, {
			path: "src/foo.ts",
		});
		expect(res.status).toBe(200);
		expect((await markCalls()).map((c) => c.fields.path)).toEqual(["src/foo.ts"]);

		// ...and via the chapter row's uuid (not the shared externalId).
		await harness.request(port, "POST", `/api/chapter-view/${prChapter.id}`);
		expect((await markCalls()).map((c) => c.fields.path)).toEqual(["src/foo.ts", "src/foo.ts"]);
	});

	it("never calls gh when marking on a run without a GitHub remote", async () => {
		await harness.writeGhShim();
		const { runId, chapters } = harness.seedRun(undefined, { originUrl: null, prNumber: null });
		const [chapterRow] = chapters;
		if (!chapterRow) throw new Error("seed: missing chapter");
		const port = await harness.start();

		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });
		await harness.request(port, "POST", `/api/chapter-view/${chapterRow.id}`);

		expect(await harness.rawCalls()).toEqual([]);
	});
});
