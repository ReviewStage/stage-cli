import {
	ArrowBigUp,
	ChevronUp,
	Command,
	CornerDownLeft,
	Delete,
	type LucideIcon,
	Option,
	Space,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MODIFIER_ICONS: Record<string, LucideIcon> = {
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

/**
 * Renders a shortcut label like `"⌘ ⇧ L"` or `"Ctrl Shift L"` as a sequence
 * of `<kbd>` chips. Single-character segments get a square chip; multi-char
 * segments (e.g. "Ctrl") get a wider one. Mac modifier glyphs render as
 * lucide icons.
 */
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
							// biome-ignore lint/suspicious/noArrayIndexKey: label is static for a given shortcut; segments never reorder
							key={`${index}-${segment}`}
							className={cn(
								"inline-flex items-center justify-center rounded border border-border bg-black/5 text-[10px] dark:bg-white/10",
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
