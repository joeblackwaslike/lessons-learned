#!/bin/bash
# Daily snapshot of data/lessons.db, run by the
# ai.joeblackwaslike.lessons-learned.backup LaunchAgent. See AGENTS.md's
# "Lesson store" section and website/docs/architecture/data-model.md.
set -euo pipefail

REPO_DIR="/Users/joe/github/joeblackwaslike/lessons-learned"
cd "$REPO_DIR"
exec /opt/homebrew/bin/node scripts/lessons.mjs backup
