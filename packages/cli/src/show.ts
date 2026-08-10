import { readFileSync } from "node:fs";
import path from "node:path";
import open from "open";
import { buildOtherChangesChapter } from "./build-other-changes.js";
import { closeDb, getDb } from "./db/client.js";
import { parseGitDiff } from "./diff-parser.js";
import { filterFilesForLlm, loadStageIgnore } from "./filter-files.js";
import { getRawDiffForScope, readRepoContext, readRepoRoot } from "./git.js";
import { commentRoutes } from "./routes/comments.js";
import { diffRoutes } from "./routes/diff.js";
import { imageProxyRoutes } from "./routes/image-proxy.js";
import { labelRoutes } from "./routes/labels.js";
import { pullRequestRoutes } from "./routes/pull-request.js";
import { pullRequestMutationRoutes } from "./routes/pull-request-mutations.js";
import { reviewRoutes } from "./routes/review.js";
import { runRoutes } from "./routes/runs.js";
import { timelineRoutes } from "./routes/timeline.js";
import { viewStateRoutes } from "./routes/view-state.js";
import { viewerRoutes } from "./routes/viewer.js";
import { insertChaptersFile } from "./runs/import-chapters.js";
import {
	type AgentOutput,
	AgentOutputSchema,
	type Chapter,
	type ChaptersFile,
	ChaptersFileSchema,
	DIFF_SIDE,
	HEADER_ONLY_OLD_START,
	type Scope,
} from "./schema.js";
import { type DiffScopeOptions, pullRequestNumberFromRef, resolveDiffScope } from "./scope.js";
import { LOOPBACK_HOST, startServer } from "./server.js";
import { unescapeLiteralNewlines } from "./unescape.js";

export async function show(jsonPath: string, options: DiffScopeOptions): Promise<void> {
	const db = getDb();
	const { chaptersFile, prNumber } = await buildChaptersFile(jsonPath, options);
	const repoContext = readRepoContext();
	const { runId } = insertChaptersFile(db, chaptersFile, repoContext, prNumber);

	const handle = await startServer({
		routes: [
			...runRoutes(db),
			...viewStateRoutes(db),
			...commentRoutes(db),
			...reviewRoutes(db),
			...viewerRoutes(),
			...diffRoutes(db),
			...pullRequestRoutes(db),
			...pullRequestMutationRoutes(db),
			...timelineRoutes(db),
			...labelRoutes(db),
			...imageProxyRoutes(),
		],
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

interface BuiltChaptersFile {
	chaptersFile: ChaptersFile;
	/** The reviewed PR's number when `--pr` was used, else null. */
	prNumber: number | null;
}

async function buildChaptersFile(
	jsonPath: string,
	options: DiffScopeOptions,
): Promise<BuiltChaptersFile> {
	const absolute = path.resolve(jsonPath);
	const raw = readFileSync(absolute, "utf8");
	const parsed = JSON.parse(raw) as unknown;

	// A fully-formed chapters file carries its own scope, so the diff isn't
	// recomputed from the working tree or PR. `--pr` still records which PR the
	// run targets (so the UI resolves the right one) — only the number is needed
	// here, not a fetch, since the scope already comes from the file.
	const fullResult = ChaptersFileSchema.safeParse(parsed);
	if (fullResult.success) {
		const prNumber = options.pr === undefined ? null : pullRequestNumberFromRef(options.pr);
		return { chaptersFile: revalidateChaptersFile(fullResult.data), prNumber };
	}

	const agentResult = AgentOutputSchema.safeParse(parsed);
	if (agentResult.success) {
		const { scope, rawDiff, prNumber } = await resolveDiffScope(options);
		return { chaptersFile: assembleChaptersFile(agentResult.data, scope, rawDiff), prNumber };
	}

	throw fullResult.error;
}

/**
 * Pre-assembled chapters files don't skip validation: recompute the diff their
 * scope describes and run the same hunk-coverage check and lineRef repair the
 * agent-output path gets. Because these files already include the other-changes
 * chapter, coverage is checked against every file in the diff — with the
 * HEADER_ONLY_OLD_START sentinel expected for files that have no hunks.
 */
function revalidateChaptersFile(file: ChaptersFile): ChaptersFile {
	const allFiles = parseGitDiff(getRawDiffForScope(file.scope));
	validateHunkCoverage(expectedHunkStarts(allFiles, { includeHeaderOnly: true }), file.chapters);
	const chapters = unescapeChapters(sanitizeLineRefs(file.chapters, allFiles));
	return { ...file, chapters };
}

function assembleChaptersFile(
	agentOutput: AgentOutput,
	scope: Scope,
	rawDiff: string,
): ChaptersFile {
	const allFiles = parseGitDiff(rawDiff);
	const stageIgnore = loadStageIgnore(readRepoRoot());
	const { files: filteredFiles, excludedByPath } = filterFilesForLlm(allFiles, stageIgnore);

	validateHunkCoverage(
		expectedHunkStarts(filteredFiles, { includeHeaderOnly: false }),
		agentOutput.chapters,
	);
	const sanitized = unescapeChapters(sanitizeLineRefs(agentOutput.chapters, filteredFiles));

	const chapters = [...sanitized];
	const otherChanges = buildOtherChangesChapter(allFiles, excludedByPath);
	if (otherChanges) {
		const maxOrder = chapters.reduce((max, c) => Math.max(max, c.order), 0);
		chapters.push({ ...otherChanges, order: maxOrder + 1 });
	}

	return {
		scope,
		chapters,
		prologue: agentOutput.prologue,
		generatedAt: new Date().toISOString(),
	};
}

function unescapeChapters(chapters: Chapter[]): Chapter[] {
	return chapters.map((chapter) => ({
		...chapter,
		summary: unescapeLiteralNewlines(chapter.summary),
		keyChanges: chapter.keyChanges.map((kc) => ({
			...kc,
			content: unescapeLiteralNewlines(kc.content),
		})),
	}));
}

/**
 * The set of hunkRefs a run's chapters must cover, keyed by file path. With
 * `includeHeaderOnly`, files without hunks (pure renames/moves, binary files)
 * expect the HEADER_ONLY_OLD_START sentinel their other-changes refs carry.
 */
function expectedHunkStarts(
	files: { path: string; hunks: { oldStart: number }[] }[],
	{ includeHeaderOnly }: { includeHeaderOnly: boolean },
): Map<string, Set<number>> {
	const expected = new Map<string, Set<number>>();
	for (const file of files) {
		const starts = new Set<number>();
		for (const hunk of file.hunks) {
			starts.add(hunk.oldStart);
		}
		if (starts.size === 0 && includeHeaderOnly) {
			starts.add(HEADER_ONLY_OLD_START);
		}
		if (starts.size > 0) {
			expected.set(file.path, starts);
		}
	}
	return expected;
}

function validateHunkCoverage(expected: Map<string, Set<number>>, chapters: Chapter[]): void {
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
