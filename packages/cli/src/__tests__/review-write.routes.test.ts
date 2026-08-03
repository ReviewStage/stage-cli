import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	HEAD,
	makeStalePendingReview,
	REVIEW_QUERY_RESULT,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — writes", () => {
	it("promotes a local thread to a pending GitHub comment", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{
				localThreadId,
			},
		);

		expect(res.status, res.body).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		const createReviewLogs = (await harness.logLines()).filter((line) =>
			line.startsWith("create-review"),
		);
		expect(createReviewLogs).toHaveLength(1);
		expect(createReviewLogs[0]).toContain(`commitOID=${HEAD}`);
	});

	it("creates a pending PR comment without storing it locally", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "On the PR",
			},
		);

		expect(res.status).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		expect((await harness.logLines()).some((line) => line.startsWith("add-thread"))).toBe(true);
	});

	it("publishes a PR comment immediately without opening a review", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 2,
				endLine: 3,
				body: "Publish now",
				pending: false,
			},
		);

		expect(res.status, res.body).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		const logs = await harness.logLines();
		const create = logs.find((line) => line.startsWith("create-immediate-comment"));
		expect(create).toContain(`commit_id=${HEAD}`);
		expect(create).toContain("path=src/foo.ts");
		expect(create).toContain("line=3");
		expect(create).toContain("side=RIGHT");
		expect(create).toContain("start_line=2");
		expect(create).toContain("start_side=RIGHT");
		expect(logs.some((line) => line.startsWith("create-review"))).toBe(false);
		expect(logs.some((line) => line.startsWith("add-thread"))).toBe(false);
	});

	it("adds a current-head comment to an older pending review", async () => {
		await harness.writeGhShim(makeStalePendingReview());
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "Join the existing review",
			},
		);

		expect(res.status, res.body).toBe(200);
		const logs = await harness.logLines();
		expect(logs).toContainEqual(expect.stringMatching(/^add-thread/));
		expect(logs).not.toContainEqual(expect.stringMatching(/^create-review/));
		expect(logs).not.toContainEqual(expect.stringMatching(/^create-immediate-comment/));
	});

	it("does not publish immediately when a pending review appeared after fetch", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "Refresh before deciding",
				pending: false,
			},
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/pending GitHub review now exists/i);
		expect(await harness.logLines()).not.toContainEqual(
			expect.stringMatching(/^create-immediate-comment/),
		);
	});

	it("rejects PR comments from a working-tree run", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun({ committed: false });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "On the PR",
			},
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/committed diff/i),
		});
	});

	it("rejects PR comments when the run has a different merge base", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { mergeBaseOid: "d".repeat(40) });
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			{
				filePath: "src/foo.ts",
				side: "additions",
				startLine: 3,
				endLine: 3,
				body: "On the PR",
			},
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/current PR diff/i),
		});
	});

	it("rejects a local thread from another repository with the same diff", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ repoRoot: "/other/repository" });

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/repository/i),
		});
	});

	it("keeps an ambiguous legacy thread visible and claimable", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ repoRoot: "" });
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const promote = await harness.request(port, "POST", `/api/runs/${runId}/review/add`, {
			localThreadId,
		});

		expect(JSON.parse(read.body).threads).toEqual([
			expect.objectContaining({ id: localThreadId, source: "local" }),
		]);
		expect(promote.status).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
	});

	it("restores an ambiguous legacy claim when the remote write fails", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { failAddThread: true });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ repoRoot: "" });

		const promote = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/add`,
			{ localThreadId },
		);
		const [thread] = harness.db.select().from(commentThread).all();

		expect(promote.status).toBe(500);
		expect(thread?.repoRoot).toBe("");
	});
});
