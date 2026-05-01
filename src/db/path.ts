import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STAGE_HOME = ".stage";
const DB_FILE = "db.sqlite";
const REPO_HASH_LEN = 12;

/**
 * Returns the absolute path to this repo's SQLite database, creating parent dirs as needed.
 *
 * Layout: `~/.stage/<sha256(repoRoot)[:12]>/db.sqlite` — mirrors diffity's per-repo scheme.
 * Two distinct repos check into separate hash buckets, so running stage-cli in one repo
 * never touches another's data.
 *
 * The repo root comes from `git rev-parse --show-toplevel` (trimmed before hashing so the
 * same repo always resolves to the same bucket). When invoked outside a git repo (rare —
 * stage-cli is meaningless without a repo), falls back to the cwd so the command at least
 * doesn't crash, but the consumer should still surface a clearer error.
 */
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
    return process.cwd();
  }
}

function ensureRepoDir(repoRoot: string): string {
  const hash = createHash("sha256").update(repoRoot.trim()).digest("hex").slice(0, REPO_HASH_LEN);
  const dir = path.join(homedir(), STAGE_HOME, hash);
  mkdirSync(dir, { recursive: true });
  return dir;
}
