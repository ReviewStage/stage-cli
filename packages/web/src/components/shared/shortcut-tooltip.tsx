import { cloneElement, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutKey } from "@/lib/keyboard-shortcuts";
import { useShortcut } from "@/lib/use-shortcut";
import { ShortcutLabel } from "./shortcut-label";

interface ShortcutTooltipProps {
	shortcutKey: ShortcutKey;
	label: string;
	side?: "top" | "bottom" | "left" | "right";
	children: ReactElement<{ "aria-label"?: string; "aria-keyshortcuts"?: string }>;
}

/**
 * Wraps a focusable child with a tooltip that shows its action label and the
 * platform-specific keyboard shortcut. Also stamps `aria-label` and
 * `aria-keyshortcuts` onto the trigger so screen readers announce both.
 */
export function ShortcutTooltip({ shortcutKey, label, side, children }: ShortcutTooltipProps) {
	const { label: shortcutLabel, ariaKeyshortcuts } = useShortcut(shortcutKey);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{cloneElement(children, {
					"aria-label": label,
					"aria-keyshortcuts": ariaKeyshortcuts,
				})}
			</TooltipTrigger>
			<TooltipContent side={side} className="flex items-center gap-0.5">
				<span className="mr-1">{label}</span>
				<ShortcutLabel label={shortcutLabel} />
			</TooltipContent>
		</Tooltip>
	);
}
