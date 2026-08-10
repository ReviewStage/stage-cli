import { isProxiableGitHubImageUrl } from "@stagereview/types/image-proxy";
import { gh } from "../github/exec.js";
import type { Route } from "../server.js";
import { writeJson } from "./json.js";
import { enforceSameOrigin, query } from "./pull-request-shared.js";

const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25 MB
const GH_TOKEN_TIMEOUT_MS = 10_000;
const UPSTREAM_FETCH_TIMEOUT_MS = 30_000;

class ImageTooLargeError extends Error {}

// SSRF allowlist — must stay in sync with the client copy in
// packages/web/src/lib/github-image-proxy.ts.

let tokenPromise: Promise<string | null> | null = null;

/**
 * The user's GitHub token via `gh auth token`, or null when `gh` is missing or
 * unauthenticated. Successful lookups are cached for the lifetime of the
 * server; failures are reported to stderr and retried on the next request so a
 * repaired login starts working without a restart. Never logged. Public
 * attachments still proxy fine without a token.
 */
function getGitHubToken(): Promise<string | null> {
	if (!tokenPromise) {
		tokenPromise = gh(["auth", "token"], process.cwd(), { timeoutMs: GH_TOKEN_TIMEOUT_MS })
			.then((stdout) => stdout.trim() || null)
			.catch((err) => {
				console.error(
					`GitHub token lookup failed; proxying attachments anonymously: ${err instanceof Error ? err.message : String(err)}`,
				);
				tokenPromise = null;
				return null;
			});
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
				// This read proxies with the local `gh` token, so it gets the same
				// anti-CSRF/DNS-rebinding guard as the gh-backed mutations. The SPA
				// loads these through same-origin <img> tags, which carry a loopback
				// `Host` and no `Origin` header — the guard admits them.
				if (!enforceSameOrigin(req, res)) return;
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
				// Hosted's serverless runtime enforces an execution deadline for it;
				// this long-lived local server needs its own so a stalled upstream
				// can't accumulate stuck requests.
				let upstream: Response;
				try {
					upstream = await fetch(imageUrl, {
						redirect: "follow",
						headers: token ? { authorization: `Bearer ${token}` } : undefined,
						signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
					});
				} catch (error) {
					if (error instanceof DOMException && error.name === "TimeoutError") {
						console.error(`Image proxy upstream fetch timed out: ${error.message}`);
						writeJson(res, 502, { error: "Upstream image fetch timed out" });
						return;
					}
					throw error;
				}

				if (!upstream.ok) {
					await upstream.body?.cancel();
					// Status only — never the body or token.
					console.error(`Image proxy upstream responded ${upstream.status} ${upstream.statusText}`);
					writeJson(res, 502, { error: "Upstream fetch failed" });
					return;
				}

				const contentLength = upstream.headers.get("content-length");
				if (contentLength && Number.parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
					await upstream.body?.cancel();
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
					if (error instanceof DOMException && error.name === "TimeoutError") {
						console.error(`Image proxy upstream fetch timed out: ${error.message}`);
						writeJson(res, 502, { error: "Upstream image fetch timed out" });
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
