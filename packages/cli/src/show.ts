import open from "open";
import { closeDb, getDb } from "./db/client.js";
import { diffRoutes } from "./routes/diff.js";
import { runRoutes } from "./routes/runs.js";
import { viewStateRoutes } from "./routes/view-state.js";
import { importChaptersFile } from "./runs/import-chapters.js";
import { LOOPBACK_HOST, startServer } from "./server.js";

export async function show(jsonPath: string): Promise<void> {
	const db = getDb();
	const { runId } = importChaptersFile(jsonPath, db);

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
