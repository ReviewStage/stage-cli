/**
 * Browser-displayable image formats, vendored from the hosted app's
 * `@stage/utils` image helpers. Used to route image files to the image diff
 * viewer instead of the text diff renderer.
 */
const BROWSER_IMAGE_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
};

const BROWSER_IMAGE_EXTENSIONS = new Set(Object.keys(BROWSER_IMAGE_MIME_TYPES));

function getExtension(path: string): string {
	return path.split(".").pop()?.toLowerCase() ?? "";
}

export function isImageFile(path: string): boolean {
	return BROWSER_IMAGE_EXTENSIONS.has(getExtension(path));
}

export function getImageMimeType(path: string): string {
	return BROWSER_IMAGE_MIME_TYPES[getExtension(path)] ?? "application/octet-stream";
}
