import { and, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import { chapter, chapterRun, chapterView, keyChange, keyChangeView } from "../db/schema/index.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

export function viewStateRoutes(db: StageDb): Route[] {
	return [
		{
			method: "POST",
			pattern: "/api/chapter-view/:chapterId",
			handler: (_req, res, params) => {
				const ids = resolveChapterIds(db, params.chapterId);
				if (ids.length === 0) {
					writeJson(res, 404, { error: `Chapter ${params.chapterId} not found` });
					return;
				}
				// Fan out across every chapter row sharing this externalId so view-state survives
				// re-imports of the same diff (PLA-117). For a uuid param this collapses to one row.
				db.insert(chapterView)
					.values(ids.map((id) => ({ userId: LOCAL_USER_ID, chapterId: id })))
					.onConflictDoNothing()
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/chapter-view/:chapterId",
			handler: (_req, res, params) => {
				const ids = resolveChapterIds(db, params.chapterId);
				if (ids.length === 0) {
					// Idempotent: if the chapter doesn't exist there's nothing to delete. The SPA
					// shouldn't have to distinguish "row was gone" from "chapter was gone".
					writeJson(res, 200, {});
					return;
				}
				db.delete(chapterView)
					.where(and(eq(chapterView.userId, LOCAL_USER_ID), inArray(chapterView.chapterId, ids)))
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "POST",
			pattern: "/api/key-change-view/:keyChangeId",
			handler: (_req, res, params) => {
				const ids = resolveKeyChangeIds(db, params.keyChangeId);
				if (ids.length === 0) {
					writeJson(res, 404, { error: `Key change ${params.keyChangeId} not found` });
					return;
				}
				db.insert(keyChangeView)
					.values(ids.map((id) => ({ userId: LOCAL_USER_ID, keyChangeId: id })))
					.onConflictDoNothing()
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/key-change-view/:keyChangeId",
			handler: (_req, res, params) => {
				const ids = resolveKeyChangeIds(db, params.keyChangeId);
				if (ids.length === 0) {
					writeJson(res, 200, {});
					return;
				}
				db.delete(keyChangeView)
					.where(
						and(eq(keyChangeView.userId, LOCAL_USER_ID), inArray(keyChangeView.keyChangeId, ids)),
					)
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

// Returns every chapter row matching the param: a singleton when given a uuid, or every
// chapter sharing an externalId (re-imports of the same scope). Empty array means 404.
function resolveChapterIds(db: StageDb, idOrExternalId: string | undefined): string[] {
	if (!idOrExternalId) return [];
	const byPk = db
		.select({ id: chapter.id })
		.from(chapter)
		.where(eq(chapter.id, idOrExternalId))
		.all();
	if (byPk.length > 0) return byPk.map((r) => r.id);
	return db
		.select({ id: chapter.id })
		.from(chapter)
		.where(eq(chapter.externalId, idOrExternalId))
		.all()
		.map((r) => r.id);
}

function resolveKeyChangeIds(db: StageDb, idOrExternalId: string | undefined): string[] {
	if (!idOrExternalId) return [];
	const byPk = db
		.select({ id: keyChange.id })
		.from(keyChange)
		.where(eq(keyChange.id, idOrExternalId))
		.all();
	if (byPk.length > 0) return byPk.map((r) => r.id);
	return db
		.select({ id: keyChange.id })
		.from(keyChange)
		.where(eq(keyChange.externalId, idOrExternalId))
		.all()
		.map((r) => r.id);
}
