---
name: lessons:retire
description: Retire a lesson or its eval scenario - archive CONTROL_CORRECT lessons, or take an untestable scenario out of the suite. Covers the ledger, config removal, and the audit.
allowed-tools: ['Bash', 'Read', 'Edit']
---

You are running the `/lessons:retire` runbook. Two paths. Pick by eval verdict.

`evalSkipReason` is documentation only. Nothing in `evals/` reads it, so setting it does not stop the scenario from running. Removing the scenario from `evals/promptfooconfig.yaml` is what takes it out of the suite. Confirmed 2026-10-25: TC-D8 kept running and failing for a lesson that already had a skip reason.

## Path A - CONTROL_CORRECT (model already does it without the lesson)

1. Present the full record before asking: ID, slug, type, priority, summary/problem/solution, tags, both arms' behavior, judge verdict, case for archiving, case for keeping. Skip the ask only if Joe already said to run the workflow.
2. Archive: `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs promote --archive "<id>:<reason with eval id and date>"`. The id is the DB id, `sqlite3 data/lessons.db "select id from lessons where slug='<slug>'"`.
3. Append the full record to `data/obsoleted-lessons.json` `entries` (same fields as the last entry, plus `obsoletedAt`, `obsoletedReason`, `evalScenario`, `priorStatus`, `sonnetRevalidated`). Run `npx prettier --write data/obsoleted-lessons.json` afterwards or the diff balloons.
4. Remove the scenario's `[control]` and `[treatment]` blocks from `evals/promptfooconfig.yaml`. Leave the scenario directory.
5. `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs build`.

## Path B - lesson stays, eval cannot test it

Use for tool unavailable in `--print` (AskUserQuestion, ExitPlanMode), hint-vs-guard gaps, and infrastructure-specific cases.

1. The edit rejects a reason with no receipt (scenario id, results/ path, or date), because an explanation without evidence is only a hypothesis. `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs edit --id <db-id> --patch '{"evalSkipReason":"reason + receipt (TC-id, results/ path, or date)"}'`
2. Remove the scenario's two blocks from `evals/promptfooconfig.yaml`, as in A4.
3. `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs build`.

## Audit - live scenarios that contradict a skip reason or archive

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');const fs=require('fs');
const db=new DatabaseSync('data/lessons.db');
const q=sql=>new Set(db.prepare(sql).all().map(r=>r.slug));
const active=q(\"select slug from lessons where status='active'\");
const bad=q('select slug from lessons where evalSkipReason is not null');
const cfg=fs.readFileSync('evals/promptfooconfig.yaml','utf8');
for(const d of fs.readdirSync('evals/scenarios')){try{const s=JSON.parse(fs.readFileSync('evals/scenarios/'+d+'/scenario.json'));
if((bad.has(s.lessonId)||!active.has(s.lessonId))&&cfg.includes('scenarios/'+d+'/'))console.log('LIVE:',d)}catch{}}"
```

Each `LIVE:` line is a scenario to retire or a deliberate exception (name it in the commit message). As of 2026-10-25 about 70 scenarios for already-archived lessons are still in the config, so retire only the ones in scope for the task unless told otherwise.

## Requires

A lesson with `requires` gets its prerequisite injected into every arm, control included, by `evals/lib/requires.mjs`: `plugin` and namespaced `skill` types become `--plugin-dir`, `cli` is checked on PATH, and anything else fails the run loudly. If an arm runs without the prerequisite, CONTROL_CORRECT results are misleading. Confirmed 2026-10-25: TC-P22 ran skill-less until this existed.

## Finish

Run the scenarios you touched, commit, and push (the pre-push eval gate needs any changed scenario to have been run).
