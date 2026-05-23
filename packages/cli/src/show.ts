import { readFileSync } from "node:fs";
import path from "node:path";
import open from "open";
import { buildOtherChangesChapter } from "./build-other-changes.js";
import { closeDb, getDb } from "./db/client.js";
import { parseGitDiff } from "./diff-parser.js";
import { filterFilesForLlm } from "./filter-files.js";
import { type ResolveScopeOptions, readRepoContext, resolveScope } from "./git.js";
import { diffRoutes } from "./routes/diff.js";
import { runRoutes } from "./routes/runs.js";
import { viewStateRoutes } from "./routes/view-state.js";
import { insertChaptersFile } from "./runs/import-chapters.js";
import {
	type AgentOutput,
	AgentOutputSchema,
	type Chapter,
	type ChaptersFile,
	ChaptersFileSchema,
	DIFF_SIDE,
	type WorkingTreeRef,
} from "./schema.js";
import { LOOPBACK_HOST, startServer } from "./server.js";

export async function show(
	jsonPath: string,
	base?: string,
	workingTreeRef?: WorkingTreeRef,
	refs?: string[],
	compare?: string,
): Promise<void> {
	const db = getDb();
	const chaptersFile = loadChaptersFile(jsonPath, base, workingTreeRef, refs, compare);
	const { runId } = insertChaptersFile(db, chaptersFile, readRepoContext());

	const handle = await startServer({
		routes: [...runRoutes(db), ...viewStateRoutes(db), ...diffRoutes(db)],
	});
	const { port } = handle;
	const url = `http://${LOOPBACK_HOST}:${port}/runs/${encodeURIComponent(runId)}`;

	process.stdout.write(`Listening on ${url}\n`);
	process.stdout.write("Press Ctrl+C to exit.\n");

	try {
		await open(url);
	} catch {
		// URL is on stdout — user can navigate manually.
	}

	await waitForShutdownSignal();

	await handle.close();
	closeDb();
}

function loadChaptersFile(
	jsonPath: string,
	base?: string,
	workingTreeRef?: WorkingTreeRef,
	refs?: string[],
	compare?: string,
): ChaptersFile {
	const absolute = path.resolve(jsonPath);
	const raw = readFileSync(absolute, "utf8");
	const parsed = JSON.parse(raw) as unknown;

	const fullResult = ChaptersFileSchema.safeParse(parsed);
	if (fullResult.success) return fullResult.data;

	const agentResult = AgentOutputSchema.safeParse(parsed);
	if (agentResult.success) {
		return assembleChaptersFile(agentResult.data, base, workingTreeRef, refs, compare);
	}

	throw fullResult.error;
}

function assembleChaptersFile(
	agentOutput: AgentOutput,
	base?: string,
	workingTreeRef?: WorkingTreeRef,
	refs?: string[],
	compare?: string,
): ChaptersFile {
	const options: ResolveScopeOptions = {
		base,
		compare,
		refs,
		workingTreeRef,
	};
	const { scope, rawDiff } = resolveScope(options);
	const allFiles = parseGitDiff(rawDiff);
	const { files: filteredFiles, excludedByPath } = filterFilesForLlm(allFiles);

	validateHunkCoverage(filteredFiles, agentOutput.chapters);
	const sanitized = sanitizeLineRefs(agentOutput.chapters, filteredFiles);

	const chapters = [...sanitized];
	const otherChanges = buildOtherChangesChapter(allFiles, excludedByPath);
	if (otherChanges) {
		chapters.push({ ...otherChanges, order: chapters.length + 1 });
	}

	return {
		scope,
		chapters,
		prologue: agentOutput.prologue,
		generatedAt: new Date().toISOString(),
	};
}

