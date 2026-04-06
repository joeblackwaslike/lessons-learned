# Developer Guide

Everything you need to extend, contribute to, or deeply understand lessons-learned.

## In this guide

| Page                            | What it covers                                                           |
| ------------------------------- | ------------------------------------------------------------------------ |
| [Architecture](architecture.md) | Component map, pipeline stages, design decisions                         |
| [Data Model](data-model.md)     | Full schema for lessons, manifest, config, and candidates                |
| [Adapters](adapters.md)         | Cross-agent support — tool name normalization, output format differences |
| [Testing](testing.md)           | Test framework, tiers, fixtures, coverage targets                        |
| [Contributing](contributing.md) | Setup, code quality gates, PR guidelines                                 |

## Quick orientation

The plugin has three conceptual layers:

```
┌─────────────────────────────────────────────────────────┐
│  STORAGE  — data/lessons.json, lesson-manifest.json     │
├─────────────────────────────────────────────────────────┤
│  PIPELINE — hooks/ (inject) + scripts/ (CLI + scanner)  │
├─────────────────────────────────────────────────────────┤
│  PROTOCOL — hooks.json wiring + agent output formats    │
└─────────────────────────────────────────────────────────┘
```

If you're investigating a bug in injection → [Architecture](architecture.md) + [Adapters](adapters.md).

If you're changing the data shape → [Data Model](data-model.md).

If you're writing tests → [Testing](testing.md).

If you're adding support for a new agent → [Adapters](adapters.md).
