import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import { useTheme } from "@/lib/theme";

export { toast };

const defaultStyle: CSSProperties = {
	"--normal-bg": "var(--popover)",
	"--normal-text": "var(--popover-foreground)",
	"--normal-border": "var(--border)",
} as CSSProperties;

export function Toaster({ style, ...props }: ToasterProps) {
	const { appTheme } = useTheme();
	return (
		<Sonner
			theme={appTheme}
			className="toaster group"
			style={{ ...defaultStyle, ...style }}
			{...props}
		/>
	);
}
