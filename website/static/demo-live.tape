# demo-live.tape — records website/static/img/demo-live.gif
#
# ⚠ WIP, NOT YET WORKING END-TO-END. Scene 1 below (the staged
# .demo-live-repo mistake) is confirmed broken and pending a rewrite — see
# "Part 3 REVISED" in /Users/joe/.claude/plans/handoff-live-e2e-bright-marble.md
# and the project_vhs-live-session-recording-playbook memory for why (3
# independent live scenarios all failed to make the model self-attribute a
# taggable mistake). Scenes 2-4 (the /lessons:manage + /lessons:doctor
# flow via record-turn.mjs) ARE validated and working — only the source of
# scene 1's transcript needs to change, from this staged scaffold to a
# real session transcript. Do not run this tape expecting scene 1 to
# succeed until that rewrite lands.
#
# Regenerate after installing vhs (https://github.com/charmbracelet/vhs):
#   vhs website/static/demo-live.tape
#
# Run from the repo root. Drives REAL `claude` sessions throughout — no
# scripted/replayed text. Budget several minutes and real API usage;
# expect exact wording to vary between runs.
#
# Four scenes, two different capture techniques:
#
# Scene 1 (mistake -> #lesson tag): a real INTERACTIVE `claude
# --dangerously-skip-permissions` session in a scratch git repo
# (.demo-live-repo/, rebuilt deterministically below — a real bare `git
# stash` has already dropped an untracked file). Tool calls (git status,
# git stash list, etc.) are shown normally — that's the agent doing
# legitimate work on the user's own repo, not the plugin's internal CLI,
# so there's no reason to hide it. `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`
# is required or the session's transcript is never written to disk, which
# silently breaks scene 2 (nothing to scan).
#
# Scenes 2-3 (/lessons:manage scan+promote, /lessons:doctor): these
# commands are themselves implemented as thin wrappers around
# `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs ...` — showing that raw
# invocation in a recording would violate the rule that the plugin's
# public API is `/lessons:*` slash commands, never its own internal CLI
# (see the `public-api-is-slash-commands-not-cli` memory/decision this
# repo's docs follow). So these scenes are captured differently: each turn
# is driven through `website/static/record-turn.mjs` (recording-only
# tooling, not a product surface — never reference it from docs), which
# runs a REAL `claude -p --output-format stream-json` call and returns only
# the final `result` event's text — genuine, live, unstaged model output,
# with zero tool-call/thinking/JSON text mixed in. The tape then reveals a
# reconstructed "You: <message>\n\nClaude: <response>" block (same
# convention as README's existing prose walkthrough) instead of the raw
# terminal session. The real tool calls underneath still happen for real
# (verified: promote actually flips lesson status to active) — only the
# visible rendering is synthetic.
#
# Isolation for scenes 2-3: `claude -p` runs from .demo-live-workspace/, a
# directory with NO real data/ subdirectory visible, not the repo root.
# This was empirically required, not optional: running the same isolated
# LESSONS_DATA_DIR/LESSONS_SCAN_PATH/LESSONS_MANIFEST_PATH env vars from
# the repo root (where the real 14MB data/lessons.db sits right next to
# the scratch one) still let the model notice the real file's size/mtime
# and derail into meta-commentary about which DB it should really be using
# — twice, independently, across two live test runs. Running from a cwd
# where the real store isn't visible at all eliminated it in a third live
# test (confirmed clean 4-turn chain: manage scan -> promote -> confirm ->
# doctor). `CLAUDE_PLUGIN_ROOT` is exported manually so
# `${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs` in the command bodies still
# resolves correctly despite the different cwd.
#
# Scene 3 deliberately audits the SAME small scratch sandbox from scene 2
# (just the one just-promoted lesson), not a copy of the real 137-lesson
# store — keeps the scene focused/coherent with the story just told, per
# explicit user direction. Whatever /lessons:doctor finds is genuine — no
# CLI-inserted synthetic lessons at any point. (Live-tested: this small,
# organic sandbox DID produce a real finding — a >80-char summary — so
# "clean audit" isn't guaranteed either way, but don't manufacture one if
# it comes back empty.)
#
# SAFETY NOTE: --dangerously-skip-permissions grants broad tool access to
# a live agent. Keep this tape's sessions short and directed — don't extend
# it to run longer unattended without re-verifying the cwd-isolation
# mitigation above still holds.

Require node
Require claude
Require git

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

