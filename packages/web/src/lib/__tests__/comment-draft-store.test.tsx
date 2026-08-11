// @vitest-environment happy-dom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	CommentDraftStoreProvider,
	type FileCommentDrafts,
	useFileCommentDrafts,
} from "../comment-draft-store";
import { readDraftBody, upsertDraft, writeDraftBody } from "../comment-drafts";
import { DIFF_SIDE } from "../diff-types";

afterEach(cleanup);

const ANCHOR = { side: DIFF_SIDE.ADDITIONS, startLine: 3, endLine: 5 } as const;

let current: FileCommentDrafts | null = null;

function Probe({ filePath }: { filePath?: string }) {
	current = useFileCommentDrafts(filePath);
	return null;
}

/** Reads the probe's latest hook value; narrowed here so tests stay unnarrowed. */
function probe(): FileCommentDrafts {
	if (current === null) throw new Error("probe not mounted");
	return current;
}

/**
 * The provider stays mounted while the probe toggles, simulating a virtualized
 * row (the probe) unmounting when scrolled beyond Virtuoso's overscan.
 */
function Harness({
	resetKey,
	rowMounted,
	filePath,
}: {
	resetKey: string;
	rowMounted: boolean;
	filePath?: string;
}) {
	return (
		<CommentDraftStoreProvider resetKey={resetKey}>
			{rowMounted ? <Probe filePath={filePath} /> : null}
		</CommentDraftStoreProvider>
	);
}

describe("useFileCommentDrafts", () => {
	afterEach(() => {
		current = null;
	});

	it("keeps an open composer and its typed text across a row unmount/remount cycle", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);

		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		writeDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine, "wip: half-typed note");

		current = null;
		rerender(<Harness resetKey="run-1" rowMounted={false} filePath="src/a.ts" />);
		expect(current).toBeNull();

		rerender(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);
		expect(probe().drafts).toEqual([{ ...ANCHOR, error: null }]);
		expect(readDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine)).toBe(
			"wip: half-typed note",
		);
	});

	it("scopes drafts and bodies to their file path", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);

		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		writeDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine, "note for a.ts");

		rerender(<Harness resetKey="run-1" rowMounted filePath="src/b.ts" />);
		expect(probe().drafts).toEqual([]);
		expect(readDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine)).toBe("");
	});

	it("removes a closed draft everywhere", () => {
		render(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);

		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		expect(probe().drafts).toHaveLength(1);

		act(() => probe().setDrafts((prev) => prev.filter((d) => d.endLine !== ANCHOR.endLine)));
		expect(probe().drafts).toEqual([]);
	});

	it("clears all drafts and bodies when the reset key changes", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);

		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		writeDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine, "stale note");

		rerender(<Harness resetKey="run-2" rowMounted filePath="src/a.ts" />);
		expect(probe().drafts).toEqual([]);
		expect(readDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine)).toBe("");
	});

	it("does not restore discarded text when a run is revisited", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);

		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		writeDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine, "discarded note");

		// Navigate away (drafts reset) and back — the original run must get a
		// fresh body-map generation, not the cached pre-reset text.
		rerender(<Harness resetKey="run-2" rowMounted filePath="src/a.ts" />);
		rerender(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);
		expect(probe().drafts).toEqual([]);
		expect(readDraftBody(probe().draftBodies, ANCHOR.side, ANCHOR.endLine)).toBe("");
	});

	it("drops a stale setDrafts captured before a run switch", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted filePath="src/a.ts" />);

		// A submit completion holds onto setDrafts across the await.
		const staleSetDrafts = probe().setDrafts;

		// Navigate to a sibling run that has its own draft at the same anchor.
		rerender(<Harness resetKey="run-2" rowMounted filePath="src/a.ts" />);
		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		expect(probe().drafts).toHaveLength(1);

		// The first run's submission settles late: closing its draft must not
		// remove the sibling's draft at the same (file, side, line).
		act(() => staleSetDrafts((prev) => prev.filter((d) => d.endLine !== ANCHOR.endLine)));
		expect(probe().drafts).toEqual([{ ...ANCHOR, error: null }]);
	});

	it("keeps drafts local to the instance when no file path is given", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted />);

		act(() => probe().setDrafts((prev) => upsertDraft(prev, ANCHOR)));
		expect(probe().drafts).toHaveLength(1);

		rerender(<Harness resetKey="run-1" rowMounted={false} />);
		rerender(<Harness resetKey="run-1" rowMounted />);
		expect(probe().drafts).toEqual([]);
	});
});
