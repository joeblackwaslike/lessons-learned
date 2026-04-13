# Lesson Emission — #lesson Tag Format

When Claude makes a mistake and corrects it during a session, it should emit a structured tag so the next scan can capture it as a `source='structured'` candidate. Structured candidates are the highest-quality input to the review pipeline — they come from real mistakes in real sessions.

## Tag format

```
#lesson
tool: <tool_name>
trigger: <the command or action that preceded the problem>
problem: <what went wrong and why — be specific about root cause>
solution: <the correction that resolved it>
tags: <comma-separated category:value tags>
#/lesson
```

## Example

```
#lesson
tool: Bash
trigger: git stash
problem: git stash only stashes tracked files — untracked files silently left behind, risking data loss when the working tree looks clean but isn't
solution: Use `git stash -u` to include untracked files
tags: tool:git, severity:data-loss
#/lesson
```

## When to emit

Emit naturally as part of your response whenever you:

- Discover why a tool call failed and apply a different approach
- Catch yourself about to repeat a known problem
- Receive a user correction ("no", "wrong", "that's not right")
- Identify a root cause after debugging

Do **not** force lesson tags where none apply. Only tag genuine problem→solution sequences.

## How it gets captured

The scanner's Tier 1 (structured) pass greps for `#lesson … #/lesson` tags in session JSONL files. On the next scan run, matching tags are parsed and written to the DB as `status='candidate'` with `source='structured'`. These surface immediately in `/lessons:review`.
