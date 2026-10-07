# learn

[![video](assets/thumbnail.png)](https://www.youtube.com/watch?v=kzcI5F4tGiU)

A personal AI learning system for [pi](https://github.com/earendil-works/pi). It builds on the video [How I Use AI to Learn Things](https://www.youtube.com/watch?v=kzcI5F4tGiU) and on Matt Pocock's `teach` skill, and it's tuned for one learner with ADHD.

## Set up one folder per skill

This repo is a `.pi` directory. Give each new skill its own folder:

```bash
mkdir ~/learn-rust && cd ~/learn-rust
git clone https://github.com/spabolu/learn .pi
(cd .pi/extensions/learn && npm install)
pi
```

When pi asks whether to trust the folder, choose **Trust**. Then type `/learn rust ownership`. The viewer opens in your browser, and the teacher starts by asking what you want to be able to do.

To continue on a later day, run `cd ~/learn-rust && pi`, then type `/learn`.

To let the teacher check facts on the web, install two pi packages once:

```bash
pi install npm:pi-subagents
pi install npm:pi-web-access
```

Without them, the teacher teaches from memory and checks nothing on the web. Everything else works.

## Commands

| Command | What it does |
| --- | --- |
| `/learn <topic>` | Starts a topic, or resumes it if it exists. |
| `/learn` | Resumes the most recent topic. |
| `/learn list` | Lists your topics. |
| `/learn view` | Opens the viewer. |

The viewer runs at `127.0.0.1:4747`. Set `LEARN_VIEWER=off` to run without it.

## Change the model

The default is Claude Sonnet 5.5 through GitHub Copilot, with medium thinking. `.pi/settings.json` sets it. To switch for one session, use `/model` and `/thinking`. To change the default, edit `.pi/settings.json`. A default that you save in the model picker goes to your global settings, and the project file overrides it.

## What's in the repo

- `skills/teach/SKILL.md` holds the whole teaching method:
  - two principles: unconditional truths first, and "how could I have discovered this?"
  - the loop: probe, plan, teach one node at a time, and review on a later day
  - a routine for a misconception: you predict a result, check it against the real number, and then solve a new case
  - delivery rules for ADHD, such as one idea per message and one small next step at the end of each
- `extensions/learn/` adds `/learn` and the live web viewer. The viewer has three tabs:
  - **Lesson** shows the conversation, with math, mermaid, and SVG rendered.
  - **Plan** shows your mission and the plan.
  - **Library** shows notes, reference sheets, and learning records.

  You can answer a question in the browser or in the terminal. The first answer counts.
- `extensions/quiz.ts` asks graded multiple-choice questions.
- `extensions/ask-user-question.ts` asks questions that have no right answer.
- `agents/researcher.md` checks facts on the web before the teacher states them.
- `settings.json` sets the default model.

Each topic gets a folder, `topics/<slug>/`, next to `.pi`. It holds plain markdown: `MISSION.md`, `PLAN.md`, `NOTES.md`, `RESOURCES.md`, `records/`, and `reference/`. The teacher reads these files at the start of each session and updates them as you go. Because they live outside `.pi`, `git -C .pi pull` updates the skill, extensions, and agent without touching your progress.
