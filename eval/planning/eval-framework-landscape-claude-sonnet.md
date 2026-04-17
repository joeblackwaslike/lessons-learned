# LLM Eval Framework Landscape

**Purpose:** Research summary for selecting an eval stack for an agentic coding assistant plugin. Covers available open-source frameworks, tradeoffs, and recommended combinations. Independent of any specific project.

**Last updated:** 2026-04-11

---

## The Eval Problem Space

LLM evals split into two fundamental categories:

**Static evals** — fixed dataset, fixed prompt, measure output quality against a rubric. Well-understood, cheap, fast. Suitable for regression detection on text generation tasks.

**Agentic evals** — the model takes multi-step actions (tool calls, code execution, session-length reasoning). Output quality cannot be assessed from a single response. Requires running the agent to completion and grading the deliverable.

For coding agents specifically, agentic evals further split by what they measure:

- **Process evals:** Did the agent exhibit the correct behavior? (Did it ask clarifying questions? Did it use the right tool?)
- **Outcome evals:** Did the agent produce a working, high-quality artifact? (Does the code build? Does it pass tests? Is it better than what a naive agent would produce?)

Process evals are necessary but not sufficient. An agent can follow every correct process step and still produce broken code. Outcome evals are the ground truth.

---

## Framework Inventory

### Inspect AI (UK AISI)

**Repo:** `github.com/UKGovernmentBEIS/inspect_ai` | **PyPI:** `inspect-ai` | **License:** MIT | **Language:** Python

The most complete open-source eval framework for agentic LLM evaluation. Created by the UK AI Security Institute; adopted for production eval infra by Anthropic, DeepMind, and other frontier labs.

**Core primitives:** `Dataset → Task → Solver → Scorer`. Composable and declarative. Each stage is independently swappable.

**Strengths:**
- Multi-turn agentic evals with tool use out of the box
- Built-in Docker/Kubernetes sandboxing for running untrusted model code safely
- `model_graded_qa()` and `model_graded_fact()` scorers — LLM-as-judge with configurable rubrics
- Supports running arbitrary external agents (Claude Code, Codex CLI, Gemini CLI) as eval targets
- Inspect View: web-based log viewer for inspecting transcripts, scores, per-step traces, and costs
- VS Code extension for authoring and debugging evals
- Exports Inspect-compatible JSON — interoperable with Bloom (see below)
- Async architecture: runs dozens of evals in parallel on a single node
- Bootstrap confidence intervals and pass/fail gates built into the scoring library
- 100+ pre-built evaluation tasks in `inspect_evals` companion repo

**Weaknesses:**
- Learning curve: the `Solver` abstraction takes time to internalize
- Overkill for simple text-in/text-out scoring tasks
- Agent evals with Docker sandboxing can be slow and expensive at scale

**Best for:** Teams treating evals as production infrastructure — agents with tools, sandboxed code execution, multi-provider scoring, auditability requirements.

---

### Anthropic Bloom

**Repo:** `github.com/safety-research/bloom` | **License:** MIT | **Language:** Python

An agentic framework for **generating** behavioral evaluation suites, not running them. Bloom takes a behavior description (a "seed") and produces a diverse set of evaluation scenarios designed to elicit that behavior. It does not score results itself — it feeds into a downstream harness.

**Pipeline:** Understanding → Ideation → Rollout → Judgment (four sequential LLM agents)

**Strengths:**
- Produces fresh, diverse scenarios on every run — avoids benchmark overfitting
- Exports Inspect-compatible transcripts — composes directly with Inspect AI
- LiteLLM backend — supports Anthropic, OpenAI, OpenRouter, AWS Bedrock
- Weights & Biases integration for large sweeps
- Validated: Spearman correlation of 0.86 between Bloom's judge (Claude Opus) and human labels on 40 transcripts

**Weaknesses:**
- Not a full eval harness — no scoring, no reporting, no CI integration
- Designed for behavioral/alignment evals; scenario generation quality depends heavily on seed quality
- Adds a pipeline stage (scenario generation) that must be managed separately from eval runs

**Best for:** Generating diverse scenario sets for a known failure mode or behavior pattern. Use as a data factory feeding into Inspect AI or another harness, not as a standalone eval tool.

---

### DeepEval (Confident AI)

**Repo:** `github.com/confident-ai/deepeval` | **PyPI:** `deepeval` | **License:** Apache 2.0 | **Language:** Python

A pytest-native LLM eval framework with 50+ built-in metrics. Designed for engineering teams who want eval-as-code in CI.

**Strengths:**
- Native `pytest` integration — drop into existing CI pipelines with no new tooling
- 50+ built-in metrics: G-Eval, faithfulness, hallucination, answer relevancy, task completion, conversational evaluation
- Synthetic dataset generation via evolution techniques
- `@observe` decorator for component-level eval (individual function calls, retrievers, tool invocations)
- Multi-modal support for image-based test cases
- Confident AI cloud platform (optional) for dataset management and experiment tracking

**Weaknesses:**
- Primitives are RAG/chatbot-centric — fighting the abstraction to express agentic, tool-call-scoped evals
- No built-in Docker sandboxing
- LLM judge calls scale linearly with dataset size; can be expensive on large suites
- Cloud platform required for collaboration and experiment tracking (core framework is open-source)

**Best for:** Engineering teams with existing pytest workflows evaluating RAG pipelines, chatbots, or text generation tasks. Not the right fit for agentic coding evals that require sandboxed execution and artifact grading.

---

### Vercel agent-eval

**Repo:** `github.com/vercel-labs/agent-eval` | **npm:** `@vercel/agent-eval` | **Language:** TypeScript/Node

