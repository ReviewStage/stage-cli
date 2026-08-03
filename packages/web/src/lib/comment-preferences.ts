import { useLocalStorage } from "./use-local-storage";

export const COMMENT_LOCAL_STORAGE_KEY = "comment-local";
export const COMMENT_START_REVIEW_STORAGE_KEY = "comment-startReview";

export interface CommentPreferences {
	local: boolean;
	startReview: boolean;
}

export interface CommentAvailability {
	canWriteToGitHub: boolean;
	canPushToReview: boolean;
	hasPendingReview: boolean;
	isGitHubAnchor: boolean;
}

export interface CommentControls {
	local: boolean;
	localDisabled: boolean;
	startReview: boolean;
	showStartReview: boolean;
}

/**
 * Resolves stored preferences against the GitHub state fetched for this run. Live
 * availability can temporarily force a local comment, but never overwrites the
 * preference the reviewer chose for the next eligible comment. GitHub permits a
 * current-head comment to join an older pending review, so an existing review is
 * always reused while direct GitHub writes remain available.
 */
export function resolveCommentControls(
	preferences: CommentPreferences,
	availability: CommentAvailability,
): CommentControls {
	const canUseGitHub = availability.isGitHubAnchor && availability.canWriteToGitHub;
	const local = preferences.local || !canUseGitHub;
	return {
		local,
		localDisabled: !canUseGitHub,
		startReview: !local && (availability.hasPendingReview || preferences.startReview),
		showStartReview: canUseGitHub && !local && !availability.hasPendingReview,
	};
}

export function useCommentPreferences() {
	const [local, setLocal] = useLocalStorage(COMMENT_LOCAL_STORAGE_KEY, false);
	const [startReview, setStartReview] = useLocalStorage(COMMENT_START_REVIEW_STORAGE_KEY, true);
	return { local, startReview, setLocal, setStartReview };
}
