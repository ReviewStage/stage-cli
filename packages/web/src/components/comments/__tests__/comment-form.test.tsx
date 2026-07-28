// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentForm } from "../comment-form";
import { threadChevronClassName } from "../review-thread";

afterEach(cleanup);

describe("comment destination", () => {
	it("always explains when a new comment stays local", () => {
		render(
			<CommentForm
				label="Comment"
				destination={{
					label: "Local only",
					description: "Saved on this machine and never sent to GitHub.",
				}}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.getByText("Local only")).toBeTruthy();
		expect(screen.getByText("Saved on this machine and never sent to GitHub.")).toBeTruthy();
	});

	it("updates the explanation when the GitHub review toggle changes", () => {
		render(
			<CommentForm
				label="Comment"
				destination={{
					toggleLabel: "Add to GitHub review",
					on: {
						label: "Pending on GitHub",
						description: "Only you can see it until you submit your review.",
					},
					off: {
						label: "Local only",
						description: "Saved on this machine and never sent to GitHub.",
					},
				}}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.getByText("Pending on GitHub")).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "Add to GitHub review" }));
		expect(screen.getByText("Local only")).toBeTruthy();
	});
});

describe("thread chevron", () => {
	it("tracks the controlled collapsible state instead of a shared data-state attribute", () => {
		expect(threadChevronClassName(true)).toContain("rotate-90");
		expect(threadChevronClassName(false)).not.toContain("rotate-90");
	});
});
