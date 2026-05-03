import type { RepoContext } from "../git.js";
import type { ChaptersFile } from "../schema.js";

const SHA = {
	base: "1111111111111111111111111111111111111111",
	head: "2222222222222222222222222222222222222222",
	mergeBase: "3333333333333333333333333333333333333333",
} as const;

export function makeRepoContext(over: Partial<RepoContext> = {}): RepoContext {
	return { root: "/repo", originUrl: null, ...over };
}

export function makeFixture(over: Partial<ChaptersFile> = {}): ChaptersFile {
	return {
		scope: {
			kind: "committed",
			baseSha: SHA.base,
			headSha: SHA.head,
			mergeBaseSha: SHA.mergeBase,
		},
		chapters: [
			{
				id: "chapter-0",
				order: 1,
				title: "Wire org ID through the API layer",
				summary: "Threads orgId through request handlers so tenant queries scope correctly.",
				hunkRefs: [{ filePath: "src/foo.ts", oldStart: 1 }],
				keyChanges: [
					{
						content: "Should orgId fall back to the user's primary org?",
						lineRefs: [{ filePath: "src/foo.ts", side: "additions", startLine: 5, endLine: 10 }],
					},
				],
			},
		],
		generatedAt: "2026-04-26T12:00:00.000Z",
		...over,
	};
}
