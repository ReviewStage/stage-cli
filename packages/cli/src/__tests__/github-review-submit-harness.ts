import type { CommentThread, CreateCommentThreadBody } from "@stagereview/types/comments";
import { getDb } from "../db/client.js";
import { commentRoutes } from "../routes/comments.js";
import { gitHubThreadRoutes } from "../routes/github-threads.js";
import { makeThreadBody } from "./comment-routes-harness.js";
import { send, setupGhRouteTest } from "./gh-route-harness.js";

// Shared setup for the two review-submit test files (split by behavior group
// to stay under the 200-line-per-file cap): core submission mechanics in
// github-review-submit.routes.test.ts, payload-construction/validation edge
// cases in github-review-submit-payload.routes.test.ts.
export const env = setupGhRouteTest("stage-cli-github-review-submit-");

// Success case: logs argv, and for the reviews POST also captures stdin (the
// JSON payload piped via `--input -`) so tests can assert its shape.
export const SUCCESS_GH_SCRIPT = `#!/bin/sh
echo "$@" >> "$(dirname "$0")/args.log"
case "$*" in
	*"/reviews"*) cat > "$(dirname "$0")/stdin.log"; echo '{"id": 99}';;
	*) echo '{}';;
esac
`;

export const FAILING_GH_SCRIPT = `#!/bin/sh
echo "$@" >> "$(dirname "$0")/args.log"
echo "gh: review submission rejected" >&2
exit 1
`;

export async function startWithRoutes(): Promise<{ port: number }> {
	const db = getDb({ dbPath: env.dbPath });
	const port = await env.startWithRoutes([...gitHubThreadRoutes(db), ...commentRoutes(db)]);
	return { port };
}

export async function createThread(
	port: number,
	runId: string,
	over: Partial<CreateCommentThreadBody> = {},
): Promise<CommentThread> {
	const res = await send(port, "POST", `/api/runs/${runId}/comment-threads`, makeThreadBody(over));
	return JSON.parse(res.body) as CommentThread;
}
