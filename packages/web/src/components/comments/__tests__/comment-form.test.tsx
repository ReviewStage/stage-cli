// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentForm } from "../comment-form";

afterEach(cleanup);

describe("comment destination", () => {
	it("always explains when a new comment stays local", () => {
		render(
			<CommentForm
				label="Comment"
				destination={{
					label: "Local only",
					description: "Saved on this machine and never sent to GitHub.",
					isGitHub: false,
				}}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.getByText("Local only")).toBeTruthy();
		expect(screen.getByText("Saved on this machine and never sent to GitHub.")).toBeTruthy();
	});

	it("updates the explanation when the GitHub review toggle changes", () => {
		const onToggleChange = vi.fn();
		render(
			<CommentForm
				label="Comment"
				destination={{
					toggleLabel: "Add to GitHub review",
					on: {
						label: "Pending on GitHub",
						description: "Only you can see it until you submit your review.",
						isGitHub: true,
					},
					off: {
						label: "Local only",
						description: "Saved on this machine and never sent to GitHub.",
						isGitHub: false,
					},
				}}
				onToggleChange={onToggleChange}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.getByText("Pending on GitHub")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Suggestion" })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "Add to GitHub review" }));
		expect(screen.getByText("Local only")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Suggestion" })).toBeNull();
		expect(onToggleChange).toHaveBeenCalledWith(false);
	});
});
