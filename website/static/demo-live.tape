# demo-live.tape — records website/static/img/demo-live.gif
#
# Regenerate after installing vhs (https://github.com/charmbracelet/vhs):
#   vhs website/static/demo-live.tape
#
# Unlike demo.tape (which replays the plain CLI in a plain shell — vhs can't
# script an LLM's exact wording), this one drives a REAL interactive `claude`
# session and captures genuine, unstaged model output. That makes it slower,
# non-reproducible byte-for-byte, and non-free (real API usage) to re-record —
# budget several minutes and expect the exact wording to vary between runs.
#
# Run from the repo root. Uses LESSONS_DATA_DIR + LESSONS_SCAN_PATH (both
# read by scripts/lessons.mjs) to sandbox the whole session against a scratch
# DB seeded from the same real fixture as demo.tape — never data/lessons.db.
#
# Why --dangerously-skip-permissions: this is the one place recording
# necessarily grants broad tool access to a live agent. SAFETY NOTE learned
# the hard way while building this: a long enough session can notice the
# scratch DB's tiny candidate count looks "wrong" and — entirely on its own
# initiative — run `env -u LESSONS_DATA_DIR -u LESSONS_SCAN_PATH ...` to
# "fix" it, which repoints every subsequent command at the REAL, live
# data/lessons.db. It only ever got as far as reading real data before this
# tape's recording stops, never writing, but do not extend this tape to run
# longer unattended without re-verifying that isolation holds throughout.
#
# Wait+Screen (not fixed Sleep) blocks on real terminal content appearing,
# since real inference time varies run to run.

Require node
Require claude

Output website/static/img/demo-live.gif

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

Hide
Type "export PS1='lessons-learned $ ' && rm -rf .demo-data-live && mkdir -p .demo-data-live && LESSONS_DATA_DIR=.demo-data-live node scripts/lessons.mjs scan --path website/static/demo >/dev/null 2>&1 && clear" Enter
Sleep 1s
Show

Type "export LESSONS_DATA_DIR=.demo-data-live && export LESSONS_SCAN_PATH=website/static/demo && claude --dangerously-skip-permissions"
Enter
Wait+Screen@30s /bypass permissions/

Type "/lessons:manage"
Sleep 500ms
Enter
Wait+Screen@300s /Active:/
Wait+Screen@60s /would you like to do/
Sleep 3s

Hide
Type "" Ctrl+C
Sleep 500ms
Type "exit" Enter
Show
Sleep 500ms

Hide
Type "rm -rf .demo-data-live" Enter
Show
