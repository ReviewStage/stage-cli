// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentForm } from "../comment-form";

afterEach(cleanup);

function CommentControlsHarness() {
	const [local, setLocal] = useState(false);
	const [startReview, setStartReview] = useState(true);
	return (
		<CommentForm
			label="Comment"
			allowsSuggestedChanges
			controls={{
				local: { checked: local, onCheckedChange: setLocal },
				...(local
					? {}
					: {
							startReview: { checked: startReview, onCheckedChange: setStartReview },
						}),
			}}
			onSubmit={vi.fn()}
			onCancel={vi.fn()}
		/>
	);
}

describe("comment controls", () => {
	it("hides Start a review and suggested changes when Local is checked", () => {
		render(<CommentControlsHarness />);

		expect(
			screen.getByRole("checkbox", { name: "Start a review" }).getAttribute("data-state"),
		).toBe("checked");
		expect(screen.getByRole("button", { name: "Suggestion" })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "Local" }));

		expect(screen.getByRole("checkbox", { name: "Local" }).getAttribute("data-state")).toBe(
			"checked",
		);
		expect(screen.queryByRole("checkbox", { name: "Start a review" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Suggestion" })).toBeNull();
	});
});
