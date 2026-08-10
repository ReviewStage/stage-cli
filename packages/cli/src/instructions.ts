import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Repository-level custom instructions (persistent, configured in repo settings)
// and per-run instructions (a one-off ask when manually regenerating) both flow
// through a single "additional instructions" channel appended to each generated
// content prompt. Centralizing the format keeps analysis, narrative, summary,
// and chapter edit prompts consistent.
//
// In the CLI, standing repo instructions come from a `.stageinstructions` file
// at the repo root, and per-run instructions from `prep --instructions`.

function trimInstructions(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/**
 * Merge persistent repo-level custom instructions with a one-off per-run
 * instruction. Repo conventions come first so the model reads standing rules
 * before the immediate ask. Returns null when neither is present.
 */
export function combineInstructions(
	repoInstructions: string | null | undefined,
	runInstructions: string | null | undefined,
): string | null {
	const parts = [trimInstructions(repoInstructions), trimInstructions(runInstructions)].filter(
		(value): value is string => value !== null,
	);
	return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Render the additional-instructions block appended to an agent prompt. Returns
 * an empty string when there are no instructions so callers can interpolate it
 * inline without conditional logic.
 */
export function formatInstructionsBlock(instructions: string | null | undefined): string {
	const trimmed = instructions?.trim();
	return trimmed ? `\n\nADDITIONAL INSTRUCTIONS:\n${trimmed}` : "";
}

/**
 * Load standing repo instructions from a `.stageinstructions` file at the repo
 * root (the CLI analogue of hosted Stage's repository custom instructions).
 * Returns the raw text, or null when the file is absent.
 */
export function loadStageInstructions(repoRoot: string): string | null {
	const instructionsPath = path.join(repoRoot, ".stageinstructions");
	if (!existsSync(instructionsPath)) return null;
	return readFileSync(instructionsPath, "utf8");
}
