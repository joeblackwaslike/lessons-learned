The lesson injection hook `hooks/inject.mjs` is firing on `Read` tool results, causing false positives in the injection pipeline.

Fix this: the hook should stop firing on `Read` tool calls. All other tools (Edit, Write, Bash, Glob, and any MCP tools) should continue to work as before.

After making the fix, run the existing tests to ensure nothing is broken:
node --test tests/

The tests must pass after your change.
