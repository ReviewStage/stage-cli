import { z } from "zod";

export const ViewStateSchema = z.object({
	chapterIds: z.array(z.string()),
	keyChangeIds: z.array(z.string()),
	filePaths: z.array(z.string()),
});
export type ViewState = z.infer<typeof ViewStateSchema>;

export const FileViewBodySchema = z.object({
	path: z.string().min(1),
});
export type FileViewBody = z.infer<typeof FileViewBodySchema>;

/**
 * Body for POST/DELETE /api/chapter-view/:chapterId. `runId` pins the run the
 * user was viewing so GitHub sync targets that run's pull request even when
 * the chapter's externalId fans out across several runs (re-imports of the
 * same scope). Optional so callers addressing a chapter row by uuid — which
 * already identifies its run — can omit it.
 */
export const ChapterViewBodySchema = z.object({
	runId: z.string().min(1).optional(),
});
export type ChapterViewBody = z.infer<typeof ChapterViewBodySchema>;
