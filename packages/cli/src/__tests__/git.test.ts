import { describe, expect, it } from "vitest";
import { parseRepoName } from "../git.js";

describe("parseRepoName", () => {
	const FALLBACK_ROOT = "/Users/dev/conductor/workspaces/stage-cli/monterrey-v3";

	it("extracts the repo name from an SSH URL", () => {
		expect(parseRepoName("git@github.com:ReviewStage/stage-cli.git", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("extracts the repo name from an HTTPS URL", () => {
		expect(parseRepoName("https://github.com/ReviewStage/stage-cli.git", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("extracts the repo name from an HTTPS URL without .git suffix", () => {
		expect(parseRepoName("https://github.com/ReviewStage/stage-cli", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("extracts the repo name from an ssh:// URL", () => {
		expect(parseRepoName("ssh://git@github.com/ReviewStage/stage-cli.git", FALLBACK_ROOT)).toBe(
			"stage-cli",
		);
	});

	it("falls back to the worktree basename when originUrl is null", () => {
		expect(parseRepoName(null, FALLBACK_ROOT)).toBe("monterrey-v3");
	});

	it("falls back to the worktree basename for an empty/garbage URL", () => {
		expect(parseRepoName("", FALLBACK_ROOT)).toBe("monterrey-v3");
		expect(parseRepoName(".git", FALLBACK_ROOT)).toBe("monterrey-v3");
	});
});
