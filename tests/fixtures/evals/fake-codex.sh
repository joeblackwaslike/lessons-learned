#!/bin/sh
# Stand-in for the codex CLI in provider tests. Behaviour comes from FAKE_CODEX_* env vars,
# which tests bake into a wrapper script because the provider strips the env. Prints a
# `codex exec --json` event stream (shape from codex-events.jsonl) and logs what it saw:
# the CODEX_HOME listing, env var names, and where git/gh resolve, plain and in the
# `/bin/zsh -lc` shell codex runs commands in.
if [ "$1" = "--version" ]; then
  echo "codex-cli ${FAKE_CODEX_VERSION:-9.9.9}"
  exit 0
fi
if [ -n "$FAKE_CODEX_LOG" ]; then
  printf 'home=%s\tpath0=%s\ttmpdir=%s\tcodex_home=%s\tauth_mode=%s\tenv=%s\tgit=%s\tgh=%s\tzsh_git=%s\tzsh_gh=%s\targs=%s\n' \
    "$HOME" "${PATH%%:*}" "$TMPDIR" "$(ls -A "$CODEX_HOME" | tr '\n' ' ')" \
    "$(ls -l "$CODEX_HOME/auth.json" | cut -c1-10)" \
    "$(env | sed 's/=.*//' | sort | tr '\n' ',')" \
    "$(command -v git)" "$(command -v gh)" \
    "$(/bin/zsh -lc 'command -v git' </dev/null 2>/dev/null)" \
    "$(/bin/zsh -lc 'command -v gh' </dev/null 2>/dev/null)" \
    "$(printf '%s ' "$@" | tr '\n' ' ')" >> "$FAKE_CODEX_LOG"
fi
# Simulates codex refreshing its token: rewrites the auth.json copy in CODEX_HOME.
if [ -n "$FAKE_CODEX_AUTH_WRITE" ]; then printf '%s' "$FAKE_CODEX_AUTH_WRITE" > "$CODEX_HOME/auth.json"; fi
if [ -n "$FAKE_CODEX_EVENTS" ]; then
  cat "$FAKE_CODEX_EVENTS"
  if [ -n "$FAKE_CODEX_HANG" ]; then sleep "$FAKE_CODEX_HANG"; fi
  exit "${FAKE_CODEX_EXIT:-0}"
fi
message() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({type:"item.completed",item:{id:"msg_"+process.argv[1],type:"agent_message",text:s}})))' "$1"
}
echo '{"type":"thread.started","thread_id":"00000000-0000-0000-0000-000000000000"}'
echo '{"type":"turn.started"}'
# The command as a JSON string, wrapped like codex does: /bin/zsh -lc '<command>', with each
# ' written as '\''.
cmd=$(node -e 'const q="\x27";console.log(JSON.stringify("/bin/zsh -lc "+q+process.argv[1].replaceAll(q,q+"\\"+q+q)+q))' -- "${FAKE_CODEX_COMMAND:-ls}")
i=0
while [ "$i" -lt "${FAKE_CODEX_TOOL_CALLS:-1}" ]; do
  printf '{"type":"item.started","item":{"id":"cmd_%s","type":"command_execution","command":%s,"aggregated_output":"","exit_code":null,"status":"in_progress"}}\n' "$i" "$cmd"
  printf '{"type":"item.completed","item":{"id":"cmd_%s","type":"command_execution","command":%s,"aggregated_output":"","exit_code":0,"status":"completed"}}\n' "$i" "$cmd"
  i=$((i + 1))
done
printf '%s' 'working on it' | message progress
if [ -n "$FAKE_CODEX_STDERR" ]; then sh -c "$FAKE_CODEX_STDERR" >&2; fi
# The final agent message carries FAKE_CODEX_RUN's output, then FAKE_CODEX_OUTPUT.
{
  if [ -n "$FAKE_CODEX_RUN" ]; then sh -c "$FAKE_CODEX_RUN" 2>&1; fi
  printf '%s' "${FAKE_CODEX_OUTPUT-ok}"
} | message final
if [ -n "$FAKE_CODEX_FAIL" ]; then
  printf '{"type":"turn.failed","error":{"message":"%s"}}\n' "$FAKE_CODEX_FAIL"
else
  echo '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":2}}'
fi
exit "${FAKE_CODEX_EXIT:-0}"
