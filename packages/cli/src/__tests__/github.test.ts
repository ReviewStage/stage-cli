import { describe, expect, it } from "vitest";
import { isGitHubRemote, parseGitHubRepo } from "../github/index.js";

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

describe("isGitHubRemote", () => {
	it("is true for github.com remotes", () => {
		expect(isGitHubRemote("git@github.com:owner/repo.git")).toBe(true);
	});

	it("is false for non-GitHub and missing remotes", () => {
		expect(isGitHubRemote("git@gitlab.com:owner/repo.git")).toBe(false);
		expect(isGitHubRemote(null)).toBe(false);
	});
});
