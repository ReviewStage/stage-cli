import { ReviewResponseSchema } from "@stagereview/types/review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	makeCrossSideRangeReview,
	makeFileLevelThreadReview,
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
		expect(review.pendingComments).toEqual([
			{
				id: "COMMENT_pending",
				filePath: "src/bar.ts",
				line: 4,
				subjectType: "LINE",
				body: "Draft comment",
			},
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

	it("surfaces whole-file threads without a line anchor and drops outdated line threads", async () => {
		await harness.writeGhShim(makeFileLevelThreadReview());
		const runId = harness.insertRun();

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.threads.map((t) => t.id).sort()).toEqual(["THREAD_file", "THREAD_sub"]);
		expect(review.threads.find((t) => t.id === "THREAD_file")).toMatchObject({
			source: "github",
			subjectType: "FILE",
			filePath: "src/foo.ts",
			startLine: null,
			endLine: null,
		});
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

	it("resolves a branch run's PR from its import-time branch, not the checkout", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { discoveredPullRequest: true });
		const runId = harness.insertRun({ prNumber: null, headRef: "feature" });

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("available");
		expect(review.canWriteToGitHub).toBe(true);
		const calls = await harness.ghArgvCalls();
		const list = calls.find((args) => args[0] === "pr" && args[1] === "list");
		expect(list).toContain("--head");
		expect(list).toContain("feature");
		const view = calls.find((args) => args[0] === "pr" && args[1] === "view");
		expect(view?.[2]).toBe("5");
	});

	it("keeps checkout discovery for legacy runs without a recorded branch", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { discoveredPullRequest: true });
		const runId = harness.insertRun({ prNumber: null });

		const res = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);

		const review = ReviewResponseSchema.parse(JSON.parse(res.body));
		expect(review.github).toBe("available");
		const calls = await harness.ghArgvCalls();
		expect(calls.some((args) => args[0] === "pr" && args[1] === "list")).toBe(false);
		const view = calls.find((args) => args[0] === "pr" && args[1] === "view");
		expect(view?.[2]).toBe("--json");
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
		expect(review.canWriteToGitHub).toBe(false);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("Pull request not found on GitHub"),
		);
	});
});
