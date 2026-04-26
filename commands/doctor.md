---
name: lessons:doctor
description: Audit the lessons DB for quality issues — dead triggers, misclassified types, truncated summaries, near-duplicates, and guards that fire too broadly. Reports findings and offers to fix them.
allowed-tools: ['Bash']
---

You are running `/lessons:doctor` — a QA audit of the lesson store.
Work through all 8 checks below in order. Do not ask questions before completing all checks — gather all findings first, then present the full report and offer fixes.

---

## Pre-check: Pending candidates

Before auditing, count unreviewed candidates:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const c = l.filter(x => x.status === 'candidate');
console.log(c.length + ' candidate(s)');
c.slice(0,5).forEach(x => console.log('  - ' + x.slug));
if (c.length > 5) console.log('  ... and ' + (c.length - 5) + ' more');
" 2>/dev/null
```

If any candidates are found, show this banner prominently **before the audit table**:

> ⚠ **N candidate lesson(s) are waiting for review.**
> These lessons have been scanned but not yet promoted — they are not currently injecting.
> Run `/lessons:review` to filter, scope, and promote them.
> Continuing audit of active lessons only.

Then proceed with the 8 checks regardless.

---

## Check 1: Dead lessons — commandPatterns with no toolNames

`matchLessons()` checks `toolNames` first and short-circuits. A lesson with `commandPatterns` but empty `toolNames` can never fire.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const dead = l.filter(x => !x.toolNames?.length && x.commandPatterns?.length);
console.log(JSON.stringify(dead.map(x=>({id:x.id,slug:x.slug,patterns:x.commandPatterns})),null,2));
"
```

For each: all shell command patterns (`\bgit\b`, `\bpython\b`, etc.) should be fixed with `toolNames: ["Bash"]`. Note IDs and proposed fix.

---

## Check 2: Dead lessons — pathPatterns with no toolNames

Same failure mode: file-path-triggered lessons need a toolName (Read, Edit, Write, or Glob) or they never fire.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const dead = l.filter(x => !x.toolNames?.length && x.pathPatterns?.length);
console.log(JSON.stringify(dead.map(x=>({id:x.id,slug:x.slug,pathPatterns:x.pathPatterns})),null,2));
"
```

For each: path glob patterns should typically use `toolNames: ["Read", "Edit", "Write", "Glob"]`. Note IDs and proposed fix.

---

## Check 3: Completely unreachable hints

Hint-type lessons with no triggers at all (no `commandPatterns`, `pathPatterns`, `toolNames`) and not reclassified as `protocol` or `guard` are completely unreachable.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const dead = l.filter(x =>
  x.type === 'hint' &&
  !x.commandPatterns?.length &&
  !x.pathPatterns?.length &&
  !x.toolNames?.length
);
console.log(JSON.stringify(dead.map(x=>({id:x.id,slug:x.slug,tags:x.tags,summary:x.summary})),null,2));
"
```

For each, apply this classification heuristic:

- Tags contain `env:claude-code` AND (`topic:planning`, `category:specification-drift`, `category:context-retrieval`, or `category:planning-control-flow`) → recommend `toolNames: ["Agent"]`
- Tags contain `tool:X` for a shell tool → recommend `toolNames: ["Bash"]`
- Lesson is a general reasoning/meta principle with no clear trigger context → recommend reclassify to `type: "protocol"` (session-start injection)

Note IDs and proposed fix for each.

---

## Check 4: Guards with non-executable commandMatchTarget

Guards should only fire when the trigger word appears in the executable part of a command, not inside `--patch '...'` or other quoted argument strings. The fix is `commandMatchTarget: "executable"`, which strips quoted content before matching.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const m = JSON.parse(require('fs').readFileSync('data/lesson-manifest.json','utf8'));
const guards = l.filter(x => x.type === 'guard');
guards.forEach(g => {
  const ml = Object.values(m.lessons).find(x => x.slug === g.slug);
  if (ml && ml.commandMatchTarget !== 'executable') {
    console.log(JSON.stringify({id:g.id,slug:g.slug,commandMatchTarget:ml.commandMatchTarget??'unset'}));
  }
});
"
```

For each: propose `edit --patch '{"commandMatchTarget":"executable"}'`.

---

## Check 5: Truncated summaries

Summaries ending in `...` or `…` are cut mid-sentence and lose their meaning in injection output.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const t = l.filter(x => x.summary.endsWith('...') || x.summary.endsWith('…'));
console.log(JSON.stringify(t.map(x=>({id:x.id,slug:x.slug,summary:x.summary,problem:x.problem.substring(0,150)})),null,2));
"
```

