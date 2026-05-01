import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
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
  port: number;
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

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const webDist = path.resolve(opts.webDistPath ?? DEFAULT_WEB_DIST);
  const compiled = (opts.routes ?? []).map(compileRoute);

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

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.once("listening", () => {
      server.removeListener("error", onError);
      resolve();
    });
    server.listen(opts.port, "127.0.0.1");
  });

  return {
    port: opts.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
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
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? "");
      });
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

  const candidate = path.resolve(webDist, `.${decoded}`);
  if (candidate !== webDist && !candidate.startsWith(webDist + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  if (await sendFile(candidate, res)) return;
  await sendIndexFallback(webDist, res);
}

async function sendFile(filePath: string, res: http.ServerResponse): Promise<boolean> {
  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return false;
    throw err;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(data);
  return true;
}

async function sendIndexFallback(webDist: string, res: http.ServerResponse): Promise<void> {
  const indexPath = path.join(webDist, "index.html");
  try {
    const data = await fs.readFile(indexPath);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}