A CLI framework for running controlled experiments against AI agents. Designed by Vercel for measuring whether their documentation, MCP servers, or API changes improve agent task completion rates.

**Strengths:**
- Clean experiment file structure: `experiments/*.ts`, each defining a task + test suite
- Parallel execution across experiments
- LLM-based failure classifier (Claude Sonnet via Vercel AI Gateway) — distinguishes model failures from infrastructure failures (rate limits, timeouts)
- Web-based results playground viewer with live-reload (`--watch`)
- Auto-retry on non-model failures

**Weaknesses:**
- TypeScript/Node only — Python teams need to reimplement or wrap
- Tightly coupled to Vercel's sandbox and AI Gateway — blocks local-first use without Vercel account
- No built-in LLM judge for output quality — only pass/fail based on test assertions
- No scenario generation, no multi-arm comparison, no caching

**Best for:** Teams building TypeScript-native agents on Vercel infrastructure who want to measure agent task completion rates as documentation or API changes. Useful as an **architectural reference** for experiment file structure and results viewer design; not suitable as a direct dependency for Python-native projects.

---

### evalite

**Repo/npm:** `evalite` | **License:** MIT | **Language:** TypeScript (Vitest-based)

A lightweight Vitest extension for LLM evals. Minimal footprint — wraps Vitest's test runner with eval-specific output and a simple results UI.

**Strengths:**
- Zero learning curve for teams already using Vitest
- Integrates cleanly with Vercel AI SDK
- Simple, un-opinionated — bring your own judge logic

**Weaknesses:**
- No built-in judge, no reporting, no scenario generation, no sandboxing
- TypeScript only
- Minimal — appropriate for simple evals, insufficient for agentic multi-turn evals

**Best for:** TypeScript projects already using Vitest that need basic eval scoring alongside their test suite.

---

### Braintrust

**Type:** Commercial SaaS (open SDK) | **Language:** TypeScript + Python SDKs

A managed platform for the full eval lifecycle: dataset management, scoring, experiment tracking, production monitoring, CI integration.

**Strengths:**
- End-to-end platform — covers everything from dataset curation to production regression alerting
- GitHub Action integration: posts per-test regression diffs to PRs
- "Loop" AI assistant generates scorers, datasets, and prompt variants from plain-language descriptions
- Strong UX for non-engineers (PMs, researchers) to review eval results

**Weaknesses:**
- Closed source — limited customizability of evaluation logic
- Per-seat pricing for team features
- Experiment tracking requires cloud dependency
- Agent tracing depth is limited — multi-step tool call sequences require external instrumentation

**Best for:** Product teams that want a managed platform and are willing to accept cloud dependency and pricing. Not appropriate for projects requiring full open-source control or local-first operation.

---

## Comparison Matrix

| Framework | Language | Agentic support | Sandboxing | LLM judge | Scenario gen | CI-ready | Local-first | License |
|-----------|----------|-----------------|------------|-----------|--------------|----------|-------------|---------|
| Inspect AI | Python | ✅ First-class | ✅ Docker/k8s | ✅ Built-in | ❌ | ✅ | ✅ | MIT |
| Bloom | Python | ✅ (generation only) | ❌ | ✅ (judgment stage) | ✅ First-class | ❌ | ✅ | MIT |
| DeepEval | Python | ⚠️ Limited | ❌ | ✅ 50+ metrics | ✅ (synthetic) | ✅ pytest | ✅ | Apache 2.0 |
| agent-eval | TypeScript | ✅ | ✅ Vercel sandbox | ⚠️ Failure only | ❌ | ✅ | ❌ Vercel dep | MIT |
| evalite | TypeScript | ❌ | ❌ | ❌ | ❌ | ✅ Vitest | ✅ | MIT |
| Braintrust | TS + Python | ⚠️ Limited | ❌ | ✅ | ✅ | ✅ | ❌ SaaS | Proprietary |

---

## Recommended Stack for Agentic Coding Plugin Evals

**Bloom + Inspect AI + custom adapter (~400 LOC Python)**

This combination covers the full pipeline without building anything from scratch:

- **Bloom** handles scenario generation — run once per lesson when a new lesson is added or its content changes; cache output by `contentHash`. Produces Inspect-compatible transcripts.
- **Inspect AI** handles the eval harness — `Dataset`, `Solver`, `Scorer`, log output, Inspect View. Multi-turn agentic sessions, Docker sandboxing, LLM judge, JSON logs, CI invocation via `inspect eval`.
- **Custom adapter** handles the domain-specific logic: loading lessons from the lesson store, two-arm A/B experiment design, process + outcome grader composition, arm result caching, markdown report generation.

**Why not DeepEval instead of Inspect AI:** DeepEval's primitives are RAG/chatbot-centric. Expressing "run a multi-turn coding session, grade the produced artifact for correctness and scope adherence" requires fighting the abstraction. Inspect's `Solver` is designed for exactly this pattern.

**Why not agent-eval instead of Inspect AI:** TypeScript coupling and Vercel sandbox dependency. The existing plugin codebase is Node/JS but the eval harness benefits from Python's richer scientific and ML tooling ecosystem (LiteLLM, scipy for CI stats, richer Docker SDK).

**Why not Bloom as the full harness:** Bloom generates scenarios and runs rollouts but does not handle scoring, pass/fail criteria, caching, CI integration, or reporting. It's a data factory, not a harness.

**Judge models:** Anthropic claude-sonnet-4-6 (primary, process + outcome grading), OpenAI o4-mini (secondary, code quality rubric — stronger on structured code review tasks). Both accessed via LiteLLM for provider-agnostic configuration.
