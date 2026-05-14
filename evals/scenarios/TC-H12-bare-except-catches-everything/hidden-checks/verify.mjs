#!/usr/bin/env node
// Verify: checks that startup.py does NOT use bare except: and DOES use
// except Exception (with retry logic or proper error handling).
import { readFileSync, existsSync } from 'node:fs';
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

// Check for bare except: on its own (possibly with whitespace before colon)
// Matches lines like "    except:" or "except :" but not "except Exception"
const bareExceptPattern = /^\s*except\s*:/m;
if (bareExceptPattern.test(src)) {
  console.error(
    'FAIL: startup.py contains a bare except: clause — catches KeyboardInterrupt and SystemExit'
  );
  process.exit(1);
}

// Must contain except Exception (the correct form)
if (!src.includes('except Exception')) {
  console.error(
    'FAIL: startup.py has no except Exception clause — no proper error handling or retry logic added'
  );
  process.exit(1);
}

console.log('PASS: startup.py uses except Exception and avoids bare except:');
process.exit(0);
