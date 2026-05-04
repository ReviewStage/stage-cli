import type { Chapter } from "@stagereview/types/chapters";
import { Checkbox } from "@/components/ui/checkbox";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { KeyChangeReferenceTooltip } from "./key-change-reference-tooltip";

interface ChapterSummaryProps {
	chapter: Chapter;
	checkedKeyChangeIds: ReadonlySet<string>;
	focusedKeyChangeId: string | null;
	onToggleKeyChangeChecked: (keyChangeId: string) => void;
	onFocusKeyChange: (keyChangeId: string | null) => void;
}

export function ChapterSummary({
	chapter,
	checkedKeyChangeIds,
	focusedKeyChangeId,
	onToggleKeyChangeChecked,
	onFocusKeyChange,
}: ChapterSummaryProps) {
	return (
		<div className="space-y-4 py-3 pl-6 pr-4 lg:pl-8">
			{chapter.summary && (
				<Markdown content={chapter.summary} className="text-muted-foreground text-sm" />
			)}

			{chapter.keyChanges.length > 0 && (
				<div>
					<h2 className="mb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
						What to Review
					</h2>
					<ul className="space-y-4">
						{chapter.keyChanges.map((kc) => {
							const isChecked = checkedKeyChangeIds.has(kc.externalId);
							const isClickable = kc.lineRefs.length > 0;
							const isFocused = focusedKeyChangeId === kc.externalId;
							return (
								<li key={kc.id} className="flex items-start gap-3">
									<Checkbox
										checked={isChecked}
										onCheckedChange={() => onToggleKeyChangeChecked(kc.externalId)}
										className="mt-0.5 shrink-0"
										aria-label="Mark key change as reviewed"
									/>
									{isClickable ? (
										<KeyChangeReferenceTooltip lineRefs={kc.lineRefs} hunkRefs={chapter.hunkRefs}>
											{/* Markdown emits block elements which can't nest inside a native
											    <button>; role="button" + keydown emulates it without breaking
											    embedded links. */}
											{/* biome-ignore lint/a11y/useSemanticElements: block-level markdown can't nest in <button>; role="button" + keydown is the workaround */}
											<div
												role="button"
												tabIndex={0}
												aria-pressed={isFocused}
												onClick={(e) => {
													if (e.target instanceof Element && e.target.closest("a")) return;
													onFocusKeyChange(isFocused ? null : kc.externalId);
												}}
												onKeyDown={(e) => {
													if (e.target !== e.currentTarget) return;
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														onFocusKeyChange(isFocused ? null : kc.externalId);
													}
												}}
												className={cn(
													"-mx-2 -my-1 flex-1 cursor-pointer rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-left outline-none transition-all",
													"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
													isFocused
														? "border-blue-500/40 bg-blue-500/10 shadow-sm hover:bg-blue-500/15"
														: "hover:border-border hover:bg-accent/60 hover:shadow-sm",
												)}
											>
												<Markdown
													content={kc.content}
													inheritSize
													className={cn(
														"text-muted-foreground text-sm [&_.md-p]:my-0",
														isChecked && "line-through opacity-50",
													)}
												/>
											</div>
										</KeyChangeReferenceTooltip>
									) : (
										<div className="-mx-1 flex-1 rounded-sm px-1">
											<Markdown
												content={kc.content}
												inheritSize
												className={cn(
													"text-muted-foreground text-sm [&_.md-p]:my-0",
													isChecked && "line-through opacity-50",
												)}
											/>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}
