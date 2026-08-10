import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chapterFileView, chapterView, fileView } from "../db/schema/index.js";
import { makeFixture } from "./fixtures.js";
import { PR_NODE_ID, ViewStateGitHubHarness } from "./view-state-github-harness.js";

const harness = new ViewStateGitHubHarness();

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

async function unmarkCalls() {
	return (await harness.graphqlCalls()).filter((c) => c.name === "UnmarkFileAsViewed");
}

describe("GitHub unmark sync", () => {
	it("DELETE /api/runs/:runId/file-views unmarks the path on GitHub after the local delete", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun();
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		const res = await harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		const calls = await unmarkCalls();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.fields).toEqual({ pullRequestId: PR_NODE_ID, path: "src/foo.ts" });
	});

	it("DELETE /api/chapter-view/:chapterId unmarks every touched path even when other chapters still cover it", async () => {
		await harness.writeGhShim();
		const { chapters } = harness.seedRun(
			makeFixture({
				chapters: [
					{
						id: "ch-a",
						order: 1,
						title: "A",
						summary: "chapter summary",
						hunkRefs: [{ filePath: "shared.ts", oldStart: 1 }],
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
			}),
		);
		const chapterA = chapters.find((c) => c.chapterIndex === 0);
		const chapterB = chapters.find((c) => c.chapterIndex === 1);
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters");
		const port = await harness.start();
		await harness.request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		await harness.request(port, "POST", `/api/chapter-view/${chapterB.id}`);

		await harness.request(port, "DELETE", `/api/chapter-view/${chapterA.id}`);

		// Rule 4: any chapter-file unview unmarks unconditionally — B's surviving
		// chapter_file_view row doesn't keep shared.ts viewed on GitHub.
		expect((await unmarkCalls()).map((c) => c.fields.path)).toEqual(["shared.ts"]);
	});

	it("leaves local state intact and still succeeds when gh fails", async () => {
		await harness.writeFailingGhShim();
		const { runId, chapters } = harness.seedRun();
		const [chapterRow] = chapters;
		if (!chapterRow) throw new Error("seed: missing chapter");
		const port = await harness.start();

		const mark = await harness.request(port, "POST", `/api/chapter-view/${chapterRow.id}`);
		expect(mark.status).toBe(200);
		expect(harness.db.select().from(chapterView).all()).toHaveLength(1);
		expect(harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(
			1,
		);

		const unmark = await harness.request(port, "DELETE", `/api/chapter-view/${chapterRow.id}`);
		expect(unmark.status).toBe(200);
		expect(harness.db.select().from(chapterView).all()).toHaveLength(0);
		expect(harness.db.select().from(chapterFileView).all()).toHaveLength(0);
		expect(harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(
			0,
		);
	});

	it("never calls gh when unmarking on a run without a PR number", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, { prNumber: null });
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		await harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		expect(await harness.graphqlCalls()).toEqual([]);
	});
});
