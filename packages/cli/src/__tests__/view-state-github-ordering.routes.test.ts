import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileView } from "../db/schema/index.js";
import { ViewStateGitHubHarness } from "./view-state-github-harness.js";

const harness = new ViewStateGitHubHarness();

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

describe("GitHub mutation ordering", () => {
	it("serializes overlapping mark/unmark for the same (runId, filePath) in request order", async () => {
		// The shim answers the first mutation only after a delay, so without
		// serialization the DELETE's unmark would finish on GitHub before the
		// POST's mark and leave the file marked viewed while local state isn't.
		await harness.writeGhShim(undefined, { firstMutationDelayMs: 250 });
		const { runId } = harness.seedRun();
		const port = await harness.start();

		const post = harness.request(port, "POST", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});
		// Wait until the mark mutation is in flight (spawned, sitting in its
		// delay) before firing the opposing request, guaranteeing overlap.
		await harness.waitForGhCall((args) => args.some((arg) => arg.includes("MarkFileAsViewed")));
		const del = harness.request(port, "DELETE", `/api/runs/${runId}/file-views`, {
			path: "src/foo.ts",
		});

		const [postRes, delRes] = await Promise.all([post, del]);
		expect(postRes.status).toBe(200);
		expect(delRes.status).toBe(200);

		expect(await harness.mutationCompletions()).toEqual([
			{ name: "MarkFileAsViewed", path: "src/foo.ts" },
			{ name: "UnmarkFileAsViewed", path: "src/foo.ts" },
		]);
		// GitHub's final state (unmarked) matches local state.
		expect(harness.db.select().from(fileView).where(eq(fileView.runId, runId)).all()).toHaveLength(
			0,
		);
	});
});
