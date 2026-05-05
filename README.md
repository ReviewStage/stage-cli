# stagereview

AI-powered code review tool that organizes pull requests into logical chapters and surfaces risks before you dive into the code. Run it from your local coding agent of choice.

Try the full Stage experience with GitHub integration at [https://stagereview.app](https://stagereview.app).

## Install

```bash
npm install -g stagereview
```

This installs the `stagereview` command.

Then add the skill to your agent:

```bash
npx skills add ReviewStage/stage-cli
```

## Usage

In your AI agent, run:

```
/stage-chapters
```

This breaks your branch's diff into reviewable "chapters" and opens a local browser window to view the chapters.

## What it does

- Splits a local git branch diff into logical review chapters
- Opens a local browser to view the chapters
- Runs entirely on your machine

## License

MIT
