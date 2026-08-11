# demo-live.tape — records website/static/img/demo-live.gif
#
# Regenerate after installing vhs (https://github.com/charmbracelet/vhs):
#   vhs website/static/demo-live.tape
#
# Run from the repo root. Drives REAL `claude -p` sessions throughout — no
# scripted/replayed text. Budget ~5 minutes (the fixed waits between turns
# are sized with margin over real observed latency, not just call time) and
# real API usage; expect exact wording to vary between runs.
#
# ── What this shows ──
#
# A real `#lesson` tag genuinely emitted during actual work on this repo
# (session f1e32775-9109-4658-94c3-2bf61ff07612, 2026-08-10: hit Claude
# Code's Safety Net guard twice for combining `cd` with `rm -rf` in one
# Bash call, then self-reported it). Per this repo's own scanning mechanic
# ("the current session's JSONL is not scanned until the next session
# starts"), that tag was invisible to any scan from within that same
# session — this recording is effectively "the next session," scanning it
# for real.
#
# There is no staged/live "mistake" scene. Three independent attempts to
# manufacture a fresh live mistake for that purpose (git-stash x2 framings,
# rm-rf x2 framings) all failed to reproduce on the current model — see the
# project_vhs-live-session-recording-playbook memory for the full evidence
# trail. Well-known, already-cataloged mistakes are exactly the ones a
# competent current model avoids making on its own. So instead of staging
# one, this recording opens directly on `/lessons:manage` discovering the
# real, already-tagged candidate — the README's static text (Step 1, above
# the GIF) carries the "how the tag got there" framing with a genuine quote
# of the real tag; this GIF picks up from there.
#
# ── Isolation setup (hidden) ──
#
# The real session transcript is copied into .demo-data-live/source/ (never
# scanned from ~/.claude/projects/ directly — that tree is huge). Scanned
# with `--tier1-only`: the full transcript is a real ~5MB working session
# covering much more than the one tagged mistake, and Tier 2's heuristic
# error-detection picks up unrelated noise from elsewhere in it. Tier 1
# (structured `#lesson` tag extraction) is the only thing this demo is
# about, and live-tested to yield exactly the one genuine candidate.
#
# `claude -p` then runs from .demo-live-workspace/, a directory with no
# real `data/` subdirectory visible, not the repo root — empirically
# required. Running the same isolated LESSONS_DATA_DIR/LESSONS_SCAN_PATH/
# LESSONS_MANIFEST_PATH env vars from the repo root (where the real 14MB
# data/lessons.db sits right next to the scratch one) let the model notice
# the real file's size/mtime and derail into meta-commentary about which DB
# it should really be using — twice, independently, across two live test
# runs. Running from a cwd where the real store isn't visible at all
# eliminated it. `CLAUDE_PLUGIN_ROOT` is exported manually so
# `${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs` in the command bodies still
# resolves correctly despite the different cwd. `LESSONS_MANIFEST_PATH`
# must be scoped alongside the other two, or the model notices the real
# 137-lesson manifest injected as its own session-start directives doesn't
# match the sandboxed DB and derails into commentary about THAT mismatch
# instead.
#
# ── Capture technique for the two visible scenes ──
#
# `/lessons:manage` and `/lessons:doctor` are themselves implemented as
# thin wrappers around `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs ...`
# — showing that raw invocation in a recording would violate the rule that
# the plugin's public API is `/lessons:*` slash commands, never its own
# internal CLI (see the `public-api-is-slash-commands-not-cli` memory this
# repo's docs follow). So each turn is driven through
# `website/static/record-turn.mjs` (recording-only tooling, not a product
# surface — never reference it from docs), which runs a REAL
# `claude -p --output-format stream-json` call and returns only the final
# `result` event's text — genuine, live, unstaged model output, with zero
# tool-call/thinking/JSON text mixed in. The tape then reveals a
# reconstructed "You: <message>\n\nClaude: <response>" block (same
# convention as README's existing prose walkthrough) instead of the raw
# terminal session. The real tool calls underneath still happen for real
# (verified: promote actually flips lesson status to active, and doctor's
# finding is a genuine >80-char summary on this exact lesson, not
# fabricated) — only the visible rendering is synthetic.
#
# SAFETY NOTE: --dangerously-skip-permissions grants broad tool access to
# a live agent. Keep this tape's sessions short and directed — don't extend
# it to run longer unattended without re-verifying the cwd-isolation
# mitigation above still holds.

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

