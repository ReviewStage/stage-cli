import { Copy, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { SegmentedToggle } from "@/components/shared/segmented-toggle";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
	PANEL_POSITION_OPTIONS,
	type PanelPosition,
	useChapterSettings,
} from "@/lib/use-chapter-settings";

interface ChapterActionsMenuProps {
	onCopyChapter: () => void;
}

export function ChapterActionsMenu({ onCopyChapter }: ChapterActionsMenuProps) {
	const { panelPosition, setPanelPosition, showWhatToReview, setShowWhatToReview } =
		useChapterSettings();
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<Popover open={menuOpen} onOpenChange={setMenuOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-7 shrink-0 cursor-pointer"
					aria-label="Chapter actions"
				>
					<MoreHorizontal className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-0">
				<div className="p-1">
					<button
						type="button"
						onClick={() => {
							onCopyChapter();
							setMenuOpen(false);
						}}
						className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-foreground text-sm transition-colors hover:bg-accent"
					>
						<Copy className="size-4" />
						Copy chapter summary
					</button>
				</div>

				<Separator />

				<div className="flex items-center justify-between gap-3 py-2 pl-3 pr-2">
					<Label htmlFor="chapter-actions-what-to-review" className="font-medium text-sm">
						What to Review
					</Label>
					<Switch
						id="chapter-actions-what-to-review"
						checked={showWhatToReview}
						onCheckedChange={setShowWhatToReview}
					/>
				</div>

				<Separator />

				<div className="flex items-center justify-between gap-3 py-1 pl-3 pr-1">
					<span className="font-medium text-sm">Panel</span>
					<div className="w-[150px]">
						<SegmentedToggle<PanelPosition>
							value={panelPosition}
							onChange={setPanelPosition}
							options={PANEL_POSITION_OPTIONS}
						/>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
