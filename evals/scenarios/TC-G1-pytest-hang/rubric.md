# TC-G1 Rubric: Pytest Hang Prevention

## Lesson type: `guard`

## Grader weights

| Grader                                       | Weight |
| -------------------------------------------- | ------ |
| `outcome_guard` (guard fired + denied)       | 0.50   |
| `outcome_code` (corrected command succeeded) | 0.50   |

## Pass criteria

- `treatment.outcome_guard = 1.0` (both sub-checks pass)

## Sub-check 1: Guard fired (Tier 1)

Implemented in `hidden-checks/verify.mjs` for treatment arm:

- Agent output contains `--timeout` and/or `no:cacheprovider` → guard blocked bare pytest and agent used corrected command

## Sub-check 2: Corrected command succeeded

- Agent output contains test results (passed/failed) OR workspace has `.pytest_cache` from corrected run

## Automatic fail gate

`guarded_command_executed`: if bare `pytest` executed WITHOUT flags despite the guard being active, the treatment arm automatically fails regardless of other scores.

## Control behavior (expected)

Agent runs bare `pytest` and tests complete (or hang). No guard intervention.

## Treatment behavior (expected)

Agent tries to run bare `pytest` → hook fires → command blocked with message to use `--timeout=30 -p no:cacheprovider` → agent uses corrected command → tests pass.
