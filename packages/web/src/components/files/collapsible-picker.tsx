import type { LucideIcon } from "lucide-react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface CollapsiblePickerProps {
	icon: LucideIcon;
	title: string;
	count: number;
	collapsedIndicators: ReactNode;
	headerExtra?: ReactNode;
	children: ReactNode;
	className?: string;
	zIndex?: number;
	defaultExpanded?: boolean;
}

export function CollapsiblePicker({
	icon: Icon,
	title,
	count,
	collapsedIndicators,
	headerExtra,
	children,
	className,
	zIndex = 30,
	defaultExpanded = true,
}: CollapsiblePickerProps) {
	const [isCollapsed, setIsCollapsed] = useState(!defaultExpanded);

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
				<button
					type="button"
					onClick={toggleCollapsed}
					aria-label={`${isCollapsed ? "Show" : "Hide"} ${title.toLowerCase()}`}
					title={`${isCollapsed ? "Show" : "Hide"} ${title.toLowerCase()}`}
					className="ml-auto cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
				>
					{isCollapsed ? (
						<PanelLeftOpen className="size-4" />
					) : (
						<PanelLeftClose className="size-4" />
					)}
				</button>
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
				<aside className="flex h-[calc(var(--main-height,100vh)_-_var(--content-top))] w-10 flex-col items-center pt-[14px] pb-3">
					<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<div className="scrollbar-none mt-2 flex flex-col items-center gap-1 overflow-y-auto pb-1">
						{collapsedIndicators}
					</div>
				</aside>

				{/* Clip wrapper hides the slid-left panel until the strip is hovered. */}
				<div
					className="pointer-events-none absolute top-0 left-0 h-full w-64 overflow-hidden group-hover/picker:pointer-events-auto"
					style={{ zIndex }}
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
			className={cn(
				"sticky top-[var(--content-top)] flex h-[calc(var(--main-height,100vh)_-_var(--content-top))] w-64 shrink-0 flex-col border-border border-r",
				className,
			)}
		>
			{header}
			{listContent}
		</aside>
	);
}