For each: reconstruct a complete summary (≤80 chars) from the `problem` field. The summary should state the failure mode in one crisp sentence. Note ID and proposed rewrite.

---

## Check 6: Long summaries (>80 chars)

Summaries over 80 chars are verbose in injection output — the key insight gets buried or wrapped awkwardly.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const long = l.filter(x => x.summary.length > 80).sort((a,b)=>b.summary.length-a.summary.length);
console.log(JSON.stringify(long.map(x=>({id:x.id,length:x.summary.length,summary:x.summary})),null,2));
"
```

For each: propose a tightened version (≤80 chars) that preserves the core failure mode. Prefer removing filler over cutting meaning.

---

## Check 7: toolNames casing and validity

`matchLessons()` does exact string comparison against platform-normalized tool names. `"bash"`, `"BASH"`, or `"edit"` silently never match. Valid canonical names: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Agent`, `TodoWrite`.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
const VALID = new Set(['Bash','Read','Edit','Write','Glob','Grep','Agent','TodoWrite','WebFetch','WebSearch','mcp__plugin_serena_serena__find_symbol']);
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const bad = l.filter(x => (x.toolNames??[]).some(t => !VALID.has(t)));
console.log(JSON.stringify(bad.map(x=>({id:x.id,slug:x.slug,toolNames:x.toolNames})),null,2));
"
```

For each: propose the correct casing or canonical name.

---

## Check 8: Near-duplicate lessons (Jaccard similarity > 0.4)

The intake validator blocks near-duplicates at insert time, but edits can cause lessons to drift toward each other over time. Compare all pairs by `problem` text.

```bash
node -e "
const l = JSON.parse(require('fs').readFileSync('/dev/stdout','utf8'));
" 2>/dev/null; node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs list --json | node -e "
function tokenize(s){return new Set(s.toLowerCase().match(/\b\w{3,}\b/g)??[]);}
function jaccard(a,b){const ua=tokenize(a),ub=tokenize(b);const inter=[...ua].filter(x=>ub.has(x)).length;const union=new Set([...ua,...ub]).size;return union?inter/union:0;}
const l = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const pairs=[];
for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++){
  const s=jaccard(l[i].problem,l[j].problem);
  if(s>0.4)pairs.push({score:Math.round(s*100)+'%',a:l[i].slug,b:l[j].slug});
}
pairs.sort((a,b)=>parseFloat(b.score)-parseFloat(a.score));
console.log(JSON.stringify(pairs,null,2));
"
```

For each pair: review both summaries. Recommend merging (archive one, enrich the other's `solution`) or confirm they are distinct enough to keep.

---

## Final Report

After all 8 checks, present this summary table:

| Check | Issue                         | Found | Severity |
| ----- | ----------------------------- | ----- | -------- |
| 1     | commandPatterns, no toolNames | N     | critical |
| 2     | pathPatterns, no toolNames    | N     | critical |
| 3     | Unreachable hints             | N     | critical |
| 4     | Guards fire on quoted args    | N     | high     |
| 5     | Truncated summaries           | N     | high     |
| 6     | Long summaries (>80 chars)    | N     | low      |
| 7     | Invalid toolNames casing      | N     | high     |
| 8     | Near-duplicate lessons (>40%) | N     | medium   |

Then ask:

> "Apply all high-confidence mechanical fixes automatically (checks 1, 2, 4, 5, 7), review judgment calls (checks 3, 6, 8) interactively, or handle everything manually?"

**Automatic fixes** (checks 1, 2, 4, 5, 7): apply with `node ${CLAUDE_PLUGIN_ROOT}/scripts/lessons.mjs edit --id <id> --patch '<json>'` for each, confirm count when done.

**Interactive review** (checks 3, 6, 8): present each proposed change one at a time with the current value, proposed value, and reason. Ask "apply, skip, or edit?" for each.

After completing the report, mention: "Run `/lessons:scope` to find lessons that should only inject in the current project."
