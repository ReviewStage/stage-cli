import { z } from "zod";

// Vendored from hosted Stage's `packages/github/src/pull-request-stack.ts`
// PullRequestStackEntry, extended with `runId`: hosted navigates between PR
// pages by number, while the CLI reviews one PR per run — so the server also
// resolves which stack members have a local run to land on.

/** A single pull request within a detected stack, as surfaced to the reviewer. */
export const PullRequestStackEntrySchema = z.object({
	number: z.number(),
	title: z.string(),
	headRef: z.string(),
	baseRef: z.string(),
	isDraft: z.boolean(),
	/** True for the pull request the stack was derived from. */
	isCurrent: z.boolean(),
	/** Latest local run reviewing this PR in the same repo, or null when it only exists on GitHub. */
	runId: z.string().nullable(),
});
export type PullRequestStackEntry = z.infer<typeof PullRequestStackEntrySchema>;

export const PullRequestStackResponseSchema = z.object({
	/** Ordered base → tip; empty when the current PR is not open or stands alone. */
	stack: z.array(PullRequestStackEntrySchema),
});
export type PullRequestStackResponse = z.infer<typeof PullRequestStackResponseSchema>;
