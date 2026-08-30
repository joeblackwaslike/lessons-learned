# Postmortem: PostToolUse Reinject Runaway

**Date:** 2026-08-30
**Severity:** High
**Status:** Resolved (commit c2a3674)

---

## Summary

The `posttooluse-directive-reinject.mjs` hook injected a full ~21 KB directive/protocol block every 20 tool calls for the entire duration of every session. In a 1,193-tool session this produced 56 identical injections totaling 1.2 MB — a 56:1 duplication ratio. The threshold-based dedup was implemented correctly but never ran, because the runtime field it depends on (`context_window.used_percentage`) is never populated by Claude Code.

---

## Impact

| Session      | Tool calls | Reinject events | Total injected |
| ------------ | ---------- | --------------- | -------------- |
| jpspot       | 23         | 1               | ~21 KB (fine)  |
| anti-compact | ~200       | ~10             | ~210 KB        |
| ai-listings  | 1,193      | 56              | ~1.17 MB       |

Unique directive content per session: ~21 KB. Everything beyond that was waste.

---

## Timeline

- **Unknown (feature shipped):** PostToolUse hook deployed with a tool-count fallback (fire every N calls when context percentage data is unavailable). No one confirmed that the primary data source was ever populated by the runtime.
- **2026-08-30 morning:** An agent reviewing a heavy session flagged that lessons-learned was injecting "on every tool call." Imprecise framing — every 20 calls — but the signal was real.
- **2026-08-30 ~10:30am:** Sampled 5 session JSONLs. Observed 56 PostToolUse reinject events in the ai-listings session. `1,193 tools ÷ 20-call interval ≈ 59 expected fallback fires` — confirmed `pct` was always null.
- **2026-08-30 ~3pm:** Fix shipped. PostToolUse hook entry removed from `hooks.json`. 277/277 tests pass.

---

## Root Cause

### Primary

`context_window.used_percentage` is never populated by the Claude Code runtime in PostToolUse stdin. The transcript fallback — scanning JSONL for `Token usage: X/Y` lines — also never matched. With both sources returning null, the fallback path (fire every 20 tool calls) ran exclusively, for every session, from the first tool call.

### Contributing

The fallback was designed for occasional data gaps. It had no session cap and no dedup. Short sessions (20–50 tools) produce 1–3 fallback fires, which looks exactly like the intended 1–3 threshold fires — so the bug was invisible at normal session lengths and never appeared in tests.

---

## What the Code Got Right

- Threshold dedup (`state.fired`) was correctly implemented and would have worked if `pct` was ever non-null
- PreToolUse per-slug dedup: ~3% match rate, no repeated injections per session
- Session-start budget cap (from commit b7372de) working correctly
- Compact-triggered `SessionStart` re-injection was already the real recovery path

## What Failed

- Fallback path had no per-session cap or dedup
- Primary data source (`context_window.used_percentage`) was never validated against actual Claude Code PostToolUse payloads before shipping
- No injection byte-count monitoring — the problem was invisible until manual JSONL sampling

---

## Fix

Removed the `PostToolUse` entry from `hooks/hooks.json`. The threshold mechanism was correct in design but never ran in practice. The compact-triggered `SessionStart` handler (`session_type === "compact"`) already re-injects directives/protocols at the boundary where it's actually needed. The hook file is retained on disk.

---

## Action Items

1. **Add injection byte metrics to session stats.** Surface total injected bytes by hook type so waste like this is visible without manual JSONL sampling. Target: `lessons scan` output or a new `lessons stats --session` subcommand.

2. **Confirm whether `context_window.used_percentage` exists in the Claude Code PostToolUse payload.** If it does, restore the hook with a fallback cap (max 3 fires per session). If it doesn't, delete the file.

3. **Fix session-start budget measurement.** The byte check uses `summary.length + problem.length + solution.length` but the output is `message`. Change to `message.length` so the declared 8 KB cap is accurate.
