---
sidebar_position: 1
title: Codex Desktop Chat History Sidebar
description: Post-mortem for the Codex Desktop chat history sidebar bug where transferred sessions disappeared due to stale absolute path metadata.
---

# Codex Desktop Chat History Sidebar Postmortem

## Summary

Transferred Codex chat history was present on disk and partly visible to the app, but most imported threads did not appear in the Desktop sidebar. The strongest current root-cause hypothesis is that the imported session files still carry old absolute workspace paths in `session_meta.payload.cwd`, while the new machine uses different local paths. The renderer appears to use those session-level paths when deciding which threads belong in current sidebar groups.

This explains the split we observed:

- the four newly created threads on the new machine appear in the sidebar
- the older imported threads exist on disk and in the thread database
- project groups render as `No chats`

---

## Impact

- High-value historical chats became effectively inaccessible from normal sidebar navigation
- Repeated restarts and index rebuilds consumed substantial time without fixing the actual root mismatch
- Several local caches were repaired successfully, but those repairs did not address the session metadata the renderer most likely depends on

---

## What Was Confirmed

### History files existed

The transferred history was not missing from disk.

Repaired and/or verified local artifacts:

- `~/.codex/sessions/...`
- `~/.codex/state_5.sqlite`
- `~/.codex/session_index.jsonl`
- `~/.codex/history.jsonl`
- `~/.codex/.codex-global-state.json`

### The app could already see the threads

Runtime evidence showed the app was aware of the restored thread set:

- `thread_count_total=36`
- `thread_count_loaded_recent=36`

That ruled out "missing transferred data" as the main failure.

### The UI failure was downstream of raw thread discovery

The sidebar still showed only four recent threads. Project groups showed `No chats`.

That proved the failure was in sidebar grouping/render selection, not in basic thread existence.

---

## Repairs That Were Real But Insufficient

### Rebuilt thread state database

`state_5.sqlite` was regenerated and `backfill_state` reached `complete`.

This fixed stale derived state, but not the sidebar population bug.

### Restored lightweight indexes

`session_index.jsonl` and `history.jsonl` were recreated so the app had recent-history metadata again.

This improved state consistency but did not populate the old imported threads in the rendered sidebar.

### Repaired global sidebar state

`~/.codex/.codex-global-state.json` was updated with:

- `project-order`
- `thread-workspace-root-hints`
- `active-workspace-roots`
- `electron-saved-workspace-roots`
- synthesized `sidebar-chat-thread-order`
- synthesized `sidebar-project-thread-orders`

This was a meaningful repair, but it still did not make the old threads render.

---

## Key Breakthrough

### Bundle inspection changed the model of the bug

Renderer bundle inspection showed project ordering is applied after the app builds sidebar thread groups. In other words:

- ordering data is not enough
- the renderer first needs a set of sidebar thread keys
- our missing 32 imported threads were not entering that upstream thread-key set

This eliminated the earlier theory that the main bug was just bad ordering state.

### The imported sessions still reference old local paths

The strongest evidence came from comparing session metadata:

- imported older sessions use `session_meta.payload.cwd` values rooted at old machine paths
- newly visible sessions use current-machine paths rooted at `/Users/joe/...`

Focused counts showed:

- `32` session files with `session_meta.payload.cwd` on the old path shape
- the visible sessions were created with current local paths

This is the first hypothesis that explains the exact visibility split.

---

## Likely Root Cause

Codex Desktop appears to use `session_meta.payload.cwd` from session files, directly or indirectly, when materializing sidebar thread keys and assigning threads to workspace buckets.

Because the imported threads still point at obsolete absolute paths:

- they do not match the current machine's workspace roots
- they fail to enter the normal sidebar grouping path
- they remain present in the database but absent from rendered sidebar groups

---

## Why Earlier Fixes Did Not Solve It

Those earlier repairs mostly targeted derived state:

- database backfill status
- thread index files
- Electron local/session storage
- synthesized sidebar order maps

But if the renderer derives grouping from the imported session files themselves, then repaired caches alone cannot fix the mismatch. The source metadata must be normalized first.

---

## Dead Ends And False Leads

### "Missing history files"

False. The sessions were already present locally.

### "Broken sidebar order only"

False or incomplete. Order state was missing and later repaired, but groups were still empty.

### Electron Local Storage as source of truth

Local Storage inspection mostly showed Statsig keys, not the missing chat/sidebar source.

### Renderer bug with no local fix

Too early. The renderer is closed-source, but by the end of the investigation there was a concrete, local, path-level mismatch with strong explanatory power.

---

## Current Best Repair Sequence

This is the repair path that best matches the evidence:

1. Back up `~/.codex/sessions` and `~/.codex/state_5.sqlite*`
2. Rewrite imported session paths from the old absolute user path to the current one
3. Update any thread titles in `state_5.sqlite` that still embed the old path
4. Remove only the derived thread DB files:
   - `state_5.sqlite`
   - `state_5.sqlite-wal`
   - `state_5.sqlite-shm`
5. Relaunch Codex so it reindexes from corrected session metadata

:::warning
The rewrite should happen **before** rebuilding the DB, not after.
:::

---

## Operational Lessons

### Lesson 1

When transferred Codex history exists on disk but not in the sidebar, check session-file path metadata before spending hours on cache rebuilds.

### Lesson 2

For this class of bug, distinguish:

- existence of thread data
- visibility of thread data in the renderer

Those are separate systems.

### Lesson 3

If the visible sidebar threads are exactly the newly created local ones, suspect stale absolute paths inside imported session metadata.

### Lesson 4

Synthesizing UI order state is lower leverage than validating the upstream group-membership inputs.

### Lesson 5

For desktop-agent migrations, absolute-path normalization should be part of the import checklist, especially when usernames or workspace roots changed across machines.

---

## Good Candidate `lessons-learned` Entry

### Title

`Codex Desktop imported chats can disappear from sidebar when session_meta cwd points at old machine paths`

### Trigger Pattern

- user migrated `~/.codex/sessions` from another machine
- threads exist on disk and in `state_5.sqlite`
- sidebar shows only newly created local chats
- project groups show `No chats`

### Detection Heuristic

Compare the first line of an old hidden session and a new visible session:

- look at `session_meta.payload.cwd`
- if imported sessions still use old absolute roots, normalize them first

### Fix

Normalize imported session `cwd` paths, then rebuild only derived thread state.

---

## Suggested Follow-On Improvements

### Product-level

- Codex Desktop should not rely on raw absolute paths without migration normalization
- imported sessions should be path-remapped during first launch or backfill
- the sidebar should surface "orphaned threads with unmatched workspace roots" instead of hiding them silently

### Tooling-level

- add a migration diagnostic command that reports mismatched session roots
- add a repair command that safely rewrites session roots with backup + dry run

---

## Status

This postmortem captures the investigation up to the breakthrough. At the time of writing, the path-normalization repair sequence had been identified and prepared, but the final rewrite/rebuild had not yet been executed in this thread.
