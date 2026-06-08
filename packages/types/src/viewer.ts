import { z } from "zod";

// The local reviewer's display identity, resolved from `gh` (falling back to git
// config, then a generic label). `avatarUrl` is null when no GitHub avatar is known.
export const ViewerSchema = z.object({
	name: z.string(),
	avatarUrl: z.string().nullable(),
});
export type Viewer = z.infer<typeof ViewerSchema>;
