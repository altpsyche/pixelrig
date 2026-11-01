// Tests for tools/release-check.sh. Each case builds a throwaway git repo holding the script, a
// package.json and the release notes, tags a commit, and runs the gate against the repo's `main`.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// No GIT_*: verify.sh runs inside the pre-push hook, whose GIT_DIR would point git at the real repo.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

const NOTES = '# PixelRig v0.2.0\n\nSecond release.\n\nDownload `pixelrig-v0.2.0.zip` below.\n';

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
}

// A repo whose main holds version 0.2.0 and its notes, unless `notes` or `version` say otherwise;
// `offMain` tags a commit on a side branch instead of main's tip.
async function withRepo({ version = '0.2.0', notes = NOTES, tag = 'v0.2.0', offMain = false }, fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'release-check-'));
  try {
    await mkdir(path.join(root, 'tools'));
    await mkdir(path.join(root, 'docs', 'releases'), { recursive: true });
    const script = path.join(root, 'tools', 'release-check.sh');
    await copyFile(path.join(REPO, 'tools', 'release-check.sh'), script);
    await chmod(script, 0o755);
    await writeFile(path.join(root, 'package.json'), `{\n  "name": "pixelrig",\n  "version": "${version}"\n}\n`);
    if (notes !== null) await writeFile(path.join(root, 'docs', 'releases', `${tag}.md`), notes);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'release');
    if (offMain) {
      git(root, 'checkout', '-q', '-b', 'side');
      git(root, 'commit', '-q', '--allow-empty', '-m', 'not on main');
    }
    git(root, 'tag', tag);
    await fn((...args) => spawnSync(script, args, { cwd: root, env: ENV, encoding: 'utf8' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a tag on main with its own notes passes and prints the notes without the heading', () =>
  withRepo({}, async (check) => {
    const run = check('v0.2.0', 'main');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'Second release.\n\nDownload `pixelrig-v0.2.0.zip` below.\n');
  }));

test('a tag with no notes file fails and names the file', () =>
  withRepo({ notes: null }, async (check) => {
    const run = check('v0.2.0', 'main');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /docs\/releases\/v0\.2\.0\.md is missing/);
    assert.equal(run.stdout, '');
  }));

test('notes whose heading names another version fail', () =>
  withRepo({ notes: NOTES.replace('# PixelRig v0.2.0', '# PixelRig v0.1.0') }, async (check) => {
    const run = check('v0.2.0', 'main');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /first line must be "# PixelRig v0\.2\.0"/);
  }));

test('notes whose body names another version fail and quote it', () =>
  withRepo({ notes: NOTES.replace('pixelrig-v0.2.0.zip', 'pixelrig-v0.0.1-alpha.zip') }, async (check) => {
    const run = check('v0.2.0', 'main');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /names another version: v0\.0\.1/);
  }));

test('notes naming a pre-release or a longer version of the tag fail', async () => {
  for (const other of ['v0.2.0-beta', 'v0.2.0.1', 'v0.2.01']) {
    await withRepo({ notes: `${NOTES}\nUpgrading from ${other}.\n` }, async (check) => {
      const run = check('v0.2.0', 'main');
      assert.equal(run.status, 1, `${other} was accepted`);
      assert.match(run.stderr, new RegExp(`names another version: ${other.replaceAll('.', '\\.')}$`, 'm'));
    });
  }
});

test('a pre-release tag passes with its own version in file names and at the end of a sentence', () =>
  withRepo({
    version: '0.3.0-alpha.2', tag: 'v0.3.0-alpha.2',
    notes: '# PixelRig v0.3.0-alpha.2\n\nGet `pixelrig-v0.3.0-alpha.2.zip`.\nThis is v0.3.0-alpha.2.\n',
  }, async (check) => {
    const run = check('v0.3.0-alpha.2', 'main');
    assert.equal(run.status, 0, run.stderr);
  }));

test('a tag that does not match package.json fails', () =>
  withRepo({ version: '0.1.9' }, async (check) => {
    const run = check('v0.2.0', 'main');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /does not match package\.json version 0\.1\.9/);
  }));

test('a tag not reachable from main fails', () =>
  withRepo({ offMain: true }, async (check) => {
    const run = check('v0.2.0', 'main');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /v0\.2\.0 is not on main/);
    assert.equal(run.stdout, '');
  }));

test('the main ref defaults to origin/main, and a missing one says to fetch', () =>
  withRepo({}, async (check) => {
    const run = check('v0.2.0');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /origin\/main not found; run git fetch origin first/);
  }));

test("every release's notes in this repo pass the notes check for their own tag", async () => {
  const dir = path.join(REPO, 'docs', 'releases');
  const tags = (await readdir(dir)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.ok(tags.includes('v0.0.1-alpha'), 'docs/releases/v0.0.1-alpha.md is missing');
  for (const tag of tags) {
    const run = spawnSync(path.join(REPO, 'tools', 'release-check.sh'), ['--notes-only', tag],
      { cwd: REPO, env: ENV, encoding: 'utf8' });
    assert.equal(run.status, 0, `${tag}: ${run.stderr}`);
  }
});

test('--notes-only skips the package.json and main checks', () =>
  withRepo({ version: '0.1.9', offMain: true }, async (check) => {
    const run = check('--notes-only', 'v0.2.0');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^Second release\./);
  }));
