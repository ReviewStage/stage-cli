import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type Viewer, ViewerSchema } from "@stagereview/types/viewer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { viewerRoutes } from "../routes/viewer.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";

let tmpDir: string;
let webDist: string;
let binDir: string;
let originalPath: string | undefined;
const handles: ServerHandle[] = [];

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-viewer-"));
	webDist = path.join(tmpDir, "web-dist");
	binDir = path.join(tmpDir, "bin");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
	await fs.mkdir(binDir);
	// Prepend a fake `gh` so the route never reaches the real CLI or the network.
	originalPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
});

afterEach(async () => {
	while (handles.length > 0) {
		const h = handles.pop();
		if (h) await h.close();
	}
	process.env.PATH = originalPath;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFakeGh(body: string): Promise<void> {
	const file = path.join(binDir, "gh");
	await fs.writeFile(file, `#!/bin/sh\n${body}\n`);
	await fs.chmod(file, 0o755);
}

async function start(): Promise<number> {
	const handle = await startServer({ webDistPath: webDist, routes: viewerRoutes() });
	handles.push(handle);
	return handle.port;
}

function get(port: number, p: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method: "GET", path: p, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("viewer API", () => {
	it("shows the GitHub login (not the display name) from gh", async () => {
		// gh returns both a login and a display name; the byline should use the login.
		await writeFakeGh(
			`if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo '{"login":"octocat","name":"The Octocat","avatar_url":"https://avatars.example/oct.png"}'
else exit 1; fi`,
		);
		const port = await start();

		const res = await get(port, "/api/viewer");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({
			name: "octocat",
			avatarUrl: "https://avatars.example/oct.png",
		});
	});

	it("falls back to a name with no avatar when gh is unavailable", async () => {
		await writeFakeGh("exit 1");
		const port = await start();

		const res = await get(port, "/api/viewer");
		expect(res.status).toBe(200);
		const viewer: Viewer = ViewerSchema.parse(JSON.parse(res.body));
		expect(viewer.name.length).toBeGreaterThan(0);
		expect(viewer.avatarUrl).toBeNull();
	});

	it("synthesizes the github avatar URL when gh omits avatar_url", async () => {
		await writeFakeGh(
			`if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo '{"login":"octocat"}'
else exit 1; fi`,
		);
		const port = await start();

		const res = await get(port, "/api/viewer");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body)).toEqual({
			name: "octocat",
			avatarUrl: "https://github.com/octocat.png",
		});
	});

	it("degrades to the generic label when run outside a git repo", async () => {
		// tmpDir is under the OS temp dir, not a git repo, so readRepoRoot() throws and
		// resolveViewer() returns the FALLBACK_VIEWER before gh is ever consulted.
		const originalCwd = process.cwd();
		process.chdir(tmpDir);
		try {
			const port = await start();
			const res = await get(port, "/api/viewer");
			expect(res.status).toBe(200);
			expect(JSON.parse(res.body)).toEqual({ name: "You", avatarUrl: null });
		} finally {
			process.chdir(originalCwd);
		}
	});
});
