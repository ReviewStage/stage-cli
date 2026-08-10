import { z } from "zod";
import { ghReadOrThrow, ghWriteOrThrow } from "./exec.js";
import type { GitHubRepo } from "./repo.js";

// The subset of GitHub's REST label the UI renders (hosted uses the full REST
// `label` schema; extra fields are stripped on parse).
export const GitHubLabelSchema = z.object({
	id: z.number(),
	name: z.string(),
	color: z.string(),
	description: z.string().nullable().optional(),
});
export type GitHubLabel = z.infer<typeof GitHubLabelSchema>;

// `--paginate --slurp` wraps every page into one JSON array (`[[…], […]]`).
const LabelPagesSchema = z.array(z.array(GitHubLabelSchema));

async function listLabels(repoRoot: string, endpoint: string): Promise<GitHubLabel[]> {
	const stdout = await ghReadOrThrow(["api", endpoint, "--paginate", "--slurp"], repoRoot);
	const parsed = LabelPagesSchema.safeParse(JSON.parse(stdout));
	if (!parsed.success) {
		throw new Error(`Unexpected response shape from GitHub label list (${endpoint})`);
	}
	return parsed.data.flat();
}

/** Every label defined on the repository, for the add-label picker. */
export function listRepositoryLabels(repoRoot: string, repo: GitHubRepo): Promise<GitHubLabel[]> {
	return listLabels(repoRoot, `repos/${repo.owner}/${repo.repo}/labels`);
}

/** The labels currently applied to a pull request (labels live on the issue side). */
export function listPullRequestLabels(
	repoRoot: string,
	repo: GitHubRepo,
	pullRequestNumber: number,
): Promise<GitHubLabel[]> {
	return listLabels(
		repoRoot,
		`repos/${repo.owner}/${repo.repo}/issues/${pullRequestNumber}/labels`,
	);
}

export async function addLabelsToPullRequest(
	repoRoot: string,
	repo: GitHubRepo,
	pullRequestNumber: number,
	labels: string[],
): Promise<void> {
	await ghWriteOrThrow(
		[
			"api",
			"--method",
			"POST",
			`repos/${repo.owner}/${repo.repo}/issues/${pullRequestNumber}/labels`,
			"--input",
			"-",
		],
		repoRoot,
		{ stdin: JSON.stringify({ labels }) },
	);
}

export async function removeLabelFromPullRequest(
	repoRoot: string,
	repo: GitHubRepo,
	pullRequestNumber: number,
	label: string,
): Promise<void> {
	// Label names may contain spaces/unicode; they travel in the URL path.
	await ghWriteOrThrow(
		[
			"api",
			"--method",
			"DELETE",
			`repos/${repo.owner}/${repo.repo}/issues/${pullRequestNumber}/labels/${encodeURIComponent(label)}`,
		],
		repoRoot,
	);
}
