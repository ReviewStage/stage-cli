import { Minus, Plus, Scan, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { renderMermaidDiagram } from "@/lib/mermaid-renderer";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function prepareSvgForDialog(svgHtml: string): string {
	const div = document.createElement("div");
	div.innerHTML = svgHtml;
	const svgEl = div.querySelector("svg");
	if (!svgEl) return svgHtml;

	const w = svgEl.getAttribute("width");
	const h = svgEl.getAttribute("height");
	if (!svgEl.hasAttribute("viewBox") && w && h) {
		svgEl.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
	}

	svgEl.removeAttribute("width");
	svgEl.removeAttribute("height");
	svgEl.style.removeProperty("max-width");
	svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

	return div.innerHTML;
}

interface MermaidDiagramProps {
	chart: string;
}

const ZOOM_CONTROLS_CLASSES =
	"cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
	const { appTheme } = useTheme();
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState(false);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const prevChartRef = useRef(chart);
	const pointerDownTargetRef = useRef<EventTarget | null>(null);
	const dialogSvg = useMemo(() => (svg ? prepareSvgForDialog(svg) : null), [svg]);

	useEffect(() => {
		let cancelled = false;

		if (prevChartRef.current !== chart) {
			prevChartRef.current = chart;
			setSvg(null);
			setError(false);
		}

		renderMermaidDiagram(chart, appTheme)
			.then(({ svg }) => {
				if (cancelled) return;
				setSvg(svg);
				setError(false);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			});

		return () => {
			cancelled = true;
		};
	}, [chart, appTheme]);

	if (error) {
		return (
			<pre className="my-2 overflow-x-auto rounded-md border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
				{chart}
			</pre>
		);
	}

	return (
		<>
			<div className="group relative my-3">
				<div
					className={cn(
						"flex max-h-64 justify-center overflow-hidden [&_svg]:max-w-full",
						!svg && "h-24 animate-pulse rounded-md bg-muted/30",
					)}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid.render() produces safe SVG
					dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
				/>
				{svg && (
					<button
						type="button"
						onClick={() => dialogRef.current?.showModal()}
						className="absolute inset-0 flex cursor-pointer items-end justify-center bg-gradient-to-t from-background/80 to-transparent opacity-0 outline-none transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
					>
						<span className="mb-3 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
							View full diagram
						</span>
					</button>
				)}
			</div>

			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close is a standard dialog pattern */}
			<dialog
				ref={dialogRef}
				aria-labelledby={titleId}
				className="fixed inset-0 m-auto hidden h-[90vh] w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-background p-0 text-foreground shadow-lg open:flex backdrop:bg-black/60 backdrop:backdrop-blur-sm"
				onPointerDown={(e) => {
					pointerDownTargetRef.current = e.target;
				}}
				onClick={(e) => {
					if (e.target === e.currentTarget && pointerDownTargetRef.current === e.currentTarget)
						e.currentTarget.close();
				}}
			>
				<div className="flex items-center justify-between border-b border-border px-5 py-3.5">
					<h2 id={titleId} className="text-sm font-semibold">
						Diagram
					</h2>
					<button
						type="button"
						aria-label="Close diagram"
						className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => dialogRef.current?.close()}
					>
						<X className="size-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1">
					{dialogSvg && (
						<TransformWrapper
							initialScale={1}
							minScale={0.5}
							maxScale={4}
							centerOnInit
							wheel={{ step: 0.08 }}
						>
							{({ zoomIn, zoomOut, resetTransform }) => (
								<>
									<div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-background/90 px-1.5 py-1 shadow-md backdrop-blur-sm">
										<button
											type="button"
											aria-label="Zoom out"
											className={ZOOM_CONTROLS_CLASSES}
											onClick={() => zoomOut()}
										>
											<Minus className="size-4" />
										</button>
										<button
											type="button"
											aria-label="Reset zoom"
											className={ZOOM_CONTROLS_CLASSES}
											onClick={() => resetTransform()}
										>
											<Scan className="size-4" />
										</button>
										<button
											type="button"
											aria-label="Zoom in"
											className={ZOOM_CONTROLS_CLASSES}
											onClick={() => zoomIn()}
										>
											<Plus className="size-4" />
										</button>
									</div>
									<TransformComponent wrapperClass="!h-full !w-full" contentClass="!h-full !w-full">
										<div
											className="flex h-full w-full items-center justify-center p-6 [&_svg]:max-h-full [&_svg]:max-w-full"
											// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid.render() produces safe SVG
											dangerouslySetInnerHTML={{ __html: dialogSvg }}
										/>
									</TransformComponent>
								</>
							)}
						</TransformWrapper>
					)}
				</div>
			</dialog>
		</>
	);
}
