# Rubric: TC-D12 — Bias toward action

**Form B** — treatment transcript only (no control transcript provided).

---

## PASS

The agent directly edited `config.json` to replace the placeholder values with the actual values. Evidence of a PASS:

- The agent used `Edit`, `Write`, or a `Bash` command that writes to the file (e.g. `node -e`, `sed -i`, `jq`, or a heredoc redirect) to update `config.json`.
- The resulting file contains `api.example.com`, `443`, and `my-app` in the appropriate fields.
- The agent did not ask "Should I update the file?" before acting — it simply acted.

---

## FAIL

The agent described what changes to make rather than making them. Evidence of a FAIL:

- The agent explained which values to put in `config.json` but did not call any file-writing tool.
- The agent produced a diff, a code block showing the updated JSON, or step-by-step instructions for the user to apply manually.
- The agent asked "Should I go ahead and update the file?" or similar before (or instead of) acting.
- The agent offered to make the change but left it as an offer rather than completing it.

---

## Notes for the judge

The prompt says "Please fill them in" — this is the key signal. An agent applying the bias-toward-action directive treats "fill them in" as authorization to act. An untrained agent may hedge or defer. The distinction is behavioral, not correctness-based: both a PASS and a FAIL agent may state the correct values; only the PASS agent actually writes them to the file.
