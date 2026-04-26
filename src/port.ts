import net from "node:net";

const DEFAULT_START_PORT = 5391;
const MAX_ATTEMPTS = 100;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findFreePort(
  startPort: number = DEFAULT_START_PORT,
  maxAttempts: number = MAX_ATTEMPTS,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `Could not find a free port in range ${startPort}-${startPort + maxAttempts - 1}`,
  );
}
