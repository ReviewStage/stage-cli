import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb, type StageDb } from "../db/client.js";
import { chapter, chapterRun, keyChange } from "../db/schema/index.js";
import { type RepoContext, readRepoContext } from "../git.js";
import { type ChaptersFile, ChaptersFileSchema, SCOPE_KIND, type Scope } from "../schema.js";

export interface ImportChaptersResult {
	runId: string;
	chapterCount: number;
	keyChangeCount: number;
}

export function importChaptersFile(jsonPath: string, db: StageDb = getDb()): ImportChaptersResult {
	const absolute = path.resolve(jsonPath);
	const raw = readFileSync(absolute, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	const file = ChaptersFileSchema.parse(parsed);
	return insertChaptersFile(db, file, readRepoContext());
}

export function insertChaptersFile(
	db: StageDb,
	file: ChaptersFile,
	repo: RepoContext,
): ImportChaptersResult {
	return db.transaction((tx) => {
		const [runRow] = tx
			.insert(chapterRun)
			.values({
				repoRoot: repo.root,
				originUrl: repo.originUrl,
				scopeKind: file.scope.kind,
				workingTreeRef: file.scope.kind === SCOPE_KIND.WORKING_TREE ? file.scope.ref : null,
				baseSha: file.scope.baseSha,
				headSha: file.scope.headSha,
				mergeBaseSha: file.scope.mergeBaseSha,
				generatedAt: new Date(file.generatedAt),
				prologue: file.prologue ?? null,
			})
			.returning({ id: chapterRun.id })
			.all();
		if (!runRow) throw new Error("chapter_run insert returned no row");
		const runId = runRow.id;

		const scopeKey = deriveScopeKey(file.scope);

		let keyChangeCount = 0;
		for (const c of file.chapters) {
			const [chapterRow] = tx
				.insert(chapter)
				.values({
					runId,
					externalId: deriveChapterExternalId(scopeKey, c.id),
					chapterIndex: c.order,
					title: c.title,
					summary: c.summary,
					hunkRefs: c.hunkRefs,
					keyChanges: c.keyChanges.map((kc) => kc.content),
				})
				.returning({ id: chapter.id })
				.all();
			if (!chapterRow) throw new Error("chapter insert returned no row");
			const chapterId = chapterRow.id;

			for (const kc of c.keyChanges) {
				tx.insert(keyChange)
					.values({
						chapterId,
						externalId: deriveKeyChangeExternalId(scopeKey, c.id, kc.content, kc.lineRefs),
						content: kc.content,
						lineRefs: kc.lineRefs,
					})
					.run();
				keyChangeCount++;
			}
		}

		return { runId, chapterCount: file.chapters.length, keyChangeCount };
	});
}

function deriveScopeKey(scope: Scope): string {
	if (scope.kind === SCOPE_KIND.COMMITTED) {
		return `committed:${scope.baseSha}:${scope.headSha}:${scope.mergeBaseSha}`;
	}
	return `workingTree:${scope.ref}:${scope.baseSha}:${scope.headSha}:${scope.mergeBaseSha}`;
}

function deriveChapterExternalId(scopeKey: string, agentId: string): string {
	const hash = createHash("sha256");
	hash.update(scopeKey);
	hash.update(" ");
	hash.update(agentId);
	return hash.digest("hex").slice(0, 24);
}

function deriveKeyChangeExternalId(
	scopeKey: string,
	chapterAgentId: string,
	content: string,
	lineRefs: unknown,
): string {
	const hash = createHash("sha256");
	hash.update(scopeKey);
	hash.update(" ");
	hash.update(chapterAgentId);
	hash.update(" ");
	hash.update(content);
	hash.update(" ");
	hash.update(JSON.stringify(lineRefs));
	return hash.digest("hex").slice(0, 24);
}
