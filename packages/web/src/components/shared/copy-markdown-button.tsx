import { Copy } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CopyMarkdownButtonProps {
	/** Produces the Markdown to copy. Returning null/empty skips the copy. */
	getMarkdown: () => string | null;
	/** Lowercase noun for the toast, e.g. "prologue" → "Copied prologue to clipboard". */
	label: string;
}

export function CopyMarkdownButton({ getMarkdown, label }: CopyMarkdownButtonProps) {
	const handleCopy = useCallback(() => {
		const markdown = getMarkdown();
		if (!markdown) return;
		navigator.clipboard.writeText(markdown).then(
			() => toast.success(`Copied ${label} to clipboard`),
			() => toast.error("Failed to copy to clipboard"),
		);
	}, [getMarkdown, label]);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={`Copy ${label}`}
					className="size-6 cursor-pointer rounded-md text-muted-foreground"
					onClick={handleCopy}
				>
					<Copy className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Copy {label} as Markdown</TooltipContent>
		</Tooltip>
	);
}
