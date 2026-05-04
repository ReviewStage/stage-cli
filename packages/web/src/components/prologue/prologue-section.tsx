import type { FocusArea, FocusAreaSeverity, Prologue } from "@stage-cli/types/prologue";
import { FOCUS_AREA_SEVERITY } from "@stage-cli/types/prologue";
import { Link } from "@tanstack/react-router";
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

function getFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

function PrologueDisplay({ prologue, runId }: { prologue: Prologue; runId: string }) {
	const concerns = getConcerns(prologue.focusAreas);

	return (
		<div className="space-y-4 rounded-lg border bg-card p-4">
			{(prologue.motivation || prologue.outcome) && (
				<section className="space-y-3">
					{prologue.motivation && (
						<div>
							<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Why this change?
							</h3>
							<p className="text-sm text-foreground">{prologue.motivation}</p>
						</div>
					)}
					{prologue.outcome && (
						<div>
							<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								What it does
							</h3>
							<p className="text-sm text-foreground">{prologue.outcome}</p>
						</div>
					)}
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
									{area.locations[0] && (
										<Link
											to="/runs/$runId/files"
											params={{ runId }}
											search={{ scrollTo: area.locations[0] }}
											className="ml-auto shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
										>
											{getFileName(area.locations[0])} &rarr;
										</Link>
									)}
								</span>
								<p className="mt-0.5 ml-6 text-xs text-muted-foreground">{area.description}</p>
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
	runId: string;
}

export function PrologueSection({ prologue, runId }: PrologueSectionProps) {
	if (!prologue) return null;
	return <PrologueDisplay prologue={prologue} runId={runId} />;
}
