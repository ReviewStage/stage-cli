import type { LucideIcon } from "lucide-react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ShortcutTooltip } from "@/components/shared/shortcut-tooltip";
import { KEYBOARD_SHORTCUTS, type ShortcutKey } from "@/lib/keyboard-shortcuts";
import { useResizablePanel } from "@/lib/use-resizable-panel";
import { cn } from "@/lib/utils";

/** Fixed width (px) used for the expanded panel when resizing is disabled. */
const FIXED_PANEL_WIDTH = 256;

interface ResizeConfig {
	minWidth: number;
	defaultWidth: number;
	maxWidth: number;
}

interface CollapsiblePickerProps {
	icon: LucideIcon;
	title: string;
	count: number;
	shortcutKey: ShortcutKey;
	collapsedIndicators: ReactNode;
	headerExtra?: ReactNode;
	children: ReactNode;
	className?: string;
	zIndex?: number;
	defaultExpanded?: boolean;
	/** When provided, the expanded panel can be dragged to resize within these bounds. */
	resize?: ResizeConfig;
}

export function CollapsiblePicker({
	icon: Icon,
	title,
	count,
	shortcutKey,
	collapsedIndicators,
	headerExtra,
	children,
	className,
	zIndex = 30,
	defaultExpanded = true,
	resize,
}: CollapsiblePickerProps) {
	const [isCollapsed, setIsCollapsed] = useState(!defaultExpanded);
	const { hotkey } = KEYBOARD_SHORTCUTS[shortcutKey];

	const { width, panelRef, resizeHandleProps } = useResizablePanel<HTMLElement>({
		minWidth: resize?.minWidth ?? FIXED_PANEL_WIDTH,
		maxWidth: resize?.maxWidth ?? FIXED_PANEL_WIDTH,
		defaultWidth: resize?.defaultWidth ?? FIXED_PANEL_WIDTH,
	});

	// Auto-collapse when viewport is too narrow for the expanded panel
	useEffect(() => {
		const mql = window.matchMedia("(max-width: 768px)");
		const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
			if (e.matches) setIsCollapsed(true);
		};
		handleChange(mql);
		mql.addEventListener("change", handleChange);
		return () => mql.removeEventListener("change", handleChange);
	}, []);

	const toggleCollapsed = useCallback(() => setIsCollapsed((prev) => !prev), []);

	useHotkeys(hotkey, toggleCollapsed, { preventDefault: true, enableOnFormTags: false }, [
		toggleCollapsed,
	]);

	const header = (
		<div
			className={cn(
				"flex flex-col gap-2 border-border border-b py-3 pr-3 pl-8",
				!headerExtra && "gap-0",
			)}
		>
			<div className="flex items-center gap-2">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				<h2 className="font-semibold text-sm">{title}</h2>
				<span className="text-muted-foreground text-xs">({count})</span>
				<ShortcutTooltip
					shortcutKey={shortcutKey}
					label={`${isCollapsed ? "Show" : "Hide"} ${title.toLowerCase()}`}
					side="bottom"
				>
					<button
						type="button"
						onClick={toggleCollapsed}
						className="ml-auto cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
					>
						{isCollapsed ? (
							<PanelLeftOpen className="size-4" />
						) : (
							<PanelLeftClose className="size-4" />
						)}
					</button>
				</ShortcutTooltip>
			</div>
			{headerExtra}
		</div>
	);

	const listContent = (
		<div className="scrollbar-thin flex-1 overflow-y-auto py-2 pr-3 pl-8">{children}</div>
	);

	if (isCollapsed) {
		return (
			<div
				className={cn(
					"group/picker sticky top-[var(--content-top)] flex w-10 shrink-0 border-border border-r",
					className,
				)}
				style={{ zIndex }}
			>
				{/* Collapsed strip */}
				<aside className="flex h-[calc(var(--main-height,100vh)_-_var(--content-top))] w-10 flex-col items-center pt-[14px] pb-3">
					<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<div className="scrollbar-none mt-2 flex flex-col items-center gap-1 overflow-y-auto pb-1">
						{collapsedIndicators}
					</div>
				</aside>

				{/* Hover overlay — clip wrapper hides the panel when slid left. Match
					the resizable width so the preview doesn't jump when expanded. */}
				<div
					className={cn(
						"pointer-events-none absolute top-0 left-0 h-full overflow-hidden group-hover/picker:pointer-events-auto",
						resize ? undefined : "w-64",
					)}
					style={resize ? { zIndex, width } : { zIndex }}
				>
					<aside className="-translate-x-full flex h-full w-full flex-col overflow-hidden rounded-r-lg border border-border border-l-0 bg-card shadow-lg transition-transform duration-300 ease-out group-hover/picker:translate-x-0">
						{header}
						{listContent}
					</aside>
				</div>
			</div>
		);
	}

	return (
		<aside
			ref={resize ? panelRef : undefined}
			className={cn(
				// `sticky` already establishes the containing block for the absolute
				// resize handle, so no `relative` is needed (and adding it would
				// override `position: sticky` and break the sticky scroll behavior).
				"sticky top-[var(--content-top)] flex h-[calc(var(--main-height,100vh)_-_var(--content-top))] shrink-0 flex-col border-border border-r",
				resize ? undefined : "w-64",
				className,
			)}
			style={resize ? { width, minWidth: resize.minWidth, maxWidth: resize.maxWidth } : undefined}
		>
			{header}
			{listContent}
			{resize && (
				<div
					{...resizeHandleProps}
					className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
				/>
			)}
		</aside>
	);
}
