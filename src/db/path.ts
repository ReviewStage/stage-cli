import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STAGE_HOME = ".stage";
const DB_FILE = "db.sqlite";
const REPO_HASH_LEN = 12;

export class NotInGitRepoError extends Error {
  constructor() {
    super("stage-cli must be run inside a git repository");
    this.name = "NotInGitRepoError";
  }
}

export function getDbPath(): string {
  const dir = ensureRepoDir(getRepoRoot());
  return path.join(dir, DB_FILE);
}

export function getRepoRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new NotInGitRepoError();
  }
}

function ensureRepoDir(repoRoot: string): string {
  const hash = createHash("sha256").update(repoRoot.trim()).digest("hex").slice(0, REPO_HASH_LEN);
  const dir = path.join(homedir(), STAGE_HOME, hash);
  mkdirSync(dir, { recursive: true });
  return dir;
}