function validateHunkCoverage(
	filteredFiles: { path: string; hunks: { oldStart: number }[] }[],
	chapters: Chapter[],
): void {
	const expected = new Map<string, Set<number>>();
	for (const file of filteredFiles) {
		const starts = new Set<number>();
		for (const hunk of file.hunks) {
			starts.add(hunk.oldStart);
		}
		if (starts.size > 0) {
			expected.set(file.path, starts);
		}
	}

	const actual = new Map<string, Map<number, number>>();
	const duplicates: string[] = [];
	for (const chapter of chapters) {
		for (const ref of chapter.hunkRefs) {
			let starts = actual.get(ref.filePath);
			if (!starts) {
				starts = new Map();
				actual.set(ref.filePath, starts);
			}
			const count = starts.get(ref.oldStart) ?? 0;
			if (count > 0) {
				duplicates.push(`  filePath: "${ref.filePath}", oldStart: ${ref.oldStart}`);
			}
			starts.set(ref.oldStart, count + 1);
		}
	}

	const missing: string[] = [];
	for (const [filePath, starts] of expected) {
		const actualStarts = actual.get(filePath);
		for (const oldStart of starts) {
			if (!actualStarts?.has(oldStart)) {
				missing.push(`  filePath: "${filePath}", oldStart: ${oldStart}`);
			}
		}
	}

	const extra: string[] = [];
	for (const [filePath, starts] of actual) {
		const expectedStarts = expected.get(filePath);
		for (const oldStart of starts.keys()) {
			if (!expectedStarts?.has(oldStart)) {
				extra.push(`  filePath: "${filePath}", oldStart: ${oldStart}`);
			}
		}
	}

	if (missing.length === 0 && extra.length === 0 && duplicates.length === 0) return;

	const lines = ["Hunk coverage validation failed."];
	if (missing.length > 0) {
		lines.push(`Missing hunks (${missing.length}) — not assigned to any chapter:`);
		lines.push(...missing);
	}
	if (extra.length > 0) {
		lines.push(`Extra hunks (${extra.length}) — not found in the diff:`);
		lines.push(...extra);
	}
	if (duplicates.length > 0) {
		lines.push(`Duplicate hunks (${duplicates.length}) — assigned to multiple chapters:`);
		lines.push(...duplicates);
	}
	throw new Error(lines.join("\n"));
}

interface HunkSpan {
	oldStart: number;
	oldEnd: number;
	newStart: number;
	newEnd: number;
}

function sanitizeLineRefs(
	chapters: Chapter[],
	filteredFiles: {
		path: string;
		hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number }[];
	}[],
): Chapter[] {
	const hunkSpanIndex = new Map<string, Map<number, HunkSpan>>();
	for (const file of filteredFiles) {
		const spans = new Map<number, HunkSpan>();
		for (const hunk of file.hunks) {
			spans.set(hunk.oldStart, {
				oldStart: hunk.oldStart,
				oldEnd: hunk.oldStart + hunk.oldLines - 1,
				newStart: hunk.newStart,
				newEnd: hunk.newStart + hunk.newLines - 1,
			});
		}
		if (spans.size > 0) {
			hunkSpanIndex.set(file.path, spans);
		}
	}

	return chapters.map((chapter) => {
		const chapterSpans = new Map<string, HunkSpan[]>();
		for (const ref of chapter.hunkRefs) {
			const fileSpans = hunkSpanIndex.get(ref.filePath);
			if (!fileSpans) continue;
			const span = fileSpans.get(ref.oldStart);
			if (!span) continue;
			let spans = chapterSpans.get(ref.filePath);
			if (!spans) {
				spans = [];
				chapterSpans.set(ref.filePath, spans);
			}
			spans.push(span);
		}

		const keyChanges = chapter.keyChanges.flatMap((kc) => {
			const validRefs = kc.lineRefs.filter((ref) => {
				if (ref.startLine < 1 || ref.endLine < 1) return false;
				if (ref.startLine > ref.endLine) return false;

				const spans = chapterSpans.get(ref.filePath);
				if (!spans) return false;

				return spans.some((span) => {
					const [rangeStart, rangeEnd] =
						ref.side === DIFF_SIDE.ADDITIONS
							? [span.newStart, span.newEnd]
							: [span.oldStart, span.oldEnd];
					if (rangeStart > rangeEnd) return false;
					return ref.startLine >= rangeStart && ref.endLine <= rangeEnd;
				});
			});

			const uniqueRefs: typeof validRefs = [];
			for (const ref of validRefs) {
				const isDuplicate = uniqueRefs.some(
					(existing) =>
						existing.filePath === ref.filePath &&
						existing.side === ref.side &&
						existing.startLine === ref.startLine &&
						existing.endLine === ref.endLine,
				);
				if (!isDuplicate) uniqueRefs.push(ref);
			}

			if (uniqueRefs.length === 0) return [];
			return [{ content: kc.content, lineRefs: uniqueRefs }];
		});

		return { ...chapter, keyChanges };
	});
}

function waitForShutdownSignal(): Promise<void> {
	return new Promise<void>((resolve) => {
		const cleanup = () => {
			process.removeListener("SIGINT", cleanup);
			process.removeListener("SIGTERM", cleanup);
			resolve();
		};

		process.once("SIGINT", cleanup);
		process.once("SIGTERM", cleanup);
	});
}
