// @vitest-environment happy-dom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FileExpansionProvider, useFileExpansion } from "../file-expansion-context";

afterEach(cleanup);

let current: ReturnType<typeof useFileExpansion> | null = null;

function Probe() {
	current = useFileExpansion();
	return null;
}

/** Reads the probe's latest hook value; narrowed here so tests stay unnarrowed. */
function probe(): ReturnType<typeof useFileExpansion> {
	if (current === null) throw new Error("probe not mounted");
	return current;
}

/**
 * The provider stays mounted while the probe toggles, simulating a virtualized
 * row (the probe) unmounting when scrolled beyond Virtuoso's overscan.
 */
function Harness({ resetKey, rowMounted }: { resetKey: string; rowMounted: boolean }) {
	return (
		<FileExpansionProvider resetKey={resetKey}>
			{rowMounted ? <Probe /> : null}
		</FileExpansionProvider>
	);
}

describe("FileExpansionProvider", () => {
	afterEach(() => {
		current = null;
	});

	it("toggles a file's expansion on and off", () => {
		render(<Harness resetKey="run-1" rowMounted />);
		expect(current?.expandedFiles.has("src/a.ts")).toBe(false);

		act(() => current?.toggleFileExpanded("src/a.ts"));
		expect(current?.expandedFiles.has("src/a.ts")).toBe(true);

		act(() => current?.toggleFileExpanded("src/a.ts"));
		expect(current?.expandedFiles.has("src/a.ts")).toBe(false);
	});

	it("keeps expansion across a row unmount/remount cycle", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted />);
		act(() => current?.toggleFileExpanded("src/a.ts"));

		current = null;
		rerender(<Harness resetKey="run-1" rowMounted={false} />);
		expect(current).toBeNull();

		rerender(<Harness resetKey="run-1" rowMounted />);
		expect(probe().expandedFiles.has("src/a.ts")).toBe(true);
	});

	it("clears expansion when the reset key changes", () => {
		const { rerender } = render(<Harness resetKey="run-1" rowMounted />);
		act(() => current?.toggleFileExpanded("src/a.ts"));
		expect(current?.expandedFiles.has("src/a.ts")).toBe(true);

		rerender(<Harness resetKey="run-2" rowMounted />);
		expect(current?.expandedFiles.size).toBe(0);
	});
});
