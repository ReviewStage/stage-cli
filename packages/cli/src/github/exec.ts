import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GH_TIMEOUT_MS = 30_000;

export interface GhExecOptions {
	/** Bound a spawned `gh` process so passive review reads cannot hang the local UI. */
	timeoutMs?: number;
}

/** Run a read-only `gh` command in `cwd` and return its stdout. */
export async function gh(
	args: string[],
	cwd: string,
	options: GhExecOptions = {},
): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		timeout: options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS,
	});
	return stdout;
}

/**
 * Run a `gh` command and return stdout, surfacing failures as a clean Error with
 * gh's stderr message. Use for user-initiated actions (reads and writes alike)
 * where the failure reason should reach the user, unlike the passive PR-context
 * adapters that degrade to empty.
 */
export async function ghOrThrow(
	args: string[],
	cwd: string,
	options: GhExecOptions = {},
): Promise<string> {
	try {
		return await gh(args, cwd, options);
	} catch (err) {
		throw new Error(ghErrorMessage(err));
	}
}

/**
 * Extract the most useful message from a failed `gh`/`git` exec: prefer the
 * command's stderr (where these tools write human-readable failures), falling
 * back to the Error message.
 */
export function ghErrorMessage(err: unknown): string {
	if (
		typeof err === "object" &&
		err !== null &&
		"stderr" in err &&
		typeof err.stderr === "string" &&
		err.stderr.trim()
	) {
		return err.stderr.trim();
	}
	return err instanceof Error ? err.message : String(err);
}
