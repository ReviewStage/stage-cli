import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commentThread } from "../db/schema/index.js";
import { REVIEW_ACTION_SCOPE, reviewActions } from "../runs/review-action-queue.js";
import {
	EMPTY_REVIEW,
	makeInterruptedPromotionReview,
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

describe("review API — promotion identity", () => {
	it("locks the repository that owns a stale promotion", async () => {
		await harness.writeGhShim(makeInterruptedPromotionReview(), {
			recoveryPullRequestNodeId: "PR_old",
			recoveryRepoOwner: "previous-owner",
			recoveryRepoName: "previous-repo",
		});
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		checkpoint(localThreadId, { pullRequestNodeId: "PR_old" });
		const runSpy = vi.spyOn(reviewActions, "run");

		const promotion = await promote(runId, localThreadId);

		expect(promotion.status).toBe(409);
		expect(runSpy.mock.calls.map(([scope]) => scope)).toContainEqual({
			kind: REVIEW_ACTION_SCOPE.PULL_REQUEST,
			owner: "previous-owner",
			repo: "previous-repo",
			prNumber: harness.pullRequestNumber,
		});
	});

	it("refuses recovery after the authenticated viewer changes", async () => {
		await harness.writeGhShim(EMPTY_REVIEW, { recoveryRootAuthorLogin: "previous-user" });
		const runId = harness.insertRun();
		const localThreadId = harness.seedLocalThread({ withReply: true });
		checkpoint(localThreadId, { viewerLogin: "previous-user" });

		const promotion = await promote(runId, localThreadId);
		const [savedThread] = harness.db.select().from(commentThread).all();

		expect(promotion.status).toBe(409);
		expect((await harness.logLines()).filter((line) => line.startsWith("add-thread"))).toHaveLength(
			0,
		);
		expect(savedThread?.promotionViewerLogin).toBe("previous-user");
		expect(savedThread?.promotionThreadNodeId).toBe("THREAD_new");
	});
});

function checkpoint(
	localThreadId: string,
	options: { pullRequestNodeId?: string; viewerLogin?: string } = {},
): void {
	harness.db
		.update(commentThread)
		.set({
			promotionPullRequestNodeId: options.pullRequestNodeId ?? "PR_node",
			promotionThreadNodeId: "THREAD_new",
			promotionRootCommentNodeId: "COMMENT_new",
			promotionViewerLogin: options.viewerLogin ?? "octocat",
			promotionReplyCount: 0,
		})
		.where(eq(commentThread.id, localThreadId))
		.run();
}

async function promote(runId: string, localThreadId: string) {
	return harness.request(await harness.start(), "POST", `/api/runs/${runId}/review/add`, {
		localThreadId,
	});
}
