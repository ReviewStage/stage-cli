import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Run a read-only `gh` command in `cwd` and return its stdout. */
export async function gh(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout;
}
