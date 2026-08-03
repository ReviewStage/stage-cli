import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	HEAD,
	makeCrossSideRangeReview,
	makePaginatedThreadReview,
	REVIEW_QUERY_RESULT,
	ReviewRouteHarness,
} from "./review-test-harness.js";

let harness: ReviewRouteHarness;

beforeEach(async () => {
	harness = new ReviewRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	vi.restoreAllMocks();
	await harness.teardown();
});

describe("review API — read", () => {
	it("rejects a cross-origin request for private draft review content", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();

		const res = await harness.request(
			await harness.start(),
			"GET",
			`/api/runs/${runId}/review`,
			undefined,
			{ Origin: "https://evil.example" },
		);

		expect(res.status).toBe(403);
	});

	it("returns local-only when the run has no GitHub remote", async () => {
		const runId = harness.insertRun({ originUrl: null });
		harness.seedLocalThread();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		expect(res.status).toBe(200);
		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("none");
		expect(review.threads[0]?.source).toBe("local");
	});

	it("merges local, pending, and submitted GitHub threads", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun();
		harness.seedLocalThread();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("available");
		expect(review.pendingCommentCount).toBe(1);
		expect(review.pendingComments).toEqual([
			{ id: "COMMENT_pending", filePath: "src/bar.ts", line: 4, body: "Draft comment" },
		]);
		expect(review.threads.map((t) => t.comments[0]?.state).sort()).toEqual([
			"local",
			"pending",
			"submitted",
		]);
	});

	it("preserves both sides of a mixed-side GitHub range", async () => {
		await harness.writeGhShim(makeCrossSideRangeReview());
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);
		const body = JSON.parse(res.body) as {
			threads: Array<{ source: string; side: string; startSide?: string }>;
		};
		const githubThread = body.threads.find((thread) => thread.source === "github");

		expect(githubThread).toMatchObject({ side: "additions", startSide: "deletions" });
	});

	it("loads later pages of comments within a GitHub thread", async () => {
		await harness.writeGhShim(makePaginatedThreadReview());
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);
		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		const githubThread = review.threads.find((thread) => thread.source === "github");

		expect(review.pendingCommentCount).toBe(1);
		expect(review.pendingComments.map((comment) => comment.id)).toEqual(["COMMENT_late"]);
		expect(githubThread?.comments.map((comment) => comment.id)).toEqual([
			"COMMENT_sub",
			"COMMENT_late",
		]);
		expect(await harness.logLines()).toContain("get-thread-comments");
		const queries = (await harness.ghArgvCalls()).flatMap((args) =>
			args.filter((arg) => arg.startsWith("query=")),
		);
		expect(queries.find((query) => query.includes("query GetReview("))).toContain(
			"reviewThreads(first: 10",
		);
		expect(queries.find((query) => query.includes("query GetReview("))).toContain(
			"comments(first: 1)",
		);
		expect(queries.find((query) => query.includes("GetReviewThreadComments"))).toContain(
			"comments(first: 10",
		);
	});

	it("reports offline when a follow-up comment page fails", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeGhShim(makePaginatedThreadReview(), { failThreadComments: true });
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);
		const review = ReviewResponseSchema.parse(JSON.parse(res.body));

		expect(review.github).toBe("offline");
		expect(review.threads).toEqual([]);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("gh: follow-up page failed"));
	});

	it("keeps local threads visible when GitHub is offline", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeFailingGhShim();
		const runId = harness.insertRun();
		harness.seedLocalThread();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("offline");
		expect(review.threads).toHaveLength(1);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("gh: authentication required"));
	});

	it("reports offline when automatic pull request discovery fails", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeFailingGhShim();
		const runId = harness.insertRun({ prNumber: null });

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("offline");
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("gh: authentication required"));
	});

	it("reports offline when the PR cannot be resolved", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await harness.writeGhShim({
			data: { viewer: { login: "octocat" }, repository: { pullRequest: null } },
		});
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("offline");
		expect(review.canPushToReview).toBe(false);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("Pull request not found on GitHub"),
		);
	});

	it("hides GitHub threads when the run does not match the PR head", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun({ headSha: HEAD.replaceAll("a", "d") });

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("available");
		expect(review.threads.every((t) => t.source === "local")).toBe(true);
		expect(review.hasPendingReview).toBe(true);
		expect(review.canPushToReview).toBe(false);
		expect(review.canWriteToGitHub).toBe(false);
	});
});
