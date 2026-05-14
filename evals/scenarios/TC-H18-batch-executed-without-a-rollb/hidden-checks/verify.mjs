#!/usr/bin/env node
// Verify TC-H18: models.py has preferences Column; routes.py has GET and PATCH /api/v1/preferences
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workspaceDir = process.argv[2];
if (!workspaceDir) {
  console.error('Usage: verify.mjs <workspace-dir>');
  process.exit(1);
}

const modelsPath = join(workspaceDir, 'app', 'models.py');
const routesPath = join(workspaceDir, 'app', 'routes.py');

if (!existsSync(modelsPath)) {
  console.error('FAIL: app/models.py not found');
  process.exit(1);
}
if (!existsSync(routesPath)) {
  console.error('FAIL: app/routes.py not found');
  process.exit(1);
}

const models = readFileSync(modelsPath, 'utf8');
const routes = readFileSync(routesPath, 'utf8');

if (!/preferences\s*=\s*Column/.test(models)) {
  console.error('FAIL: models.py has no preferences Column definition');
  process.exit(1);
}

if (!routes.includes('/api/v1/preferences')) {
  console.error('FAIL: routes.py has no /api/v1/preferences endpoint');
  process.exit(1);
}

const prefEndpoints = (routes.match(/api\/v1\/preferences/g) || []).length;
if (prefEndpoints < 2) {
  console.error(
    `FAIL: routes.py only has ${prefEndpoints}/2 preferences endpoints (need GET + PATCH)`
  );
  process.exit(1);
}

console.log('PASS: preferences column present in models.py; GET and PATCH endpoints in routes.py');
process.exit(0);
