import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiffResponse, FileContentsMap } from "@stagereview/types/diff";
import { eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import type { ChapterRunRow } from "../db/schema/chapter-run.js";
import { chapterRun } from "../db/schema/index.js";
import { buildDiffArgs, hasStringStdout } from "../git.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DIFF_BYTES = 50 * 1024 * 1024;

async function buildUntrackedPatch(cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd,
		encoding: "utf8",
	});
	const files = stdout.trim() ? stdout.trim().split("\n") : [];
	if (files.length === 0) return "";

	const patches = await Promise.all(
		files.map(async (file) => {
			try {
				await execFileAsync(
					"git",
					[
						"diff",
						"--no-index",
						"--no-color",
						"--src-prefix=a/",
						"--dst-prefix=b/",
						"--",
						"/dev/null",
						file,
					],
					{ cwd, encoding: "utf8", maxBuffer: MAX_DIFF_BYTES },
				);
				return "";
			} catch (err: unknown) {
				return hasStringStdout(err) ? err.stdout : "";
			}
		}),
	);
	return patches.filter(Boolean).join("\n");
}

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
					const { stdout: trackedPatch } = await execFileAsync("git", args, {
						cwd: repoRoot,
						encoding: "utf8",
						maxBuffer: MAX_DIFF_BYTES,
					});

					let patch = trackedPatch;
					if (
						run.scopeKind === SCOPE_KIND.WORKING_TREE &&
						run.workingTreeRef === WORKING_TREE_REF.WORK
					) {
						const untrackedPatch = await buildUntrackedPatch(repoRoot);
						if (untrackedPatch) {
							patch = patch ? `${patch}\n${untrackedPatch}` : untrackedPatch;
						}
					}

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
const BINARY_RE = /^Binary files|^GIT binary patch/m;
const RENAME_FROM_RE = /^(?:rename|copy) from (.+)$/m;
const RENAME_TO_RE = /^(?:rename|copy) to (.+)$/m;

/**
 * Browser-displayable image formats. Binary files are normally skipped when
 * building file contents, but images are shipped base64-encoded so the web
 * UI's image diff viewer can render them.
 */
const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"bmp",
	"ico",
	"avif",
]);

function isImagePath(filePath: string): boolean {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.has(ext);
}

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

		let oldPath = minus?.[1] && minus[1] !== "/dev/null" ? minus[1] : null;
		let newPath = plus?.[1] && plus[1] !== "/dev/null" ? plus[1] : null;

		// Pure renames/copies have no ---/+++ headers; fall back to the
		// rename/copy header lines so their contents can still be served.
		if (oldPath === null && newPath === null) {
			oldPath = text.match(RENAME_FROM_RE)?.[1] ?? null;
			newPath = text.match(RENAME_TO_RE)?.[1] ?? null;
		}

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

async function getGitFileContentBase64(
	cwd: string,
	ref: string,
	filePath: string,
): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["show", `${ref}:${filePath}`], {
			cwd,
			encoding: "buffer",
			maxBuffer: MAX_FILE_BYTES,
		});
		return stdout.toString("base64");
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

async function readFileContentBase64(repoRoot: string, filePath: string): Promise<string | null> {
	const resolved = path.resolve(repoRoot, filePath);
	const rel = path.relative(repoRoot, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	try {
		const buffer = await fs.readFile(resolved);
		return buffer.toString("base64");
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
			return { oldRef: run.baseSha, newRef: "DISK" };
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

function fetchContentBase64(
	repoRoot: string,
	ref: string | "DISK",
	filePath: string,
): Promise<string | null> {
	if (ref === "DISK") return readFileContentBase64(repoRoot, filePath);
	return getGitFileContentBase64(repoRoot, ref, filePath);
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
			if (!key) return null;

			// Images ship base64-encoded (whether or not git marked the diff as
			// binary — pure renames carry no marker) so the image diff viewer
			// can render them; other binary files carry no usable content.
			if (isImagePath(key)) {
				const [oldContent, newContent] = await Promise.all([
					oldPath ? fetchContentBase64(repoRoot, oldRef, oldPath) : Promise.resolve(null),
					newPath ? fetchContentBase64(repoRoot, newRef, newPath) : Promise.resolve(null),
				]);
				return [key, { oldContent, newContent, encoding: "base64" as const }] as const;
			}
			if (isBinary) return null;

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
