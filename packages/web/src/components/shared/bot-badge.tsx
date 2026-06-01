import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function BotBadge({ className }: { className?: string }) {
	return (
		<Badge variant="outline" className={cn("inline-flex px-1.5 py-0 text-[10px]", className)}>
			<Bot className="!size-2.5" />
			bot
		</Badge>
	);
}
