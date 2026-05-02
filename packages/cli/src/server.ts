import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export type RouteParams = Record<string, string>;

export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	params: RouteParams,
) => void | Promise<void>;

export interface Route {
	method: string;
	/** Path pattern with optional `:name` placeholders, e.g. `/api/runs/:id/chapters`. */
	pattern: string;
	handler: RouteHandler;
}

export interface ServerOptions {
	port?: number;
	maxPortAttempts?: number;
	routes?: Route[];
	/** Override the static asset root. Defaults to the bundled `web-dist/` next to the CLI. */
	webDistPath?: string;
}

export interface ServerHandle {
	port: number;
	close: () => Promise<void>;
}

interface CompiledRoute {
	method: string;
	regex: RegExp;
	paramNames: string[];
	handler: RouteHandler;
}

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
};

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = path.resolve(CLI_DIR, "..", "web-dist");
export const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_START_PORT = 5391;
const DEFAULT_MAX_PORT_ATTEMPTS = 100;

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
	const webDist = path.resolve(opts.webDistPath ?? DEFAULT_WEB_DIST);
	const compiled = (opts.routes ?? []).map(compileRoute);
	const startPort = opts.port ?? DEFAULT_START_PORT;
	const maxPortAttempts = opts.maxPortAttempts ?? DEFAULT_MAX_PORT_ATTEMPTS;

	for (let i = 0; i < maxPortAttempts; i++) {
		const port = startPort + i;
		const server = http.createServer((req, res) => {
			handleRequest(req, res, webDist, compiled).catch((err) => {
				const msg = err instanceof Error ? err.message : String(err);
				process.stderr.write(`request handler error: ${msg}\n`);
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "text/plain" });
				}
				res.end("Internal Server Error");
			});
		});

		try {
			await listen(server, port);
			return {
				port,
				close: () =>
					new Promise<void>((resolve, reject) => {
						server.close((err) => (err ? reject(err) : resolve()));
					}),
			};
		} catch (err) {
			if (!isPortUnavailable(err)) throw err;
		}
	}

	throw new Error(
		`Could not find a free port in range ${startPort}-${startPort + maxPortAttempts - 1}`,
	);
}

function listen(server: http.Server, port: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onError = (err: Error) => reject(err);
		server.once("error", onError);
		server.once("listening", () => {
			server.removeListener("error", onError);
			resolve();
		});
		server.listen(port, LOOPBACK_HOST);
	});
}

function isPortUnavailable(err: unknown): boolean {
	const code = (err as NodeJS.ErrnoException).code;
	return code === "EADDRINUSE" || code === "EACCES";
}

function compileRoute(route: Route): CompiledRoute {
	const paramNames: string[] = [];
	const escaped = route.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const body = escaped.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name: string) => {
		paramNames.push(name);
		return "([^/]+)";
	});
	return {
		method: route.method.toUpperCase(),
		regex: new RegExp(`^${body}$`),
		paramNames,
		handler: route.handler,
	};
}

async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	webDist: string,
	routes: CompiledRoute[],
): Promise<void> {
	// Don't parse via `new URL()` — its WHATWG normalization collapses `/../foo` to `/foo`,
	// hiding traversal attempts before our guard runs. Strip the query string ourselves.
	const fullUrl = req.url ?? "/";
	const queryIdx = fullUrl.indexOf("?");
	const pathname = (queryIdx >= 0 ? fullUrl.slice(0, queryIdx) : fullUrl) || "/";
	const method = (req.method ?? "GET").toUpperCase();

	if (pathname.startsWith("/api/")) {
		for (const route of routes) {
			if (route.method !== method) continue;
			const match = route.regex.exec(pathname);
			if (!match) continue;
			const params: RouteParams = {};
			try {
				route.paramNames.forEach((name, i) => {
					params[name] = decodeURIComponent(match[i + 1] ?? "");
				});
			} catch {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Bad Request");
				return;
			}
			await route.handler(req, res, params);
			return;
		}
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
		return;
	}

	if (method !== "GET") {
		res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET" });
		res.end("Method Not Allowed");
		return;
	}

	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end("Bad Request");
		return;
	}

	// path.relative + a check for `..`/absolute is a CodeQL-recognized path-injection sanitizer.
	// Building filePath from the validated relative makes the data flow explicit.
	const rel = path.relative(webDist, path.resolve(webDist, `.${decoded}`));
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		res.writeHead(403, { "Content-Type": "text/plain" });
		res.end("Forbidden");
		return;
	}
	const filePath = path.join(webDist, rel);

	if (await sendFile(filePath, res)) return;
	await sendIndexFallback(webDist, res);
}

async function sendFile(filePath: string, res: http.ServerResponse): Promise<boolean> {
	let stat: Awaited<ReturnType<typeof fsp.stat>>;
	try {
		stat = await fsp.stat(filePath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return false;
		throw err;
	}
	if (!stat.isFile()) return false;

	const ext = path.extname(filePath).toLowerCase();
	res.writeHead(200, {
		"Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
		"Content-Length": String(stat.size),
	});
	await pipeline(createReadStream(filePath), res);
	return true;
}

async function sendIndexFallback(webDist: string, res: http.ServerResponse): Promise<void> {
	const indexPath = path.join(webDist, "index.html");
	let stat: Awaited<ReturnType<typeof fsp.stat>>;
	try {
		stat = await fsp.stat(indexPath);
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
		return;
	}
	res.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"Content-Length": String(stat.size),
	});
	await pipeline(createReadStream(indexPath), res);
}
