---
sidebar_position: 5
title: 'PRD-005: PostToolUse Context-Aware Re-injection'
description: Design specification for a PostToolUse hook that re-injects directives and protocols at calibrated token-budget thresholds to counter context degradation.
---

# PRD 005: PostToolUse Context-Aware Directive Re-injection

:::caution[Design Document]
This is a Product Requirements Document — a design specification. It describes intended behavior, not necessarily current implementation. Refer to the architecture docs for the current state.
:::

---

## Problem

Directives and protocols are injected once at session start (and on compact/clear), but Claude's attention to them degrades as context fills. By 50–60% context usage, recall measurably drops. By 70–75%, the model is at its least intelligent — exactly when auto-compact fires. There is no mechanism to refresh this content mid-session.

---

## Goal

Add a PostToolUse hook that re-injects directives and protocols at three token-budget thresholds calibrated to the context degradation curve, keeping the model behaviorally aligned throughout long sessions.

---

## Degradation Research

Source: `docs/research/context-and-degredation.md`

- **30–49%** — Model is sharp; session-start directives are still well-attended
- **50–60%** — Context rot begins; accuracy and recall measurably degrade
- **70–75%** — "Consider compacting now" zone; quality is at its lowest
- **80–83.5%** — Auto-compact fires

---

## Thresholds

Three injections with compressed cadence (each window shorter as risk increases):

| Injection | Threshold | Gap | Rationale                                        |
| --------- | --------- | --- | ------------------------------------------------ |
| First     | 30%       | —   | Pre-degradation; model maximally receptive       |
| Second    | 52%       | 22% | Just into rot zone; catch it early               |
| Third     | 70%       | 18% | Deep in rot; last refresh before compaction zone |

All three configurable via env var: `LESSONS_REINJECT_THRESHOLDS=30,52,70`

---

## What Gets Re-injected

Both **directives** and **protocols** — same set as session-start. They have equal drift exposure. Output format mirrors `session-start-lesson-protocol.mjs`: directives section first, protocols section second, grouped by tag.

---

## Context Percentage Source

Three layers, tried in order:

1. `input.context_window?.used_percentage` from PostToolUse stdin — statusline receives this field; PostToolUse may too (needs empirical verification on first run)
2. Parse transcript JSONL at `input.transcript_path`: scan for most recent `<system_warning>Token usage: X/Y` entry and compute `X/Y * 100`
3. Fallback: tool-call count — increment a counter per session, re-inject every N calls (default: `LESSONS_REINJECT_TOOL_COUNT=20`)

---

## State Tracking

Temp file for tracking which thresholds have fired and the tool call count:

```json
{ "fired": [30], "toolCount": 7 }
```

**Location:** `$TMPDIR/lessons-<sessionHash>-reinject.json` — consistent with the existing dedup/seen state convention.

**Reset:** `session-start-reset.mjs` already cleans session temp state on clear/compact — no extra wiring needed, as long as the file uses the same `$TMPDIR` convention.

---

## Files

| Action | File                                                     |
| ------ | -------------------------------------------------------- |
| Create | `hooks/posttooluse-directive-reinject.mjs`               |
| Edit   | `hooks/hooks.json` — add PostToolUse entry, matcher `.+` |

---

## Open Questions

- Does PostToolUse stdin actually include `context_window.used_percentage`? Needs a quick empirical dump on first run.
- Should state live in `$TMPDIR` or `/var/run`? The former is consistent with existing conventions but may get cleaned mid-session on some systems.
- Should re-injection suppress the PreToolUse dedup so directives can fire again at tool-use time too, or let them remain deduped?

---

## Verification

1. Smoke-test the hook directly with mocked stdin at 31% usage — confirm output contains directives and protocols
2. Smoke-test with 25% — confirm no output (threshold not crossed)
3. Smoke-test with 31% twice — confirm second call produces no output (threshold already fired)
4. Run `node --test 'tests/unit/**/*.test.mjs'` — all unit tests must pass
5. Manual: run a long session and confirm re-injection appears in context near the threshold points
