import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SegmentedToggle<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
}) {
	return (
		<div
			role="radiogroup"
			className="flex w-full items-center rounded-lg border border-border/50 bg-muted/30 p-0.5"
		>
			{options.map((opt) => (
				<Button
					key={opt.value}
					variant="ghost"
					size="sm"
					role="radio"
					aria-checked={value === opt.value}
					className={cn(
						"h-7 flex-1 rounded-md px-2.5 transition-all cursor-pointer",
						value === opt.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
					onClick={() => onChange(opt.value)}
				>
					{opt.icon && <opt.icon className="size-3.5" aria-hidden="true" />}
					<span className="ml-1 text-xs">{opt.label}</span>
				</Button>
			))}
		</div>
	);
}
