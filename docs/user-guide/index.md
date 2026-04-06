# User Guide

Everything you need to use lessons-learned day-to-day.

## In this guide

| Page                                    | What it covers                                                          |
| --------------------------------------- | ----------------------------------------------------------------------- |
| [How It Works](how-it-works.md)         | End-to-end pipeline — capture, promote, inject                          |
| [Working with Lessons](lessons.md)      | The lesson model, adding, editing, listing, archiving                   |
| [Slash Commands](slash-commands.md)     | `/lessons:add`, `/lessons:review`, `/lessons:manage`, `/lessons:config` |
| [Configuration](configuration.md)       | Tuning injection budget, scan paths, priority thresholds                |
| [Scanning & Discovery](scanning.md)     | Tier 1 and Tier 2 scanning, incremental state, promoting candidates     |
| [Emitting Lessons](emitting-lessons.md) | The `#lesson` tag format — when and how to emit during sessions         |

## Quick orientation

If you're brand new, read [How It Works](how-it-works.md) first — it explains the three-phase pipeline (capture → promote → inject) that everything else builds on.

If you already understand the pipeline and want to get things done:

- **Add a lesson now** → [Slash Commands: /lessons:add](slash-commands.md#lessonsadd)
- **Review what the scanner found** → [Slash Commands: /lessons:review](slash-commands.md#lessonsreview)
- **Browse and edit lessons** → [Slash Commands: /lessons:manage](slash-commands.md#lessonsmanage)
- **Tune injection settings** → [Configuration](configuration.md)
