import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALLED_PLUGINS = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');

function pluginInstallPath(pluginName) {
  const installed = JSON.parse(readFileSync(INSTALLED_PLUGINS, 'utf8')).plugins ?? {};
  const key = Object.keys(installed).find(k => k.startsWith(`${pluginName}@`));
  const path = key && installed[key][0]?.installPath;
  if (!path || !existsSync(path)) throw new Error(`plugin "${pluginName}" is not installed`);
  return path;
}

function resolveOne(req) {
  if (req.type === 'plugin') return pluginInstallPath(req.name);
  if (req.type === 'skill' && req.name.includes(':')) {
    return pluginInstallPath(req.name.split(':')[0]);
  }
  if (req.type === 'cli') {
    if (spawnSync('sh', ['-c', 'command -v "$0"', req.name]).status !== 0) {
      throw new Error(`cli "${req.name}" is not on PATH`);
    }
    return null;
  }
  throw new Error(`requires type "${req.type}" (${req.name}) has no eval injection yet`);
}

/**
 * Resolve a lesson's `requires` into what the eval agent needs: plugin directories
 * for `--plugin-dir`, plus a signature that changes when the resolved set changes.
 * Array `requires` means OR: the first resolvable alternative wins. Throws when
 * nothing resolves, so a scenario never runs silently without its prerequisite.
 */
export function resolveLessonRequires(lessonSlug) {
  const dataDir = process.env.LESSONS_DATA_DIR ?? join(REPO_ROOT, 'data');
  const db = new DatabaseSync(join(dataDir, 'lessons.db'), { readOnly: true });
  const row = db
    .prepare("SELECT requires FROM lessons WHERE slug = ? AND status = 'active'")
    .get(lessonSlug);
  db.close();
  if (!row?.requires) return { pluginDirs: [], signature: '' };

  const parsed = JSON.parse(row.requires);
  const alternatives = Array.isArray(parsed) ? parsed : [parsed];
  const errors = [];
  for (const req of alternatives) {
    try {
      const dir = resolveOne(req);
      const pluginDirs = dir ? [dir] : [];
      return { pluginDirs, signature: pluginDirs.join('|') || `${req.type}:${req.name}` };
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(`cannot satisfy requires for ${lessonSlug}: ${errors.join('; ')}`);
}
