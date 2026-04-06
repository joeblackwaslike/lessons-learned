# Tag Reference

Tags use `category:value` format and are attached to lessons to enable filtering, scoring, and future skill aggregation.

---

## Format

```
category:value
```

- All lowercase
- Letters, digits, dots, underscores, and hyphens in value
- Validated by schema pattern: `^[a-z]+:[a-z0-9._-]+$`

Multiple tags are a JSON array:

```json
"tags": ["lang:python", "tool:pytest", "severity:hang"]
```

---

## Established categories

### `lang` — Programming language

| Tag               | When to use                                                         |
| ----------------- | ------------------------------------------------------------------- |
| `lang:python`     | Python-specific mistakes (pytest, pip, venv, import paths)          |
| `lang:typescript` | TypeScript mistakes (type assertions, declaration files, tsc flags) |
| `lang:javascript` | JavaScript mistakes (ESM vs CJS, Promise, async/await)              |
| `lang:go`         | Go mistakes (module paths, goroutine patterns)                      |
| `lang:rust`       | Rust mistakes (borrow checker, cargo, lifetime)                     |
| `lang:shell`      | Shell/bash mistakes (quoting, redirects, expansions)                |

---

### `tool` — Tool or command

| Tag               | When to use                                      |
| ----------------- | ------------------------------------------------ |
| `tool:pytest`     | pytest flags, configuration, TTY issues          |
| `tool:git`        | git stash, commit, rebase, merge edge cases      |
| `tool:npm`        | npm install, link, peer deps, scripts            |
| `tool:docker`     | Dockerfile, docker-compose, container networking |
| `tool:vim`        | Vim commands and editor behavior                 |
| `tool:curl`       | curl flags, SSL, auth                            |
| `tool:jq`         | jq syntax and filter patterns                    |
| `tool:make`       | Makefile syntax and PHONY targets                |
| `tool:pre-commit` | Pre-commit hook failures and fixes               |
| `tool:biome`      | Biome formatter/linter config                    |
| `tool:eslint`     | ESLint rules and config migration                |

---

### `severity` — Impact level

| Tag                       | When to use                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `severity:hang`           | Process hangs waiting for input (TTY detection, stdin)        |
| `severity:data-loss`      | Silent data loss (files dropped, overwritten without warning) |
| `severity:silent-failure` | Command exits 0 but doesn't do what it claims                 |
| `severity:error`          | Command exits non-zero with a diagnostic                      |

Severity tags affect candidate scoring:

- `severity:hang` and `severity:data-loss` each add `+1` to initial priority
- Use `severity:hang` sparingly — it marks lessons that should potentially have `block: true`

---

### `topic` — Subject area

| Tag                 | When to use                                          |
| ------------------- | ---------------------------------------------------- |
| `topic:testing`     | Test configuration, mocking patterns, test isolation |
| `topic:auth`        | Authentication, tokens, session handling             |
| `topic:networking`  | TCP, HTTP, WebSocket, port binding                   |
| `topic:types`       | Type system, generics, type guards                   |
| `topic:agents`      | AI agent tool availability, subagent patterns        |
| `topic:imports`     | Module resolution, import paths, circular deps       |
| `topic:async`       | Async/await, Promise, event loop                     |
| `topic:ci`          | CI pipeline, GitHub Actions, environment differences |
| `topic:performance` | Memory, CPU, profiling                               |

---

### `platform` — Runtime environment

| Tag               | When to use                                      |
| ----------------- | ------------------------------------------------ |
| `platform:macos`  | macOS-specific differences (BSD tools, Homebrew) |
| `platform:linux`  | Linux-specific differences (GNU tools, systemd)  |
| `platform:wsl`    | Windows Subsystem for Linux edge cases           |
| `platform:docker` | Docker container environment differences         |

---

### `candidate` — Aggregation hints

| Tag                              | When to use                                       |
| -------------------------------- | ------------------------------------------------- |
| `candidate:node-gotchas-skill`   | Candidate for a future Node.js gotchas skill file |
| `candidate:python-testing-skill` | Candidate for a Python testing skill file         |

The `candidate:` category is for tracking lessons that could be aggregated into a skill file in the future. It has no effect on injection.

---

## Multi-tag examples

```json
// Python test isolation
"tags": ["lang:python", "tool:pytest", "topic:testing"]

// Git data loss
"tags": ["tool:git", "severity:data-loss"]

// macOS-specific Chrome debugging
"tags": ["tool:chrome", "platform:macos", "topic:networking", "severity:error"]

// Cross-platform CI difference
"tags": ["topic:ci", "platform:linux", "lang:shell"]
```

---

## Adding new tags

New tags can be used freely — the schema validates format (`category:value`) but not the specific values. Prefer extending established categories over inventing new ones. If you add a new category, document it here.
