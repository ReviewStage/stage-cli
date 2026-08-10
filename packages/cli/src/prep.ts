import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hunk, PullRequestFile } from "@stagereview/types/parsed-diff";
import { z } from "zod";
import { truncatePrBody } from "./constants.js";
import { parseGitDiff } from "./diff-parser.js";
import { filterFilesForLlm, loadStageIgnore } from "./filter-files.js";
import { formatHunkDiffWithLineNumbers } from "./format-diff.js";
import { getCommitMessages, readRepoContext } from "./git.js";
import { getPullRequest } from "./github/index.js";
import {
	combineInstructions,
	formatInstructionsBlock,
	loadStageInstructions,
} from "./instructions.js";
import { type DiffScopeOptions, resolveDiffScope } from "./scope.js";

// One-off instructions share hosted Stage's per-run cap (chapters.ts regenerate input).
const runInstructionsSchema = z.string().max(1000).nullable().optional();

export interface PrepOptions extends DiffScopeOptions {
	/** One-off instructions appended to the prep file's ADDITIONAL INSTRUCTIONS block. */
	instructions?: string;
}

function formatHunkForPrompt(file: PullRequestFile, hunk: Hunk): string {
	return `=== File: ${file.path} (${file.status}) | filePath: "${file.path}", oldStart: ${hunk.oldStart} ===
=== Hunk @${hunk.oldStart}: ${hunk.header} ===
${formatHunkDiffWithLineNumbers(hunk)}`;
}

export async function runPrep(options: PrepOptions): Promise<string> {
	const runInstructions = runInstructionsSchema.parse(options.instructions);
	const { scope, rawDiff, mergeBaseSha, prNumber } = await resolveDiffScope(options);
	const { root: repoRoot, originUrl } = readRepoContext();

	const allFiles = parseGitDiff(rawDiff);
	const stageIgnore = loadStageIgnore(repoRoot);
	const { files } = filterFilesForLlm(allFiles, stageIgnore);

	const formattedHunks = files
		.flatMap((file) => file.hunks.map((hunk) => formatHunkForPrompt(file, hunk)))
		.join("\n\n");

	const totalFiles = files.length;
	const totalAdded = files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeleted = files.reduce((sum, f) => sum + f.deletions, 0);
	const fileTypes = [...new Set(files.map((f) => f.path.split(".").pop() || "unknown"))].join(", ");

	const commitMessages = getCommitMessages(mergeBaseSha, scope.headSha);

	const sections: string[] = [];

	const pullRequest =
		prNumber === null ? null : await getPullRequest(repoRoot, originUrl, prNumber);
	if (pullRequest) {
		sections.push(
			"=== PULL REQUEST ===",
			`PR Title: ${pullRequest.title}`,
			`PR Description: ${truncatePrBody(pullRequest.body) || "(none)"}`,
			"",
		);
	}

	sections.push(
		"=== STATS ===",
		`Stats: ${totalFiles} files, +${totalAdded}/-${totalDeleted} lines (${fileTypes})`,
		"",
		"=== COMMIT MESSAGES ===",
		commitMessages,
		"",
		"=== HUNKS ===",
		formattedHunks,
	);

	const instructions = combineInstructions(loadStageInstructions(repoRoot), runInstructions);
	const content = sections.join("\n") + formatInstructionsBlock(instructions);

	const filePath = path.join(tmpdir(), `stage-prep-${Date.now()}.txt`);
	writeFileSync(filePath, content, "utf8");

	return filePath;
}
