# Lesson Fields Reference

All fields available on a lesson record in the DB and manifest.

| Field             | Description                                                                |
| ----------------- | -------------------------------------------------------------------------- |
| `summary`         | One-line description shown in manifests and listings                       |
| `mistake`         | What goes wrong and why — the core of the lesson                           |
| `remediation`     | The concrete fix or avoidance strategy                                     |
| `injection`       | Override text injected into context (auto-generated if absent)             |
| `injectOn`        | `["PreToolUse"]`, `["SessionStart"]`, or both                              |
| `toolNames`       | Exact tool names that trigger this lesson (e.g. `["Bash"]`)                |
| `commandPatterns` | Regex array matched against Bash commands                                  |
| `pathPatterns`    | Glob array matched against Read/Edit/Write paths                           |
| `priority`        | 1–10, higher = more important; affects ranking and reinjection             |
| `confidence`      | 0.0–1.0; below `minConfidence` in config → excluded from manifest          |
| `block`           | If true, denies the tool call instead of injecting a warning               |
| `blockReason`     | Message shown when a tool call is blocked                                  |
| `tags`            | `category:value` labels (e.g. `tool:git`, `severity:data-loss`)            |
| `source`          | `manual`, `structured` (`#lesson` tag), or `heuristic` (pattern detection) |

## Trigger field precedence

When multiple trigger types are set, all are evaluated — the lesson fires if any match:

1. `toolNames` — exact match against tool name (fastest)
2. `commandPatterns` — regex match against Bash command string
3. `pathPatterns` — glob match against Read/Edit/Write file path
4. `injectOn: ["SessionStart"]` — fires once at session start, no command matching

## Priority guide

| Range | Meaning                                   |
| ----- | ----------------------------------------- |
| 9–10  | Data loss, session hangs, security issues |
| 7–8   | Common recurring mistakes, wrong defaults |
| 4–6   | Good-to-know patterns                     |
| 1–3   | Situational, low-frequency                |
