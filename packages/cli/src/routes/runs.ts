import type {
	Chapter,
	ChapterRun,
	KeyChange,
	LineRef,
	RiskLevel,
} from "@stagereview/types/chapters";
import { isValidRiskLevel } from "@stagereview/types/chapters";
import { asc, eq, inArray } from "drizzle-orm";
import type { StageDb } from "../db/client.js";
import { chapter, chapterRun, keyChange } from "../db/schema/index.js";
import { parseRepoName } from "../git.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";

type ChapterRow = typeof chapter.$inferSelect;
type ChapterRunRow = typeof chapterRun.$inferSelect;
type KeyChangeRow = typeof keyChange.$inferSelect;

// Project DB rows into the public wire shape. Keeps DB-only fields
// (`runId`, `chapterIndex`, `createdAt`, `updatedAt`, the denormalized
// `keyChanges` string array) out of the API surface so the wire format can
// evolve independently of the schema. Mirrors hosted's mapChapterRow pattern.
function mapKeyChange(kc: KeyChangeRow): KeyChange {
	return {
		id: kc.id,
		externalId: kc.externalId,
		content: kc.content,
		lineRefs: kc.lineRefs,
	};
}

// Mirrors hosted's mapChapterRow: order keyChanges by the first file they
// reference (per the chapter's hunkRef file order), then by min startLine
// within that file, so What-to-Review reads top-to-bottom with the diff.
function mapChapter(ch: ChapterRow, kcs: KeyChangeRow[]): Chapter {
	const fileOrder = new Map<string, number>();
	for (const ref of ch.hunkRefs) {
		if (!fileOrder.has(ref.filePath)) {
			fileOrder.set(ref.filePath, fileOrder.size);
		}
	}

	const keyChanges = kcs.map(mapKeyChange).sort((a, b) => {
		const aIndex = minFileIndex(a.lineRefs, fileOrder);
		const bIndex = minFileIndex(b.lineRefs, fileOrder);
		if (aIndex !== bIndex) {
			if (aIndex === undefined) return 1;
			if (bIndex === undefined) return -1;
			return aIndex - bIndex;
		}
		if (aIndex === undefined) return 0;
		const tiedFile = fileAtIndex(fileOrder, aIndex);
		return minStartLineInFile(a.lineRefs, tiedFile) - minStartLineInFile(b.lineRefs, tiedFile);
	});

	const riskLevel = ch.riskLevel !== null && isValidRiskLevel(ch.riskLevel) ? ch.riskLevel : null;

	return {
		id: ch.id,
		externalId: ch.externalId,
		order: ch.chapterIndex,
		title: ch.title,
		summary: ch.summary,
		hunkRefs: ch.hunkRefs,
		keyChanges,
		riskLevel,
		riskReasons: riskReasonsForLevel(riskLevel, ch.riskReasons),
	};
}

function riskReasonsForLevel(riskLevel: RiskLevel | null, riskReasons: string[] | null): string[] {
	if (riskLevel === null) {
		return [];
	}
	if (riskReasons === null) {
		return [];
	}
	return riskReasons;
}

function minFileIndex(lineRefs: LineRef[], fileOrder: Map<string, number>): number | undefined {
	let min: number | undefined;
	for (const ref of lineRefs) {
		const idx = fileOrder.get(ref.filePath);
		if (idx !== undefined && (min === undefined || idx < min)) min = idx;
	}
	return min;
}

function fileAtIndex(fileOrder: Map<string, number>, index: number): string {
	for (const [path, idx] of fileOrder) {
		if (idx === index) return path;
	}
	throw new Error(`No file at index ${index}`);
}

function minStartLineInFile(lineRefs: LineRef[], filePath: string): number {
	let min = Number.POSITIVE_INFINITY;
	for (const ref of lineRefs) {
		if (ref.filePath === filePath && ref.startLine < min) min = ref.startLine;
	}
	return min;
}

function mapRun(run: ChapterRunRow): ChapterRun {
	return { id: run.id, repoName: parseRepoName(run.originUrl, run.repoRoot) };
}

export function runRoutes(db: StageDb): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/runs/:runId/chapters",
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

				const chapters = db
					.select()
					.from(chapter)
					.where(eq(chapter.runId, runId))
					.orderBy(asc(chapter.chapterIndex))
					.all();

				const chapterIds = chapters.map((c) => c.id);
				const keyChanges =
					chapterIds.length > 0
						? db.select().from(keyChange).where(inArray(keyChange.chapterId, chapterIds)).all()
						: [];

				const byChapter = new Map<string, KeyChangeRow[]>();
				for (const kc of keyChanges) {
					const list = byChapter.get(kc.chapterId);
					if (list) list.push(kc);
					else byChapter.set(kc.chapterId, [kc]);
				}

				writeJson(res, 200, {
					run: mapRun(run),
					chapters: chapters.map((ch) => mapChapter(ch, byChapter.get(ch.id) ?? [])),
					prologue: run.prologue ?? null,
				});
			},
		},
	];
}
