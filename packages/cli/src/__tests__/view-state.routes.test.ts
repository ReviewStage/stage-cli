import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import {
	chapter,
	chapterFileView,
	chapterRun,
	chapterView,
	fileView,
	keyChange,
	keyChangeView,
} from "../db/schema/index.js";
import { runRoutes } from "../routes/runs.js";
import { viewStateRoutes } from "../routes/view-state.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture, makeRepoContext } from "./fixtures.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
const handles: ServerHandle[] = [];

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-view-state-"));
	dbPath = path.join(tmpDir, "db.sqlite");
	webDist = path.join(tmpDir, "web-dist");
	await fs.mkdir(webDist);
	await fs.writeFile(path.join(webDist, "index.html"), "<html></html>");
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
	const handle = await startServer({
		webDistPath: webDist,
		routes: [...runRoutes(db), ...viewStateRoutes(db)],
	});
	handles.push(handle);
	return handle;
}

interface JsonResponse {
	status: number;
	body: unknown;
}

function request(port: number, method: string, requestPath: string): Promise<JsonResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: LOOPBACK_HOST, port, method, path: requestPath, agent: false },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({
						status: res.statusCode ?? 0,
						body: text ? JSON.parse(text) : null,
					});
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

function requestWithBody(
	port: number,
	method: string,
	requestPath: string,
	body: unknown,
): Promise<JsonResponse> {
	const payload = body === undefined ? "" : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: LOOPBACK_HOST,
				port,
				method,
				path: requestPath,
				agent: false,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload).toString(),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({
						status: res.statusCode ?? 0,
						body: text ? JSON.parse(text) : null,
					});
				});
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

function seedRun(): {
	runId: string;
	chapterUuid: string;
	chapterExternalId: string;
	keyChangeUuid: string;
	keyChangeExternalId: string;
} {
	const db = getDb({ dbPath });
	insertChaptersFile(db, makeFixture(), makeRepoContext());
	const [chapterRow] = db.select().from(chapter).limit(1).all();
	if (!chapterRow) throw new Error("seed: missing chapter");
	const [keyChangeRow] = db
		.select()
		.from(keyChange)
		.where(eq(keyChange.chapterId, chapterRow.id))
		.limit(1)
		.all();
	if (!keyChangeRow) throw new Error("seed: missing key change");
	return {
		runId: chapterRow.runId,
		chapterUuid: chapterRow.id,
		chapterExternalId: chapterRow.externalId,
		keyChangeUuid: keyChangeRow.id,
		keyChangeExternalId: keyChangeRow.externalId,
	};
}

