// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DiffSettingsForm } from "@/components/diff/diff-settings-form";
import { ThemeProvider } from "../theme";
import { ChapterSettingsProvider } from "../use-chapter-settings";
import { DiffSettingsProvider } from "../use-diff-settings";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function SettingsProviders({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider>
			<DiffSettingsProvider>
				<ChapterSettingsProvider>{children}</ChapterSettingsProvider>
			</DiffSettingsProvider>
		</ThemeProvider>
	);
}

it("names each select by its setting and retains that name after changing its value", () => {
	render(<DiffSettingsForm />, { wrapper: SettingsProviders });
	for (const name of [
		"Text size",
		"Chapter progress",
		"Syntax theme",
		"Font",
		"Font size",
		"Line height",
		"Indicators",
		"Inline diffs",
	]) {
		expect(screen.getByRole("combobox", { name })).toBeDefined();
	}
	const textSize = screen.getByRole("combobox", { name: "Text size" });

	fireEvent.keyDown(textSize, { key: "ArrowDown" });
	fireEvent.click(screen.getByRole("option", { name: "Large" }));

	expect(screen.getByRole("combobox", { name: "Text size" }).textContent).toBe("Large");
	expect(window.localStorage.getItem("ui-text-size")).toBe('"large"');
});
