import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFixture } from "./fixtures.js";
import { PR_NODE_ID, ViewStateGitHubHarness } from "./view-state-github-harness.js";

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
		expect(calls.map((c) => c.name)).toEqual(["GetPullRequestNodeId", "MarkFileAsViewed"]);
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
		expect(calls.filter((c) => c.name === "GetPullRequestNodeId")).toHaveLength(1);
		expect((await markCalls()).map((c) => c.fields.path).sort()).toEqual(["x.ts", "y.ts"]);
	});

	it("never calls gh when marking on a run without a PR number", async () => {
		await harness.writeGhShim();
		const { runId, chapters } = harness.seedRun(undefined, { prNumber: null });
		const [chapterRow] = chapters;
		if (!chapterRow) throw new Error("seed: missing chapter");
		const port = await harness.start();

		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });
		await harness.request(port, "POST", `/api/chapter-view/${chapterRow.id}`);

		expect(await harness.graphqlCalls()).toEqual([]);
	});
});
