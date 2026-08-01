import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GH_TIMEOUT_MS = 30_000;

export interface GhExecOptions {
	/** Bound a spawned `gh` process so passive review reads cannot hang the local UI. */
	timeoutMs?: number;
}

async function execGh(args: string[], cwd: string, options: GhExecOptions): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		timeout: options.timeoutMs,
	});
	return stdout;
}

/** Run a general read-only `gh` command, optionally with a caller-selected deadline. */
export async function gh(
	args: string[],
	cwd: string,
	options: GhExecOptions = {},
): Promise<string> {
	return execGh(args, cwd, options);
}

/**
 * Run a `gh` command without a default deadline and surface failures cleanly.
 * Non-idempotent mutations must not be timed out: GitHub may have accepted the
 * write before the local process is killed, making a retry duplicate the action.
 */
export async function ghWriteOrThrow(args: string[], cwd: string): Promise<string> {
	try {
		return await execGh(args, cwd, {});
	} catch (err) {
		throw new Error(ghErrorMessage(err));
	}
}

/** Run a read-only `gh` command with a bounded deadline while preserving its failure reason. */
export async function ghReadOrThrow(
	args: string[],
	cwd: string,
	options: GhExecOptions = {},
): Promise<string> {
	try {
		return await gh(args, cwd, { timeoutMs: options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS });
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
