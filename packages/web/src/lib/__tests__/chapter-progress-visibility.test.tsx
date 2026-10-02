// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ChapterProgress } from "@/components/chapter/chapter-progress";
import {
	CHAPTER_PROGRESS_MODE,
	CHAPTER_PROGRESS_MODE_OPTIONS,
	isChapterProgressMode,
} from "../chapter-progress";
import { ChapterSettingsProvider, useChapterSettings } from "../use-chapter-settings";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function makeChapter(order: number) {
	return { id: String(order), externalId: String(order), order, title: `Review step ${order + 1}` };
}

function ProgressSettingsHarness() {
	const { chapterProgressMode, setChapterProgressMode } = useChapterSettings();
	return (
		<>
			<select
				aria-label="Chapter progress display"
				value={chapterProgressMode}
				onChange={(event) => {
					const mode = event.target.value;
					if (isChapterProgressMode(mode)) setChapterProgressMode(mode);
				}}
			>
				{CHAPTER_PROGRESS_MODE_OPTIONS.map(({ value, label }) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
			<ChapterProgress
				chapters={[makeChapter(0), makeChapter(1)]}
				viewState={{ reviewedChapterIds: new Set(["0"]), visitedChapterIds: new Set(["1"]) }}
				activeChapterNumber={2}
				onNavigateToChapter={() => {}}
				isLoading={false}
				error={null}
			/>
		</>
	);
}

it("removes the entire strip when hidden and restores review progress when shown again", () => {
	render(<ProgressSettingsHarness />, { wrapper: ChapterSettingsProvider });
	const setting = screen.getByRole("combobox", { name: "Chapter progress display" });

	fireEvent.change(setting, { target: { value: CHAPTER_PROGRESS_MODE.HIDDEN } });

	expect(screen.queryByRole("region", { name: "Chapter progress" })).toBeNull();
	expect(screen.queryByRole("navigation", { name: "Chapter navigation" })).toBeNull();
	expect(screen.queryByText("Reviewed 1 of 2")).toBeNull();
	expect(screen.queryByRole("button", { name: /Chapter 1:/ })).toBeNull();

	fireEvent.change(setting, { target: { value: CHAPTER_PROGRESS_MODE.COMPACT } });

	expect(screen.getByText("Reviewed 1 of 2")).toBeDefined();
	expect(screen.getByRole("button", { name: "Chapter 1: Review step 1. Reviewed" })).toBeDefined();
	expect(screen.getByRole("button", { name: "Chapter 2: Review step 2. Visited" })).toBeDefined();
});
