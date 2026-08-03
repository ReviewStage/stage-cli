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
	it("shows the hosted-style controls without a destination card", () => {
		render(<CommentControlsHarness />);

		expect(screen.getByRole("checkbox", { name: "Local" }).getAttribute("data-state")).toBe(
			"unchecked",
		);
		expect(
			screen.getByRole("checkbox", { name: "Start a review" }).getAttribute("data-state"),
		).toBe("checked");
		expect(screen.queryByText("Destination")).toBeNull();
	});

	it("hides Start a review and suggested changes when Local is checked", () => {
		render(<CommentControlsHarness />);

		expect(screen.getByRole("button", { name: "Suggestion" })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "Local" }));

		expect(screen.getByRole("checkbox", { name: "Local" }).getAttribute("data-state")).toBe(
			"checked",
		);
		expect(screen.queryByRole("checkbox", { name: "Start a review" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Suggestion" })).toBeNull();
	});

	it("can show a fixed local destination when GitHub is unavailable", () => {
		render(
			<CommentForm
				label="Comment"
				controls={{ local: { checked: true, disabled: true } }}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		const local = screen.getByRole("checkbox", { name: "Local" });
		expect(local.getAttribute("data-state")).toBe("checked");
		expect(local.hasAttribute("disabled")).toBe(true);
	});
});
