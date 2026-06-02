/**
 * Shared resize bounds for the chapter side panel. Width is viewport-relative:
 * a 30% default capped at 50%, with a fixed pixel floor.
 */
export const CHAPTER_PANEL_MIN_WIDTH = 280;
export const CHAPTER_PANEL_MAX_WIDTH_FRACTION = 0.5;

export const resolveChapterPanelDefaultWidth = (viewportWidth: number) =>
	Math.round(viewportWidth * 0.3);

export const resolveChapterPanelMaxWidth = (viewportWidth: number) =>
	Math.round(viewportWidth * CHAPTER_PANEL_MAX_WIDTH_FRACTION);
