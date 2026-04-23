# Context Anti-Compact

!!! warning "Moved to standalone plugin"
Context Anti-Compact has been extracted to its own repository: **[joeblackwaslike/anti-compact](https://github.com/joeblackwaslike/anti-compact)**. Install and configure it from there. This copy in lessons-learned still works but will not receive updates.

!!! warning "Beta Feature"
Context Anti-Compact is a **beta feature** — enabled by opt-in only. The underlying hook mechanics are stable, but the quality of the generated handoff and edge-case behavior are still being refined. [Feedback and reports welcome.](https://github.com/joeblackwaslike/anti-compact/issues)

---

## The problem

When a session grows large, Claude Code triggers `/compact` — a built-in mechanism that compresses the conversation history to reclaim context window space. Compaction is lossy by design: the model rewrites the thread as a condensed summary, discarding detail, nuance, and the reasoning chain behind recent decisions.

The result is a measurable drop in inference quality:

- Key decisions lose their rationale. The model knows _what_ was decided but not _why_, making it more likely to reverse good decisions.
- In-progress work loses its exact state. Commands, issue IDs, file paths, and error messages that were live context get smoothed over.
- The model's confidence about recent steps drops — it may re-ask questions that were already answered, re-explore paths already ruled out, or repeat mistakes already corrected.

For long, complex sessions this is a real cost. Compaction trades continuity for capacity, and the trade is often worse than it appears.

---

## The solution

Context Anti-Compact intercepts `/compact` before it runs and **blocks it**. Instead of letting the built-in compaction replace your thread, the hook:

1. Parses the current session transcript to estimate how much context is in use
2. Sends the full conversation to `claude -p` (the CLI) with a structured summarization prompt
3. Outputs a high-quality handoff document — the same kind of context-preserving summary a skilled human would write
4. Exits with code `2`, which is the Claude Code signal to block the compaction

The handoff is designed to be copied into a fresh session as a continuation prompt. The fresh session starts with zero compaction overhead and a well-structured context document rather than a machine-compressed thread.

The hook falls back to a structured extraction (active issues, recent commits, full conversation entries) if `claude -p` is unavailable or times out.

---

## Why block instead of summarize?

Built-in `/compact` is a Claude feature, not a lessons-learned feature — the plugin has no visibility into what gets discarded. Blocking gives the user a choice: start fresh with a known-good handoff, rather than continuing on a silently degraded thread.

The 80% trigger point is hardcoded in Claude Code and not configurable. Once you see the compaction signal, you're already at capacity — blocking here is the only place to intervene.

---

## Opt in

The feature is disabled by default. To enable it, set the environment variable before starting Claude Code:

```bash
export LESSONS_PRECOMPACT_HANDOFF=1
```

Or set it in your shell profile to enable persistently:

```bash
echo 'export LESSONS_PRECOMPACT_HANDOFF=1' >> ~/.zshrc   # or ~/.bashrc
```

When enabled, the next time `/compact` would fire, the hook intercepts it, generates the handoff, and blocks compaction. You will see output like:

```
# [lessons-learned] Pre-Compact Handoff

Context: ~142k / ~178k tokens (~80%). Compaction would degrade inference quality —
blocking to preserve session context.

Copy this prompt to continue in a new session:

```

[Structured handoff document...]

```

```

Copy the fenced block, start a new session, and paste it as your first message.

---

## How the handoff is generated

The hook reads the session JSONL transcript and separates real conversation content from injected system context (hook attachments, system reminders). It counts characters from `user` and `assistant` message content plus `attachment` records to estimate token usage — this is more accurate than using raw file size, which is inflated by hook injection records.

The conversation text is piped to `claude -p --no-session-persistence` with a prompt that instructs the model to produce a structured handoff covering:

- Original task and goal
- Key decisions and their rationale
- Current state: done, in progress, blocked
- Exact commands, file paths, issue IDs
- Mistakes encountered and solutions
- Next concrete steps

The `--no-session-persistence` flag prevents the handoff generation call from polluting session history. The hook uses `spawn` with an async close handler (not `spawnSync`) because `claude -p` performs post-response cleanup after printing output, causing `spawnSync` to hang for the full timeout budget even after the response arrives.

---

## Limitations (beta)

- The `claude -p` call takes 20–40 seconds. The hook has a 45-second kill timeout and a 60-second hook budget in `hooks.json`. On very slow hardware or under heavy load, the fallback may fire.
- The JSONL token estimate is an approximation (chars ÷ 4). Actual token usage may differ from what the hook reports.
- The feature currently only works in Claude Code. Gemini CLI and Codex do not have a `PreCompact` hook equivalent.
- The `claude` binary must be in `PATH` or in `~/.nvm/versions/node/v24.10.0/bin/`. If it is not found, the hook falls back to the structured extraction path.

---

## Future: standalone plugin

Context Anti-Compact is conceptually independent of lesson injection — it doesn't read from the lesson store, it doesn't write candidates, and it would be useful even without the rest of lessons-learned installed. The plan is to extract it into its own plugin and repository once the beta period concludes and the feature is stable.

The beta lives here for now so it can be tested alongside the hook infrastructure and refined without an additional release cycle.

Track the extraction in [GitHub issues](https://github.com/joeblackwaslike/lessons-learned/issues).