# ── Setup: rebuild .demo-live-repo deterministically (bare `git stash`
# already run, tracked README.md change stashed, new-feature.txt left
# genuinely untracked — the real bug this scene investigates) ──
Hide
Type `export PS1='lessons-learned $ ' && rm -rf .demo-live-repo .demo-live-workspace && mkdir -p .demo-live-repo` Enter
Type `git -C .demo-live-repo init -q && git -C .demo-live-repo config user.email demo@example.com && git -C .demo-live-repo config user.name Demo` Enter
Type `printf '# demo project\n' > .demo-live-repo/README.md && git -C .demo-live-repo add README.md && git -C .demo-live-repo commit -q -m initial` Enter
Type `git -C .demo-live-repo checkout -q -b feature/new-thing` Enter
Type `printf '# demo project\nmore notes\n' > .demo-live-repo/README.md && printf 'new file content\n' > .demo-live-repo/new-feature.txt && git -C .demo-live-repo stash -q` Enter
Type `clear` Enter
Sleep 500ms
Show

# ── Scene 1: real interactive session, mistake investigation + #lesson tag ──
Type "cd .demo-live-repo" Enter
Type `export CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 && claude --dangerously-skip-permissions`
Enter
# .demo-live-repo is its own git root nested inside the outer repo, so
# Claude Code flags the outer repo's CLAUDE.md (which imports AGENTS.md)
# as an "external" import and asks to confirm before the permissions
# dialog even appears -- but ONLY the first time this absolute path is
# ever trusted; after that the decision persists and the dialog never
# reappears. vhs has no conditionals, so this can't be a Wait+Screen (it
# would hang forever once the path is already trusted). Instead: a blind
# Enter after a fixed pause. If the dialog is showing, this accepts its
# highlighted default ("Yes, allow external imports"). If it's not
# showing, this lands on the empty chat prompt, where Enter on empty
# input is a no-op.
Sleep 3s
Enter
Wait+Screen@30s /bypass permissions/

Type "I ran git stash before switching branches, but new-feature.txt is still sitting right here in my working tree instead of being tucked away like I expected -- what happened?"
Sleep 500ms
Enter
Wait+Screen@180s /#\/lesson/
Sleep 2s

Hide
Type "" Ctrl+C
Sleep 500ms
Type "exit" Enter
Type "cd .." Enter
Show

# ── Bridge (hidden): locate scene 1's own transcript dir, build an
# isolated scratch sandbox seeded from it ──
Hide
Type `REPO_ROOT="$(pwd)"` Enter
Type `DEMO_REPO_ABS="$(cd .demo-live-repo && pwd)"` Enter
Type `SCENE1_PROJECT_ID=$(printf '%s' "$DEMO_REPO_ABS" | sed 's#/#-#g; s/^-//')` Enter
Type `SCENE1_SCAN_PATH="$HOME/.claude/projects/$SCENE1_PROJECT_ID"` Enter
Type `mkdir -p .demo-live-workspace/.demo-data && cd .demo-live-workspace` Enter
Type `export CLAUDE_PLUGIN_ROOT="$REPO_ROOT" LESSONS_DATA_DIR=.demo-data LESSONS_SCAN_PATH="$SCENE1_SCAN_PATH" LESSONS_MANIFEST_PATH=.demo-data/lesson-manifest.json` Enter
Type `node "$REPO_ROOT/scripts/lessons.mjs" scan --path "$LESSONS_SCAN_PATH" >/dev/null 2>&1` Enter
Type `node "$REPO_ROOT/scripts/lessons.mjs" build >/dev/null 2>&1` Enter
Show

# ── Scene 2: /lessons:manage — scan, promote, confirm (tool calls hidden) ──
Hide
Type `MSG='/lessons:manage'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Show
Sleep 4s

Hide
Type `MSG='promote 1'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Show
Sleep 3s

Hide
Type `MSG='yes'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Show
Sleep 3s

# ── Scene 3: /lessons:doctor — genuine audit of the small scratch sandbox ──
Hide
Type `MSG='/lessons:doctor'` Enter
Type `RESPONSE=$(node "$REPO_ROOT/website/static/record-turn.mjs" --session-file .demo-session-id "$MSG")` Enter
Type `clear && printf 'You: %s\n\nClaude: %s\n' "$MSG" "$RESPONSE"` Enter
Show
Sleep 5s

# ── Cleanup ──
Hide
Type `cd "$REPO_ROOT" && rm -rf .demo-live-workspace .demo-live-repo` Enter
Show
