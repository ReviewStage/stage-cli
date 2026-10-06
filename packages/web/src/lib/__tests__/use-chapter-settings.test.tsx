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
	it.each([
		CHAPTER_PROGRESS_MODE.WITH_TITLES,
		CHAPTER_PROGRESS_MODE.HIDDEN,
	])("restores %s after the provider remounts", (mode) => {
		const first = renderHook(useChapterSettings, { wrapper: ChapterSettingsProvider });
		expect(first.result.current.chapterProgressMode).toBe(CHAPTER_PROGRESS_MODE.COMPACT);

		act(() => first.result.current.setChapterProgressMode(mode));
		first.unmount();
		const second = renderHook(useChapterSettings, { wrapper: ChapterSettingsProvider });

		expect(second.result.current.chapterProgressMode).toBe(mode);
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
