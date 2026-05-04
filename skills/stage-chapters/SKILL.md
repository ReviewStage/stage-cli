---
name: stage-chapters
description: Generate Stage chapters for the current local git branch and open them in a browser for review.
user-invocable: true
---

# stage-chapters

Generates a Stage chapter run for the current local git branch and opens it in a browser. The skill detects the base ref, computes the diff, generates chapters from it, writes a JSON file matching the `stage-cli` schema, and hands the file to `stage-cli show` to launch the SPA.

## Prerequisites

Run these checks before any other work. If either fails, stop with the error message — do not continue.

1. **`stage-cli` is installed.** Run `which stage-cli`. If it exits non-zero, instruct the user:

   ```
   stage-cli is not installed. Run:

       npm install -g stagereview

   Then retry /stage-chapters.
   ```

   Stop.

2. **The current directory is a git repo.** Run `git rev-parse --is-inside-work-tree`. If it does not print `true`, stop with:

   ```
   /stage-chapters must be run inside a git repository.
   ```

## Step 1 — Detect base ref

Find the branch the user reviews against. Try each of the following in order; the first that succeeds becomes `<base>`:

1. `git rev-parse --abbrev-ref origin/HEAD 2>/dev/null` — typically prints `origin/main`. Use the full output (e.g. `origin/main`) as `<base>`; do **not** strip `origin/`, because the bare name (`main`) may not exist locally in single-branch clones.
2. `git rev-parse --verify main 2>/dev/null` — local `main` branch; use `main` as `<base>`.
3. `git rev-parse --verify master 2>/dev/null` — older repos; use `master` as `<base>`.
4. `git rev-parse --verify origin/main 2>/dev/null` — remote-tracking fallback when `origin/HEAD` is unset; use `origin/main` as `<base>`.
5. `git rev-parse --verify origin/master 2>/dev/null` — remote-tracking fallback for older repos; use `origin/master` as `<base>`.

If all five fail, stop with:

```
No default branch detected. Tried origin/HEAD, main, master, origin/main, and origin/master.
```

`<base>` is whatever ref expression was verified above and is passed verbatim to `git merge-base` / `git rev-parse` in Step 2.

## Step 2 — Get the diff

Compute the merge-base and dump the unified diff for the committed range only:

```bash
MERGE_BASE=$(git merge-base <base> HEAD)
HEAD_SHA=$(git rev-parse HEAD)

git diff "$MERGE_BASE..HEAD"
```

`git diff <merge-base>..HEAD` covers exactly the commits on the branch since it diverged from the base — the same range the SPA renders for a `committed` run (`baseSha..headSha` in `packages/cli/src/routes/diff.ts`). Save the full diff text into context for Step 3.

This skill scopes review to *committed* work. If the user has uncommitted changes to tracked files, instruct them to commit first; mixing committed and working-tree changes into a single run would produce `hunkRefs`/`lineRefs` that don't line up with the diff the SPA serves.

`MERGE_BASE` and `HEAD_SHA` are full 40-character SHAs that feed directly into the JSON `scope` field in Step 4.

## Step 3 — Cluster + narrate

> **TODO:** See Issue 11 for the chapter generation prompt port. For now, leave this step as a placeholder. The next revision of this skill will produce a `chapters` array shaped per the schema documented in Step 4.

## Step 4 — Write JSON file

Compute a unique temp path. The trailing `XXXXXX` (with no suffix after) is required by macOS BSD `mktemp` — placing characters after the X's causes BSD `mktemp` to return the template verbatim instead of substituting random characters:

```bash
TMPFILE=$(mktemp "${TMPDIR:-/tmp}/stage-chapters.XXXXXX")
```

`stage-cli show` reads JSON regardless of file extension, so the missing `.json` suffix is fine.

The `${TMPDIR:-/tmp}` fallback matters on macOS, where `os.tmpdir()` resolves to `/var/folders/...` but `$TMPDIR` is not always set in every shell. Avoid `date +%s%N` — the `%N` (nanoseconds) format is a GNU extension and on macOS BSD `date` it emits a literal `N`, breaking uniqueness.

Write a JSON file at `"$TMPFILE"` matching the shape below. The file must validate against `ChaptersFileSchema` in `packages/cli/src/schema.ts`; mismatched fields will be rejected by `stage-cli show`.

High-level shape:

```
{ scope: {...}, chapters: [...], generatedAt: "..." }
```

Full example:

```jsonc
{
  "scope": {
    "kind": "committed",
    // Set baseSha = mergeBaseSha = $MERGE_BASE so the SPA renders
    // baseSha..headSha — the same range chapters were generated from.
    "baseSha": "<MERGE_BASE>",
    "headSha": "<HEAD_SHA>",
    "mergeBaseSha": "<MERGE_BASE>"
  },
  "chapters": [
    {
      "id": "ch-1",
      "order": 1,
      "title": "Short imperative title",
      "summary": "Why this chapter matters to the reviewer.",
      "hunkRefs": [
        { "filePath": "path/to/file.ts", "oldStart": 42 }
      ],
      "keyChanges": [
        {
          "content": "A judgment-call question for the reviewer (not source code).",
          "lineRefs": [
            {
              "filePath": "path/to/file.ts",
              "side": "additions",
              "startLine": 50,
              "endLine": 55
            }
          ]
        }
      ]
    }
  ],
  "generatedAt": "2026-05-04T12:34:56.000Z"
}
```

Field rules:

| Field | Constraint |
|-------|------------|
| `scope.kind` | `"committed"` or `"workingTree"` |
| `scope.ref` | Required when `kind` is `"workingTree"`; one of `"work"`, `"staged"`, `"unstaged"` |
| `scope.baseSha` / `headSha` / `mergeBaseSha` | Full 40-character lowercase hex SHAs |
| `chapters[].id` | Non-empty, unique within the run |
| `chapters[].order` | Positive integer (1-indexed) |
| `chapters[].hunkRefs[].oldStart` | Non-negative integer — the pre-image start line from the unified-diff `@@` header (`0` for new files) |
| `chapters[].keyChanges[].lineRefs` | Array with at least one entry |
| `lineRefs[].side` | `"additions"` (right side) or `"deletions"` (left side) |
| `lineRefs[].startLine` / `endLine` | Positive integers; `endLine >= startLine` |
| `generatedAt` | ISO 8601 datetime string |

## Step 5 — Display generated chapters

Hand the file to `stage-cli`:

```bash
stage-cli show "$TMPFILE"
```

`stage-cli show` validates the JSON, inserts a new `chapter_run` plus chapters and key changes into the local SQLite database, boots a loopback HTTP server, and opens the browser to the new run. The command stays running and serves the SPA until the user kills it with Ctrl+C — invoke it as the final command in the workflow rather than expecting it to print a value and exit.

Do not pass a `runId` and do not call a separate `stage-cli ingest`. `show <path>` does ingestion and serving in one step.
