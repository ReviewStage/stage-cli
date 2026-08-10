import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiffResponse, FileContentsMap } from "@stagereview/types/diff";
import { isImageFile } from "@stagereview/types/image";
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
	// `-z` NUL-delimits and never C-quotes, so non-ASCII names stay literal paths.
	const { stdout } = await execFileAsync(
		"git",
		["ls-files", "--others", "--exclude-standard", "-z"],
		{ cwd, encoding: "utf8" },
	);
	const files = stdout.split("\0").filter(Boolean);
	if (files.length === 0) return "";

	// Sequential like git.ts's getUntrackedDiff: one child process per file at
	// a time, so thousands of untracked files can't exhaust processes/memory.
	const patches: string[] = [];
	for (const file of files) {
		try {
			await execFileAsync(
				"git",
				[
					"-c",
					"core.quotepath=off",
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
		} catch (err: unknown) {
			if (hasStringStdout(err)) patches.push(err.stdout);
		}
	}
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

const MINUS_RE = /^--- (.+)$/m;
const PLUS_RE = /^\+\+\+ (.+)$/m;
const BINARY_RE = /^Binary files|^GIT binary patch/m;
// Mode 120000 in the pre-hunk header marks a symlink (same detection as the
// CLI diff parser's isSymlinkPatch).
const SYMLINK_MODE_RE =
	/(?:new file mode|deleted file mode|old mode|new mode|index [0-9a-f]+\.\.[0-9a-f]+) 120000\b/m;
const RENAME_FROM_RE = /^(?:rename|copy) from (.+)$/m;
const RENAME_TO_RE = /^(?:rename|copy) to (.+)$/m;
// `diff --git "a/x y" "b/x y"` — git quotes paths containing spaces or specials.
const DIFF_GIT_QUOTED_RE = /^diff --git "a\/((?:[^"\\]|\\.)+)" "b\/((?:[^"\\]|\\.)+)"$/m;
const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/m;

interface ParsedFilePaths {
	oldPath: string | null;
	newPath: string | null;
	isBinary: boolean;
	isSymlink: boolean;
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
		const headerEnd = text.indexOf("@@");
		const isSymlink = SYMLINK_MODE_RE.test(headerEnd === -1 ? text : text.slice(0, headerEnd));

		let oldPath = decodeHeaderPath(text.match(MINUS_RE)?.[1], "a/");
		let newPath = decodeHeaderPath(text.match(PLUS_RE)?.[1], "b/");

		// Pure renames/copies have no ---/+++ headers; fall back to the
		// rename/copy header lines so their contents can still be served.
		if (oldPath === null && newPath === null) {
			oldPath = decodeHeaderPath(text.match(RENAME_FROM_RE)?.[1], null);
			newPath = decodeHeaderPath(text.match(RENAME_TO_RE)?.[1], null);
		}

		// Modified binaries emit only `diff --git` + `Binary files ... differ`
		// (no ---/+++, no rename lines); parse the header itself so images can
		// still reach the image diff viewer.
		if (oldPath === null && newPath === null) {
			const quoted = text.match(DIFF_GIT_QUOTED_RE);
			if (quoted) {
				oldPath = unquoteGitPath(quoted[1]);
				newPath = unquoteGitPath(quoted[2]);
			} else {
				const firstLine = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
				const halves = splitEqualGitHeader(firstLine);
				if (halves) {
					[oldPath, newPath] = halves;
				} else {
					const header = text.match(DIFF_GIT_RE);
					oldPath = header?.[1] ?? null;
					newPath = header?.[2] ?? null;
				}
			}
		}

		results.push({ oldPath, newPath, isBinary, isSymlink });
	}

	return results;
}

/**
 * Resolve the ambiguity in unquoted `diff --git a/P b/P` headers when P itself
 * contains " b/": for non-renames both paths are identical, so try the split
 * where the two halves match before falling back to the greedy regex.
 */
function splitEqualGitHeader(firstLine: string): [string, string] | null {
	if (!firstLine.startsWith("diff --git a/")) return null;
	const rest = firstLine.slice("diff --git a/".length);
	// P + " b/" + P → total length 2*|P|+3
	if ((rest.length - 3) % 2 !== 0) return null;
	const half = (rest.length - 3) / 2;
	const candidate = rest.slice(0, half);
	if (rest.slice(half, half + 3) === " b/" && rest.slice(half + 3) === candidate) {
		return [candidate, candidate];
	}
	return null;
}

/**
 * Decode a raw `---`/`+++`/`rename from`/`rename to` header capture: strip
 * surrounding quotes and C-style escapes when git quoted the path (spaces,
 * non-ASCII), then drop the diff prefix (`a/`/`b/`, which sits inside the
 * quotes) and map `/dev/null` to null.
 */
function decodeHeaderPath(raw: string | undefined, prefix: "a/" | "b/" | null): string | null {
	if (raw === undefined) return null;
	// git appends a TAB after ---/+++ paths containing spaces or specials.
	let decoded = raw.replace(/\t$/, "");
	if (decoded.startsWith('"') && decoded.endsWith('"') && decoded.length >= 2) {
		decoded = unquoteGitPath(decoded.slice(1, -1)) ?? decoded;
	}
	if (decoded === "/dev/null") return null;
	if (prefix !== null && decoded.startsWith(prefix)) decoded = decoded.slice(prefix.length);
	return decoded;
}

/**
 * Decode the C-style escapes git uses inside quoted diff header paths:
 * `\\"` and `\\\\`, control shorthands (`\\t`, `\\n`, `\\r`), and octal byte
 * escapes for non-ASCII names (decoded as UTF-8 byte sequences).
 */
function unquoteGitPath(headerPath: string | undefined): string | null {
	if (headerPath === undefined) return null;
	const bytes: number[] = [];
	for (let i = 0; i < headerPath.length; i++) {
		const ch = headerPath[i];
		if (ch !== "\\") {
			for (const byte of Buffer.from(ch ?? "", "utf8")) bytes.push(byte);
			continue;
		}
		const next = headerPath[i + 1];
		if (next === undefined) break;
		const octal = headerPath.slice(i + 1, i + 4);
		if (/^[0-7]{3}$/.test(octal)) {
			bytes.push(Number.parseInt(octal, 8));
			i += 3;
			continue;
		}
		const shorthand: Record<string, number> = {
			a: 0x07,
			b: 0x08,
			t: 0x09,
			n: 0x0a,
			v: 0x0b,
			f: 0x0c,
			r: 0x0d,
		};
		const code = shorthand[next];
		bytes.push(code ?? Buffer.from(next, "utf8")[0] ?? 0);
		i += 1;
	}
	return Buffer.from(bytes).toString("utf8");
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

/**
 * Resolve a working-tree path for reading, or null when it escapes the repo or
 * exceeds MAX_FILE_BYTES — mirroring the maxBuffer cap on committed-side reads.
 */
async function resolveReadablePath(repoRoot: string, filePath: string): Promise<string | null> {
	const resolved = path.resolve(repoRoot, filePath);
	const rel = path.relative(repoRoot, resolved);
	if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
	try {
		// fs reads follow symlinks, so a checked-out branch could commit a link
		// pointing outside the repo; re-check containment on the real path.
		const [real, realRoot] = await Promise.all([fs.realpath(resolved), fs.realpath(repoRoot)]);
		const realRel = path.relative(realRoot, real);
		if (realRel === ".." || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel))
			return null;
		const { size } = await fs.stat(real);
		return size > MAX_FILE_BYTES ? null : real;
	} catch {
		return null;
	}
}

async function readFileContent(repoRoot: string, filePath: string): Promise<string | null> {
	const resolved = await resolveReadablePath(repoRoot, filePath);
	if (resolved === null) return null;
	try {
		return await fs.readFile(resolved, "utf8");
	} catch {
		return null;
	}
}

async function readFileContentBase64(repoRoot: string, filePath: string): Promise<string | null> {
	const resolved = await resolveReadablePath(repoRoot, filePath);
	if (resolved === null) return null;
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

/**
 * A symlink's git content is its target path: `git show` prints it for
 * committed refs; on disk the link itself must be read, not followed.
 */
async function fetchSymlinkTarget(
	repoRoot: string,
	ref: string | "DISK",
	filePath: string,
): Promise<string | null> {
	if (ref !== "DISK") return getGitFileContent(repoRoot, ref, filePath);
	const resolved = path.resolve(repoRoot, filePath);
	const rel = path.relative(repoRoot, resolved);
	if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
	try {
		return await fs.readlink(resolved);
	} catch {
		return null;
	}
}

function fetchContentBase64(
	repoRoot: string,
	ref: string | "DISK",
	filePath: string,
): Promise<string | null> {
	if (ref === "DISK") return readFileContentBase64(repoRoot, filePath);
	return getGitFileContentBase64(repoRoot, ref, filePath);
}

/** Git's binary heuristic: a NUL byte within the first 8000 bytes. */
const BINARY_SNIFF_BYTES = 8000;

/**
 * Null out content that is actually binary. Pure renames of binary non-image
 * files (pdf/zip/wasm) carry no `Binary files` marker in the patch, so they
 * reach the text path — serving their bytes as UTF-8 would render mojibake.
 */
function dropBinaryContent(content: string | null): string | null {
	if (content?.slice(0, BINARY_SNIFF_BYTES).includes("\0")) return null;
	return content;
}

async function buildFileContents(
	run: ChapterRunRow,
	repoRoot: string,
	patch: string,
): Promise<FileContentsMap> {
	const files = parseFilePathsFromPatch(patch);
	const { oldRef, newRef } = getContentRefs(run);

	const entries = await Promise.all(
		files.map(async ({ oldPath, newPath, isBinary, isSymlink }) => {
			const key = newPath ?? oldPath;
			if (!key) return null;

			// A symlink's content is its target path (git blob semantics) — text,
			// even when the link is named like an image. The web routes mode
			// 120000 to the text diff, so base64 here would corrupt it.
			if (isSymlink) {
				const [oldContent, newContent] = await Promise.all([
					oldPath ? fetchSymlinkTarget(repoRoot, oldRef, oldPath) : Promise.resolve(null),
					newPath ? fetchSymlinkTarget(repoRoot, newRef, newPath) : Promise.resolve(null),
				]);
				return [key, { oldContent, newContent }] as const;
			}

			// Images ship base64-encoded (whether or not git marked the diff as
			// binary — pure renames carry no marker) so the image diff viewer
			// can render them; other binary files carry no usable content.
			if (isImageFile(key)) {
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

			return [
				key,
				{ oldContent: dropBinaryContent(oldContent), newContent: dropBinaryContent(newContent) },
			] as const;
		}),
	);

	const map: FileContentsMap = {};
	for (const entry of entries) {
		if (entry) map[entry[0]] = entry[1];
	}
	return map;
}
