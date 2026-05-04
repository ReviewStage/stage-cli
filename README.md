# stagereview

Chapter-style code review against your local git branch. Run it from your AI coding agent — no server, no telemetry, no API key.

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

This breaks your branch's diff into reviewable "chapters".

To open a generated chapters file directly:

```bash
stagereview show path/to/chapters.json
```

## What it does

- Splits a local git branch diff into logical review chapters
- Opens a local browser to view the chapters
- Runs entirely on your machine

## What it does NOT do

- Connect to any Stage server
- Send telemetry or analytics
- Require an API key or login
- Upload your code anywhere

## License

MIT
