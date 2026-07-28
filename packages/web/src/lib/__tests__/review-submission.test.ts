import { REVIEW_EVENT } from "@stagereview/types/review";
import { describe, expect, it } from "vitest";
import { canSubmitReview } from "@/lib/review-submission";

describe("canSubmitReview", () => {
	it("requires a summary when requesting changes even with pending comments", () => {
		expect(
			canSubmitReview({
				event: REVIEW_EVENT.REQUEST_CHANGES,
				body: "   ",
				pendingCommentCount: 2,
				isSubmitting: false,
			}),
		).toBe(false);
	});

	it("allows requesting changes with a summary", () => {
		expect(
			canSubmitReview({
				event: REVIEW_EVENT.REQUEST_CHANGES,
				body: "Please address the race.",
				pendingCommentCount: 0,
				isSubmitting: false,
			}),
		).toBe(true);
	});

	it("allows a bodyless approval", () => {
		expect(
			canSubmitReview({
				event: REVIEW_EVENT.APPROVE,
				body: "",
				pendingCommentCount: 0,
				isSubmitting: false,
			}),
		).toBe(true);
	});

	it("requires content or a pending comment for a comment review", () => {
		expect(
			canSubmitReview({
				event: REVIEW_EVENT.COMMENT,
				body: "",
				pendingCommentCount: 0,
				isSubmitting: false,
			}),
		).toBe(false);
	});
});
