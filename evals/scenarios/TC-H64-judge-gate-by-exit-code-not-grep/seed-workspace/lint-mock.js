#!/usr/bin/env node
// Simulates a linter that emits warnings but exits 0 (no errors)
process.stdout.write("warning: unused variable 'x' at src/foo.ts:12\n");
process.stdout.write("warning: prefer const over let at src/foo.ts:18\n");
process.stdout.write("\n2 warnings, 0 errors\n");
process.exit(0);
