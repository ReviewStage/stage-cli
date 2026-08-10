import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chapterFileView, chapterView, fileView } from "../db/schema/index.js";
import { makeFixture } from "./fixtures.js";
import {
	BRANCH_HEAD_REF,
	PR_NODE_ID,
	ViewStateGitHubHarness,
} from "./view-state-github-harness.js";

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

	it("resolves the run's stored branch's PR and unmarks on it for runs without a PR number", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, { prNumber: null, headRef: BRANCH_HEAD_REF });
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		const res = await harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		const prViewCalls = (await harness.rawCalls()).filter(
			(args) => args[0] === "pr" && args[1] === "view",
		);
		// One resolution per mutation, each pinned to the stored branch.
		expect(prViewCalls.map((args) => args[2])).toEqual([BRANCH_HEAD_REF, BRANCH_HEAD_REF]);
		const calls = await unmarkCalls();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.fields).toEqual({ pullRequestId: PR_NODE_ID, path: "src/foo.ts" });
	});

	it("skips the GitHub unmark for a branch run with no recorded headRef (detached import)", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, { prNumber: null, headRef: null });
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		const res = await harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		// Local state still clears while GitHub is never consulted.
		expect(res.status).toBe(200);
		expect(await harness.rawCalls()).toEqual([]);
		expect(harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(
			0,
		);
	});

	it("skips the GitHub unmark when the run's head is no longer the PR's head", async () => {
		await harness.writeGhShim(undefined, { prHeadSha: "9".repeat(40) });
		const { runId } = harness.seedRun();
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		const res = await harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		// Local state is cleared; the stale run leaves the live PR's viewed
		// state alone in both directions.
		expect(res.status).toBe(200);
		expect(harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(
			0,
		);
		const names = (await harness.graphqlCalls()).map((c) => c.name);
		expect(names).toEqual(["GetPullRequestIdentity", "GetPullRequestIdentity"]);
	});

	it("never mutates GitHub when the unmarked externalId spans multiple runs", async () => {
		await harness.writeGhShim();
		// A local-only sibling shares the externalId with a fresh PR run.
		harness.seedRun(undefined, { originUrl: null, prNumber: null });
		const pr = harness.seedRun();
		const [prChapter] = pr.chapters;
		if (!prChapter) throw new Error("seed: missing chapter");
		const port = await harness.start();
		// Mark through the PR run's own row first so GitHub has state to lose.
		await harness.request(port, "POST", `/api/chapter-view/${prChapter.id}`);

		const res = await harness.request(port, "DELETE", `/api/chapter-view/${prChapter.externalId}`);

		// The externalId alone can't identify the run the user was reviewing, so
		// the fresh sibling's PR is left untouched while local state still clears
		// across the whole fan-out.
		expect(res.status).toBe(200);
		expect(await unmarkCalls()).toEqual([]);
		expect(harness.db.select().from(chapterView).all()).toHaveLength(0);
		expect(harness.db.select().from(fileView).all()).toHaveLength(0);
	});

	it("unmarks the initiating fresh run's PR even when a no-PR sibling shares the externalId", async () => {
		await harness.writeGhShim();
		harness.seedRun(undefined, { originUrl: null, prNumber: null });
		const pr = harness.seedRun();
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${pr.runId}/file-views`, {
			path: "src/foo.ts",
		});

		const res = await harness.request(port, "DELETE", `/api/runs/${pr.runId}/file-views`, {
			path: "src/foo.ts",
		});

		expect(res.status).toBe(200);
		expect((await unmarkCalls()).map((c) => c.fields.path)).toEqual(["src/foo.ts"]);
	});

	it("never calls gh when unmarking on a run without a GitHub remote", async () => {
		await harness.writeGhShim();
		const { runId } = harness.seedRun(undefined, { originUrl: null, prNumber: null });
		const port = await harness.start();
		await harness.request(port, "POST", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		await harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, { path: "src/foo.ts" });

		expect(await harness.rawCalls()).toEqual([]);
	});
});
