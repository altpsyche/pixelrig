// Tests for scripts/verify.sh. Each case copies it into a temp tree whose checks are stand-ins that
// pass, and runs it with a PATH that holds only the tools named, so a missing jq or gitleaks is real.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSING_TEST = "import { test } from 'node:test';\ntest('stand-in', () => {});\n";

// The caller's environment without GIT_*: verify.sh runs this test inside the real pre-push hook,
// whose GIT_DIR would otherwise point every git command here, `git init` included, at the real repo.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function which(tool) {
  const found = spawnSync('sh', ['-c', `command -v ${tool}`], { env: ENV, encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : null;
}

// A tree holding verify.sh and a passing stand-in for every script it runs; the agent-layer check
// prints the folder it ran in. A bin folder holds the tools given, plus bash, node and dirname.
async function withTree(tools, fn) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'verify-')));
  try {
    const tree = path.join(root, 'tree');
    await mkdir(path.join(tree, 'scripts', 'jev'), { recursive: true });
    const verify = path.join(tree, 'scripts', 'verify.sh');
    await copyFile(path.join(REPO, 'scripts', 'verify.sh'), verify);
    await chmod(verify, 0o755);
    const source = await readFile(verify, 'utf8');
    for (const script of new Set(source.match(/scripts\/[\w/.-]+?\.mjs/g))) {
      const body = script.endsWith('.test.mjs') ? PASSING_TEST : 'console.log(`checked ${process.cwd()}`);\n';
      await writeFile(path.join(tree, script), body);
    }
    await writeFile(path.join(tree, 'scripts', 'jev', 'stand-in.test.mjs'), PASSING_TEST);

    const bin = path.join(root, 'bin');
    await mkdir(bin);
    await symlink(process.execPath, path.join(bin, 'node'));
    for (const tool of ['bash', 'dirname', ...tools]) {
      const at = which(tool);
      assert.ok(at, `${tool} is not on this machine's PATH`);
      await symlink(at, path.join(bin, tool));
    }
    const elsewhere = path.join(root, 'elsewhere');
    await mkdir(elsewhere);
    await fn({ tree, verify, elsewhere, env: { ...ENV, PATH: bin } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('run by path from another git repo, it checks the tree it lives in, not that repo', () =>
  withTree(['git'], async ({ tree, verify, elsewhere, env }) => {
    assert.equal(spawnSync('git', ['init', '-q', elsewhere], { env: ENV }).status, 0);
    const run = spawnSync(verify, [], { cwd: elsewhere, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`^checked ${tree}$`, 'm'));
  }));

test('without jq it says so in one line, and still passes', () =>
  withTree([], async ({ verify, elsewhere, env }) => {
    const run = spawnSync(verify, [], { cwd: elsewhere, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stderr.split('\n').filter((line) => line.includes('jq'));
    assert.deepEqual(lines, ['verify: jq not found, the tests that run it skipped (CI runs them)']);
  }));

test('with jq it prints no jq line', { skip: which('jq') ? false : 'jq not found' }, () =>
  withTree(['jq'], async ({ verify, elsewhere, env }) => {
    const run = spawnSync(verify, [], { cwd: elsewhere, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr, /jq/);
  }));
