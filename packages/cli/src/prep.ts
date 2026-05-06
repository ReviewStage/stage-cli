import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hunk, PullRequestFile } from "@stagereview/types/parsed-diff";
import { parseGitDiff } from "./diff-parser.js";
import { filterFilesForLlm } from "./filter-files.js";
import { formatHunkDiff } from "./format-diff.js";
import { getCommitMessages, resolveScope } from "./git.js";

function formatHunkForPrompt(file: PullRequestFile, hunk: Hunk): string {
	return `=== File: ${file.path} (${file.status}) | filePath: "${file.path}", oldStart: ${hunk.oldStart} ===
=== Hunk @${hunk.oldStart}: ${hunk.header} ===
${formatHunkDiff(hunk)}`;
}

export function runPrep(): string {
	const { rawDiff, mergeBaseSha } = resolveScope();

	const allFiles = parseGitDiff(rawDiff);
	const { files } = filterFilesForLlm(allFiles);

	const formattedHunks = files
		.flatMap((file) => file.hunks.map((hunk) => formatHunkForPrompt(file, hunk)))
		.join("\n\n");

	const commitMessages = getCommitMessages(mergeBaseSha);

	const output = JSON.stringify({ formattedHunks, commitMessages });
	const filePath = path.join(tmpdir(), `stage-prep-${Date.now()}.json`);
	writeFileSync(filePath, output, "utf8");

	return filePath;
}
