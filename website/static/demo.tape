# demo.tape — records website/static/img/demo.gif
#
# Regenerate after installing vhs (https://github.com/charmbracelet/vhs):
#   vhs website/static/demo.tape
#
# Run from the repo root. Uses the real CLI end-to-end against a scratch
# LESSONS_DATA_DIR (.demo-data/, gitignored) — never touches data/lessons.db.
# The session log is a real fixture at website/static/demo/session.jsonl.

Require node
Require jq

Output website/static/img/demo.gif

Set Shell "bash"
Set FontSize 16
Set FontFamily "Menlo"
Set Width 1180
Set Height 660
Set Padding 24
Set BorderRadius 10
Set WindowBar Colorful
Set TypingSpeed 20ms
Set Theme {"name":"lessons-learned","black":"#0d1117","red":"#f85149","green":"#2ea44f","yellow":"#d29922","blue":"#58a6ff","purple":"#bc8cff","cyan":"#39c5cf","white":"#c9d1d9","brightBlack":"#6e7681","brightRed":"#ff7b72","brightGreen":"#3fb950","brightYellow":"#e3b341","brightBlue":"#79c0ff","brightPurple":"#d2a8ff","brightCyan":"#56d4dd","brightWhite":"#f0f6fc","background":"#0d1117","foreground":"#c9d1d9","cursor":"#2ea44f","selection":"#264f78"}

Hide
Type "export PS1='lessons-learned $ ' && rm -rf .demo-data && mkdir -p .demo-data && clear" Enter
Sleep 500ms
Show

Type "# 1. Claude reports a mistake as a #lesson tag in the session log" Enter
Sleep 800ms
Type "LESSONS_DATA_DIR=.demo-data node scripts/lessons.mjs scan --path website/static/demo --verbose"
Sleep 500ms
Enter
Sleep 3800ms

Type "clear" Enter
Type "# 2. Review the candidate against intake validation rules" Enter
Sleep 800ms
Type "LESSONS_DATA_DIR=.demo-data node scripts/lessons.mjs review"
Sleep 500ms
Enter
Sleep 3200ms

Type "clear" Enter
Type "# 3. Promote it — the manifest rebuilds automatically" Enter
Sleep 800ms
Type@12ms `LESSONS_DATA_DIR=.demo-data node scripts/lessons.mjs promote --ids "$(LESSONS_DATA_DIR=.demo-data node scripts/lessons.mjs scan aggregate | jq -r '.candidates[0].id')"`
Sleep 500ms
Enter
Sleep 2600ms

Type "clear" Enter
Type "# 4. Next session: Claude is about to run git stash again..." Enter
Sleep 800ms
Type@12ms `echo '{"tool_name":"Bash","tool_input":{"command":"git stash"},"session_id":"demo","cwd":"/Users/you/lessons-learned"}' | LESSONS_MANIFEST_PATH=.demo-data/lesson-manifest.json node hooks/pretooluse-lesson-inject.mjs | jq -r '.hookSpecificOutput.additionalContext'`
Sleep 500ms
Enter
Sleep 5500ms

Hide
Type "rm -rf .demo-data" Enter
Show
