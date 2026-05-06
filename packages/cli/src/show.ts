import { readFileSync } from "node:fs";
import path from "node:path";
import open from "open";
import { buildOtherChangesChapter } from "./build-other-changes.js";
import { closeDb, getDb } from "./db/client.js";
import { parseGitDiff } from "./diff-parser.js";
import { filterFilesForLlm } from "./filter-files.js";
import { readRepoContext, resolveScope } from "./git.js";
import { diffRoutes } from "./routes/diff.js";
import { runRoutes } from "./routes/runs.js";
import { viewStateRoutes } from "./routes/view-state.js";
import { insertChaptersFile } from "./runs/import-chapters.js";
import {
	type AgentOutput,
	AgentOutputSchema,
	type ChaptersFile,
	ChaptersFileSchema,
} from "./schema.js";
import { LOOPBACK_HOST, startServer } from "./server.js";

export async function show(jsonPath: string): Promise<void> {
	const db = getDb();
	const chaptersFile = loadChaptersFile(jsonPath);
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

function loadChaptersFile(jsonPath: string): ChaptersFile {
	const absolute = path.resolve(jsonPath);
	const raw = readFileSync(absolute, "utf8");
	const parsed = JSON.parse(raw) as unknown;

	const fullResult = ChaptersFileSchema.safeParse(parsed);
	if (fullResult.success) return fullResult.data;

	const agentResult = AgentOutputSchema.safeParse(parsed);
	if (agentResult.success) return assembleChaptersFile(agentResult.data);

	throw fullResult.error;
}

function assembleChaptersFile(agentOutput: AgentOutput): ChaptersFile {
	const { scope, rawDiff } = resolveScope();
	const allFiles = parseGitDiff(rawDiff);
	const { excludedByPath } = filterFilesForLlm(allFiles);

	const chapters = [...agentOutput.chapters];
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
