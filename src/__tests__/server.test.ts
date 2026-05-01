import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Route, type ServerHandle, startServer } from "../server.js";

const INDEX_HTML = "<!doctype html><html><head><title>SPA</title></head><body>SPA-SHELL</body></html>";

let webDist: string;

beforeAll(async () => {
  webDist = await fs.mkdtemp(path.join(os.tmpdir(), "stage-cli-server-"));
  await fs.writeFile(path.join(webDist, "index.html"), INDEX_HTML);
  await fs.mkdir(path.join(webDist, "assets"));
  await fs.writeFile(path.join(webDist, "assets/app.js"), "console.log('hi');");
  await fs.writeFile(path.join(webDist, "assets/styles.css"), "body { color: red; }");
  await fs.writeFile(path.join(webDist, "assets/icon.svg"), "<svg/>");
});

afterAll(async () => {
  await fs.rm(webDist, { recursive: true, force: true });
});

const handles: ServerHandle[] = [];

afterEach(async () => {
  while (handles.length > 0) {
    const h = handles.pop();
    if (h) await h.close();
  }
});

async function start(routes?: Route[]): Promise<ServerHandle> {
  const handle = await startServer({ webDistPath: webDist, routes });
  handles.push(handle);
  return handle;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function rawRequest(port: number, requestPath: string, method = "GET"): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: requestPath,
        // Disable the global keep-alive agent so closed test servers don't leave
        // pooled sockets that bind to the next test's reused port.
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("startServer", () => {
  it("serves index.html at /", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("SPA-SHELL");
  });

  it("serves static assets with mime types from the lookup table", async () => {
    const { port } = await start();

    const js = await rawRequest(port, "/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);

    const css = await rawRequest(port, "/assets/styles.css");
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/text\/css/);

    const svg = await rawRequest(port, "/assets/icon.svg");
    expect(svg.status).toBe(200);
    expect(svg.headers["content-type"]).toMatch(/image\/svg/);
  });

  it("falls back to index.html for unmatched SPA routes", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/some/spa/route");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("SPA-SHELL");
  });

  it("returns 404 for /api/* with no matching route (no SPA fallback)", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/api/unknown");
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("SPA-SHELL");
  });

  it("rejects path traversal with 403 (literal `..` segments)", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/../etc/passwd");
    expect(res.status).toBe(403);
  });

  it("rejects path traversal with 403 (URL-encoded `..` segments)", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/%2E%2E/etc/passwd");
    expect(res.status).toBe(403);
  });

  it("rejects non-GET methods on static paths with 405", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/index.html", "POST");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET");
  });

  it("invokes registered API route handlers and parses :params", async () => {
    const { port } = await start([
      {
        method: "GET",
        pattern: "/api/runs/:id/chapters",
        handler: (_req, res, params) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: params.id }));
        },
      },
    ]);
    const res = await rawRequest(port, "/api/runs/abc-123/chapters");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: "abc-123" });
  });

  it("returns 400 when an /api route's :param has malformed percent-encoding", async () => {
    const { port } = await start([
      {
        method: "GET",
        pattern: "/api/runs/:id/chapters",
        handler: (_req, res) => {
          res.writeHead(200);
          res.end("ok");
        },
      },
    ]);
    const res = await rawRequest(port, "/api/runs/%E0%A4%A/chapters");
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed percent-encoding in static paths", async () => {
    const { port } = await start();
    const res = await rawRequest(port, "/%E0%A4%A");
    expect(res.status).toBe(400);
  });

  it("returns 404 for /api/* paths that don't match any registered route", async () => {
    const { port } = await start([
      {
        method: "GET",
        pattern: "/api/foo",
        handler: (_req, res) => {
          res.end("ok");
        },
      },
    ]);
    const res = await rawRequest(port, "/api/bar");
    expect(res.status).toBe(404);
  });

  it("two simultaneous starts bind separate ports", async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.port).not.toBe(b.port);
    expect(Math.abs(a.port - b.port)).toBeGreaterThanOrEqual(1);
  });

  it("close() stops the server from accepting new connections", async () => {
    const handle = await start();
    const { port } = handle;
    // Take ownership: don't auto-close, we're closing manually.
    handles.pop();
    await handle.close();
    await expect(rawRequest(port, "/")).rejects.toThrow();
  });
});
