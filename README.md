<div align="center">
  <img src="https://raw.githubusercontent.com/ReviewStage/stage-cli/main/assets/stage-mark.svg" alt="Stage" height="80">
  <h1>Stage</h1>
  <p>A code review tool that organizes local code changes into logical chapters and points out what to review before you dive into the code.</p>
  <p>If you like this, try out the full Stage experience on our website below!</p>
</div>

<p align="center">
  <a href="https://stagereview.app">Website</a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://stagereview.app/explore">Examples</a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://stagereview.app/blog">Blog</a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://x.com/StageReviewApp">Twitter</a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://discord.gg/kfEa6a4wTp">Discord</a>
  &nbsp;&nbsp;•&nbsp;&nbsp;
  <a href="https://stagereview.app/about">About Us</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/stagereview"><img src="https://img.shields.io/npm/v/stagereview.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/stagereview"><img src="https://img.shields.io/npm/dm/stagereview.svg" alt="npm downloads"></a>
  <a href="https://github.com/ReviewStage/stage-cli/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/stagereview.svg" alt="license"></a>
</p>

## What's a chapter?

Instead of reviewing a pull request as one long, undifferentiated diff, Stage groups related changes into "chapters" — for example, one chapter for a new API integration, another for a schema migration, another for test cleanup. Each chapter comes with a short summary of what changed and what's actually risky, so you know where to focus before reading line by line.

## Prerequisites

- Node.js 18 or later
- A local git repository with changes to review
- An AI coding agent that supports the `skills` convention (see [Which agents work with this?](#which-agents-work-with-this))
- Optional: the [GitHub CLI](https://cli.github.com/) (`gh`), only needed for `--pr` to review a pull request by number or URL

## Install

```bash
npm install -g stagereview
```

Then add the skill to your agent:

```bash
npx skills add ReviewStage/stage-cli
```

## Uninstall

```bash
npx skills remove ReviewStage/stage-cli
npm uninstall -g stagereview
```

## Usage

In your AI agent, run:

```
/stage-chapters
```

This organizes your local changes into reviewable chapters and opens a browser UI. Everything happens on your machine.

### Options

| Flag | Description |
|------|-------------|
| `--base <ref>` | Base ref to diff against (default: auto-detect main/master) |
| `--compare <ref>` | Compare ref to diff against `--base` |
| `--ref <mode>` | Diff scope: `work` (staged + unstaged + untracked), `staged`, or `unstaged` (default: auto-detect) |
| `--pr <number-or-url>` | Review a GitHub pull request by number or URL (requires `gh`) |

Examples:

```bash
# Review only staged changes
/stage-chapters --ref staged

# Diff against a specific branch
/stage-chapters --base feature-a

# Compare two branches
/stage-chapters main feature
/stage-chapters main..feature
/stage-chapters --base main --compare feature

# Review a teammate's PR by number or URL
/stage-chapters --pr 123
/stage-chapters --pr https://github.com/owner/repo/pull/123
```

### `.stageignore`

Add a `.stageignore` file to your repo root to exclude files from the diff analysis. Uses `.gitignore`-style patterns, one per line:

```
# Build artifacts
build/**
dist/**

# Generated code
*.generated.ts

# But keep this one
!dist/important.js
```

Ignored files still appear in the "Other changes" chapter so nothing is silently hidden. Comments (`#`), blank lines, and negation patterns (`!`) are supported — last matching pattern wins.

## Troubleshooting

**`/stage-chapters` isn't recognized in my agent.**
Re-run `npx skills add ReviewStage/stage-cli` to confirm it installed cleanly, and restart your agent — most agents only pick up newly registered skills after a restart.

**Stage says there's nothing to review.**
By default it looks for staged, unstaged, and untracked changes. If everything's already committed, use `--ref staged` or diff against a specific commit with `--compare`.

**It picked the wrong base branch.**
Auto-detection looks for `main` or `master`. If your default branch is named differently, pass it explicitly: `--base your-branch-name`.

**`--pr` isn't working.**
This requires the [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`). Confirm `gh` works on its own first — Stage relies on it to fetch PR data.

## Which agents work with this?

Stage runs on the `skills` convention for AI coding agents, so support depends on whether your agent implements that convention. If `npx skills add` doesn't complete, or `/stage-chapters` doesn't show up as a command afterward, check your agent's own docs for skills or plugin support.

*(Note to the Stage team: this is the one thing I couldn't verify from outside the project — worth explicitly listing which agents you've tested against, since "works with any AI agent" is the first thing a new user will want confirmed.)*

<img width="1840" height="1196" alt="Stage CLI" src="https://raw.githubusercontent.com/ReviewStage/stage-cli/main/assets/screenshot.png" />

## License

[MIT](LICENSE)
