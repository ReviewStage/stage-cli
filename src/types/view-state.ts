import { z } from "zod";

export const ViewStateSchema = z.object({
	chapterIds: z.array(z.string()),
	keyChangeIds: z.array(z.string()),
});
export type ViewState = z.infer<typeof ViewStateSchema>;
