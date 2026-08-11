import type { MergeStatusResponse } from "@stagereview/types/pull-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MERGE_JSON, PullRequestRouteHarness } from "./pull-request-route-harness.js";

let harness: PullRequestRouteHarness;

beforeEach(async () => {
	harness = new PullRequestRouteHarness();
	await harness.setup();
});

afterEach(async () => {
	await harness.teardown();
});

// GraphQL Ref.rules shapes — GitHub returns uppercase rule types and merge-method tokens.
type RuleNode = {
	type: string;
	parameters: { __typename: string; allowedMergeMethods?: string[] | null } | null;
} | null;

type BaseRef = { rules: { nodes: RuleNode[] | null } | null } | null;

function pullRequestRule(allowedMergeMethods: string[] | null): RuleNode {
	return {
		type: "PULL_REQUEST",
		parameters: { __typename: "PullRequestParameters", allowedMergeMethods },
	};
}

const LINEAR_HISTORY_RULE: RuleNode = { type: "REQUIRED_LINEAR_HISTORY", parameters: null };
const NON_PR_RULE: RuleNode = { type: "NON_FAST_FORWARD", parameters: null };

function buildMergeStatusJson(overrides?: {
	squashMergeAllowed?: boolean;
	mergeCommitAllowed?: boolean;
	rebaseMergeAllowed?: boolean;
	baseRef?: BaseRef;
}): string {
	return JSON.stringify({
		data: {
			repository: {
				autoMergeAllowed: true,
				squashMergeAllowed: overrides?.squashMergeAllowed ?? true,
				mergeCommitAllowed: overrides?.mergeCommitAllowed ?? true,
				rebaseMergeAllowed: overrides?.rebaseMergeAllowed ?? true,
				pullRequest: {
					mergeable: "MERGEABLE",
					mergeStateStatus: "CLEAN",
					reviewDecision: "APPROVED",
					isMergeQueueEnabled: false,
					viewerCanEnableAutoMerge: true,
					viewerCanDisableAutoMerge: false,
					autoMergeRequest: null,
					baseRef:
						overrides && "baseRef" in overrides ? overrides.baseRef : { rules: { nodes: [] } },
					commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
					mergeQueueEntry: null,
				},
			},
		},
	});
}

async function fetchAllowedMergeMethods(merge: string): Promise<string[]> {
	await harness.writeFakeGh({ merge });
	const runId = harness.insertRun();
	const response = await harness.request(
		await harness.start(),
		`/api/runs/${runId}/pull-request/merge-status?number=7`,
	);
	expect(response.status).toBe(200);
	const { mergeStatus } = JSON.parse(response.body) as MergeStatusResponse;
	if (!mergeStatus) throw new Error("merge-status route returned a null mergeStatus");
	return mergeStatus.allowedMergeMethods;
}

describe("pull-request API — merge status", () => {
	it("maps the merge-status GraphQL response", async () => {
		await harness.writeFakeGh({ merge: MERGE_JSON });
		const runId = harness.insertRun();
		const response = await harness.request(
			await harness.start(),
			`/api/runs/${runId}/pull-request/merge-status?number=7`,
		);
		const { mergeStatus } = JSON.parse(response.body) as MergeStatusResponse;

		expect(response.status).toBe(200);
		expect(mergeStatus).toMatchObject({
			mergeable: "MERGEABLE",
			mergeStateStatus: "CLEAN",
			reviewDecision: "APPROVED",
			checkRollupState: "SUCCESS",
			isInMergeQueue: false,
			allowedMergeMethods: ["MERGE", "SQUASH"],
		});
	});

	it("derives allowedMergeMethods with all three enabled and no branch rules", async () => {
		const methods = await fetchAllowedMergeMethods(buildMergeStatusJson());
		expect(methods).toEqual(["MERGE", "SQUASH", "REBASE"]);
	});

	it("intersects repo flags with a squash-only pull-request rule", async () => {
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({ baseRef: { rules: { nodes: [pullRequestRule(["SQUASH"])] } } }),
		);
		expect(methods).toEqual(["SQUASH"]);
	});

	it("does not widen beyond repo flags when a rule allows more methods", async () => {
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({
				squashMergeAllowed: true,
				mergeCommitAllowed: false,
				rebaseMergeAllowed: false,
				baseRef: { rules: { nodes: [pullRequestRule(["MERGE", "SQUASH", "REBASE"])] } },
			}),
		);
		expect(methods).toEqual(["SQUASH"]);
	});

	it("intersects across multiple pull-request rules", async () => {
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({
				baseRef: {
					rules: {
						nodes: [pullRequestRule(["MERGE", "SQUASH"]), pullRequestRule(["SQUASH", "REBASE"])],
					},
				},
			}),
		);
		expect(methods).toEqual(["SQUASH"]);
	});

	it("falls back to repo flags when no pull-request rule applies", async () => {
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({ baseRef: { rules: { nodes: [NON_PR_RULE] } } }),
		);
		expect(methods).toEqual(["MERGE", "SQUASH", "REBASE"]);
	});

	it("ignores a pull-request rule that does not constrain merge methods", async () => {
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({ baseRef: { rules: { nodes: [pullRequestRule(null)] } } }),
		);
		expect(methods).toEqual(["MERGE", "SQUASH", "REBASE"]);
	});

	it("drops merge commits when the base branch requires linear history", async () => {
		// Repo allows all three; a pull-request rule allows squash + merge; a
		// required-linear-history rule forbids merge commits — so only squash survives.
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({
				baseRef: {
					rules: { nodes: [pullRequestRule(["SQUASH", "MERGE"]), LINEAR_HISTORY_RULE] },
				},
			}),
		);
		expect(methods).toEqual(["SQUASH"]);
	});

	it("parses the real GitHub rules payload (all rule shapes) and yields squash-only", async () => {
		// Verbatim rules-shape mix seen via GraphQL on a real repo: null-parameter
		// rules, a required_status_checks rule, and the pull-request + linear-history combo.
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({
				baseRef: {
					rules: {
						nodes: [
							{ type: "DELETION", parameters: null },
							{ type: "NON_FAST_FORWARD", parameters: null },
							{ type: "REQUIRED_LINEAR_HISTORY", parameters: null },
							pullRequestRule(["SQUASH", "MERGE"]),
							{
								type: "REQUIRED_STATUS_CHECKS",
								parameters: { __typename: "RequiredStatusChecksParameters" },
							},
						],
					},
				},
			}),
		);
		expect(methods).toEqual(["SQUASH"]);
	});

	it("drops merge commits under required linear history with no pull-request rule", async () => {
		const methods = await fetchAllowedMergeMethods(
			buildMergeStatusJson({ baseRef: { rules: { nodes: [LINEAR_HISTORY_RULE] } } }),
		);
		expect(methods).toEqual(["SQUASH", "REBASE"]);
	});

	it("uses repo flags when the base ref is missing (deleted base branch)", async () => {
		const methods = await fetchAllowedMergeMethods(buildMergeStatusJson({ baseRef: null }));
		expect(methods).toEqual(["MERGE", "SQUASH", "REBASE"]);
	});
});
