// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CHAPTER_PROGRESS_MODE,
	CHAPTER_PROGRESS_MODE_STORAGE_KEY,
	ChapterSettingsProvider,
	useChapterSettings,
} from "../use-chapter-settings";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("chapter progress preference", () => {
	it("restores the selected mode after the provider remounts", () => {
		const first = renderHook(useChapterSettings, { wrapper: ChapterSettingsProvider });
		expect(first.result.current.chapterProgressMode).toBe(CHAPTER_PROGRESS_MODE.COMPACT);

		act(() => first.result.current.setChapterProgressMode(CHAPTER_PROGRESS_MODE.WITH_TITLES));
		first.unmount();
		const second = renderHook(useChapterSettings, { wrapper: ChapterSettingsProvider });

		expect(second.result.current.chapterProgressMode).toBe(CHAPTER_PROGRESS_MODE.WITH_TITLES);
	});

	it.each([
		'"unknown"',
		"null",
		"42",
		"{broken",
	])("uses Compact for an invalid persisted value: %s", (raw) => {
		window.localStorage.setItem(CHAPTER_PROGRESS_MODE_STORAGE_KEY, raw);

		const { result } = renderHook(useChapterSettings, { wrapper: ChapterSettingsProvider });

		expect(result.current.chapterProgressMode).toBe(CHAPTER_PROGRESS_MODE.COMPACT);
	});
});
