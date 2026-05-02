export function SectionLabel({ children }: { children: string }) {
	return (
		<h2 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
			{children}
		</h2>
	);
}
