import { describe, expect, it } from "vitest";
import { threadChevronClassName } from "../review-thread";

describe("thread chevron", () => {
	it("tracks the controlled collapsible state instead of a shared data-state attribute", () => {
		expect(threadChevronClassName(true)).toContain("rotate-90");
		expect(threadChevronClassName(false)).not.toContain("rotate-90");
	});
});
