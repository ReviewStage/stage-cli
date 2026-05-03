// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHORTCUT_KEY } from "@/lib/keyboard-shortcuts";
import { useShortcut } from "@/lib/use-shortcut";
import { ShortcutTooltip } from "../shortcut-tooltip";

vi.mock("@/lib/use-shortcut", () => ({
	useShortcut: vi.fn(),
}));

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipTrigger: ({
		children,
		asChild,
		...props
	}: { children: ReactNode; asChild?: boolean } & Record<string, unknown>) =>
		asChild ? children : <span {...props}>{children}</span>,
	TooltipContent: ({ children, side }: { children: ReactNode; side?: string }) => (
		<span data-testid="tooltip-content" data-side={side}>
			{children}
		</span>
	),
	TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(() => {
	cleanup();
});

describe("ShortcutTooltip (Mac)", () => {
	beforeEach(() => {
		vi.mocked(useShortcut).mockReturnValue({
			hotkey: "shift+f",
			label: "⇧ F",
			ariaKeyshortcuts: "Shift+F",
		});
	});

	it("stamps aria-label from the label prop onto the trigger", () => {
		render(
			<ShortcutTooltip shortcutKey={SHORTCUT_KEY.TOGGLE_FILES} label="Hide files">
				<button type="button">Click me</button>
			</ShortcutTooltip>,
		);
		expect(screen.getByRole("button", { name: "Hide files" })).toBeDefined();
	});

	it("stamps aria-keyshortcuts onto the trigger", () => {
		render(
			<ShortcutTooltip shortcutKey={SHORTCUT_KEY.TOGGLE_FILES} label="Hide files">
				<button type="button">Click me</button>
			</ShortcutTooltip>,
		);
		expect(screen.getByRole("button").getAttribute("aria-keyshortcuts")).toBe("Shift+F");
	});

	it("renders the action label and shortcut as kbd chips with icon for ⇧", () => {
		render(
			<ShortcutTooltip shortcutKey={SHORTCUT_KEY.TOGGLE_FILES} label="Hide files">
				<button type="button">Click me</button>
			</ShortcutTooltip>,
		);
		const content = screen.getByTestId("tooltip-content");
		expect(content.textContent).toContain("Hide files");
		const kbds = content.querySelectorAll("kbd");
		expect(kbds).toHaveLength(2);
		expect(kbds[0]?.querySelector("svg")).not.toBeNull();
		expect(kbds[1]?.textContent).toBe("F");
	});
});

describe("ShortcutTooltip (non-Mac)", () => {
	beforeEach(() => {
		vi.mocked(useShortcut).mockReturnValue({
			hotkey: "shift+f",
			label: "Shift F",
			ariaKeyshortcuts: "Shift+F",
		});
	});

	it("renders multi-character modifiers as text kbd chips", () => {
		render(
			<ShortcutTooltip shortcutKey={SHORTCUT_KEY.TOGGLE_FILES} label="Hide files">
				<button type="button">Click me</button>
			</ShortcutTooltip>,
		);
		const content = screen.getByTestId("tooltip-content");
		const kbds = content.querySelectorAll("kbd");
		expect(kbds).toHaveLength(2);
		expect(kbds[0]?.textContent).toBe("Shift");
		expect(kbds[1]?.textContent).toBe("F");
	});
});
