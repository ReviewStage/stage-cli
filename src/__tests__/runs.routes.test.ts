import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertChaptersFile } from "../commands/ingest.js";
import { closeDb, getDb } from "../db/client.js";
import { runRoutes } from "../routes/runs.js";
import { LOOPBACK_HOST, type ServerHandle, startServer } from "../server.js";
import { makeFixture } from "./fixtures.js";

let tmpDir: string;
let dbPath: string;
let webDist: string;
const handles: ServerHandle[] = [];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-routes-"));
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
  const handle = await startServer({ webDistPath: webDist, routes: runRoutes(db) });
  handles.push(handle);
  return handle;
}

interface JsonResponse {
  status: number;
  body: unknown;
}

function getJson(port: number, requestPath: string): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: LOOPBACK_HOST, port, method: "GET", path: requestPath, agent: false },
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

describe("runs API", () => {
  it("GET /api/runs/latest returns the most recent run", async () => {
    const db = getDb({ dbPath });
    const first = insertChaptersFile(db, makeFixture(), "/repo");
    await new Promise((r) => setTimeout(r, 5));
    const second = insertChaptersFile(db, makeFixture(), "/repo");

    const { port } = await startWithRoutes();
    const res = await getJson(port, "/api/runs/latest");

    expect(res.status).toBe(200);
    const body = res.body as { run: { id: string } };
    expect(body.run.id).toBe(second.runId);
    expect(body.run.id).not.toBe(first.runId);
  });

  it("GET /api/runs/latest returns 404 when no runs exist", async () => {
    const { port } = await startWithRoutes();
    const res = await getJson(port, "/api/runs/latest");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId/chapters returns chapters with nested keyChanges sorted by chapterIndex", async () => {
    const db = getDb({ dbPath });
    const fixture = makeFixture({
      chapters: [
        {
          id: "chapter-0",
          order: 2,
          title: "Second",
          summary: "Second summary",
          hunkRefs: [],
          keyChanges: [],
        },
        {
          id: "chapter-1",
          order: 1,
          title: "First",
          summary: "First summary",
          hunkRefs: [{ filePath: "a.ts", oldStart: 1 }],
          keyChanges: [
            {
              content: "Question?",
              lineRefs: [{ filePath: "a.ts", side: "additions", startLine: 1, endLine: 2 }],
            },
          ],
        },
      ],
    });
    const { runId } = insertChaptersFile(db, fixture, "/repo");

    const { port } = await startWithRoutes();
    const res = await getJson(port, `/api/runs/${runId}/chapters`);

    expect(res.status).toBe(200);
    const body = res.body as {
      run: { id: string };
      chapters: Array<{ chapterIndex: number; title: string; keyChanges: unknown[] }>;
    };
    expect(body.run.id).toBe(runId);
    expect(body.chapters).toHaveLength(2);
    expect(body.chapters[0]?.chapterIndex).toBe(1);
    expect(body.chapters[0]?.title).toBe("First");
    expect(body.chapters[0]?.keyChanges).toHaveLength(1);
    expect(body.chapters[1]?.chapterIndex).toBe(2);
    expect(body.chapters[1]?.keyChanges).toHaveLength(0);
  });

  it("GET /api/runs/:runId/chapters returns 404 for unknown runs", async () => {
    const { port } = await startWithRoutes();
    const res = await getJson(port, "/api/runs/00000000-0000-0000-0000-000000000000/chapters");
    expect(res.status).toBe(404);
  });
});
