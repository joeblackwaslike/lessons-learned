# demo.tape — records website/static/img/demo.gif (the README hero GIF)
#
# Regenerate after installing vhs (https://github.com/charmbracelet/vhs):
#   vhs website/static/demo.tape
#
# Run from the repo root. Requires a `claude` login session (real API usage,
# budget a few minutes).
#
# ── History ──
#
# v1 (through 2026-08-10) typed raw `node scripts/lessons.mjs ...` into a
# plain shell — no agent involved, carved out of that day's public-API fix
# (commit 3b039ce) because fixing it properly meant a full rebuild.
#
# v2 (2026-08-18) replaced that with `record-turn.mjs`-driven `claude -p`
# calls reconstructed into "You: ... Claude: ..." printf blocks. This hid
# the internal CLI calls but, per direct feedback, didn't look like a real
# Claude Code session at all (no TUI chrome, no natural tool-call
# rendering) and the closing PreToolUse-preview scene — a raw
# `echo ... | node hooks/pretooluse-lesson-inject.mjs | jq ...` pipeline
# typed into bash — had no agent in it whatsoever.
#
# v3 (this version) drives one continuous REAL interactive `claude` session
# throughout, captured natively — no printf reconstruction, no synthetic
# hook-simulation pipeline. `/lessons:manage`'s underlying Bash tool calls
# render as Claude Code's own default collapsed tool-call cards
# (`Bash(node ...)` + truncated preview + "ctrl+o to expand") — genuinely
# how the agent using its own tools looks, not "the CLI as the interface."
# The closing scene asks the SAME live agent to clean up a scratch build
# directory — a task that naturally invites combining `cd` with `rm -rf` —
# and the just-promoted lesson (real injected context, not simulated)
# steers it to the safe single-command form instead. Real prevention, live.
#
# ── Isolation & technique notes (v3 build, 2026-08-18/19) ──
#
# - Workspace is a FIXED path (/tmp/ll-demo-workspace), not a fresh $$-
#   suffixed one per run, and pre-trusted once via a throwaway zero-API-cost
#   vhs run (launch claude, accept the trust dialog, exit — never sends a
#   message). A fresh path means a first-time "trust this folder?" dialog
#   Claude Code shows for any never-seen directory, which stalled an entire
#   recording attempt when the blind dismissal keystroke missed it.
# - Workspace is OUTSIDE the repo tree entirely (/tmp, not a subdirectory of
#   the checkout). An earlier attempt nested it under the repo root and the
#   agent, on seeing `list --json` correctly return `[]` (nothing promoted
#   yet — expected), got curious, `cd`'d to the real repo root, and spent 5
#   tool calls reading the real 14MB data/lessons.db before answering.
#   Moving fully outside the repo removed the easy "just look around"
#   affordance and that derailment did not recur.
# - Never `Type "clear" Enter` between scenes while the interactive claude
#   session is still focused — there is no shell to receive it, so "clear"
#   is submitted as a real chat message instead ("Do you mean clear/archive
#   the active lesson(s)...?"), burning a confused turn. Just let the
#   transcript scroll between scenes; it reads fine.
# - `--effort low` on the claude launch: default effort made even the
#   correctly-behaved 3-call manage.md startup sequence slow. Low effort
#   handled the same sequence in ~17s without changing the actual tool
#   calls made.
# - A 2s pause between typing a slash command and pressing Enter (not
#   500ms) is required — a shorter pause raced Claude Code's own
#   command-autocomplete dropdown and silently submitted a DIFFERENT
#   command than what was typed (`/lessons:add` instead of `/lessons:manage`,
#   confirmed via captured frames: the wrong command fully executed as its
#   own real turn). This explains several earlier "timeout" failures in
#   this file's history that looked like slow generation but were actually
#   the response to a submitted command whose text never matched the
#   completion marker being waited for.
# - Fixed `Sleep` after each turn, not `Wait+Screen` on response text.
#   `manage.md`'s exact closing phrasing isn't guaranteed verbatim, and a
#   failed `Wait+Screen` match is a hard abort with zero captured frames —
#   a fixed Sleep always produces something to inspect even when timing
#   needs adjusting.
# - Source data: scans the same real, historical session transcript
#   `demo-live.tape` uses (a genuine `#lesson` tag for the cd+rm-rf Safety
#   Net near-miss), not a hand-crafted fixture — a live agent has
#   previously called out a synthetic-looking `demo-session-001` id in the
#   old fixture mid-recording.

