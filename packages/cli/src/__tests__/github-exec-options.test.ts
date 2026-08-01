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
});
