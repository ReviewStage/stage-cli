import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "../db/client.js";
import { gitHubThreadRoutes } from "../routes/github-threads.js";
import { send, setupGhRouteTest } from "./gh-route-harness.js";

const env = setupGhRouteTest("stage-cli-github-thread-writes-");

const SUCCESS_GH_SCRIPT = `#!/bin/sh
echo "$@" >> "$(dirname "$0")/args.log"
echo '{}'
`;

const FAILING_GH_SCRIPT = `#!/bin/sh
echo "gh: not authorized" >&2
exit 1
`;

async function argsLog(): Promise<string> {
	return fs.readFile(path.join(env.binDir, "args.log"), "utf8");
}

function start(): Promise<number> {
	const db = getDb({ dbPath: env.dbPath });
	return env.startWithRoutes(gitHubThreadRoutes(db));
}

describe("POST /api/runs/:runId/github-threads/:commentId/replies", () => {
	it("replies to a review comment via gh", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(port, "POST", `/api/runs/${runId}/github-threads/111/replies`, {
			body: "reply",
		});
		expect(res.status).toBe(200);
		expect(await argsLog()).toContain("repos/owner/repo/pulls/7/comments/111/replies");
	});

	it("returns 502 with gh's stderr when the reply fails", async () => {
		await env.writeFakeGh(FAILING_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(port, "POST", `/api/runs/${runId}/github-threads/111/replies`, {
			body: "reply",
		});
		expect(res.status).toBe(502);
		expect(JSON.parse(res.body).error).toBe("gh: not authorized");
	});

	it("rejects a cross-origin reply with 403", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(
			port,
			"POST",
			`/api/runs/${runId}/github-threads/111/replies`,
			{ body: "reply" },
			{ Origin: "http://evil.example" },
		);
		expect(res.status).toBe(403);
	});

	it("rejects a non-numeric commentId with 400 without invoking gh", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		// %2F decodes to `/` inside the captured param — a path-traversal attempt
		// against `repos/:owner/:repo/pulls/:n/comments/:commentId/replies`.
		const res = await send(
			port,
			"POST",
			`/api/runs/${runId}/github-threads/..%2F..%2Fusers/replies`,
			{ body: "reply" },
		);
		expect(res.status).toBe(400);
		await expect(fs.access(path.join(env.binDir, "args.log"))).rejects.toThrow();
	});
});

describe("PATCH /api/runs/:runId/github-threads/:threadNodeId/resolve", () => {
	it("resolves a thread via the GraphQL mutation", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(port, "PATCH", `/api/runs/${runId}/github-threads/RT_1/resolve`, {
			resolved: true,
		});
		expect(res.status).toBe(200);
		expect(await argsLog()).toContain("resolveReviewThread");
	});

	it("unresolves a thread via the GraphQL mutation", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(port, "PATCH", `/api/runs/${runId}/github-threads/RT_1/resolve`, {
			resolved: false,
		});
		expect(res.status).toBe(200);
		expect(await argsLog()).toContain("unresolveReviewThread");
	});

	it("returns 502 with gh's stderr when resolving fails", async () => {
		await env.writeFakeGh(FAILING_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(port, "PATCH", `/api/runs/${runId}/github-threads/RT_1/resolve`, {
			resolved: true,
		});
		expect(res.status).toBe(502);
		expect(JSON.parse(res.body).error).toBe("gh: not authorized");
	});

	it("rejects a cross-origin resolve with 403", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		const res = await send(
			port,
			"PATCH",
			`/api/runs/${runId}/github-threads/RT_1/resolve`,
			{ resolved: true },
			{ Origin: "http://evil.example" },
		);
		expect(res.status).toBe(403);
	});

	it("rejects a threadNodeId containing '@' with 400 without invoking gh", async () => {
		await env.writeFakeGh(SUCCESS_GH_SCRIPT);
		const runId = env.seedRun(7);
		const port = await start();

		// %40 decodes to `@` — gh's `-F`/`-f` treat an `@`-prefixed value as "read
		// this file from disk," so this charset must be rejected before it reaches gh.
		const res = await send(
			port,
			"PATCH",
			`/api/runs/${runId}/github-threads/%40%2Fetc%2Fpasswd/resolve`,
			{ resolved: true },
		);
		expect(res.status).toBe(400);
		await expect(fs.access(path.join(env.binDir, "args.log"))).rejects.toThrow();
	});
});