Require node
Require claude

Output website/static/img/demo.gif

Set Shell "bash"
Set FontSize 15
Set FontFamily "Menlo"
Set Width 1180
Set Height 900
Set Padding 24
Set BorderRadius 10
Set WindowBar Colorful
Set TypingSpeed 20ms
Set Theme {"name":"lessons-learned","black":"#0d1117","red":"#f85149","green":"#2ea44f","yellow":"#d29922","blue":"#58a6ff","purple":"#bc8cff","cyan":"#39c5cf","white":"#c9d1d9","brightBlack":"#6e7681","brightRed":"#ff7b72","brightGreen":"#3fb950","brightYellow":"#e3b341","brightBlue":"#79c0ff","brightPurple":"#d2a8ff","brightCyan":"#56d4dd","brightWhite":"#f0f6fc","background":"#0d1117","foreground":"#c9d1d9","cursor":"#2ea44f","selection":"#264f78"}

# ── Setup (hidden): copy the real session transcript, scan it for real
# (Tier 1 only), build the isolated sandbox at the pre-trusted fixed path ──
Hide
Type `export PS1='lessons-learned $ '` Enter
Type `REPO_ROOT="$(pwd)"` Enter
Type `WS="/tmp/ll-demo-workspace"` Enter
Type `rm -rf "$WS/source" "$WS/db"` Enter
Type `mkdir -p "$WS/source" "$WS/db"` Enter
Type `rm -rf /tmp/scratch && mkdir -p /tmp/scratch/old-build && echo "stale artifact" > /tmp/scratch/old-build/output.bin` Enter
Type `cp "$HOME/.claude/projects/-Users-joe-github-joeblackwaslike-lessons-learned/f1e32775-9109-4658-94c3-2bf61ff07612.jsonl" "$WS/source/"` Enter
Type `LESSONS_DATA_DIR="$WS/db" LESSONS_MANIFEST_PATH="$WS/db/lesson-manifest.json" node "$REPO_ROOT/scripts/lessons.mjs" scan --path "$WS/source" --tier1-only >/dev/null 2>&1` Enter
Type `LESSONS_DATA_DIR="$WS/db" LESSONS_MANIFEST_PATH="$WS/db/lesson-manifest.json" node "$REPO_ROOT/scripts/lessons.mjs" build >/dev/null 2>&1` Enter
Type `cd "$WS"` Enter
Type `export CLAUDE_PLUGIN_ROOT="$REPO_ROOT" LESSONS_DATA_DIR="$WS/db" LESSONS_SCAN_PATH="$WS/source" LESSONS_MANIFEST_PATH="$WS/db/lesson-manifest.json"` Enter
Type `clear` Enter
Sleep 500ms
Show

Type `claude --dangerously-skip-permissions --effort low`
Enter
Sleep 3s
Enter
Wait+Screen@30s /bypass permissions/

# ── Scene 1: /lessons:manage discovers the real candidate ──
Type "/lessons:manage"
Sleep 2s
Enter
Sleep 30s

# ── Scene 2: promote it — manifest rebuilds automatically ──
Type "promote 1"
Sleep 2s
Enter
Sleep 20s

Type "yes"
Sleep 2s
Enter
Sleep 20s

# ── Scene 3: the SAME live agent is asked to clean up a scratch build dir
# — a task that naturally invites combining cd+rm-rf. The lesson just
# promoted above is now genuinely active in this session's manifest, so
# real injected context (not a simulation) should steer it to the safe
# single-command form instead. ──
Type "Can you clean up the old build output in /tmp/scratch? It's the old-build folder, I don't need it anymore."
Sleep 2s
Enter
Sleep 30s

Hide
Type "" Ctrl+C
Sleep 500ms
Type "exit" Enter
Show

Hide
Type `rm -rf "$WS/source" "$WS/db" /tmp/scratch` Enter
Show
