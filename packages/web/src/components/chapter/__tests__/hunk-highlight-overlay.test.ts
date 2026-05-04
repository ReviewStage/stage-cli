// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { DIFF_SIDE } from "@/lib/diff-types";
import {
	findKeyChangeIdAtPoint,
	getHighlightLineRect,
	isPointInReviewStateBadge,
	shouldIgnoreOverlayClick,
} from "../hunk-highlight-overlay";
import { findRenderedDiffLine } from "../rendered-line-target";

describe("findRenderedDiffLine", () => {
	it("finds split-view lines within the matching side column", () => {
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		const additions = document.createElement("code");
		additions.setAttribute("data-code", "");
		additions.setAttribute("data-additions", "");
		const line = document.createElement("div");
		line.setAttribute("data-line", "12");
		additions.appendChild(line);
		shadowRoot.appendChild(additions);

		expect(findRenderedDiffLine(shadowRoot, DIFF_SIDE.ADDITIONS, 12)).toBe(line);
	});

	it("finds unified-view lines by diff side instead of raw line number alone", () => {
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		const unified = document.createElement("code");
		unified.setAttribute("data-code", "");
		unified.setAttribute("data-unified", "");

		const deletionLine = document.createElement("div");
		deletionLine.setAttribute("data-line", "42");
		deletionLine.setAttribute("data-line-type", "change-deletion");
		unified.appendChild(deletionLine);

		const additionLine = document.createElement("div");
		additionLine.setAttribute("data-line", "42");
		additionLine.setAttribute("data-line-type", "change-addition");
		unified.appendChild(additionLine);

		shadowRoot.appendChild(unified);

		expect(findRenderedDiffLine(shadowRoot, DIFF_SIDE.ADDITIONS, 42)).toBe(additionLine);
		expect(findRenderedDiffLine(shadowRoot, DIFF_SIDE.DELETIONS, 42)).toBe(deletionLine);
	});

	it("finds unified-view context lines for either side", () => {
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		const unified = document.createElement("code");
		unified.setAttribute("data-unified", "");

		const contextLine = document.createElement("div");
		contextLine.setAttribute("data-line", "50");
		contextLine.setAttribute("data-line-type", "context");
		unified.appendChild(contextLine);

		shadowRoot.appendChild(unified);

		expect(findRenderedDiffLine(shadowRoot, DIFF_SIDE.ADDITIONS, 50)).toBe(contextLine);
		expect(findRenderedDiffLine(shadowRoot, DIFF_SIDE.DELETIONS, 50)).toBe(contextLine);
	});
});

describe("getHighlightLineRect", () => {
	it("uses the line-number gutter and code content bounds for Pierre rows", () => {
		const row = document.createElement("div");
		row.setAttribute("data-line", "12");
		const number = document.createElement("span");
		number.setAttribute("data-column-number", "");
		const content = document.createElement("span");
		content.setAttribute("data-column-content", "");
		row.append(number, content);

		row.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 20, width: 190, height: 20 });
		number.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 20, width: 48, height: 20 });
		content.getBoundingClientRect = () =>
			DOMRect.fromRect({ x: 58, y: 20, width: 142, height: 20 });

		const rect = getHighlightLineRect(content);

		expect(rect.left).toBe(10);
		expect(rect.right).toBe(200);
		expect(rect.width).toBe(190);
	});

	it("matches Pierre's separate gutter and content cells by line index", () => {
		const side = document.createElement("div");
		side.setAttribute("data-additions", "");
		const gutter = document.createElement("div");
		gutter.setAttribute("data-gutter", "");
		const content = document.createElement("div");
		content.setAttribute("data-content", "");
		const number = document.createElement("div");
		number.setAttribute("data-column-number", "56");
		number.setAttribute("data-line-index", "4");
		const line = document.createElement("div");
		line.setAttribute("data-line", "56");
		line.setAttribute("data-line-index", "4");
		gutter.append(number);
		content.append(line);
		side.append(gutter, content);

		number.getBoundingClientRect = () => DOMRect.fromRect({ x: 240, y: 40, width: 52, height: 20 });
		line.getBoundingClientRect = () => DOMRect.fromRect({ x: 292, y: 40, width: 220, height: 20 });

		const rect = getHighlightLineRect(line);

		expect(rect.left).toBe(240);
		expect(rect.right).toBe(512);
		expect(rect.width).toBe(272);
	});
});

describe("findKeyChangeIdAtPoint", () => {
	it("returns the matching key change when the click lands inside a box", () => {
		expect(
			findKeyChangeIdAtPoint(40, 30, [
				{
					top: 20,
					left: 10,
					width: 80,
					height: 40,
					firstLineHeight: 20,
					keyChangeId: "kc-1",
					filePath: "src/foo.ts",
					side: DIFF_SIDE.ADDITIONS,
					startLine: 20,
					endLine: 21,
					isChecked: false,
				},
			]),
		).toBe("kc-1");
	});

	it("returns null when the click lands outside every box", () => {
		expect(
			findKeyChangeIdAtPoint(200, 200, [
				{
					top: 20,
					left: 10,
					width: 80,
					height: 40,
					firstLineHeight: 20,
					keyChangeId: "kc-1",
					filePath: "src/foo.ts",
					side: DIFF_SIDE.ADDITIONS,
					startLine: 20,
					endLine: 21,
					isChecked: false,
				},
			]),
		).toBeNull();
	});
});

describe("isPointInReviewStateBadge", () => {
	it("uses the rendered badge bounds instead of reconstructing them with magic offsets", () => {
		expect(
			isPointInReviewStateBadge(
				88,
				11,
				{
					top: 11,
					left: 82,
					width: 16,
					height: 16,
				},
				{
					top: 8,
					left: 10,
				},
			),
		).toBe(true);
	});

	it("returns false when the point lands outside the badge area", () => {
		expect(
			isPointInReviewStateBadge(
				40,
				30,
				{
					top: 11,
					left: 82,
					width: 16,
					height: 16,
				},
				{
					top: 8,
					left: 10,
				},
			),
		).toBe(false);
	});
});

describe("shouldIgnoreOverlayClick", () => {
	it("ignores clicks when text is actively selected", () => {
		expect(
			shouldIgnoreOverlayClick([], {
				isCollapsed: false,
				toString: () => "selected code",
			}),
		).toBe(true);
	});

	it("ignores clicks on interactive elements", () => {
		const button = document.createElement("button");
		expect(shouldIgnoreOverlayClick([button], null)).toBe(true);
	});

	it("ignores clicks inside inline comment annotation content", () => {
		const annotation = document.createElement("div");
		annotation.setAttribute("data-line-annotation", "");
		expect(shouldIgnoreOverlayClick([annotation], null)).toBe(true);
	});

	it("allows ordinary diff line clicks when no selection is active", () => {
		const line = document.createElement("div");
		line.setAttribute("data-line", "42");
		expect(
			shouldIgnoreOverlayClick([line], {
				isCollapsed: true,
				toString: () => "",
			}),
		).toBe(false);
	});
});
