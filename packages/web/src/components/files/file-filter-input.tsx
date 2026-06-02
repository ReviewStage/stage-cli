import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileFilterInputProps {
	value: string;
	onChange: (value: string) => void;
	className?: string;
}

export function FileFilterInput({ value, onChange, className }: FileFilterInputProps) {
	return (
		<div className={cn("relative", className)}>
			<Search
				className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground/50"
				aria-hidden="true"
			/>
			<input
				type="text"
				placeholder="Filter files..."
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-md border border-border bg-background/50 py-1.5 pr-2 pl-8 text-xs outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
			/>
		</div>
	);
}
