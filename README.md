# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

My AI learning system from this video: [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU).

This is a personal system I built for myself, shared as-is. Built as a pi configuration: the teaching philosophy encoded in a skill, a few small extensions, and agent definitions.

## What's in it

- `skills/teach/` — the philosophy and the process
- `skills/visualize/` — adds a correct, minimal diagram to a lesson when an idea is clearer as a picture
- `extensions/ask-user-question/` — the agent asks you questions through a UI popup
- `extensions/quiz/` — graded questions with instant feedback (✓/✗, correct answer, explanation)
- `extensions/md-log/` — link a markdown file to the session
- `extensions/visual-tools/` — tools for visualization subagents
- `agents/` — `researcher`, `svg-maker`, `mermaid-maker`: the subagents the system delegates to

## Install

This repo **is** a `.pi` directory. From your learning project's root:

```bash
git clone https://github.com/spabolu/learn .pi
```

Then open pi in that directory. (Or copy the pieces you want into your existing project config.)

**Required after every clone** (`node_modules` isn't in git; without this the Mermaid maker fails with a missing-puppeteer error):

```bash
cd .pi/extensions/visual-tools
PUPPETEER_SKIP_DOWNLOAD=1 npm install   # skips the Chromium download; uses your installed Chrome
```

## Requirements

- [pi](https://github.com/earendil-works/pi)
- A subagent implementation, so the system can spawn the researcher and the visual makers. Recommended: [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents) (tmux only). With it, everything works out of the box. Any other implementation works too, but expect to adapt the agent definitions, e.g. `agents/researcher.md` lists `safe_bash` in its tools, which is specific to that extension.
- `ask-user-question` — use the copy bundled here. If your setup already has an `ask-user-question` extension, use **this** one in its place. Popups from different extensions serialize through a shared UI lock, which only works when it's the same implementation.

## Notes

You can run the system without subagents. The main session does the teaching. You just lose the researcher (truth verification) and the generated visuals.

The teaching skill is written for one learner (me). Edit the skill to fit how you learn best.

## Setup notes for `pi-subagents` (this fork)

This fork is adapted to run on [`pi-subagents`](https://github.com/nicobailon/pi-subagents) instead of `pi-interactive-subagents`:

- Install web tools for the researcher: `pi install npm:pi-web-access`. `researcher` uses `web_search`, `fetch_content`, `get_search_content` (no `safe_bash`). Run it with `async: true` so the child loads the extension.
- Agent models are set to `github-copilot/claude-sonnet-5.5`; change them to any model in your registry.
- `mermaid-maker` / `svg-maker` load their tools via `subagentOnlyExtensions` pointing at `extensions/visual-tools/tools/*.ts`.
- In `extensions/visual-tools`: `PUPPETEER_SKIP_DOWNLOAD=1 npm install` (uses your installed Chrome), and `brew install librsvg` for SVG rendering.
- Obsidian: published images go to `<project>/viz`. If your vault root is a subfolder, symlink it in: `ln -s ../viz <vault>/viz`.

## ADHD-friendly delivery (this fork)

`skills/teach/SKILL.md` has a "Delivery" section adapting how lessons are written for a learner with ADHD (action first, one idea per node, restated progress, one next step, no preamble/closers). The probe → plan → teach flow is unchanged. Inspired by [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd).
