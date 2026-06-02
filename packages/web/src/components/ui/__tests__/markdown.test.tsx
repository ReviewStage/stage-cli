// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../markdown";

// A PR-body badge block as GitHub/bots emit it: an anchor wrapping a <picture>.
const BADGE_HTML = `Some description.

<a href="https://stagereview.app/x"><picture><source media="(prefers-color-scheme: dark)" srcset="https://stagereview.app/dark.svg"><img alt="Open in Stage" src="https://stagereview.app/light.svg"></picture></a>`;

describe("Markdown allowHtml", () => {
	it("renders embedded HTML image badges when allowHtml is set", () => {
		const { container } = render(<Markdown content={BADGE_HTML} allowHtml />);
		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"https://stagereview.app/light.svg",
		);
		expect(container.querySelector("a")?.getAttribute("href")).toBe("https://stagereview.app/x");
		expect(container.querySelector("source")?.getAttribute("srcset")).toBe(
			"https://stagereview.app/dark.svg",
		);
	});

	it("strips scripts and inline event handlers from embedded HTML", () => {
		const { container } = render(
			<Markdown content={`<img src="x" onerror="alert(1)"><script>alert(2)</script>`} allowHtml />,
		);
		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("img")?.getAttribute("onerror")).toBeNull();
	});

	it("does not render raw HTML as elements when allowHtml is off", () => {
		const { container } = render(<Markdown content={`<img src="https://x.test/evil.svg">`} />);
		expect(container.querySelector("img")).toBeNull();
	});
});
