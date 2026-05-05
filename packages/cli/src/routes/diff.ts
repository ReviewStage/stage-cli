import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiffResponse, FileContentsMap } from "@stagereview/types/diff";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import type { ChapterRunRow } from "../db/schema/chapter-run.js";
import { chapterRun } from "../db/schema/index.js";
import { buildDiffArgs } from "../git.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

const execFileAsync = promisify(execFile);

export function diffRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/diff.patch",
			handler: async (_req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}

				const [run] = db.select().from(chapterRun).where(eq(chapterRun.id, runId)).limit(1).all();
				if (!run) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				const repoRoot = run.repoRoot;
				if (!path.isAbsolute(repoRoot) || repoRoot.split(path.sep).includes("..")) {
					writeJson(res, 500, {
						error: "Run repoRoot is not an absolute path or contains traversal segments",
					});
					return;
				}

				const args = buildDiffArgs(run);
				const cacheControl =
					run.scopeKind === SCOPE_KIND.COMMITTED ? "private, max-age=300" : "no-store";

				try {
					const patch = await collectGitDiff(repoRoot, args);
					const fileContents = await buildFileContents(run, repoRoot, patch);
					const body: DiffResponse = { patch, fileContents };
					res.writeHead(200, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": cacheControl,
					});
					res.end(JSON.stringify(body));
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					writeJson(res, 500, { error: message });
				}
			},
		},
	];
}

function collectGitDiff(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve(Buffer.concat(stdoutChunks).toString("utf8"));
			} else {
				reject(new Error(stderr.trim() || `git exited with code ${code}`));
			}
		});
	});
}

const MINUS_RE = /^--- (?:a\/)?(.+)$/m;
const PLUS_RE = /^\+\+\+ (?:b\/)?(.+)$/m;
const BINARY_RE = /^Binary files/m;

interface ParsedFilePaths {
	oldPath: string | null;
	newPath: string | null;
	isBinary: boolean;
}

function parseFilePathsFromPatch(patch: string): ParsedFilePaths[] {
	if (!patch.trim()) return [];

	const segments = patch.split(/\ndiff --git /);
	const results: ParsedFilePaths[] = [];

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (segment === undefined) continue;
		const text = i === 0 ? segment : `diff --git ${segment}`;
		if (!text.startsWith("diff --git ")) continue;

		const isBinary = BINARY_RE.test(text);

		const minus = text.match(MINUS_RE);
		const plus = text.match(PLUS_RE);

		const oldPath = minus?.[1] && minus[1] !== "/dev/null" ? minus[1] : null;
		const newPath = plus?.[1] && plus[1] !== "/dev/null" ? plus[1] : null;

		results.push({ oldPath, newPath, isBinary });
	}

	return results;
}

async function getGitFileContent(
	cwd: string,
	ref: string,
	filePath: string,
): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["show", `${ref}:${filePath}`], {
			cwd,
			encoding: "utf8",
			maxBuffer: 5 * 1024 * 1024,
		});
		return stdout;
	} catch {
		return null;
	}
}

async function readFileContent(repoRoot: string, filePath: string): Promise<string | null> {
	const resolved = path.resolve(repoRoot, filePath);
	const rel = path.relative(repoRoot, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	try {
		return await fs.readFile(resolved, "utf8");
	} catch {
		return null;
	}
}

function getOldRef(run: ChapterRunRow): string {
	if (run.scopeKind === SCOPE_KIND.COMMITTED) return run.baseSha;
	switch (run.workingTreeRef) {
		case WORKING_TREE_REF.UNSTAGED:
			return "";
		case WORKING_TREE_REF.STAGED:
		case WORKING_TREE_REF.WORK:
			return "HEAD";
		default:
			return "HEAD";
	}
}

function getNewRef(run: ChapterRunRow): string | "DISK" {
	if (run.scopeKind === SCOPE_KIND.COMMITTED) return run.headSha;
	switch (run.workingTreeRef) {
		case WORKING_TREE_REF.UNSTAGED:
		case WORKING_TREE_REF.WORK:
			return "DISK";
		case WORKING_TREE_REF.STAGED:
			return "";
		default:
			return "HEAD";
	}
}

async function buildFileContents(
	run: ChapterRunRow,
	repoRoot: string,
	patch: string,
): Promise<FileContentsMap> {
	const files = parseFilePathsFromPatch(patch);
	const oldRef = getOldRef(run);
	const newRef = getNewRef(run);

	const entries = await Promise.all(
		files.map(async ({ oldPath, newPath, isBinary }) => {
			const key = newPath ?? oldPath;
			if (!key || isBinary) return null;

			const [oldContent, newContent] = await Promise.all([
				oldPath ? getGitFileContent(repoRoot, oldRef, oldPath) : Promise.resolve(null),
				newPath
					? newRef === "DISK"
						? readFileContent(repoRoot, newPath)
						: getGitFileContent(repoRoot, newRef, newPath)
					: Promise.resolve(null),
			]);

			return [key, { oldContent, newContent }] as const;
		}),
	);

	const map: FileContentsMap = {};
	for (const entry of entries) {
		if (entry) map[entry[0]] = entry[1];
	}
	return map;
}