describe("view-state API", () => {
	it("POST /api/chapter-view/:chapterId inserts a row and is idempotent", async () => {
		const { chapterUuid } = seedRun();
		const { port } = await startWithRoutes();

		const first = await request(port, "POST", `/api/chapter-view/${chapterUuid}`);
		expect(first.status).toBe(200);

		const second = await request(port, "POST", `/api/chapter-view/${chapterUuid}`);
		expect(second.status).toBe(200);

		const db = getDb({ dbPath });
		const rows = db.select().from(chapterView).where(eq(chapterView.chapterId, chapterUuid)).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.userId).toBe("local");
	});

	it("POST /api/chapter-view/:chapterId accepts external_id and resolves to the uuid", async () => {
		const { chapterUuid, chapterExternalId } = seedRun();
		const { port } = await startWithRoutes();

		const res = await request(port, "POST", `/api/chapter-view/${chapterExternalId}`);
		expect(res.status).toBe(200);

		const db = getDb({ dbPath });
		const rows = db.select().from(chapterView).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.chapterId).toBe(chapterUuid);
	});

	it("DELETE /api/chapter-view/:chapterId removes the row and is idempotent", async () => {
		const { chapterUuid } = seedRun();
		const { port } = await startWithRoutes();

		await request(port, "POST", `/api/chapter-view/${chapterUuid}`);

		const first = await request(port, "DELETE", `/api/chapter-view/${chapterUuid}`);
		expect(first.status).toBe(200);

		const db = getDb({ dbPath });
		expect(db.select().from(chapterView).all()).toHaveLength(0);

		const second = await request(port, "DELETE", `/api/chapter-view/${chapterUuid}`);
		expect(second.status).toBe(200);
	});

	it("POST /api/chapter-view/:chapterId cascades file_view rows for each path in the chapter's hunkRefs", async () => {
		// Seed a chapter that touches two files so the cascade has more than one path.
		const db = getDb({ dbPath });
		const fixture = makeFixture({
			chapters: [
				{
					id: "chapter-multi",
					order: 1,
					title: "Multi-file chapter",
					summary: "Touches two files.",
					hunkRefs: [
						{ filePath: "src/foo.ts", oldStart: 1 },
						{ filePath: "src/foo.ts", oldStart: 50 }, // duplicate path → still one row
						{ filePath: "src/bar.ts", oldStart: 1 },
					],
					keyChanges: [],
				},
			],
		});
		insertChaptersFile(db, fixture, makeRepoContext());
		const [chapterRow] = db.select().from(chapter).limit(1).all();
		if (!chapterRow) throw new Error("seed: missing chapter");

		const { port } = await startWithRoutes();
		const res = await request(port, "POST", `/api/chapter-view/${chapterRow.id}`);
		expect(res.status).toBe(200);

		const fileRows = db.select().from(fileView).where(eq(fileView.runId, chapterRow.runId)).all();
		expect(fileRows.map((r) => r.filePath).sort()).toEqual(["src/bar.ts", "src/foo.ts"]);

		// And the cascade is reflected in GET view-state.
		const view = await request(port, "GET", `/api/runs/${chapterRow.runId}/view-state`);
		expect((view.body as { filePaths: string[] }).filePaths.sort()).toEqual([
			"src/bar.ts",
			"src/foo.ts",
		]);
	});

	it("DELETE /api/chapter-view/:chapterId cascades the unmark to the chapter's files", async () => {
		const { chapterUuid, runId } = seedRun();
		const { port } = await startWithRoutes();

		await request(port, "POST", `/api/chapter-view/${chapterUuid}`);
		const db = getDb({ dbPath });
		expect(
			db.select().from(fileView).where(eq(fileView.runId, runId)).all().length,
		).toBeGreaterThan(0);
		expect(
			db.select().from(chapterFileView).where(eq(chapterFileView.chapterId, chapterUuid)).all()
				.length,
		).toBeGreaterThan(0);

		await request(port, "DELETE", `/api/chapter-view/${chapterUuid}`);
		// Symmetric with POST: unmarking the chapter clears chapter_view, the
		// chapter's chapter_file_view rows, and (per rule 4) the global file_view
		// rows for every path the unmarked chapter touched.
		expect(db.select().from(chapterView).all()).toHaveLength(0);
		expect(
			db.select().from(chapterFileView).where(eq(chapterFileView.chapterId, chapterUuid)).all(),
		).toHaveLength(0);
		expect(db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(0);
	});

	it("DELETE /api/chapter-view/:chapterId scopes the cascade to that chapter's hunkRef paths", async () => {
		// File X belongs to chapter A, file Y belongs to chapter B. Marking A
		// then unmarking A should clear X but leave Y untouched, even though Y
		// was independently file-view'd.
		const db = getDb({ dbPath });
		const fixture = makeFixture({
			chapters: [
				{
					id: "ch-a",
					order: 1,
					title: "A",
					summary: "",
					hunkRefs: [{ filePath: "x.ts", oldStart: 1 }],
					keyChanges: [],
				},
				{
					id: "ch-b",
					order: 2,
					title: "B",
					summary: "",
					hunkRefs: [{ filePath: "y.ts", oldStart: 1 }],
					keyChanges: [],
				},
			],
		});
		insertChaptersFile(db, fixture, makeRepoContext());
		const chapters = db.select().from(chapter).all();
		const chapterA = chapters.find((c) => c.chapterIndex === 1);
		const chapterB = chapters.find((c) => c.chapterIndex === 2);
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters");

		const { port } = await startWithRoutes();
		await request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		await request(port, "POST", `/api/chapter-view/${chapterB.id}`);
		await request(port, "DELETE", `/api/chapter-view/${chapterA.id}`);

		const remaining = db
			.select({ filePath: fileView.filePath })
			.from(fileView)
			.where(eq(fileView.runId, chapterA.runId))
			.all();
		expect(remaining.map((r) => r.filePath)).toEqual(["y.ts"]);
	});

	it("POST /api/chapter-view/:chapterId only promotes file_view once every chapter containing the file is marked", async () => {
		// Two chapters share file `shared.ts`. Marking the first should leave file_view
		// empty for it (only one of two containing chapters covered); marking the second
		// promotes it. Mirrors hosted's "all chapters covered → file viewed" rule.
		const db = getDb({ dbPath });
		const fixture = makeFixture({
			chapters: [
				{
					id: "ch-a",
					order: 1,
					title: "A",
					summary: "",
					hunkRefs: [
						{ filePath: "shared.ts", oldStart: 1 },
						{ filePath: "only-a.ts", oldStart: 1 },
					],
					keyChanges: [],
				},
				{
					id: "ch-b",
					order: 2,
					title: "B",
					summary: "",
					hunkRefs: [{ filePath: "shared.ts", oldStart: 50 }],
					keyChanges: [],
				},
			],
		});
		insertChaptersFile(db, fixture, makeRepoContext());
		const chapters = db.select().from(chapter).all();
		const chapterA = chapters.find((c) => c.chapterIndex === 1);
		const chapterB = chapters.find((c) => c.chapterIndex === 2);
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters");

		const { port } = await startWithRoutes();

		// After marking only A: only-a.ts is fully covered (only A contains it),
		// shared.ts is NOT (B still hasn't marked it).
		await request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		const afterA = db
			.select({ filePath: fileView.filePath })
			.from(fileView)
			.where(eq(fileView.runId, chapterA.runId))
			.all()
			.map((r) => r.filePath)
			.sort();
		expect(afterA).toEqual(["only-a.ts"]);

		// chapter_file_view records both chapter A's hunkRef paths even though
		// shared.ts hasn't been promoted globally.
		const cfvAfterA = db
			.select({ chapterId: chapterFileView.chapterId, filePath: chapterFileView.filePath })
			.from(chapterFileView)
			.where(eq(chapterFileView.chapterId, chapterA.id))
			.all();
		expect(cfvAfterA.map((r) => r.filePath).sort()).toEqual(["only-a.ts", "shared.ts"]);

		// Marking B closes the coverage for shared.ts → it gets promoted.
		await request(port, "POST", `/api/chapter-view/${chapterB.id}`);
		const afterB = db
			.select({ filePath: fileView.filePath })
			.from(fileView)
			.where(eq(fileView.runId, chapterA.runId))
			.all()
			.map((r) => r.filePath)
			.sort();
		expect(afterB).toEqual(["only-a.ts", "shared.ts"]);
	});

	it("DELETE /api/chapter-view/:chapterId clears file_view for the chapter's files even when other chapters still cover them", async () => {
		// File `shared.ts` covered by both chapters. After marking both,
		// unmarking either chapter must drop file_view for shared.ts (rule 4),
		// even though the other chapter's chapter_file_view row survives so a
		// future re-mark can re-promote.
		const db = getDb({ dbPath });
		const fixture = makeFixture({
			chapters: [
				{
					id: "ch-a",
					order: 1,
					title: "A",
					summary: "",
					hunkRefs: [{ filePath: "shared.ts", oldStart: 1 }],
					keyChanges: [],
				},
				{
					id: "ch-b",
					order: 2,
					title: "B",
					summary: "",
					hunkRefs: [{ filePath: "shared.ts", oldStart: 50 }],
					keyChanges: [],
				},
			],
		});
		insertChaptersFile(db, fixture, makeRepoContext());
		const chapters = db.select().from(chapter).all();
		const chapterA = chapters.find((c) => c.chapterIndex === 1);
		const chapterB = chapters.find((c) => c.chapterIndex === 2);
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters");

		const { port } = await startWithRoutes();
		await request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		await request(port, "POST", `/api/chapter-view/${chapterB.id}`);
		// Sanity: shared.ts is fully covered.
		expect(db.select().from(fileView).where(eq(fileView.runId, chapterA.runId)).all()).toHaveLength(
			1,
		);

		await request(port, "DELETE", `/api/chapter-view/${chapterA.id}`);

		// file_view cleared for shared.ts even though B's chapter_file_view row stays,
		// because rule 4 unmarks every file the unmarked chapter touches unconditionally.
		expect(db.select().from(fileView).where(eq(fileView.runId, chapterA.runId)).all()).toHaveLength(
			0,
		);
		// B's per-chapter mark for shared.ts survives, and so does B's chapter_view.
		const cfvB = db
			.select()
			.from(chapterFileView)
			.where(eq(chapterFileView.chapterId, chapterB.id))
			.all();
		expect(cfvB).toHaveLength(1);
		expect(cfvB[0]?.filePath).toBe("shared.ts");

		// Re-marking A re-promotes shared.ts because A's chapter_file_view row
		// returns and B's row is still there → coverage is complete again.
		await request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		expect(db.select().from(fileView).where(eq(fileView.runId, chapterA.runId)).all()).toHaveLength(
			1,
		);
	});

	it("DELETE /api/runs/:runId/file-views cascades to remove chapter state for that path", async () => {
		// Without the cascade, a direct file unmark followed by a chapter mark/unmark
		// cycle could resurrect file_view via the coverage rule. The cascade clears
		// chapter state across every chapter in the run that touches the path.
		const db = getDb({ dbPath });
		const fixture = makeFixture({
			chapters: [
				{
					id: "ch-a",
					order: 1,
					title: "A",
					summary: "",
					hunkRefs: [{ filePath: "x.ts", oldStart: 1 }],
					keyChanges: [],
				},
				{
					id: "ch-b",
					order: 2,
					title: "B",
					summary: "",
					hunkRefs: [{ filePath: "y.ts", oldStart: 1 }],
					keyChanges: [],
				},
			],
		});
		insertChaptersFile(db, fixture, makeRepoContext());
		const chapters = db.select().from(chapter).all();
		const chapterA = chapters.find((c) => c.chapterIndex === 1);
		const chapterB = chapters.find((c) => c.chapterIndex === 2);
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters");
		const { port } = await startWithRoutes();

		await request(port, "POST", `/api/chapter-view/${chapterA.id}`);
		await request(port, "POST", `/api/chapter-view/${chapterB.id}`);
		expect(db.select().from(chapterView).all()).toHaveLength(2);

		// Direct unmark from the Files tab.
		const res = await requestWithBody(port, "DELETE", `/api/runs/${chapterA.runId}/file-views`, {
			path: "x.ts",
		});
		expect(res.status).toBe(200);

		expect(db.select().from(fileView).where(eq(fileView.filePath, "x.ts")).all()).toHaveLength(0);
		expect(db.select().from(fileView).where(eq(fileView.filePath, "y.ts")).all()).toHaveLength(1);
		expect(
			db.select().from(chapterFileView).where(eq(chapterFileView.filePath, "x.ts")).all(),
		).toHaveLength(0);
		expect(
			db.select().from(chapterView).where(eq(chapterView.chapterId, chapterA.id)).all(),
		).toHaveLength(0);
		expect(
			db.select().from(chapterView).where(eq(chapterView.chapterId, chapterB.id)).all(),
		).toHaveLength(1);
	});

	it("POST /api/chapter-view/:chapterId returns 404 for unknown chapter (no FK 500)", async () => {
		const { port } = await startWithRoutes();
		const res = await request(
			port,
			"POST",
			"/api/chapter-view/00000000-0000-0000-0000-000000000000",
		);
		expect(res.status).toBe(404);
		expect((res.body as { error: string }).error).toMatch(/not found/i);
	});

	it("POST /api/key-change-view/:keyChangeId inserts and is idempotent", async () => {
		const { keyChangeUuid } = seedRun();
		const { port } = await startWithRoutes();

		const first = await request(port, "POST", `/api/key-change-view/${keyChangeUuid}`);
		expect(first.status).toBe(200);
		const second = await request(port, "POST", `/api/key-change-view/${keyChangeUuid}`);
		expect(second.status).toBe(200);

		const db = getDb({ dbPath });
		const rows = db
			.select()
			.from(keyChangeView)
			.where(eq(keyChangeView.keyChangeId, keyChangeUuid))
			.all();
		expect(rows).toHaveLength(1);
	});

	it("POST /api/key-change-view/:keyChangeId accepts external_id", async () => {
		const { keyChangeUuid, keyChangeExternalId } = seedRun();
		const { port } = await startWithRoutes();

		const res = await request(port, "POST", `/api/key-change-view/${keyChangeExternalId}`);
		expect(res.status).toBe(200);

		const db = getDb({ dbPath });
		const rows = db.select().from(keyChangeView).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.keyChangeId).toBe(keyChangeUuid);
	});

	it("DELETE /api/key-change-view/:keyChangeId is idempotent", async () => {
		const { keyChangeUuid } = seedRun();
		const { port } = await startWithRoutes();

		await request(port, "POST", `/api/key-change-view/${keyChangeUuid}`);
		const first = await request(port, "DELETE", `/api/key-change-view/${keyChangeUuid}`);
		expect(first.status).toBe(200);
		const second = await request(port, "DELETE", `/api/key-change-view/${keyChangeUuid}`);
		expect(second.status).toBe(200);

		const db = getDb({ dbPath });
		expect(db.select().from(keyChangeView).all()).toHaveLength(0);
	});

	it("POST /api/key-change-view/:keyChangeId returns 404 for unknown key change", async () => {
		const { port } = await startWithRoutes();
		const res = await request(
			port,
			"POST",
			"/api/key-change-view/00000000-0000-0000-0000-000000000000",
		);
		expect(res.status).toBe(404);
	});

	it("GET /api/runs/:runId/view-state returns external_id strings (not uuid PKs)", async () => {
		const { runId, chapterUuid, chapterExternalId, keyChangeUuid, keyChangeExternalId } = seedRun();
		const { port } = await startWithRoutes();

		await request(port, "POST", `/api/chapter-view/${chapterUuid}`);
		await request(port, "POST", `/api/key-change-view/${keyChangeUuid}`);

		const res = await request(port, "GET", `/api/runs/${runId}/view-state`);
		expect(res.status).toBe(200);
		const body = res.body as { chapterIds: string[]; keyChangeIds: string[] };
		expect(body.chapterIds).toEqual([chapterExternalId]);
		expect(body.keyChangeIds).toEqual([keyChangeExternalId]);
		expect(body.chapterIds).not.toContain(chapterUuid);
		expect(body.keyChangeIds).not.toContain(keyChangeUuid);
	});

	it("GET /api/runs/:runId/view-state isolates state across runs", async () => {
		const db = getDb({ dbPath });
		// Two runs whose content (and external_ids) differ via baseSha. Both seeded with one chapter.
		const fixtureA = makeFixture({
			scope: {
				kind: "committed",
				baseSha: "a".repeat(40),
				headSha: "b".repeat(40),
				mergeBaseSha: "c".repeat(40),
			},
		});
		const fixtureB = makeFixture({
			scope: {
				kind: "committed",
				baseSha: "d".repeat(40),
				headSha: "e".repeat(40),
				mergeBaseSha: "f".repeat(40),
			},
		});
		const runA = insertChaptersFile(db, fixtureA, makeRepoContext());
		const runB = insertChaptersFile(db, fixtureB, makeRepoContext());

		const [chapterA] = db.select().from(chapter).where(eq(chapter.runId, runA.runId)).all();
		const [chapterB] = db.select().from(chapter).where(eq(chapter.runId, runB.runId)).all();
		if (!chapterA || !chapterB) throw new Error("seed: missing chapters per run");

		const { port } = await startWithRoutes();
		await request(port, "POST", `/api/chapter-view/${chapterA.id}`);

		const stateA = await request(port, "GET", `/api/runs/${runA.runId}/view-state`);
		const stateB = await request(port, "GET", `/api/runs/${runB.runId}/view-state`);

		expect((stateA.body as { chapterIds: string[] }).chapterIds).toEqual([chapterA.externalId]);
		expect((stateB.body as { chapterIds: string[] }).chapterIds).toEqual([]);
	});

	it("GET /api/runs/:runId/view-state returns 404 for unknown runs", async () => {
		const { port } = await startWithRoutes();
		const res = await request(
			port,
			"GET",
			"/api/runs/00000000-0000-0000-0000-000000000000/view-state",
		);
		expect(res.status).toBe(404);
	});

	it("cascade: deleting a chapter removes its chapter_view and key_change_view rows", async () => {
		const { chapterUuid, keyChangeUuid } = seedRun();
		const { port } = await startWithRoutes();

		await request(port, "POST", `/api/chapter-view/${chapterUuid}`);
		await request(port, "POST", `/api/key-change-view/${keyChangeUuid}`);

		const db = getDb({ dbPath });
		expect(db.select().from(chapterView).all()).toHaveLength(1);
		expect(db.select().from(keyChangeView).all()).toHaveLength(1);

		db.delete(chapter).where(eq(chapter.id, chapterUuid)).run();

		expect(db.select().from(chapterView).all()).toHaveLength(0);
		expect(db.select().from(keyChangeView).all()).toHaveLength(0);
	});

	it("POST /api/runs/:runId/file-views inserts a row and is idempotent", async () => {
		const { runId } = seedRun();
		const { port } = await startWithRoutes();

		const first = await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});
		expect(first.status).toBe(200);

		const second = await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});
		expect(second.status).toBe(200);

		const db = getDb({ dbPath });
		const rows = db.select().from(fileView).where(eq(fileView.runId, runId)).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.filePath).toBe("src/foo.ts");
	});

	it("POST /api/runs/:runId/file-views accepts paths with slashes and dots (no path traversal magic)", async () => {
		const { runId } = seedRun();
		const { port } = await startWithRoutes();

		// File paths are pure identifiers in the view-state table; we don't resolve
		// them to disk, so traversal characters are stored verbatim.
		const tricky = "deep/../../weird path/with spaces.ts";
		const res = await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: tricky,
		});
		expect(res.status).toBe(200);

		const get = await request(port, "GET", `/api/runs/${runId}/view-state`);
		expect((get.body as { filePaths: string[] }).filePaths).toEqual([tricky]);
	});

	it("POST /api/runs/:runId/file-views returns 404 for unknown run", async () => {
		const { port } = await startWithRoutes();
		const res = await requestWithBody(
			port,
			"POST",
			"/api/runs/00000000-0000-0000-0000-000000000000/file-views",
			{ path: "src/foo.ts" },
		);
		expect(res.status).toBe(404);
		expect((res.body as { error: string }).error).toMatch(/not found/i);
	});

	it("POST /api/runs/:runId/file-views returns 400 for missing or empty path", async () => {
		const { runId } = seedRun();
		const { port } = await startWithRoutes();

		const empty = await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {});
		expect(empty.status).toBe(400);

		const blank = await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "",
		});
		expect(blank.status).toBe(400);
	});

	it("DELETE /api/runs/:runId/file-views removes the row and is idempotent", async () => {
		const { runId } = seedRun();
		const { port } = await startWithRoutes();

		await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		const first = await requestWithBody(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});
		expect(first.status).toBe(200);

		const db = getDb({ dbPath });
		expect(db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(0);

		const second = await requestWithBody(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});
		expect(second.status).toBe(200);
	});

	it("GET /api/runs/:runId/view-state returns viewed file paths in filePaths", async () => {
		const { runId } = seedRun();
		const { port } = await startWithRoutes();

		await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "packages/web/src/App.tsx",
		});
		await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "packages/cli/src/index.ts",
		});

		const res = await request(port, "GET", `/api/runs/${runId}/view-state`);
		expect(res.status).toBe(200);
		const body = res.body as { filePaths: string[] };
		expect(body.filePaths).toContain("packages/web/src/App.tsx");
		expect(body.filePaths).toContain("packages/cli/src/index.ts");
	});

	it("GET /api/runs/:runId/view-state isolates filePaths across runs", async () => {
		const db = getDb({ dbPath });
		const fixtureA = makeFixture({
			scope: {
				kind: "committed",
				baseSha: "a".repeat(40),
				headSha: "b".repeat(40),
				mergeBaseSha: "c".repeat(40),
			},
		});
		const fixtureB = makeFixture({
			scope: {
				kind: "committed",
				baseSha: "d".repeat(40),
				headSha: "e".repeat(40),
				mergeBaseSha: "f".repeat(40),
			},
		});
		const runA = insertChaptersFile(db, fixtureA, makeRepoContext());
		const runB = insertChaptersFile(db, fixtureB, makeRepoContext());

		const { port } = await startWithRoutes();
		await requestWithBody(port, "POST", `/api/runs/${runA.runId}/file-views`, {
			path: "src/a.ts",
		});

		const stateA = await request(port, "GET", `/api/runs/${runA.runId}/view-state`);
		const stateB = await request(port, "GET", `/api/runs/${runB.runId}/view-state`);
		expect((stateA.body as { filePaths: string[] }).filePaths).toEqual(["src/a.ts"]);
		expect((stateB.body as { filePaths: string[] }).filePaths).toEqual([]);
	});

	it("cascade: deleting a run removes its file_view rows", async () => {
		const { runId } = seedRun();
		const { port } = await startWithRoutes();

		await requestWithBody(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		const db = getDb({ dbPath });
		expect(db.select().from(fileView).all()).toHaveLength(1);

		// File views are scoped to chapter_run; deleting the run cascades them.
		db.delete(chapterRun).where(eq(chapterRun.id, runId)).run();
		expect(db.select().from(fileView).all()).toHaveLength(0);
	});

	it("POST via external_id fans out across re-imports of the same scope (view-state survives regeneration)", async () => {
		// Importing twice with identical scope creates two chapter rows sharing one externalId.
		// POST to that externalId must mark both runs viewed; otherwise GET on whichever run
		// was missed comes back empty even though the content is identical.
		const db = getDb({ dbPath });
		insertChaptersFile(db, makeFixture(), makeRepoContext());
		const runA = db.select().from(chapter).all();
		insertChaptersFile(db, makeFixture(), makeRepoContext());
		const allChapters = db.select().from(chapter).all();
		const chapterB = allChapters.find((c) => !runA.some((a) => a.id === c.id));
		if (!chapterB) throw new Error("seed: expected a second chapter row from the re-import");
		const chapterA = runA[0];
		if (!chapterA) throw new Error("seed: missing chapter from first import");
		expect(chapterB.externalId).toBe(chapterA.externalId);
		expect(chapterB.runId).not.toBe(chapterA.runId);

		const { port } = await startWithRoutes();
		const post = await request(port, "POST", `/api/chapter-view/${chapterA.externalId}`);
		expect(post.status).toBe(200);

		const stateA = await request(port, "GET", `/api/runs/${chapterA.runId}/view-state`);
		const stateB = await request(port, "GET", `/api/runs/${chapterB.runId}/view-state`);
		expect((stateA.body as { chapterIds: string[] }).chapterIds).toEqual([chapterA.externalId]);
		expect((stateB.body as { chapterIds: string[] }).chapterIds).toEqual([chapterB.externalId]);

		const del = await request(port, "DELETE", `/api/chapter-view/${chapterA.externalId}`);
		expect(del.status).toBe(200);
		expect(db.select().from(chapterView).all()).toHaveLength(0);
	});
});
