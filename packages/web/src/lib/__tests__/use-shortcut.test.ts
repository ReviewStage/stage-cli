// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcut } from "../use-shortcut";

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubPlatform(platform: string): void {
	vi.stubGlobal("navigator", {
		...navigator,
		platform,
		userAgentData: undefined,
	});
}

describe("useShortcut", () => {
	it("returns the Mac label and aria value on macOS", () => {
		stubPlatform("MacIntel");
		const { result } = renderHook(() => useShortcut("TOGGLE_FILES"));
		expect(result.current).toEqual({
			hotkey: "shift+f",
			label: "⇧ F",
			ariaKeyshortcuts: "Shift+F",
		});
	});

	it("returns the non-Mac label on Windows/Linux", () => {
		stubPlatform("Win32");
		const { result } = renderHook(() => useShortcut("TOGGLE_FILES"));
		expect(result.current).toEqual({
			hotkey: "shift+f",
			label: "Shift F",
			ariaKeyshortcuts: "Shift+F",
		});
	});
});
