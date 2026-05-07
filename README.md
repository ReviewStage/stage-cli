<div align="center">
  <img src="https://raw.githubusercontent.com/ReviewStage/stage-cli/main/assets/stage-mark.svg" alt="Stage" height="80">
  <h1>Stage</h1>
  <p>AI-powered code review tool that organizes local code changes into logical chapters and points out what to review before you dive into the code.</p>
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/stagereview"><img src="https://img.shields.io/npm/v/stagereview.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/stagereview"><img src="https://img.shields.io/npm/dm/stagereview.svg" alt="npm downloads"></a>
  <a href="https://github.com/ReviewStage/stage-cli/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/stagereview.svg" alt="license"></a>
</p>

---

Try the full Stage experience with GitHub integration at [stagereview.app](https://stagereview.app).

## Install

```bash
npm install -g stagereview
```

Then add the skill to your agent:

```bash
npx skills add ReviewStage/stage-cli
```

## Usage

In your AI agent, run:

```
/stage-chapters
```

This organizes your local changes into reviewable chapters and opens a browser UI. Everything happens on your machine.

<img width="1840" height="1196" alt="Stage CLI" src="https://raw.githubusercontent.com/ReviewStage/stage-cli/main/assets/screenshot.png" />

## License

[MIT](LICENSE)
