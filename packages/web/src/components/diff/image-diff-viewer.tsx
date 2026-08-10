import { getImageMimeType } from "@stagereview/types/image";
import { useMemo } from "react";
import { FILE_STATUS, type PullRequestFile } from "@/lib/diff-types";

/**
 * Vendored from the hosted app's `components/diff/image-diff-viewer.tsx`.
 *
 * The hosted app fetches base/head blobs from GitHub per side; the CLI's diff
 * response instead ships full file contents inline — UTF-8 text for SVG,
 * base64 for binary image formats — so both sides arrive synchronously with
 * the diff and there is no loading state.
 */
interface ImageDiffViewerProps {
	file: PullRequestFile;
	/** Full old-side file text, when the diff response includes it. */
	oldText?: string;
	/** Full new-side file text, when the diff response includes it. */
	newText?: string;
	/** How oldText/newText are encoded. Absent means UTF-8 text. */
	encoding?: "base64";
}

function toDataUrl(
	text: string | undefined,
	mimeType: string,
	encoding: "base64" | undefined,
): string | undefined {
	if (text === undefined) return undefined;
	if (encoding === "base64") return `data:${mimeType};base64,${text}`;
	return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
}

function ImageUnavailable() {
	return <p className="text-muted-foreground text-sm">Unable to load image</p>;
}

export function ImageDiffViewer({ file, oldText, newText, encoding }: ImageDiffViewerProps) {
	const oldPath = file.oldPath ?? file.path;

	const oldSrc = useMemo(
		() => toDataUrl(oldText, getImageMimeType(oldPath), encoding),
		[oldText, oldPath, encoding],
	);
	const newSrc = useMemo(
		() => toDataUrl(newText, getImageMimeType(file.path), encoding),
		[newText, file.path, encoding],
	);

	if (file.status === FILE_STATUS.ADDED || file.status === FILE_STATUS.DELETED) {
		const src = file.status === FILE_STATUS.ADDED ? newSrc : oldSrc;
		return (
			<div className="flex items-center justify-center rounded-b-lg border-x border-b border-border bg-card p-4">
				{src ? (
					<img
						src={src}
						alt={file.path}
						className="max-h-[500px] max-w-full rounded border border-border object-contain"
					/>
				) : (
					<ImageUnavailable />
				)}
			</div>
		);
	}

	return (
		<div className="flex items-stretch rounded-b-lg border-x border-b border-border bg-card p-4">
			<div className="flex flex-1 items-center justify-center">
				{oldSrc ? (
					<img
						src={oldSrc}
						alt={oldPath}
						className="max-h-[500px] max-w-full rounded border border-border object-contain"
					/>
				) : (
					<ImageUnavailable />
				)}
			</div>
			<div className="mx-4 w-px shrink-0 bg-border" />
			<div className="flex flex-1 items-center justify-center">
				{newSrc ? (
					<img
						src={newSrc}
						alt={file.path}
						className="max-h-[500px] max-w-full rounded border border-border object-contain"
					/>
				) : (
					<ImageUnavailable />
				)}
			</div>
		</div>
	);
}
