import { FOCUS_AREA_SEVERITY, type Prologue } from "@stagereview/types/prologue";

/** Renders the prologue as portable Markdown for the "Copy prologue" action. */
export function formatPrologueAsMarkdown(prologue: Prologue): string {
	const sections: string[] = ["# Prologue"];

	if (prologue.motivation) sections.push(`## Why this change?\n${prologue.motivation}`);
	if (prologue.outcome) sections.push(`## What it does\n${prologue.outcome}`);

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
