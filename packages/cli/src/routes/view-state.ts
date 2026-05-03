import { FileViewBodySchema } from "@stage-cli/types/view-state";
import { and, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { LOCAL_USER_ID } from "../db/local-user.js";
import {
	chapter,
	chapterRun,
	chapterView,
	fileView,
	keyChange,
	keyChangeView,
} from "../db/schema/index.js";
import type { Route } from "../server.js";
import { readJsonBody, writeJson } from "./json.js";

export function viewStateRoutes(db: StageDb): Route[] {
	return [
		{
			method: "POST",
			pattern: "/api/chapter-view/:chapterId",
			handler: (_req, res, params) => {
				const rows = resolveChapterRows(db, params.chapterId);
				if (rows.length === 0) {
					writeJson(res, 404, { error: `Chapter ${params.chapterId} not found` });
					return;
				}
				// Fan out across every chapter row sharing this externalId so view-state survives
				// re-imports of the same diff (PLA-117). For a uuid param this collapses to one row.
				db.transaction((tx) => {
					tx.insert(chapterView)
						.values(rows.map((r) => ({ userId: LOCAL_USER_ID, chapterId: r.id })))
						.onConflictDoNothing()
						.run();
					// Cascade: marking a chapter viewed implicitly marks every file the
					// chapter touches as viewed too. Mirrors hosted's chapter→file
					// behavior (which writes through GitHub's per-file viewed-state) —
					// here we write directly to file_view since that's our local store.
					const fileViewRows = chapterFileViewRows(rows);
					if (fileViewRows.length > 0) {
						tx.insert(fileView).values(fileViewRows).onConflictDoNothing().run();
					}
				});
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/chapter-view/:chapterId",
			handler: (_req, res, params) => {
				const rows = resolveChapterRows(db, params.chapterId);
				if (rows.length === 0) {
					// Idempotent: if the chapter doesn't exist there's nothing to delete. The SPA
					// shouldn't have to distinguish "row was gone" from "chapter was gone".
					writeJson(res, 200, {});
					return;
				}
				db.transaction((tx) => {
					tx.delete(chapterView)
						.where(
							and(
								eq(chapterView.userId, LOCAL_USER_ID),
								inArray(
									chapterView.chapterId,
									rows.map((r) => r.id),
								),
							),
						)
						.run();
					// Symmetric counterpart to the POST cascade: unmarking a chapter
					// also unmarks every file the chapter touches, so the Files-changed
					// tab's "N/M viewed" label tracks the chapter state. A file that
					// belongs to multiple chapters loses its mark from this delete; the
					// next refetch re-derives the correct count from whatever's left.
					const cascadeRows = chapterFileViewRows(rows);
					if (cascadeRows.length === 0) return;
					const runIds = Array.from(new Set(cascadeRows.map((r) => r.runId)));
					const filePaths = Array.from(new Set(cascadeRows.map((r) => r.filePath)));
					tx.delete(fileView)
						.where(
							and(
								eq(fileView.userId, LOCAL_USER_ID),
								inArray(fileView.runId, runIds),
								inArray(fileView.filePath, filePaths),
							),
						)
						.run();
				});
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
		// File-view endpoints take the path in the body so file paths with `/` separators
		// don't have to be URL-encoded into route segments.
		{
			method: "POST",
			pattern: "/api/runs/:runId/file-views",
			handler: async (req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				const exists = runExists(db, runId);
				if (!exists) {
					writeJson(res, 404, { error: `Run ${runId} not found` });
					return;
				}

				const parsed = await parseFileViewBody(req, res);
				if (!parsed) return;

				db.insert(fileView)
					.values({ userId: LOCAL_USER_ID, runId, filePath: parsed.path })
					.onConflictDoNothing()
					.run();
				writeJson(res, 200, {});
			},
		},
		{
			method: "DELETE",
			pattern: "/api/runs/:runId/file-views",
			handler: async (req, res, params) => {
				const runId = params.runId;
				if (!runId) {
					writeJson(res, 400, { error: "Missing runId" });
					return;
				}
				if (!runExists(db, runId)) {
					writeJson(res, 200, {});
					return;
				}

				const parsed = await parseFileViewBody(req, res);
				if (!parsed) return;

				db.delete(fileView)
					.where(
						and(
							eq(fileView.userId, LOCAL_USER_ID),
							eq(fileView.runId, runId),
							eq(fileView.filePath, parsed.path),
						),
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

				const viewedFiles = db
					.select({ filePath: fileView.filePath })
					.from(fileView)
					.where(and(eq(fileView.userId, LOCAL_USER_ID), eq(fileView.runId, runId)))
					.all();

				writeJson(res, 200, {
					chapterIds: viewedChapters.map((r) => r.externalId),
					keyChangeIds: checkedKeyChanges.map((r) => r.externalId),
					filePaths: viewedFiles.map((r) => r.filePath),
				});
			},
		},
	];
}

interface ResolvedChapterRow {
	id: string;
	runId: string;
	hunkRefs: typeof chapter.$inferSelect.hunkRefs;
}

// Returns every chapter row matching the param: a singleton when given a uuid, or every
// chapter sharing an externalId (re-imports of the same scope). Empty array means 404.
function resolveChapterRows(db: StageDb, idOrExternalId: string | undefined): ResolvedChapterRow[] {
	if (!idOrExternalId) return [];
	const cols = { id: chapter.id, runId: chapter.runId, hunkRefs: chapter.hunkRefs };
	const byPk = db.select(cols).from(chapter).where(eq(chapter.id, idOrExternalId)).all();
	if (byPk.length > 0) return byPk;
	return db.select(cols).from(chapter).where(eq(chapter.externalId, idOrExternalId)).all();
}

// Builds the file_view rows that the chapter→file cascade should insert. Each
// chapter contributes one row per distinct file in its hunkRefs, scoped to the
// chapter's runId so the same path in a different run stays unaffected.
function chapterFileViewRows(
	rows: ResolvedChapterRow[],
): Array<{ userId: string; runId: string; filePath: string }> {
	// Dedupe within (runId, filePath) pairs so we don't generate duplicate rows
	// when externalId fan-out hits multiple imports of the same scope.
	const seen = new Set<string>();
	const out: Array<{ userId: string; runId: string; filePath: string }> = [];
	for (const row of rows) {
		const filePaths = new Set<string>();
		for (const ref of row.hunkRefs) filePaths.add(ref.filePath);
		for (const filePath of filePaths) {
			const key = `${row.runId} ${filePath}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ userId: LOCAL_USER_ID, runId: row.runId, filePath });
		}
	}
	return out;
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

function runExists(db: StageDb, runId: string): boolean {
	const rows = db
		.select({ id: chapterRun.id })
		.from(chapterRun)
		.where(eq(chapterRun.id, runId))
		.limit(1)
		.all();
	return rows.length > 0;
}

async function parseFileViewBody(
	req: Parameters<Route["handler"]>[0],
	res: Parameters<Route["handler"]>[1],
): Promise<{ path: string } | null> {
	let raw: unknown;
	try {
		raw = await readJsonBody(req);
	} catch (err) {
		writeJson(res, 400, { error: err instanceof Error ? err.message : "Invalid JSON body" });
		return null;
	}
	const parsed = FileViewBodySchema.safeParse(raw);
	if (!parsed.success) {
		writeJson(res, 400, { error: "Invalid file-view body: missing or empty `path`" });
		return null;
	}
	return parsed.data;
}