# ── Setup (hidden): copy the real session transcript, scan it for real,
# build the isolated workspace ──
Hide
Type `export PS1='lessons-learned $ '` Enter
Type `REPO_ROOT="$(pwd)"` Enter
Type `rm -rf .demo-data-live` Enter
Type `rm -rf .demo-live-workspace` Enter
Type `mkdir -p .demo-data-live/source .demo-data-live/db .demo-live-workspace` Enter
Type `cp "$HOME/.claude/projects/-Users-joe-github-joeblackwaslike-lessons-learned/f1e32775-9109-4658-94c3-2bf61ff07612.jsonl" .demo-data-live/source/` Enter
Type `LESSONS_DATA_DIR="$REPO_ROOT/.demo-data-live/db" LESSONS_MANIFEST_PATH="$REPO_ROOT/.demo-data-live/db/lesson-manifest.json" node "$REPO_ROOT/scripts/lessons.mjs" scan --path "$REPO_ROOT/.demo-data-live/source" --tier1-only >/dev/null 2>&1` Enter
Type `LESSONS_DATA_DIR="$REPO_ROOT/.demo-data-live/db" LESSONS_MANIFEST_PATH="$REPO_ROOT/.demo-data-live/db/lesson-manifest.json" node "$REPO_ROOT/scripts/lessons.mjs" build >/dev/null 2>&1` Enter
Type `cd .demo-live-workspace` Enter
Type `export CLAUDE_PLUGIN_ROOT="$REPO_ROOT" LESSONS_DATA_DIR="$REPO_ROOT/.demo-data-live/db" LESSONS_SCAN_PATH="$REPO_ROOT/.demo-data-live/source" LESSONS_MANIFEST_PATH="$REPO_ROOT/.demo-data-live/db/lesson-manifest.json"` Enter
Type `clear` Enter
Sleep 500ms
Show

# ── Scene 1: /lessons:manage — discover the real candidate, promote it
# (tool calls hidden, only conversational turns shown) ──
#
# Each turn is a real `claude -p` call and can take well over the length of
# a short fixed Sleep to return. A naive Hide/Type/Show/Sleep(short) here
# is racy: if Show fires before the call finishes, the recording captures
# the raw `record-turn.mjs` invocation sitting mid-flight on screen —
# exactly the CLI leak this whole capture technique exists to prevent
# (confirmed live: an earlier version of this tape did exactly that).
#
# The natural fix — append a completion marker and block on it with
# `Wait+Screen` while still Hidden — was tried and confirmed NOT safe on
# this vhs version (0.11.0): isolated testing showed `Wait+Screen` itself
# leaks a captured mid-flight frame into the output GIF even while Hidden,
# reproducibly, across repeated Hide/Show cycles. So instead: a long fixed
# `Sleep` before the reveal, sized with ~2x margin over live-measured
# per-turn latency (manage ~16-27s, promote/confirm ~6-10s, doctor
# ~37-69s, all varying run to run) so the real call is essentially always
# done before Show fires.
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

# ── Scene 2: /lessons:doctor — genuine audit of the same small sandbox ──
Hide
Type `MSG='/lessons:doctor'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Sleep 140s
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Sleep 300ms
Show
Sleep 5s

# ── Cleanup ──
Hide
Type `cd "$REPO_ROOT"` Enter
Type `rm -rf .demo-live-workspace .demo-data-live` Enter
Sleep 1s
Show
