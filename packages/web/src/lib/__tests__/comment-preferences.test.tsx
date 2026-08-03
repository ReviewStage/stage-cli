// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	COMMENT_LOCAL_STORAGE_KEY,
	COMMENT_START_REVIEW_STORAGE_KEY,
	resolveCommentControls,
	useCommentPreferences,
} from "../comment-preferences";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const GITHUB_AVAILABLE = {
	canWriteToGitHub: true,
	canPushToReview: true,
	hasPendingReview: false,
	isGitHubAnchor: true,
};

describe("resolveCommentControls", () => {
	it("defaults to a GitHub comment that starts a review", () => {
		expect(resolveCommentControls({ local: false, startReview: true }, GITHUB_AVAILABLE)).toEqual({
			local: false,
			localDisabled: false,
			startReview: true,
			showStartReview: true,
		});
	});

	it("hides the review choice while Local is selected", () => {
		expect(resolveCommentControls({ local: true, startReview: true }, GITHUB_AVAILABLE)).toEqual({
			local: true,
			localDisabled: false,
			startReview: false,
			showStartReview: false,
		});
	});

	it("joins a valid pending review and hides a choice that no longer applies", () => {
		expect(
			resolveCommentControls(
				{ local: false, startReview: false },
				{ ...GITHUB_AVAILABLE, hasPendingReview: true },
			),
		).toEqual({
			local: false,
			localDisabled: false,
			startReview: true,
			showStartReview: false,
		});
	});

	it("joins a stale pending review using a current-head GitHub comment", () => {
		expect(
			resolveCommentControls(
				{ local: false, startReview: false },
				{ ...GITHUB_AVAILABLE, canPushToReview: false, hasPendingReview: true },
			),
		).toEqual({
			local: false,
			localDisabled: false,
			startReview: true,
			showStartReview: false,
		});
	});

	it("temporarily forces Local when GitHub cannot accept any comment", () => {
		expect(
			resolveCommentControls(
				{ local: false, startReview: true },
				{ ...GITHUB_AVAILABLE, canPushToReview: false, canWriteToGitHub: false },
			),
		).toEqual({
			local: true,
			localDisabled: true,
			startReview: false,
			showStartReview: false,
		});
	});
});

describe("useCommentPreferences", () => {
	it("persists both choices independently", () => {
		const { result } = renderHook(() => useCommentPreferences());
		expect(result.current.local).toBe(false);
		expect(result.current.startReview).toBe(true);

		act(() => {
			result.current.setLocal(true);
			result.current.setStartReview(false);
		});

		expect(result.current.local).toBe(true);
		expect(result.current.startReview).toBe(false);
		expect(window.localStorage.getItem(COMMENT_LOCAL_STORAGE_KEY)).toBe("true");
		expect(window.localStorage.getItem(COMMENT_START_REVIEW_STORAGE_KEY)).toBe("false");
	});
});
