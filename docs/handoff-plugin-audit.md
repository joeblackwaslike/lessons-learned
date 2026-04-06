# Handoff: Plugin Structure Audit

## Context

This is the `lessons-learned` Claude Code plugin. It has been under active development and several structural decisions were made by reverse-engineering cached plugin files rather than consulting the official plugin development documentation. As a result, there are at least two known structural issues and potentially more.

## Known Issues to Fix

### 1. Skills in the wrong location

The plugin's skill file currently lives at:

```
skills/lessons-learned/SKILL.md        ← correct (just moved here)
.claude/skills/lessons-learned/         ← old location, may still exist
```

The canonical location per the plugin system is `skills/<skill-name>/SKILL.md` at the **plugin root** — not inside `.claude/`. This was discovered by reading cached plugin files from other installed plugins. The skill was previously at `.claude/skills/` and required a manual symlink to `~/.claude/skills/` to work at all. It has since been moved, but needs verification.

### 2. Plugin manifest in the wrong location

The manifest was originally at `.plugin/plugin.json`. The canonical location is `.claude-plugin/plugin.json`. Both files now exist — `.plugin/plugin.json` is the one currently wired into local `settings.json`, `.claude-plugin/plugin.json` is the new correct location. The old `.plugin/` location should likely be removed or confirmed obsolete.

### 3. Unknown unknowns

Development proceeded without consulting the official plugin structure specification. There may be additional issues with:

- Hook wiring format in `hooks/hooks.json`
- Command file location (`commands/` at root vs `.claude/commands/`)
- Agent definitions (none currently, but the pattern should be understood)
- `plugin.json` required/optional fields
- How `${CLAUDE_PLUGIN_ROOT}` should be used in hook commands
- Whether `.plugin/` has any role in the system at all

## Your Task

**Use the `plugin-dev@claude-plugins-official` plugin to perform a full structural audit of this repository.**

Start by invoking all relevant skills from that plugin:

- `plugin-structure` — canonical directory layout, manifest spec, auto-discovery rules
- `hook-development` — hook wiring format, `hooks.json` spec, event types
- `command-development` — slash command format, frontmatter fields, allowed-tools
- `skill-development` — skill file format, frontmatter, `<when_to_use>` conventions
- `plugin-settings` — settings.json integration, env vars, permissions

Then audit every component of this repo against those specifications:

### Audit checklist

**Manifest**

- [ ] `.claude-plugin/plugin.json` exists and is valid JSON
- [ ] All required fields present
- [ ] No unknown/invalid fields
- [ ] `.plugin/plugin.json` — determine if this location is used by the system or can be deleted

**Skills**

- [ ] `skills/lessons-learned/SKILL.md` — correct location confirmed
- [ ] Frontmatter fields (`name`, `version`, `description`) match spec
- [ ] `<when_to_use>` block present and correctly formatted
- [ ] No other skill files in wrong locations

**Commands**

- [ ] Current location: `.claude/commands/lessons/` — verify this is correct vs `commands/` at root
- [ ] Each command file has valid frontmatter (`description`, `allowed-tools`)
- [ ] `allowed-tools` values are valid tool names
- [ ] Files: `add.md`, `review.md`, `manage.md`, `config.md`

**Hooks**

- [ ] `hooks/hooks.json` — format matches spec
- [ ] Hook commands use `${CLAUDE_PLUGIN_ROOT}` correctly (or absolute paths — verify which is preferred)
- [ ] Event names are valid (`SessionStart`, `PreToolUse`, `SubagentStart`, etc.)
- [ ] Matcher patterns are valid

**General**

- [ ] No files in locations that will be silently ignored by the plugin system
- [ ] `package.json` — any plugin-relevant fields needed?
- [ ] README accurately describes installation

## Repo Layout (current)

```
lessons-learned/
├── .claude-plugin/
│   └── plugin.json              ← new canonical location
├── .plugin/
│   └── plugin.json              ← old location, wired into local settings.json
├── .claude/
│   └── commands/
│       └── lessons/
│           ├── add.md
│           ├── review.md
│           ├── manage.md
│           └── config.md
├── skills/
│   └── lessons-learned/
│       └── SKILL.md
├── hooks/
│   ├── hooks.json
│   ├── pretooluse-lesson-inject.mjs
│   ├── session-start-lesson-protocol.mjs
│   ├── session-start-reset.mjs
│   ├── session-start-scan.mjs
│   ├── subagent-start-lesson-protocol.mjs
│   └── lib/
├── scripts/
│   ├── lessons.mjs              ← main CLI
│   ├── db.mjs                   ← SQLite DAL
│   ├── migrate-db.mjs
│   └── scanner/
├── data/
│   ├── lessons.db
│   ├── lesson-manifest.json
│   ├── config.json
│   └── review-sessions/
├── tests/
├── schemas/
├── commands/                    ← old command location (pre-slash-command era)
│   ├── add-lesson.md
│   └── scan-lessons.md
└── package.json
```

## Goal

Produce a prioritized list of issues found, what the correct state should be, and make all fixes needed to bring the plugin into full compliance with the official plugin structure specification. After fixing, verify the plugin would load correctly if installed from a marketplace.
