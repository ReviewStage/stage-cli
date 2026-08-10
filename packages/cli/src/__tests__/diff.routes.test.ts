import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { DiffResponse } from "@stagereview/types/diff";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapterRun } from "../db/schema/index.js";
import { diffRoutes } from "../routes/diff.js";
import { SCOPE_KIND, WORKING_TREE_REF } from "../schema.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
let repoRoot: string;
const handles: ServerHandle[] = [];

const ZERO_SHA = "0".repeat(40);

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-diff-routes-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	repoRoot = path.join(tmpDir, "repo");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(repoRoot);
	closeDb();
});

afterEach(async () => {
	while (handles.length > 0) {
		const h = handles.pop();
		if (h) await h.close();
	}
	closeDb();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function startWithRoutes(): Promise<ServerHandle> {
	const db = getDb({ dbPath });
	const handle = await startServer({ webDistPath: webDist, routes: diffRoutes(db) });
	handles.push(handle);
	return handle;
}

function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
	});
}

async function initRepoWithTwoCommits(): Promise<{ baseSha: string; headSha: string }> {
	git("init", "--initial-branch=main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "commit.gpgsign", "false");

	await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\n");
	git("add", "file.txt");
	git("commit", "-m", "first");
	const baseSha = git("rev-parse", "HEAD").trim();

	await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\n");
	git("commit", "-am", "second");
	const headSha = git("rev-parse", "HEAD").trim();

	return { baseSha, headSha };
}

function insertCommittedRun(baseSha: string, headSha: string): string {
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			scopeKind: SCOPE_KIND.COMMITTED,
			workingTreeRef: null,
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

function insertWorkingTreeRun(
	ref: (typeof WORKING_TREE_REF)[keyof typeof WORKING_TREE_REF],
): string {
	const headSha = git("rev-parse", "HEAD").trim();
	const db = getDb({ dbPath });
	const [row] = db
		.insert(chapterRun)
		.values({
			repoRoot,
			scopeKind: SCOPE_KIND.WORKING_TREE,
			workingTreeRef: ref,
			baseSha: headSha,
			headSha,
			mergeBaseSha: headSha,
			generatedAt: new Date(),
		})
		.returning({ id: chapterRun.id })
		.all();
	if (!row) throw new Error("seed: chapter_run insert returned no row");
	return row.id;
}

interface RawResponse {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}

function rawRequest(port: number, requestPath: string): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "GET", path: requestPath, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

function parseDiffResponse(body: string): DiffResponse {
	return JSON.parse(body) as DiffResponse;
}

describe("diff API", () => {
	it("GET /api/runs/:runId/diff.patch returns JSON with patch and fileContents", async () => {
		const { baseSha, headSha } = await initRepoWithTwoCommits();
		const runId = insertCommittedRun(baseSha, headSha);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toMatch(/application\/json/);
		expect(res.headers["cache-control"]).toBe("private, max-age=300");

		const data = parseDiffResponse(res.body);
		expect(data.patch).toContain("diff --git a/file.txt b/file.txt");
		expect(data.patch).toContain("+world");
		expect(data.patch).not.toContain(`${String.fromCharCode(27)}[`);

		expect(data.fileContents["file.txt"]).toBeDefined();
		expect(data.fileContents["file.txt"]?.oldContent).toBe("hello\n");
		expect(data.fileContents["file.txt"]?.newContent).toBe("hello\nworld\n");
	});

	it("returns the unstaged diff for workingTree/unstaged runs", async () => {
		await initRepoWithTwoCommits();
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nunstaged\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.UNSTAGED);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		expect(res.headers["cache-control"]).toBe("no-store");

		const data = parseDiffResponse(res.body);
		expect(data.patch).toContain("+unstaged");
		expect(data.fileContents["file.txt"]?.newContent).toBe("hello\nworld\nunstaged\n");
	});

	it("returns the staged diff for workingTree/staged runs", async () => {
		await initRepoWithTwoCommits();
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\n");
		git("add", "file.txt");
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\nleak\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.STAGED);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);
		expect(res.headers["cache-control"]).toBe("no-store");

		const data = parseDiffResponse(res.body);
		expect(data.patch).toContain("+staged");
		expect(data.patch).not.toContain("+leak");
		expect(data.fileContents["file.txt"]?.newContent).toBe("hello\nworld\nstaged\n");
	});

	it("returns the combined diff vs HEAD for workingTree/work runs", async () => {
		await initRepoWithTwoCommits();
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\n");
		git("add", "file.txt");
		await fs.writeFile(path.join(repoRoot, "file.txt"), "hello\nworld\nstaged\nunstaged\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.WORK);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(200);

		const data = parseDiffResponse(res.body);
		expect(data.patch).toContain("+staged");
		expect(data.patch).toContain("+unstaged");
		expect(data.fileContents["file.txt"]?.newContent).toBe("hello\nworld\nstaged\nunstaged\n");
	});

	it("returns null oldContent for added files", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");

		await fs.writeFile(path.join(repoRoot, "initial.txt"), "init\n");
		git("add", "initial.txt");
		git("commit", "-m", "initial");
		const baseSha = git("rev-parse", "HEAD").trim();

		await fs.writeFile(path.join(repoRoot, "new-file.txt"), "brand new\n");
		git("add", "new-file.txt");
		git("commit", "-m", "add new file");
		const headSha = git("rev-parse", "HEAD").trim();

		const runId = insertCommittedRun(baseSha, headSha);
		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		const data = parseDiffResponse(res.body);
		expect(data.fileContents["new-file.txt"]?.oldContent).toBeNull();
		expect(data.fileContents["new-file.txt"]?.newContent).toBe("brand new\n");
	});

	it("returns null newContent for deleted files", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");

		await fs.writeFile(path.join(repoRoot, "doomed.txt"), "goodbye\n");
		git("add", "doomed.txt");
		git("commit", "-m", "add file");
		const baseSha = git("rev-parse", "HEAD").trim();

		git("rm", "doomed.txt");
		git("commit", "-m", "delete file");
		const headSha = git("rev-parse", "HEAD").trim();

		const runId = insertCommittedRun(baseSha, headSha);
		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		const data = parseDiffResponse(res.body);
		expect(data.fileContents["doomed.txt"]?.oldContent).toBe("goodbye\n");
		expect(data.fileContents["doomed.txt"]?.newContent).toBeNull();
	});

	it("serves both sides of a modified binary image base64-encoded", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");

		const oldBytes = Buffer.concat([Buffer.from("PNG"), Buffer.alloc(32, 0), Buffer.from("v1")]);
		const newBytes = Buffer.concat([Buffer.from("PNG"), Buffer.alloc(32, 0), Buffer.from("v2")]);
		await fs.writeFile(path.join(repoRoot, "logo.png"), oldBytes);
		git("add", "logo.png");
		git("commit", "-m", "add image");
		const baseSha = git("rev-parse", "HEAD").trim();

		await fs.writeFile(path.join(repoRoot, "logo.png"), newBytes);
		git("commit", "-am", "modify image");
		const headSha = git("rev-parse", "HEAD").trim();

		const runId = insertCommittedRun(baseSha, headSha);
		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		const data = parseDiffResponse(res.body);
		// The patch is only `diff --git` + `Binary files ... differ` — paths come
		// from the header fallback.
		expect(data.patch).toContain("Binary files");
		expect(data.fileContents["logo.png"]).toMatchObject({ encoding: "base64" });
		expect(data.fileContents["logo.png"]?.oldContent).toBe(oldBytes.toString("base64"));
		expect(data.fileContents["logo.png"]?.newContent).toBe(newBytes.toString("base64"));
	});

	it("serves null contents for a pure rename of a binary non-image file", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");

		const bytes = Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(64, 0), Buffer.from("end")]);
		await fs.writeFile(path.join(repoRoot, "doc.pdf"), bytes);
		git("add", "doc.pdf");
		git("commit", "-m", "add pdf");
		const baseSha = git("rev-parse", "HEAD").trim();

		git("mv", "doc.pdf", "renamed.pdf");
		git("commit", "-m", "rename pdf");
		const headSha = git("rev-parse", "HEAD").trim();

		const runId = insertCommittedRun(baseSha, headSha);
		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		const data = parseDiffResponse(res.body);
		expect(data.patch).toContain("rename from doc.pdf");
		// Binary bytes must not be served as a UTF-8 text preview.
		expect(data.fileContents["renamed.pdf"]?.oldContent).toBeNull();
		expect(data.fileContents["renamed.pdf"]?.newContent).toBeNull();
	});

	it("skips working-tree image sides larger than the file size cap", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");

		const oldBytes = Buffer.concat([Buffer.from("PNG"), Buffer.alloc(32, 0), Buffer.from("v1")]);
		await fs.writeFile(path.join(repoRoot, "logo.png"), oldBytes);
		git("add", "logo.png");
		git("commit", "-m", "add image");

		// Overwrite with > 5 MiB of binary data in the working tree.
		const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
		await fs.writeFile(path.join(repoRoot, "logo.png"), huge);
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.WORK);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		const data = parseDiffResponse(res.body);
		expect(data.fileContents["logo.png"]?.oldContent).toBe(oldBytes.toString("base64"));
		expect(data.fileContents["logo.png"]?.newContent).toBeNull();
	});

	it("serves contents for a pure rename whose path git quotes", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");
		await fs.writeFile(path.join(repoRoot, "ole\u0301 file.txt"), "quoted contents\n");
		git("add", "-A");
		git("commit", "-m", "add quoted file");
		const baseSha = git("rev-parse", "HEAD").trim();

		git("mv", "ole\u0301 file.txt", "ole\u0301 renamed.txt");
		git("commit", "-m", "rename quoted file");
		const headSha = git("rev-parse", "HEAD").trim();
		const runId = insertCommittedRun(baseSha, headSha);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);
		expect(res.status).toBe(200);
		const data = parseDiffResponse(res.body);
		const entry = data.fileContents["ole\u0301 renamed.txt"];
		expect(entry).toBeDefined();
		expect(entry?.newContent).toBe("quoted contents\n");
		expect(entry?.oldContent).toBe("quoted contents\n");
	});

	it("includes untracked files with non-ASCII names in work-tree diffs", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");
		await fs.writeFile(path.join(repoRoot, "keep.txt"), "keep\n");
		git("add", "keep.txt");
		git("commit", "-m", "initial");

		await fs.writeFile(path.join(repoRoot, "unt ol\u00e9.txt"), "untracked contents\n");
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.WORK);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);
		expect(res.status).toBe(200);
		const data = parseDiffResponse(res.body);
		expect(data.patch).toContain("unt ol\u00e9.txt");
		expect(data.fileContents["unt ol\u00e9.txt"]?.newContent).toBe("untracked contents\n");
	});

	it("refuses to serve working-tree content through a symlink escaping the repo", async () => {
		git("init", "--initial-branch=main");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		git("config", "commit.gpgsign", "false");
		const outside = path.join(path.dirname(repoRoot), "outside-secret.png");
		await fs.writeFile(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
		await fs.writeFile(path.join(repoRoot, "keep.txt"), "keep\n");
		git("add", "keep.txt");
		git("commit", "-m", "initial");

		await fs.symlink(outside, path.join(repoRoot, "leak.png"));
		const runId = insertWorkingTreeRun(WORKING_TREE_REF.WORK);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);
		expect(res.status).toBe(200);
		const data = parseDiffResponse(res.body);
		// The untracked symlink appears in the patch, so its entry must exist —
		// with null content rather than the out-of-repo target bytes. Guarding
		// on presence would let a silent inclusion regression skip the check.
		const entry = data.fileContents["leak.png"];
		expect(entry).toBeDefined();
		expect(entry?.newContent).toBeNull();
		const outsideBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
		expect(res.body).not.toContain(outsideBase64);
		await fs.rm(outside, { force: true });
	});

	it("returns 404 for unknown runId", async () => {
		const { port } = await startWithRoutes();
		const res = await rawRequest(port, "/api/runs/00000000-0000-0000-0000-000000000000/diff.patch");
		expect(res.status).toBe(404);
		expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringMatching(/not found/i) });
	});

	it("returns 500 with the underlying error when repoRoot has been removed", async () => {
		const { baseSha, headSha } = await initRepoWithTwoCommits();
		const runId = insertCommittedRun(baseSha, headSha);
		await fs.rm(repoRoot, { recursive: true, force: true });

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(500);
		const body = JSON.parse(res.body) as { error: string };
		expect(body.error.toLowerCase()).toMatch(/enoent|no such file|not a git repository/);
	});

	it("returns 500 when the requested SHA is not reachable", async () => {
		const { baseSha } = await initRepoWithTwoCommits();
		const runId = insertCommittedRun(baseSha, ZERO_SHA);

		const { port } = await startWithRoutes();
		const res = await rawRequest(port, `/api/runs/${runId}/diff.patch`);

		expect(res.status).toBe(500);
		const body = JSON.parse(res.body) as { error: string };
		expect(body.error.toLowerCase()).toMatch(/bad object|unknown revision|fatal/);
	});
});
