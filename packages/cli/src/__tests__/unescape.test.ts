import { describe, expect, it } from "vitest";
import { unescapeLiteralNewlines } from "../unescape.js";

describe("unescapeLiteralNewlines", () => {
	it("unescapes literal backslash-n sequences in prose", () => {
		expect(
			unescapeLiteralNewlines(
				"First paragraph about the change.\\n\\nSecond paragraph with more context.",
			),
		).toBe("First paragraph about the change.\n\nSecond paragraph with more context.");
	});

	it("preserves literal backslash-n inside backtick spans", () => {
		expect(
			unescapeLiteralNewlines("Uses the `\\n` character for line breaks.\\n\\nSecond paragraph."),
		).toBe("Uses the `\\n` character for line breaks.\n\nSecond paragraph.");
	});

	it("preserves literal backslash-n inside double-backtick spans", () => {
		expect(unescapeLiteralNewlines("Uses ``\\n`` for newlines.\\n\\nSecond paragraph.")).toBe(
			"Uses ``\\n`` for newlines.\n\nSecond paragraph.",
		);
	});

	it("unescapes literal backslash-n inside fenced code blocks", () => {
		expect(
			unescapeLiteralNewlines(
				"Summary text.\\n\\n```mermaid\\nsequenceDiagram\\n    participant A\\n    A->>B: hello\\n```",
			),
		).toBe(
			"Summary text.\n\n```mermaid\nsequenceDiagram\n    participant A\n    A->>B: hello\n```",
		);
	});

	it("leaves strings without escapes untouched", () => {
		expect(unescapeLiteralNewlines("plain text")).toBe("plain text");
	});
});
