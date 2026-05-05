import { execFile } from "node:child_process";
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

const MAX_FILE_BYTES = 5 * 1024 * 1024;

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
					const { stdout: patch } = await execFileAsync("git", args, {
						cwd: repoRoot,
						encoding: "utf8",
						maxBuffer: 50 * 1024 * 1024,
					});
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
			maxBuffer: MAX_FILE_BYTES,
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

function getContentRefs(run: ChapterRunRow): { oldRef: string; newRef: string | "DISK" } {
	if (run.scopeKind === SCOPE_KIND.COMMITTED) {
		return { oldRef: run.baseSha, newRef: run.headSha };
	}
	switch (run.workingTreeRef) {
		case WORKING_TREE_REF.UNSTAGED:
			return { oldRef: "", newRef: "DISK" };
		case WORKING_TREE_REF.STAGED:
			return { oldRef: "HEAD", newRef: "" };
		case WORKING_TREE_REF.WORK:
			return { oldRef: "HEAD", newRef: "DISK" };
		default:
			return { oldRef: "HEAD", newRef: "HEAD" };
	}
}

function fetchContent(
	repoRoot: string,
	ref: string | "DISK",
	filePath: string,
): Promise<string | null> {
	if (ref === "DISK") return readFileContent(repoRoot, filePath);
	return getGitFileContent(repoRoot, ref, filePath);
}

async function buildFileContents(
	run: ChapterRunRow,
	repoRoot: string,
	patch: string,
): Promise<FileContentsMap> {
	const files = parseFilePathsFromPatch(patch);
	const { oldRef, newRef } = getContentRefs(run);

	const entries = await Promise.all(
		files.map(async ({ oldPath, newPath, isBinary }) => {
			const key = newPath ?? oldPath;
			if (!key || isBinary) return null;

			const [oldContent, newContent] = await Promise.all([
				oldPath ? fetchContent(repoRoot, oldRef, oldPath) : Promise.resolve(null),
				newPath ? fetchContent(repoRoot, newRef, newPath) : Promise.resolve(null),
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
