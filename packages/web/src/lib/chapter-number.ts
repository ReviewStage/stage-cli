/**
 * Parses a 1-based chapter number from a URL segment. `/chapters/1e2` and
 * `/chapters/1.5` read as chapter 1, matching `Number.parseInt`.
 */
export function parseChapterNumber(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Clamps a requested chapter number into a run of `chapterCount` chapters. */
export function clampChapterNumber(chapterNumber: number, chapterCount: number): number {
	return Math.min(Math.max(chapterNumber, 1), Math.max(chapterCount, 1));
}
