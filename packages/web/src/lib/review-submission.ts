import { REVIEW_EVENT, type ReviewEvent } from "@stagereview/types/review";

interface ReviewSubmissionInput {
	event: ReviewEvent;
	body: string;
	pendingCommentCount: number;
	isSubmitting: boolean;
}

export function canSubmitReview(input: ReviewSubmissionInput): boolean {
	if (input.isSubmitting) return false;
	if (input.event === REVIEW_EVENT.REQUEST_CHANGES) return input.body.trim().length > 0;
	if (input.event === REVIEW_EVENT.COMMENT) {
		return input.body.trim().length > 0 || input.pendingCommentCount > 0;
	}
	return true;
}
