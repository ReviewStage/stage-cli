import { FOCUS_AREA_SEVERITY, type Prologue } from "@stagereview/types/prologue";

/**
 * Picks a backtick fence longer than any backtick run inside the content (min 3),
 * per CommonMark, so content containing ``` can't break out of the code block.
 */
function codeFence(content: string): string {
	const longestRun = (content.match(/`+/g) ?? []).reduce(
		(max, run) => Math.max(max, run.length),
		0,
	);
	return "`".repeat(Math.max(3, longestRun + 1));
}

/** Renders the prologue as portable Markdown for the "Copy prologue" action. */
export function formatPrologueAsMarkdown(prologue: Prologue): string {
	const sections: string[] = ["# Prologue"];

	if (prologue.motivation) sections.push(`## Why this change?\n${prologue.motivation}`);
	if (prologue.outcome) sections.push(`## What it does\n${prologue.outcome}`);
	if (prologue.diagram) {
		const fence = codeFence(prologue.diagram);
		sections.push(`## Diagram\n${fence}mermaid\n${prologue.diagram}\n${fence}`);
	}

	if (prologue.keyChanges.length > 0) {
		const bullets = prologue.keyChanges
			.map((kc) =>
				kc.description ? `- **${kc.summary}**: ${kc.description}` : `- **${kc.summary}**`,
			)
			.join("\n");
		sections.push(`## Key Changes\n${bullets}`);
	}

	const concerns = prologue.focusAreas.filter((f) => f.severity !== FOCUS_AREA_SEVERITY.INFO);
	if (concerns.length > 0) {
		const bullets = concerns
			.map((area) => {
				const locations = area.locations.length > 0 ? ` (${area.locations.join(", ")})` : "";
				return `- **${area.title}**${locations}: ${area.description}`;
			})
			.join("\n");
		sections.push(`## Review Focus\n${bullets}`);
	}

	sections.push(
		`## Complexity\n- **Level**: ${prologue.complexity.level}\n- **Reasoning**: ${prologue.complexity.reasoning}`,
	);

	return sections.join("\n\n");
}
