# Real-World Demand: Cross-Session Learning for AI Agents

This document collects real-world issues, discussions, and user reports demonstrating demand for the kind of capability `lessons-learned` provides. Collecting these early ensures we incorporate diverse perspectives from the beginning rather than building in isolation.

---

## Open Issues

### obra/superpowers#907 — "Add a canonical 'learnings' section so Superpowers improves over time"

- **URL**: https://github.com/obra/superpowers/issues/907
- **State**: Open
- **Labels**: `enhancement`
- **Core problem**: "Project- and team-specific knowledge still lives scattered in CLAUDE.md, ad-hoc notes, or nowhere at all. After a session I often have durable lessons that don't belong in a single skill file but should shape future runs."
- **Key quote**: "Without that, the same mistakes and rediscoveries repeat; skills stay static while reality drifts."
- **Proposed**: Canonical `learnings/` directory, small "how to use learnings" contract, optional hooks for capture
- **Relevance**: Directly validates our core thesis — lessons must be structured, discoverable, and automatically loaded. Their proposal is file-based/manual; ours automates the capture and injection pipeline.
- **What we can learn**: The emphasis on human-auditability and deprecation of stale entries. Our `needsReview` flag and confidence scoring address this.

### obra/superpowers#601 — "Accumulate learnings across tasks and feed to subsequent subagents"

- **URL**: https://github.com/obra/superpowers/issues/601
- **State**: Open
- **Core problem**: "Each subagent starts completely fresh. Knowledge discovered during one task is invisible to subsequent subagents in the same plan execution. They rediscover the same issues independently."
- **Relevance**: Validates our 3-layer dedup system and SubagentStart hook. The `O_EXCL` claim directory specifically solves the cross-subagent knowledge sharing problem — lessons injected for one subagent are visible to the next.
- **What we can learn**: The intra-session (within a plan execution) focus is different from our cross-session focus. Both matter. Our system handles cross-session by default; the dedup layers handle intra-session.

### obra/superpowers#551 — "Add a core project memory system for cross-session retrieval and recording"

- **URL**: https://github.com/obra/superpowers/issues/551
- **State**: Open
- **Core problem**: "New sessions repeat work because they do not know what was already tried or decided. The current workflow has no general-purpose way for agents to recover small, relevant pieces of prior project history."
- **Relevance**: Validates cross-session persistence. This issue asks for a broader "project memory" — our plugin is a specialized, high-value subset focused on mistake patterns (the highest-ROI category of project memory).
- **What we can learn**: The distinction between "memory" (broad, everything) and "lessons" (specific, mistakes). Our narrower scope is a feature: it's tractable to automate and has a clear injection trigger (tool calls that match mistake patterns).

---

## Themes Across Demand Signals

| Theme                                 | Issues           | Our Approach                                                                 |
| ------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| Same mistakes repeat across sessions  | #907, #551       | Core thesis — automatic injection via PreToolUse hook                        |
| Subagents don't share discoveries     | #601             | 3-layer dedup with O_EXCL claims; SubagentStart protocol injection           |
| Knowledge scattered / hard to find    | #907, #551       | Structured store with manifest; pattern-matched injection (no manual lookup) |
| Human auditability needed             | #907             | `needsReview` flag, `/scan-lessons` command, confidence scoring              |
| Stale knowledge accumulates           | #907             | Content-hash dedup, confidence decay, CLI intelligence aggregation           |
| Should work across different AI tools | #907, #551, #601 | Agent-agnostic core with thin adapter layers (V2)                            |

---

## Key Design Tension: Project-Specific vs. Generalized Lessons

The demand signals reveal two distinct user expectations:

| Type                 | Example                                                | Scope                   | Source                             |
| -------------------- | ------------------------------------------------------ | ----------------------- | ---------------------------------- |
| **Generalized**      | "pytest hangs in non-interactive envs"                 | All projects, all users | #907 (partially), our seed lessons |
| **Project-specific** | "our CI uses custom runner X", "don't run migration Y" | Single repo or team     | #907, #551 primarily               |
| **Intra-session**    | "subagent A discovered this codebase quirk"            | Single session/plan     | #601 primarily                     |

Our current implementation treats all lessons as global. But #907 and #551 specifically call out **project- and team-specific knowledge** as the primary pain point. This suggests:

1. **Both scopes matter** — generalized lessons prevent universal pitfalls; project-specific lessons prevent repo-specific rediscovery
2. **Storage may need to diverge** — global lessons in the plugin's data dir, project lessons in the repo (e.g., `.lessons/`)
3. **Injection should merge both** — the hook reads global manifest + local project manifest, with project-specific lessons getting a priority boost
4. **The scanner sees both** — generalized patterns recur across projects; project patterns recur within the same project's sessions

This is captured as Open Question #17 in the PRD.

---

## How to Add Entries

When you find a new issue, discussion, or user report that demonstrates demand for cross-session learning:

1. Add a new `###` section with the source reference
2. Include: URL, state, core problem quote, relevance to our system, what we can learn
3. Update the Themes table if the entry introduces a new theme

Good sources to watch:

- `obra/superpowers` issues (the primary Claude Code skills ecosystem)
- `anthropics/claude-code` issues and discussions
- Hacker News threads on AI coding assistants
- Reddit r/ClaudeAI, r/LocalLLaMA
- Twitter/X threads from AI agent developers
