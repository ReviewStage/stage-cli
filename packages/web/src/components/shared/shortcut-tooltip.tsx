import { cloneElement, type ReactElement } from "react";
import { ShortcutLabel } from "@/components/keyboard/shortcut-label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutKey } from "@/lib/keyboard-shortcuts";
import { useShortcut } from "@/lib/use-shortcut";

interface ShortcutTooltipProps {
	shortcutKey: ShortcutKey;
	label: string;
	side?: "top" | "bottom" | "left" | "right";
	children: ReactElement<{ "aria-label"?: string; "aria-keyshortcuts"?: string }>;
}

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
