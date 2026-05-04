import type { FocusArea, FocusAreaSeverity, Prologue } from "@stage-cli/types/prologue";
import { FOCUS_AREA_SEVERITY } from "@stage-cli/types/prologue";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const SEVERITY_COLORS: Record<string, string> = {
	[FOCUS_AREA_SEVERITY.CRITICAL]: "text-red-500",
	[FOCUS_AREA_SEVERITY.HIGH]: "text-orange-500",
	[FOCUS_AREA_SEVERITY.MEDIUM]: "text-yellow-500",
};

function getConcerns(focusAreas: FocusArea[]): FocusArea[] {
	return focusAreas.filter((f) => f.severity !== FOCUS_AREA_SEVERITY.INFO);
}

function PrologueDisplay({ prologue }: { prologue: Prologue }) {
	const concerns = getConcerns(prologue.focusAreas);

	return (
		<div className="space-y-4 rounded-lg border bg-card p-4">
			{prologue.motivation && prologue.outcome && (
				<section className="space-y-3">
					<div>
						<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							Why this change?
						</h3>
						<p className="text-sm text-foreground">{prologue.motivation}</p>
					</div>
					<div>
						<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
							What it does
						</h3>
						<p className="text-sm text-foreground">{prologue.outcome}</p>
					</div>
				</section>
			)}

			<section>
				<h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
					Key Changes
				</h3>
				<ul className="space-y-2">
					{prologue.keyChanges.map((change) => (
						<li key={change.summary} className="flex items-start gap-2 text-sm">
							<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
							<span>
								<span className="block">{change.summary}</span>
								{change.description && (
									<span className="block text-xs text-muted-foreground">{change.description}</span>
								)}
							</span>
						</li>
					))}
				</ul>
			</section>

			{concerns.length > 0 && (
				<section>
					<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
						Review Focus
					</h3>
					<ul className="space-y-2">
						{concerns.map((area) => (
							<li key={`${area.type}-${area.title}`} className="text-sm">
								<span className="flex items-center gap-2">
									<AlertTriangle
										className={cn(
											"size-3.5 shrink-0",
											SEVERITY_COLORS[area.severity as Exclude<FocusAreaSeverity, "info">],
										)}
										aria-hidden="true"
									/>
									<span className="min-w-0 truncate">{area.title}</span>
								</span>
								<p className="mt-0.5 ml-5.5 text-xs text-muted-foreground">{area.description}</p>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

interface PrologueSectionProps {
	prologue: Prologue | null | undefined;
}

export function PrologueSection({ prologue }: PrologueSectionProps) {
	if (!prologue) return null;
	return <PrologueDisplay prologue={prologue} />;
}
