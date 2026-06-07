import { describe, expect, it } from "vitest";
import { isGitHubRemote, parseGitHubRepo, parsePullRequestNumber } from "../github/index.js";

describe("parseGitHubRepo", () => {
	it("parses the SSH shorthand form", () => {
		expect(parseGitHubRepo("git@github.com:owner/repo.git")).toEqual({
			owner: "owner",
			repo: "repo",
		});
	});

	it("parses the HTTPS form", () => {
		expect(parseGitHubRepo("https://github.com/owner/repo.git")).toEqual({
			owner: "owner",
			repo: "repo",
		});
	});

	it("parses the ssh:// URL form without a .git suffix", () => {
		expect(parseGitHubRepo("ssh://git@github.com/acme/Stage-CLI")).toEqual({
			owner: "acme",
			repo: "Stage-CLI",
		});
	});

	it("returns null for non-GitHub hosts", () => {
		expect(parseGitHubRepo("git@gitlab.com:owner/repo.git")).toBeNull();
		expect(parseGitHubRepo("https://bitbucket.org/owner/repo.git")).toBeNull();
	});

	it("returns null for look-alike hosts that merely contain github.com", () => {
		expect(parseGitHubRepo("https://notgithub.com.evil.test/owner/repo")).toBeNull();
	});

	it("returns null when no origin is configured", () => {
		expect(parseGitHubRepo(null)).toBeNull();
	});
});

describe("parsePullRequestNumber", () => {
	const repo = { owner: "owner", repo: "repo" };

	it("parses a bare PR number", () => {
		expect(parsePullRequestNumber("123", repo)).toBe(123);
	});

	it("parses a #-prefixed PR number", () => {
		expect(parsePullRequestNumber("#123", repo)).toBe(123);
	});

	it("parses a PR URL for the current repo", () => {
		expect(parsePullRequestNumber("https://github.com/owner/repo/pull/123", repo)).toBe(123);
	});

	it("ignores trailing path segments on a PR URL", () => {
		expect(parsePullRequestNumber("https://github.com/owner/repo/pull/123/files", repo)).toBe(123);
	});

	it("matches owner/repo case-insensitively", () => {
		expect(parsePullRequestNumber("https://github.com/Owner/Repo/pull/123", repo)).toBe(123);
	});

	it("throws when a PR URL points at a different repository", () => {
		expect(() => parsePullRequestNumber("https://github.com/other/repo/pull/123", repo)).toThrow(
			/different repository/,
		);
	});

	it("throws on an unparseable reference", () => {
		expect(() => parsePullRequestNumber("not-a-pr", repo)).toThrow(/Invalid PR reference/);
	});
});

describe("isGitHubRemote", () => {
	it("is true for github.com remotes", () => {
		expect(isGitHubRemote("git@github.com:owner/repo.git")).toBe(true);
	});

	it("is false for non-GitHub and missing remotes", () => {
		expect(isGitHubRemote("git@gitlab.com:owner/repo.git")).toBe(false);
		expect(isGitHubRemote(null)).toBe(false);
	});
});
