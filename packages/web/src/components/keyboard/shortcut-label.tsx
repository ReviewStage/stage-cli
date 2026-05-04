import {
	ArrowBigUp,
	ChevronUp,
	Command,
	CornerDownLeft,
	Delete,
	Option,
	Space,
} from "lucide-react";
import type { FC } from "react";
import { cn } from "@/lib/utils";

const MODIFIER_ICONS: Record<string, FC<{ className?: string }>> = {
	"⌘": Command,
	"⇧": ArrowBigUp,
	"⌥": Option,
	"⌃": ChevronUp,
	"⌫": Delete,
	"↩": CornerDownLeft,
	"␣": Space,
};

interface ShortcutLabelProps {
	label: string;
}

export function ShortcutLabel({ label }: ShortcutLabelProps) {
	return (
		<span className="inline-flex items-center gap-0.5">
			{label
				.split(" ")
				.filter(Boolean)
				.map((segment, index) => {
					const Icon = MODIFIER_ICONS[segment];
					const isSingleChar = !Icon && segment.length <= 1;
					return (
						<kbd
							// biome-ignore lint/suspicious/noArrayIndexKey: label segments are static for a given shortcut and may repeat
							key={`${index}-${segment}`}
							className={cn(
								"inline-flex items-center justify-center rounded border border-border bg-black/5 dark:bg-white/10 text-[10px]",
								isSingleChar ? "size-4" : "px-1 py-0.5",
							)}
						>
							{Icon ? <Icon className="size-2.5" /> : segment}
						</kbd>
					);
				})}
		</span>
	);
}
