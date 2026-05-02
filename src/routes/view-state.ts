import { and, eq } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import { chapter, chapterRun, chapterView, keyChange, keyChangeView } from "../db/schema/index.js";
import type { Route } from "../server.js";

export function viewStateRoutes(db: StageDb): Route[] {
  return [
    {
      method: "POST",
      pattern: "/api/chapter-view/:chapterId",
      handler: (_req, res, params) => {
        const id = resolveChapterId(db, params.chapterId);
        if (!id) {
          writeJson(res, 404, { error: `Chapter ${params.chapterId} not found` });
          return;
        }
        db.insert(chapterView)
          .values({ userId: LOCAL_USER_ID, chapterId: id })
          .onConflictDoNothing()
          .run();
        writeJson(res, 200, {});
      },
    },
    {
      method: "DELETE",
      pattern: "/api/chapter-view/:chapterId",
      handler: (_req, res, params) => {
        const id = resolveChapterId(db, params.chapterId);
        if (!id) {
          // Idempotent: if the chapter doesn't exist there's nothing to delete. The SPA
          // shouldn't have to distinguish "row was gone" from "chapter was gone".
          writeJson(res, 200, {});
          return;
        }
        db.delete(chapterView)
          .where(and(eq(chapterView.userId, LOCAL_USER_ID), eq(chapterView.chapterId, id)))
          .run();
        writeJson(res, 200, {});
      },
    },
    {
      method: "POST",
      pattern: "/api/key-change-view/:keyChangeId",
      handler: (_req, res, params) => {
        const id = resolveKeyChangeId(db, params.keyChangeId);
        if (!id) {
          writeJson(res, 404, { error: `Key change ${params.keyChangeId} not found` });
          return;
        }
        db.insert(keyChangeView)
          .values({ userId: LOCAL_USER_ID, keyChangeId: id })
          .onConflictDoNothing()
          .run();
        writeJson(res, 200, {});
      },
    },
    {
      method: "DELETE",
      pattern: "/api/key-change-view/:keyChangeId",
      handler: (_req, res, params) => {
        const id = resolveKeyChangeId(db, params.keyChangeId);
        if (!id) {
          writeJson(res, 200, {});
          return;
        }
        db.delete(keyChangeView)
          .where(and(eq(keyChangeView.userId, LOCAL_USER_ID), eq(keyChangeView.keyChangeId, id)))
          .run();
        writeJson(res, 200, {});
      },
    },
    {
      method: "GET",
      pattern: "/api/runs/:runId/view-state",
      handler: (_req, res, params) => {
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

        // Returning external_id (not the uuid PK) is what makes view-state survive content
        // regenerations — see PLA-116 for the externalId derivation.
        const viewedChapters = db
          .select({ externalId: chapter.externalId })
          .from(chapterView)
          .innerJoin(chapter, eq(chapter.id, chapterView.chapterId))
          .where(and(eq(chapterView.userId, LOCAL_USER_ID), eq(chapter.runId, runId)))
          .all();

        const checkedKeyChanges = db
          .select({ externalId: keyChange.externalId })
          .from(keyChangeView)
          .innerJoin(keyChange, eq(keyChange.id, keyChangeView.keyChangeId))
          .innerJoin(chapter, eq(chapter.id, keyChange.chapterId))
          .where(and(eq(keyChangeView.userId, LOCAL_USER_ID), eq(chapter.runId, runId)))
          .all();

        writeJson(res, 200, {
          chapterIds: viewedChapters.map((r) => r.externalId),
          keyChangeIds: checkedKeyChanges.map((r) => r.externalId),
        });
      },
    },
  ];
}

function resolveChapterId(db: StageDb, idOrExternalId: string | undefined): string | null {
  if (!idOrExternalId) return null;
  const [row] = db
    .select({ id: chapter.id })
    .from(chapter)
    .where(eq(chapter.id, idOrExternalId))
    .limit(1)
    .all();
  if (row) return row.id;
  const [byExt] = db
    .select({ id: chapter.id })
    .from(chapter)
    .where(eq(chapter.externalId, idOrExternalId))
    .limit(1)
    .all();
  return byExt?.id ?? null;
}

function resolveKeyChangeId(db: StageDb, idOrExternalId: string | undefined): string | null {
  if (!idOrExternalId) return null;
  const [row] = db
    .select({ id: keyChange.id })
    .from(keyChange)
    .where(eq(keyChange.id, idOrExternalId))
    .limit(1)
    .all();
  if (row) return row.id;
  const [byExt] = db
    .select({ id: keyChange.id })
    .from(keyChange)
    .where(eq(keyChange.externalId, idOrExternalId))
    .limit(1)
    .all();
  return byExt?.id ?? null;
}

function writeJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
