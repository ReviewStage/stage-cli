import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	makeSummaryOnlyPendingReview,
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
		expect((await harness.logLines()).filter((line) => line === "create-review")).toHaveLength(1);
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

	it("submits the pending review with the chosen event", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "LGTM" },
		);

		expect(res.status).toBe(200);
		expect((await harness.logLines()).find((line) => line.startsWith("submit"))).toContain(
			"event=APPROVE",
		);
	});

	it("rejects an empty comment review", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "COMMENT", body: "   " },
		);

		expect(res.status).toBe(400);
		expect((await harness.logLines()).join("\n")).not.toMatch(/create-review|submit/);
	});

	it("rejects a request for changes without a summary", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "REQUEST_CHANGES", body: "   " },
		);

		expect(res.status).toBe(400);
		expect(JSON.parse(res.body)).toEqual({
			error: expect.stringMatching(/summary.*request changes/i),
		});
		expect((await harness.logLines()).join("\n")).not.toMatch(/submit/);
	});

	it("allows an existing pending summary to be cleared", async () => {
		await harness.writeGhShim(makeSummaryOnlyPendingReview());
		const runId = harness.insertRun();

		const submit = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/submit`,
			{ event: "APPROVE", body: "" },
		);
		const log = (await harness.logLines()).find((line) => line.startsWith("submit")) ?? "";

		expect(submit.status).toBe(200);
		expect(log).toContain("body=");
		expect(log).not.toContain("Existing draft summary");
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
