import { gh } from "../github/exec.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import { query } from "./pull-request-shared.js";

const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25 MB
const GH_TOKEN_TIMEOUT_MS = 10_000;

class ImageTooLargeError extends Error {}

// SSRF allowlist — must stay in sync with the client copy in
// packages/web/src/lib/github-image-proxy.ts.
const ALLOWED_HOSTS = new Set(["github.com", "private-user-images.githubusercontent.com"]);

const GITHUB_COM_ALLOWED_PATH_PREFIXES = ["/user-attachments/assets/"];

function isAllowedGitHubComPath(pathname: string): boolean {
	if (GITHUB_COM_ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return true;
	}

	// /<owner>/<repo>/assets/<id> pattern
	const segments = pathname.split("/").filter(Boolean);
	return segments.length >= 4 && segments[2] === "assets";
}

export function isProxiableGitHubImageUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== "https:") return false;

	if (!ALLOWED_HOSTS.has(parsed.hostname)) return false;

	if (parsed.hostname === "github.com") {
		return isAllowedGitHubComPath(parsed.pathname);
	}

	return true;
}

let tokenPromise: Promise<string | null> | null = null;

/**
 * The user's GitHub token via `gh auth token`, or null when `gh` is missing or
 * unauthenticated. Cached for the lifetime of the server; never logged. Public
 * attachments still proxy fine without it, so failure degrades silently.
 */
function getGitHubToken(): Promise<string | null> {
	if (!tokenPromise) {
		tokenPromise = gh(["auth", "token"], process.cwd(), { timeoutMs: GH_TOKEN_TIMEOUT_MS })
			.then((stdout) => stdout.trim() || null)
			.catch(() => null);
	}
	return tokenPromise;
}

async function readImageResponseBody(
	body: ReadableStream<Uint8Array> | null,
): Promise<ArrayBuffer> {
	if (!body) throw new Error("Upstream response body is empty");

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;

	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;

			const chunk = result.value;
			bytesRead += chunk.byteLength;
			if (bytesRead > MAX_IMAGE_SIZE) {
				await reader.cancel();
				throw new ImageTooLargeError("Image too large");
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}

	const responseBody = new ArrayBuffer(bytesRead);
	const responseBytes = new Uint8Array(responseBody);
	let offset = 0;
	for (const chunk of chunks) {
		responseBytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return responseBody;
}

export function imageProxyRoutes(): Route[] {
	return [
		{
			method: "GET",
			pattern: "/api/image-proxy",
			handler: async (req, res) => {
				const imageUrl = query(req, "url");
				if (!imageUrl) {
					writeJson(res, 400, { error: "Missing url parameter" });
					return;
				}

				if (!isProxiableGitHubImageUrl(imageUrl)) {
					writeJson(res, 403, { error: "URL not allowed" });
					return;
				}

				const token = await getGitHubToken();
				// Node's fetch strips the Authorization header on cross-origin
				// redirects, so the token never reaches GitHub's CDN hosts.
				const upstream = await fetch(imageUrl, {
					redirect: "follow",
					headers: token ? { authorization: `Bearer ${token}` } : undefined,
				});

				if (!upstream.ok) {
					writeJson(res, 502, { error: "Upstream fetch failed" });
					return;
				}

				const contentLength = upstream.headers.get("content-length");
				if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
					writeJson(res, 413, { error: "Image too large" });
					return;
				}

				let responseBody: ArrayBuffer;
				try {
					responseBody = await readImageResponseBody(upstream.body);
				} catch (error) {
					if (error instanceof ImageTooLargeError) {
						writeJson(res, 413, { error: "Image too large" });
						return;
					}
					throw error;
				}

				res.writeHead(200, {
					"Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
					"Cache-Control": "private, max-age=300, immutable",
					"Content-Security-Policy": "default-src 'none'",
					"X-Content-Type-Options": "nosniff",
					"Content-Length": String(responseBody.byteLength),
				});
				res.end(Buffer.from(responseBody));
			},
		},
	];
}
