#!/bin/sh
# Stand-in for the claude CLI in provider tests. Behaviour comes from FAKE_CLAUDE_* env
# vars, which tests bake into a wrapper script because the provider strips the env.
# Hook events go where the eval hook shim writes them: $EVAL_LOG_DIR, else ./.eval.
if [ "$1" = "--version" ]; then
  echo "${FAKE_CLAUDE_VERSION:-9.9.9} (Fake)"
  exit 0
fi
if [ -n "$FAKE_CLAUDE_LOG" ]; then
  printf 'home=%s\tpath0=%s\ttmpdir=%s\ttoken=%s\targs=%s\n' \
    "$HOME" "${PATH%%:*}" "$TMPDIR" "${CLAUDE_CODE_OAUTH_TOKEN:+set}" \
    "$(printf '%s ' "$@" | tr '\n' ' ')" >> "$FAKE_CLAUDE_LOG"
fi
log_dir="${EVAL_LOG_DIR:-.eval}"
mkdir -p "$log_dir"
i=0
while [ "$i" -lt "${FAKE_CLAUDE_TOOL_CALLS:-1}" ]; do
  printf '{"type":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}\n' >> "$log_dir/hook-events.ndjson"
  printf '{"tool_name":"Bash","tool_input":{"command":"ls"}}\n' >> "$log_dir/tool-calls.jsonl"
  i=$((i + 1))
done
if [ -n "$FAKE_CLAUDE_RUN" ]; then sh -c "$FAKE_CLAUDE_RUN" 2>&1; fi
if [ -n "$FAKE_CLAUDE_STDERR" ]; then sh -c "$FAKE_CLAUDE_STDERR" >&2; fi
printf '%s\n' "${FAKE_CLAUDE_OUTPUT-ok}"
exit "${FAKE_CLAUDE_EXIT:-0}"
