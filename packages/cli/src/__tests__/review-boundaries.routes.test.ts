import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	makeClosedReview,
	makeMissingPendingCommitReview,
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

describe("review API — GitHub boundaries", () => {
	it("keeps a closed PR's comments visible but disables writes", async () => {
		await harness.writeGhShim(makeClosedReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const edit = await harness.request(port, "POST", `/api/runs/${runId}/review/comment/edit`, {
			nodeId: "COMMENT_pending",
			body: "Nope",
		});
		const review = JSON.parse(read.body);

		expect(read.status).toBe(200);
		expect(review.github).toBe("available");
		expect(review.threads).toHaveLength(2);
		expect(review.canPushToReview).toBe(false);
		expect(review.canWriteToGitHub).toBe(false);
		expect(edit.status).toBe(409);
		expect(JSON.parse(edit.body).error).toMatch(/closed/i);
		expect(await harness.logLines()).not.toContainEqual(expect.stringMatching(/^edit-comment/));
	});

	it("keeps an older pending review writable on the current PR diff", async () => {
		await harness.writeGhShim(makeStalePendingReview());
		const runId = harness.insertRun();
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const reply = await harness.request(port, "POST", `/api/runs/${runId}/review/reply`, {
			creationId: "00000000-0000-4000-8000-000000000001",
			threadNodeId: "THREAD_pending",
			body: "Nope",
			pending: true,
		});
		const immediateReply = await harness.request(port, "POST", `/api/runs/${runId}/review/reply`, {
			creationId: "00000000-0000-4000-8000-000000000002",
			threadNodeId: "THREAD_sub",
			body: "Published now",
			pending: false,
		});
		const resolve = await harness.request(port, "POST", `/api/runs/${runId}/review/resolve`, {
			threadNodeId: "THREAD_sub",
			resolved: true,
		});

		expect(JSON.parse(read.body).canPushToReview).toBe(true);
		expect(JSON.parse(read.body).canWriteToGitHub).toBe(true);
		expect(reply.status).toBe(200);
		expect(immediateReply.status).toBe(200);
		expect(resolve.status).toBe(200);
		expect(await harness.logLines()).toEqual(expect.arrayContaining(["reply", "resolve-thread"]));
	});

	it("keeps stale-run pending review controls available in read-only mode", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT);
		const runId = harness.insertRun({ headSha: "d".repeat(40) });

		const read = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);
		const review = JSON.parse(read.body);

		expect(read.status).toBe(200);
		expect(review.github).toBe("available");
		expect(review.threads).toHaveLength(0);
		expect(review.pendingCommentCount).toBe(1);
		expect(review.pendingComments).toHaveLength(1);
		expect(review.hasPendingReview).toBe(true);
		expect(review.canPushToReview).toBe(false);
		expect(review.canWriteToGitHub).toBe(false);
	});

	it("treats a pending review with no commit as stale instead of offline", async () => {
		await harness.writeGhShim(makeMissingPendingCommitReview());
		const runId = harness.insertRun();

		const read = await harness.request(await harness.start(), "GET", `/api/runs/${runId}/review`);
		const review = JSON.parse(read.body);

		expect(read.status).toBe(200);
		expect(review.github).toBe("available");
		expect(review.hasPendingReview).toBe(true);
		expect(review.canPushToReview).toBe(true);
		expect(review.canWriteToGitHub).toBe(true);
	});

	it("reports a missing automatically discovered PR without treating GitHub as offline", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { noPullRequest: true });
		const runId = harness.insertRun({ prNumber: null });
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const write = await harness.request(port, "POST", `/api/runs/${runId}/review/comment`, {
			creationId: "00000000-0000-4000-8000-000000000001",
			filePath: "src/foo.ts",
			side: "additions",
			startLine: 3,
			endLine: 3,
			body: "No PR",
		});

		expect(JSON.parse(read.body).github).toBe("none");
		expect(write.status).toBe(404);
		expect(JSON.parse(write.body).error).toMatch(/no GitHub pull request/i);
	});

	it("does not expose another branch's discovered pending review to a stale run", async () => {
		await harness.writeGhShim(REVIEW_QUERY_RESULT, { discoveredPullRequest: true });
		const runId = harness.insertRun({ prNumber: null, headSha: "d".repeat(40) });
		const port = await harness.start();

		const read = await harness.request(port, "GET", `/api/runs/${runId}/review`);
		const discard = await harness.request(port, "POST", `/api/runs/${runId}/review/discard`);
		const review = JSON.parse(read.body);

		expect(read.status).toBe(200);
		expect(review.github).toBe("none");
		expect(review.hasPendingReview).toBe(false);
		expect(review.pendingComments).toHaveLength(0);
		expect(discard.status).toBe(409);
		expect(JSON.parse(discard.body).error).toMatch(/isn't tied to the pull request/i);
		expect(await harness.logLines()).not.toContain("discard-review");
	});
});
