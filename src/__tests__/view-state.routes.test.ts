import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { chapter, chapterView, keyChange, keyChangeView } from "../db/schema/index.js";
import { runRoutes } from "../routes/runs.js";
import { viewStateRoutes } from "../routes/view-state.js";
import { insertChaptersFile } from "../runs/import-chapters.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture } from "./fixtures.js";

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

function seedRun(): {
  runId: string;
  chapterUuid: string;
  chapterExternalId: string;
  keyChangeUuid: string;
  keyChangeExternalId: string;
} {
  const db = getDb({ dbPath });
  insertChaptersFile(db, makeFixture(), "/repo");
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
    const runA = insertChaptersFile(db, fixtureA, "/repo");
    const runB = insertChaptersFile(db, fixtureB, "/repo");

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
});
