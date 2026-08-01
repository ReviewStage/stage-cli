import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LOOPBACK_HOST, type Route, type ServerHandle, startServer } from "../server.js";

let webDist: string;

beforeAll(async () => {
	webDist = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-server-lifecycle-"));
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
});

afterAll(async () => {
	await fs.rm(webDist, { recursive: true, force: true });
});

const handles: ServerHandle[] = [];

afterEach(async () => {
	while (handles.length > 0) await handles.pop()?.close();
});

async function start(routes?: Route[]): Promise<ServerHandle> {
	const handle = await startServer({ webDistPath: webDist, routes });
	handles.push(handle);
	return handle;
}

function rawRequest(port: number, requestPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, path: requestPath, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("server lifecycle", () => {
	it("binds simultaneous starts to separate ports", async () => {
		const [a, b] = await Promise.all([start(), start()]);

		expect(a.port).not.toBe(b.port);
		expect(Math.abs(a.port - b.port)).toBeGreaterThanOrEqual(1);
	});

	it("stops accepting new connections after close", async () => {
		const marker = "owned-by-server-close-test";
		const handle = await start([
			{
				method: "GET",
				pattern: "/api/close-probe",
				handler: (_req, res) => res.end(marker),
			},
		]);
		const { port } = handle;
		handles.pop();

		await handle.close();

		const body = await rawRequest(port, "/api/close-probe").catch(() => null);
		expect(body).not.toBe(marker);
	});
});
