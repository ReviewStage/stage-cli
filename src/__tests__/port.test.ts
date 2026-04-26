import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { findFreePort } from "../port.js";

const BASE_PORT = 5391;

function occupy(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => resolve(server));
    server.listen(port, "127.0.0.1");
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("findFreePort", () => {
  const servers: net.Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop();
      if (s) await close(s);
    }
  });

  it("returns the start port when free", async () => {
    const port = await findFreePort(BASE_PORT);
    expect(port).toBe(BASE_PORT);
  });

  it("returns the next port when the start port is occupied", async () => {
    const blocker = await occupy(BASE_PORT);
    servers.push(blocker);
    const port = await findFreePort(BASE_PORT);
    expect(port).toBe(BASE_PORT + 1);
  });

  it("errors after exhausting all attempts", async () => {
    const blockers = await Promise.all([
      occupy(BASE_PORT),
      occupy(BASE_PORT + 1),
      occupy(BASE_PORT + 2),
    ]);
    servers.push(...blockers);
    await expect(findFreePort(BASE_PORT, 3)).rejects.toThrow(
      /Could not find a free port/,
    );
  });
});
