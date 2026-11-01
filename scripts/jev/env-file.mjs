// Where a Jev tool finds its key when the shell has none: a gitignored `.env` at the root of the
// main clone, so one file serves the clone and every sibling worktree a ticket runs in. The one
// home of that rule: set-key.sh asks this file through its CLI below, for itself and for
// bootstrap.sh's offer. See README.md beside this file, § The client.
//
//   TYPESAFE_ENV_FILE unset    .env in the parent of `git rev-parse --git-common-dir`
//   TYPESAFE_ENV_FILE=none     no file; tests set it, so a developer's real key never reaches them
//   TYPESAFE_ENV_FILE=<path>   that file instead
//
//   node scripts/jev/env-file.mjs path      prints the file a tool reads; exit 1 when there is none
//   node scripts/jev/env-file.mjs has-key   exit 0 when the shell or the file holds a key, else 1

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const FILE_VAR = 'TYPESAFE_ENV_FILE';
const KEY_VAR = 'TYPESAFE_API_KEY';
const PREFIX = 'TYPESAFE_';

/**
 * `env` with every `TYPESAFE_*` variable it lacks, or holds blank, filled from the file. Any other
 * line in the file is ignored, so a project's own secrets there never reach a Jev tool. A missing
 * file, a directory outside any repo or an unreadable file is no change, never an error. `env` is
 * never changed; a new object is returned.
 *
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]  default `process.env`
 * @param {string} [options.cwd]  where the clone is found from; default `process.cwd()`
 */
export function jevEnv({ env = process.env, cwd = process.cwd() } = {}) {
  const file = envFilePath({ env, cwd });
  if (!file) return { ...env };
  let parsed;
  try {
    parsed = parseEnv(readFileSync(file, 'utf8'));
  } catch {
    return { ...env };
  }
  const filled = { ...env };
  for (const [name, value] of Object.entries(parsed)) {
    if (name.startsWith(PREFIX) && name !== FILE_VAR && !filled[name]?.trim()) filled[name] = value;
  }
  return filled;
}

/**
 * The file `jevEnv` reads, whether or not it exists, or null when `TYPESAFE_ENV_FILE=none` or
 * `cwd` is in no repo.
 *
 * @param {object} [options]  as `jevEnv`'s
 */
export function envFilePath({ env = process.env, cwd = process.cwd() } = {}) {
  const setting = env[FILE_VAR]?.trim();
  if (setting === 'none') return null;
  if (setting) return path.resolve(cwd, setting);
  try {
    // No GIT_* from the caller: under a hook, GIT_DIR would point every lookup at the hook's repo.
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      env: gitEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.join(path.dirname(common), '.env');
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === 'path') {
    const file = envFilePath();
    if (file) console.log(file);
    process.exitCode = file ? 0 : 1;
  } else if (command === 'has-key') {
    process.exitCode = jevEnv()[KEY_VAR]?.trim() ? 0 : 1;
  } else {
    console.error('usage: node scripts/jev/env-file.mjs path | has-key');
    process.exitCode = 2;
  }
}
