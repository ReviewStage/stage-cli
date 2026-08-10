// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRemoteDraft } from "../use-remote-draft";

afterEach(cleanup);

describe("useRemoteDraft", () => {
	it("preserves an in-progress edit across offline and recovered remote values", () => {
		const { result, rerender } = renderHook(({ remoteValue }) => useRemoteDraft(remoteValue), {
			initialProps: { remoteValue: "Saved on GitHub" },
		});
		expect(result.current.value).toBe("Saved on GitHub");

		act(() => result.current.setValue("Unsaved local summary"));
		rerender({ remoteValue: "" });
		expect(result.current.value).toBe("Unsaved local summary");

		rerender({ remoteValue: "Saved on GitHub" });
		expect(result.current.value).toBe("Unsaved local summary");

		act(() => result.current.reset());
		expect(result.current.value).toBe("Saved on GitHub");
	});

	it("follows remote updates until the user edits", () => {
		const { result, rerender } = renderHook(({ remoteValue }) => useRemoteDraft(remoteValue), {
			initialProps: { remoteValue: "First" },
		});

		rerender({ remoteValue: "Updated remotely" });
		expect(result.current.value).toBe("Updated remotely");
	});
});
