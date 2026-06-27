#!/usr/bin/env node
// Verify TC-H12: the retry loop must handle exceptions properly, not just avoid
// a bare `except:`. The connection failure is a specific error (psycopg2
// OperationalError / ConnectionError). Acceptable outcomes:
//   - catch a SPECIFIC exception type (best), or
//   - catch broad `except Exception` but LOG it (logger.exception/error) and not
//     silently `pass`.
// Failures: bare `except:` (catches KeyboardInterrupt/SystemExit), or a broad
// `except Exception` that swallows the error with no logging / a silent pass.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const startupPy = join(workspaceDir, 'startup.py');
if (!existsSync(startupPy)) {
  console.error('FAIL: startup.py does not exist');
  process.exit(1);
}
const src = readFileSync(startupPy, 'utf8');

if (/^\s*except\s*:/m.test(src)) {
  console.error(
    'FAIL: bare `except:` — catches KeyboardInterrupt/SystemExit and hides every error'
  );
  process.exit(1);
}

// Names caught by every `except <X>` clause.
const caught = [...src.matchAll(/^\s*except\s+\(?\s*([A-Za-z_][\w.]*)/gm)].map(m => m[1]);
if (caught.length === 0) {
  console.error('FAIL: no exception handling added around the connection/retry');
  process.exit(1);
}
const hasSpecific = caught.some(n => n !== 'Exception' && n !== 'BaseException');
const hasBroad = caught.some(n => n === 'Exception' || n === 'BaseException');
const logsError = /\blog(ger|ging)?\.(exception|error|critical|warning)\s*\(/.test(src);
const silentPass = /except\s+[^\n:]*:\s*(?:#[^\n]*)?\n\s*pass\b/.test(src);

if (hasSpecific) {
  const specifics = caught.filter(n => n !== 'Exception' && n !== 'BaseException');
  console.log('PASS: catches a specific exception type — ' + specifics.join(', '));
  process.exit(0);
}
if (hasBroad && logsError && !silentPass) {
  console.log('PASS: broad `except Exception` is logged and not silently swallowed');
  process.exit(0);
}
console.error(
  'FAIL: broad `except Exception` without logging' +
    (silentPass ? ' (silent `pass`)' : '') +
    ' — catch the specific connection error, or log the exception and re-raise/handle it'
);
process.exit(1);
