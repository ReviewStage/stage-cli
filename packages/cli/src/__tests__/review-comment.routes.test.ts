import type { GitHubCommentCreateBody } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commentThread } from "../db/schema/index.js";
import {
	EMPTY_REVIEW,
	HEAD,
	REVIEW_QUERY_RESULT,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

function commentInput(overrides: Partial<GitHubCommentCreateBody> = {}): GitHubCommentCreateBody {
	return {
		filePath: "src/foo.ts",
		side: "additions",
		startLine: 3,
		endLine: 3,
		body: "On the PR",
		pending: true,
		...overrides,
	};
}

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

describe("review API — create comment", () => {
	it("creates a pending PR comment without storing it locally", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			commentInput(),
		);

		expect(res.status).toBe(200);
		expect(harness.db.select().from(commentThread).all()).toHaveLength(0);
		expect((await harness.logLines()).some((line) => line.startsWith("add-thread"))).toBe(true);
	});

	it("sends GitHub comment bodies through stdin instead of argv", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const marker = "body-that-must-not-appear-in-process-arguments";

		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			commentInput({ body: marker }),
		);

		expect(res.status, res.body).toBe(200);
		const mutationArgs = (await harness.ghArgvCalls()).filter((args) => args.includes("--input"));
		expect(mutationArgs).toContainEqual(["api", "graphql", "--input", "-"]);
		expect(JSON.stringify(mutationArgs)).not.toContain(marker);
	});

	it("publishes a PR comment immediately without opening a review", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			commentInput({ startLine: 2, body: "Publish now", pending: false }),
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
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();
		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			commentInput({ body: "Join the existing review" }),
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
			commentInput({ body: "Refresh before deciding", pending: false }),
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
			commentInput(),
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/committed diff/i);
	});

	it("rejects PR comments when the run has a different merge base", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { mergeBaseOid: "d".repeat(40) });
		const runId = harness.insertRun();
		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			commentInput(),
		);

		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toMatch(/current PR diff/i);
	});

	it("preserves line-range validation from the local comment schema", async () => {
		await harness.writeGhShim(EMPTY_REVIEW);
		const runId = harness.insertRun();
		const res = await harness.request(
			await harness.start(),
			"POST",
			`/api/runs/${runId}/review/comment`,
			commentInput({ startLine: 4, body: "Bad range" }),
		);

		expect(res.status).toBe(400);
		expect((await harness.logLines()).filter(Boolean)).toEqual([]);
	});
});
