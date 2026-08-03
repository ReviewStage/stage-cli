import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile);

beforeEach(() => {
	execFileMock.mockImplementation((_file, _args, _options, callback) => {
		if (typeof callback === "function") callback(null, "ok", "");
		return {} as ReturnType<typeof execFile>;
	});
});

describe("gh timeout policy", () => {
	it("does not apply the passive-review timeout to general reads", async () => {
		const { gh } = await import("../github/exec.js");

		await gh(["api", "--paginate"], "/tmp");

		expect(execFileMock).toHaveBeenCalledWith(
			"gh",
			["api", "--paginate"],
			expect.objectContaining({ timeout: undefined }),
			expect.any(Function),
		);
	});

	it("bounds the optional REST lookup during pull request discovery", async () => {
		execFileMock.mockImplementation((_file, args, _options, callback) => {
			const stdout =
				args?.[0] === "pr"
					? JSON.stringify({
							number: 70,
							title: "Review",
							body: null,
							url: "https://github.com/owner/repo/pull/70",
							state: "OPEN",
							isDraft: false,
							mergedAt: null,
							createdAt: "2026-01-01T00:00:00Z",
							author: { login: "octocat" },
							headRefName: "feature",
							headRefOid: "a".repeat(40),
							baseRefName: "main",
						})
					: JSON.stringify({ user: null });
			const done = typeof callback === "function" ? callback : _options;
			if (typeof done === "function") {
				done(null, { stdout, stderr: "" } as never, "");
			}
			return {} as ReturnType<typeof execFile>;
		});
		const { getPullRequestOrThrow } = await import("../github/pull-request.js");

		await getPullRequestOrThrow("/tmp", "git@github.com:owner/repo.git", null);

		expect(execFileMock).toHaveBeenLastCalledWith(
			"gh",
			["api", "repos/owner/repo/pulls/70"],
			expect.objectContaining({ timeout: 30_000 }),
			expect.any(Function),
		);
	});
});
