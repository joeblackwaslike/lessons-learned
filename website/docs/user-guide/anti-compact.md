---
sidebar_position: 7
title: Context Anti-Compact
description: Block lossy context compaction and replace it with a high-quality session handoff document.
---

# Context Anti-Compact

:::warning Moved to standalone plugin
Context Anti-Compact has moved to its own repository and plugin:
**[joeblackwaslike/anti-compact](https://github.com/joeblackwaslike/anti-compact)**. This feature
is no longer implemented in lessons-learned — install and configure it from the standalone repo.
:::

## Install

```sh
/plugin marketplace add joeblackwaslike/agent-marketplace
/plugin install anti-compact@joeblackwaslike
```

See the [anti-compact README](https://github.com/joeblackwaslike/anti-compact) for usage,
`/anti-compact:handoff` command details, and how the handoff is generated.
