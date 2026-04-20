# lessons-learned task runner
# Run `just` to see all available recipes

set dotenv-load := false
set shell := ["zsh", "-cu"]

export NODE_NO_WARNINGS := "1"

# Show available recipes
default:
    @just --list

# ── Install ────────────────────────────────────────────────────────────────────

# Install all dependencies
install:
    npm ci

# Install docs dependencies
install-docs:
    pip install -r requirements-docs.txt

# Install everything (Node + docs)
install-all: install install-docs

# ── Development ────────────────────────────────────────────────────────────────

# Rebuild the lesson manifest from lessons.json
build:
    node scripts/lessons.mjs build

# Run the background scanner against session logs
scan:
    node scripts/lessons.mjs scan

# Run a full re-scan (resets byte offsets)
scan-full:
    node scripts/lessons.mjs scan --full

# Add a new lesson interactively
add:
    node scripts/lessons.mjs add

# List all lessons
list:
    node scripts/lessons.mjs list

# Show scan candidates
candidates:
    node scripts/lessons.mjs scan candidates

# Review Tier 2 heuristic candidates
review:
    node scripts/lessons.mjs review

# Show current configuration
config:
    node scripts/lessons.mjs config

# ── Quality Gates ──────────────────────────────────────────────────────────────

# Run ESLint
lint:
    npm run lint

# Run ESLint with auto-fix
lint-fix:
    npm run lint:fix

# Run Prettier check
fmt-check:
    npm run format:check

# Run Prettier write
fmt:
    npm run format

# Run TypeScript check
typecheck:
    npm run typecheck

# Run all quality gates (lint + typecheck + format check)
check: lint typecheck fmt-check

# ── Tests ──────────────────────────────────────────────────────────────────────

# Run all tests
test:
    node --test 'tests/**/*.test.mjs'

# Run unit tests only (fast, no I/O)
test-unit:
    node --test 'tests/unit/**/*.test.mjs'

# Run integration tests
test-integration:
    node --test 'tests/integration/**/*.test.mjs'

# Run E2E / cross-agent tests
test-e2e:
    node --test 'tests/e2e/**/*.test.mjs'

# Run tests with coverage report
test-coverage:
    node --test --experimental-test-coverage 'tests/**/*.test.mjs'

# Run unit tests for a specific module (e.g. just test-watch core/match)
test-filter pattern:
    node --test --test-name-pattern '{{pattern}}' 'tests/**/*.test.mjs'

# ── Docs ───────────────────────────────────────────────────────────────────────

# Serve docs locally with live reload
docs:
    mkdocs serve

# Build docs (strict — fails on warnings)
docs-build:
    mkdocs build -s

# Deploy docs to GitHub Pages
docs-deploy:
    mkdocs gh-deploy --force

# ── CI ─────────────────────────────────────────────────────────────────────────

# Full CI pipeline: install → check → test
ci: install check test

# Full CI pipeline including docs validation
ci-full: install check test install-docs docs-build

# ── Hook Testing ───────────────────────────────────────────────────────────────
# NOTE: Run these from your terminal directly — not through Claude Code.
# Claude Code's own PreToolUse hooks fire on the Bash commands below, which
# means a blocking lesson will stop the test before the hook script runs.
# These work correctly when invoked outside any agent session.

# Test the injection hook — shows block output for pytest without required flags
test-hook-pytest:
    @printf '%s' '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"},"session_id":"test","cwd":"'"$(pwd)"'"}' \
        | node hooks/pretooluse-lesson-inject.mjs

# Test the injection hook — shows empty output when fix flags are already present
test-hook-pytest-fixed:
    @printf '%s' '{"tool_name":"Bash","tool_input":{"command":"pytest --no-header -p no:faulthandler tests/"},"session_id":"test","cwd":"'"$(pwd)"'"}' \
        | node hooks/pretooluse-lesson-inject.mjs

# Test the injection hook with a custom command (e.g.: just test-hook "git stash")
test-hook cmd:
    @printf '%s' '{"tool_name":"Bash","tool_input":{"command":"{{cmd}}"},"session_id":"test","cwd":"'"$(pwd)"'"}' \
        | node hooks/pretooluse-lesson-inject.mjs

# Test injection hook with Gemini platform normalization
test-hook-gemini cmd:
    @printf '%s' '{"tool_name":"run_shell_command","tool_input":{"command":"{{cmd}}"},"session_id":"test"}' \
        | LESSONS_AGENT_PLATFORM=gemini node hooks/pretooluse-lesson-inject.mjs

# Test injection hook with Codex platform normalization
test-hook-codex cmd:
    @printf '%s' '{"tool_name":"shell","tool_input":{"command":"{{cmd}}"},"session_id":"test"}' \
        | LESSONS_AGENT_PLATFORM=codex node hooks/pretooluse-lesson-inject.mjs

# ── Maintenance ────────────────────────────────────────────────────────────────

# Rebuild manifest and run all tests (after editing lessons.json)
refresh: build test

# Clean generated files
clean:
    rm -f data/lesson-manifest.json data/scan-state.json data/cross-project-candidates.json
    rm -rf site/

# Reset scan state (forces full re-scan next session startup)
reset-scan:
    rm -f data/scan-state.json

# Show manifest stats (lesson count, last built)
manifest-stats:
    @node -e " \
        const m = JSON.parse(require('fs').readFileSync('data/lesson-manifest.json','utf8')); \
        const count = Object.keys(m.lessons).length; \
        console.log('Lessons in manifest: ' + count); \
        console.log('Built at: ' + m.generatedAt); \
    "
