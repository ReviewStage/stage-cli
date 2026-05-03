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
