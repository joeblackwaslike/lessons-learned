# demo.tape — records website/static/img/demo.gif (the README hero GIF)
#
# Regenerate after installing vhs (https://github.com/charmbracelet/vhs):
#   vhs website/static/demo.tape
#
# Run from the repo root. Requires a `claude` login session (real API usage,
# budget ~2-3 minutes) and `jq` on PATH.
#
# ── Why this drives a real `claude -p` session instead of a plain shell ──
#
# The original version of this tape (through 2026-08-10) typed raw
# `node scripts/lessons.mjs scan/review/promote` commands into a plain
# shell — vhs just replayed hardcoded keystrokes, no agent involved. That
# was carved out of the same-day fix (commit 3b039ce) that removed the CLI
# as the presented interface everywhere else in this repo's docs, because
# doing it properly meant rebuilding this tape the way `demo-live.tape` was
# built, not just editing text — see the
# `public-api-is-slash-commands-not-cli` memory/decision this repo's docs
# follow. This version closes that gap: the review/promote scene is driven
# through `/lessons:manage`, using the exact technique validated in
# `demo-live.tape` (`website/static/record-turn.mjs`, which runs a real
# `claude -p --output-format stream-json` call and prints only the final
# `result` event's text — no tool-call/CLI output leaks through).
#
# The closing PreToolUse hook-injection preview (scene 3) is the one
# deliberate exception: it's demonstrating an automatic runtime mechanism
# that fires with zero typed command, not "how a user manages lessons",
# and there's no slash-command wrapper for "preview what the hook would
# inject" — so it stays a direct, transparent pipeline invocation, same as
# `demo-live.tape` shows real `git` commands normally in its own mistake
# scene.
#
# ── Isolation ──
#
# Sources the review/promote scene from the same real, historical session
# transcript `demo-live.tape` uses (a genuine `#lesson` tag for the
# cd+rm-rf Safety Net near-miss) rather than the old hand-crafted
# website/static/demo/session.jsonl fixture — a live agent asked to
# discuss candidates has previously called out that fixture's
# `demo-session-001` id as looking synthetic mid-recording (see the
# project_vhs-live-session-recording-playbook memory), which this avoids
# entirely. `claude -p` runs from .demo-workspace/, a directory with no
# real `data/` visible, so the model never notices/comments on the real
# `data/lessons.db` sitting at the repo root.
#
# DEMO_SESSION is derived from the shell PID ($$), not hardcoded, because
# the PreToolUse hook's dedup state lives under $TMPDIR keyed by
# session_id — a fixed session_id would silently return {} (already
# "seen") on a second recording.

Require node
Require claude
Require jq

Output website/static/img/demo.gif

Set Shell "bash"
Set FontSize 16
Set FontFamily "Menlo"
Set Width 1180
Set Height 820
Set Padding 24
Set BorderRadius 10
Set WindowBar Colorful
Set TypingSpeed 20ms
Set Theme {"name":"lessons-learned","black":"#0d1117","red":"#f85149","green":"#2ea44f","yellow":"#d29922","blue":"#58a6ff","purple":"#bc8cff","cyan":"#39c5cf","white":"#c9d1d9","brightBlack":"#6e7681","brightRed":"#ff7b72","brightGreen":"#3fb950","brightYellow":"#e3b341","brightBlue":"#79c0ff","brightPurple":"#d2a8ff","brightCyan":"#56d4dd","brightWhite":"#f0f6fc","background":"#0d1117","foreground":"#c9d1d9","cursor":"#2ea44f","selection":"#264f78"}

# ── Setup (hidden): copy the real session transcript, scan it for real
# (Tier 1 only — the full transcript covers far more than the one tagged
# mistake), build the isolated sandbox ──
Hide
Type `export PS1='lessons-learned $ ' && export DEMO_SESSION=demo-$$` Enter
Type `REPO_ROOT="$(pwd)"` Enter
Type `rm -rf .demo-data-src .demo-workspace` Enter
Type `mkdir -p .demo-data-src/source .demo-data-src/db .demo-workspace` Enter
Type `cp "$HOME/.claude/projects/-Users-joe-github-joeblackwaslike-lessons-learned/f1e32775-9109-4658-94c3-2bf61ff07612.jsonl" .demo-data-src/source/` Enter
Type `LESSONS_DATA_DIR="$REPO_ROOT/.demo-data-src/db" LESSONS_MANIFEST_PATH="$REPO_ROOT/.demo-data-src/db/lesson-manifest.json" node "$REPO_ROOT/scripts/lessons.mjs" scan --path "$REPO_ROOT/.demo-data-src/source" --tier1-only >/dev/null 2>&1` Enter
Type `LESSONS_DATA_DIR="$REPO_ROOT/.demo-data-src/db" LESSONS_MANIFEST_PATH="$REPO_ROOT/.demo-data-src/db/lesson-manifest.json" node "$REPO_ROOT/scripts/lessons.mjs" build >/dev/null 2>&1` Enter
Type `cd .demo-workspace` Enter
Type `export CLAUDE_PLUGIN_ROOT="$REPO_ROOT" LESSONS_DATA_DIR="$REPO_ROOT/.demo-data-src/db" LESSONS_SCAN_PATH="$REPO_ROOT/.demo-data-src/source" LESSONS_MANIFEST_PATH="$REPO_ROOT/.demo-data-src/db/lesson-manifest.json"` Enter
Type `clear` Enter
Sleep 500ms
Show

Type "# 1. Claude reports a mistake as a #lesson tag in the session log" Enter
Sleep 800ms
Type "# 2. Next session: review and promote it — the manifest rebuilds automatically" Enter
Sleep 1200ms

# ── Scene 1: /lessons:manage discovers the candidate (tool calls hidden,
# only the conversational turn shown) ──
Hide
Type `MSG='/lessons:manage'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Sleep 60s
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Sleep 300ms
Show
Sleep 4s

Hide
Type `MSG='promote 1'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Sleep 25s
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Sleep 300ms
Show
Sleep 3s

Hide
Type `MSG='yes'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Sleep 25s
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Sleep 300ms
Show
Sleep 3s

# ── Scene 2: PreToolUse hook injection preview — direct pipeline, see the
# header comment for why this one stays raw ──
Hide
Type `cd "$REPO_ROOT" && clear` Enter
Show

Type "# 3. Next session: Claude is about to combine cd with rm -rf again..." Enter
Sleep 800ms
Type@12ms `echo '{"tool_name":"Bash","tool_input":{"command":"cd /tmp/scratch && rm -rf old-build"},"session_id":"'"$DEMO_SESSION"'","cwd":"/Users/you/lessons-learned"}' | node hooks/pretooluse-lesson-inject.mjs | jq -r '.hookSpecificOutput.additionalContext'`
Sleep 500ms
Enter
Sleep 5500ms

Hide
Type "rm -rf .demo-data-src .demo-workspace" Enter
Show
