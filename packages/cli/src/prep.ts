import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hunk, PullRequestFile } from "@stagereview/types/parsed-diff";
import { parseGitDiff } from "./diff-parser.js";
import { filterFilesForLlm, loadStageIgnore } from "./filter-files.js";
import { formatHunkDiffWithLineNumbers } from "./format-diff.js";
import { getCommitMessages, readRepoRoot } from "./git.js";
import { type DiffScopeOptions, resolveDiffScope } from "./scope.js";

function formatHunkForPrompt(file: PullRequestFile, hunk: Hunk): string {
	return `=== File: ${file.path} (${file.status}) | filePath: "${file.path}", oldStart: ${hunk.oldStart} ===
=== Hunk @${hunk.oldStart}: ${hunk.header} ===
${formatHunkDiffWithLineNumbers(hunk)}`;
}

export async function runPrep(options: DiffScopeOptions): Promise<string> {
	const { scope, rawDiff, mergeBaseSha } = await resolveDiffScope(options);

	const allFiles = parseGitDiff(rawDiff);
	const stageIgnore = loadStageIgnore(readRepoRoot());
	const { files } = filterFilesForLlm(allFiles, stageIgnore);

	const formattedHunks = files
		.flatMap((file) => file.hunks.map((hunk) => formatHunkForPrompt(file, hunk)))
		.join("\n\n");

	const commitMessages = getCommitMessages(mergeBaseSha, scope.headSha);

	const sections = ["=== COMMIT MESSAGES ===", commitMessages, "", "=== HUNKS ===", formattedHunks];

	const filePath = path.join(tmpdir(), `stage-prep-${Date.now()}.txt`);
	writeFileSync(filePath, sections.join("\n"), "utf8");

	return filePath;
}
