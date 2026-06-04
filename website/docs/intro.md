---
sidebar_position: 1
title: Get Started
description: Install lessons-learned and capture your first mistake in 2 minutes.
---

# Get Started

**lessons-learned** automatically captures Claude's mistakes from session logs and injects relevant warnings before the same mistake repeats. No manual curation needed.

## Install

```bash
# Claude Code (recommended)
claude /plugin install lessons-learned@agent-marketplace
```

Other platforms: [see Installation →](./user-guide/slash-commands)

## Verify it's working

1. Start a Claude Code session
2. Make a mistake — or emit a test lesson manually:

```
#lesson
tool: Bash
trigger: git stash
problem: git stash silently omits untracked files, risking data loss
solution: Use git stash -u to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

3. In the next session, Claude will warn you before running `git stash`

## Scan & build

```bash
node scripts/lessons.mjs scan       # scan session logs for new candidates
node scripts/lessons.mjs review     # review candidates for quality
node scripts/lessons.mjs build      # rebuild the lesson manifest
```

## What's next

- [How it works](./user-guide/how-it-works) — understand the capture → inject loop
- [Writing lessons](./user-guide/emitting-lessons) — the `#lesson` tag format
- [Configuration](./user-guide/configuration) — tune injection budget and thresholds
- [Interactive visualization](pathname:///how-it-works.html) — explore the system architecture
