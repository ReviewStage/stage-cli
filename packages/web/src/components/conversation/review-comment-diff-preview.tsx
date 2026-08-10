import { PatchDiff } from "@pierre/diffs/react";
import { LINE_TYPE, type LineType } from "@stagereview/types";
import type { CSSProperties } from "react";
import {
	resolveFontFamily,
	resolveFontFeatures,
	resolveFontSize,
	resolveLineHeight,
} from "@/lib/diff-typography";
import {
	buildReviewCommentPreviewPatch,
	canRenderReviewCommentPreviewWithPatchDiff,
	getReviewCommentDiffPreviewLines,
	getReviewCommentSelectedLines,
	type ParsedReviewCommentDiffLine,
	parseReviewCommentDiffHunk,
} from "@/lib/review-comment-diff-hunk";
import { useTheme } from "@/lib/theme";
import { useDiffSettings } from "@/lib/use-diff-settings";
import type { Thread } from "./normalize-threads";

const FALLBACK_LINE_CLASS_BY_TYPE: Record<LineType, string> = {
	[LINE_TYPE.ADDITION]: "bg-green-500/10 text-green-950 dark:bg-green-500/15 dark:text-green-100",
	[LINE_TYPE.DELETION]: "bg-red-500/10 text-red-950 dark:bg-red-500/15 dark:text-red-100",
	[LINE_TYPE.CONTEXT]: "text-foreground",
	[LINE_TYPE.HEADER]: "text-muted-foreground",
};

function getFallbackLineNumber(line: ParsedReviewCommentDiffLine): number | null {
	if (line.type === LINE_TYPE.DELETION) return line.oldLineNumber;
	return line.newLineNumber;
}

function getFallbackPrefix(line: ParsedReviewCommentDiffLine): string {
	if (line.type === LINE_TYPE.ADDITION) return "+";
	if (line.type === LINE_TYPE.DELETION) return "-";
	return " ";
}

export function ReviewCommentDiffPreview({ thread }: { thread: Thread }) {
	const {
		diffIndicators,
		backgrounds,
		wrap,
		lineNumbers,
		darkSyntaxTheme,
		lightSyntaxTheme,
		diffFontFamily,
		diffFontSize,
		diffLineHeight,
		diffLigatures,
	} = useDiffSettings();
	const { appTheme } = useTheme();

	if (!thread.diffPreview) return null;

	const hunk = parseReviewCommentDiffHunk(thread.diffPreview.diffHunk);
	if (!hunk) return null;
	const target = {
		side: thread.side,
		line: thread.diffPreview.line,
		startLine: thread.diffPreview.startLine,
		startSide: thread.startSide,
	};
	const previewLines = getReviewCommentDiffPreviewLines(hunk, target);
	if (previewLines.length === 0) return null;
	const patch = buildReviewCommentPreviewPatch(thread.path, hunk, previewLines);
	if (!patch) return null;
	const selectedLines = getReviewCommentSelectedLines(previewLines, target);
	const options = {
		theme: {
			dark: darkSyntaxTheme,
			light: lightSyntaxTheme,
		},
		themeType: appTheme,
		diffStyle: "unified" as const,
		diffIndicators,
		// Conversation previews are partial GitHub hunks, not full file diffs.
		// Pierre's inline word decorations can crash on truncated uneven blocks.
		lineDiffType: "none" as const,
		disableBackground: !backgrounds,
		disableFileHeader: true,
		disableLineNumbers: !lineNumbers,
		expandUnchanged: true,
		overflow: wrap ? ("wrap" as const) : ("scroll" as const),
	};
	const typographyStyle: CSSProperties & Record<`--diffs-${string}`, string> = {
		"--diffs-font-family": resolveFontFamily(diffFontFamily),
		"--diffs-font-size": resolveFontSize(diffFontSize),
		"--diffs-line-height": resolveLineHeight(diffLineHeight),
		"--diffs-font-features": resolveFontFeatures(diffLigatures),
	};
	const canUsePatchDiff = canRenderReviewCommentPreviewWithPatchDiff(previewLines);

	return (
		<section aria-label={`Diff preview for ${thread.path}`}>
			<div className="overflow-x-auto" style={typographyStyle}>
				{canUsePatchDiff ? (
					<PatchDiff patch={patch} options={options} selectedLines={selectedLines} />
				) : (
					<div className="py-1 font-mono text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)]">
						{previewLines.map((line) => (
							<div
								key={line.rowNumber}
								className={`grid min-w-max ${
									lineNumbers
										? "grid-cols-[3rem_minmax(20rem,1fr)]"
										: "grid-cols-[minmax(20rem,1fr)]"
								} gap-2 px-3 ${backgrounds ? FALLBACK_LINE_CLASS_BY_TYPE[line.type] : "text-foreground"}`}
							>
								{lineNumbers && (
									<span className="select-none text-right text-muted-foreground/60 tabular-nums">
										{getFallbackLineNumber(line)}
									</span>
								)}
								<span className={wrap ? "whitespace-pre-wrap" : "whitespace-pre"}>
									<span className="select-none text-muted-foreground/60">
										{getFallbackPrefix(line)}
									</span>
									{line.content}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
