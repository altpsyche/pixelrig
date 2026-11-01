// Tests for scripts/eval-cleanup.sh (evals/README.md § Sandbox, docs/workflow.md § 5). No network:
// a stub gh comes first on PATH and answers from fixture JSON, applying each --jq filter with the
// runner's jq, as gh applies its own. Every scenario has its own temp folder holding a main clone,
// the folders beside it and the stub's fixtures, so the script never sees a real repo or folder.
//
// The script must delete a repo only when every guard holds: its token is listed in the merged PR's
// ## Evidence as `run <T>`, eight lowercase hex digits; the repo is named eval-<T>, owned by the
// logged-in account, private, and its description is the marker eval-sandbox.sh sets. It removes
// only the folders eval-<T> and eval-<T>-<n> beside the main clone, and lists, never deletes, other
// eval-* repos older than 7 days. Expected values are written out by hand, never derived the way the
// script derives them.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'eval-cleanup.sh');

const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
// Skipped locally without jq. CI never skips: ubuntu runners ship jq, and a missing one fails.
const opts = { skip: HAVE_JQ || process.env.CI ? false : 'jq not found (CI runs it)' };

const ME = 'the-owner';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const T = 'a1b2c3d4';
const DAY = 24 * 60 * 60 * 1000;

// Logs every call. A call whose arguments match the glob $STUB_FAIL fails as an unreachable API
// does. Otherwise it answers `api user`, `pr view <n>`, `repo view <owner>/<name>` and
// `repo list <owner>` from $STUB_DIR, through jq -r when a --jq filter is given; a repo with no
// fixture is not found, as gh says it. `repo delete` only logs. Anything else fails loudly.
const STUB_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_LOG"
# shellcheck disable=SC2053
if [ -n "$STUB_FAIL" ] && [[ "$*" == $STUB_FAIL ]]; then echo "error connecting to api.github.com" >&2; exit 1; fi
filter=
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  [ "\${args[i]}" = --jq ] && filter="\${args[i + 1]}"
done
answer() {
  if [ -n "$filter" ]; then jq -r "$filter" "$1"; else cat "$1"; fi
}
case "$1 $2" in
  "api user") answer "$STUB_DIR/user.json" ;;
  "pr view")
    [ -f "$STUB_DIR/pr-$3.json" ] || { echo "GraphQL: Could not resolve to a PullRequest with the number of $3. (repository.pullRequest)" >&2; exit 1; }
    answer "$STUB_DIR/pr-$3.json" ;;
  "repo view")
    f="$STUB_DIR/repo-\${3//\\//__}.json"
    [ -f "$f" ] || { echo "GraphQL: Could not resolve to a Repository with the name '$3'. (repository)" >&2; exit 1; }
    answer "$f" ;;
  "repo list") answer "$STUB_DIR/repo-list.json" ;;
  "repo delete") ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 64 ;;
esac
`;

const marker = (token, sha = SHA) => `eval-sandbox run ${token} from ${sha}`;

// A sandbox repo as `gh repo view --json` returns it, every guard holding unless overridden.
const sandbox = (token, over = {}) => ({
  nameWithOwner: `${ME}/eval-${token}`,
  name: `eval-${token}`,
  visibility: 'PRIVATE',
  description: marker(token),
  createdAt: new Date(Date.now() - DAY).toISOString(),
  ...over,
});

const evidenceBody = (...lines) =>
  ['## Summary', '', 'Proves the skill.', '', '## Evidence', '', ...lines, '', '## Evals', '', 'None.', ''].join(
    '\r\n',
  );

const gradeEntry = (token) => `- evals/work/red-baseline.md, run ${token}: Verdict: pass 3/3`;

// Builds one scenario in its own temp folder and runs the script from its main clone.
//   repos:   fixtures keyed by the `<owner>/<name>` the script asks for
//   list:    what `gh repo list` returns
//   folders: names created beside the main clone, as folders
//   fail:    a glob of gh arguments the stub fails, as an unreachable API
//   init:    what the folder the script runs from is: 'repo', a main clone; 'bare', a bare
//            repository; 'none', no repository at all
async function scenario({
  body,
  state = 'MERGED',
  repos = {},
  list = [],
  folders = [],
  setup,
  mainName = 'main',
  fail = '',
  init = 'repo',
}) {
  const tmp = await mkdtemp(path.join(tmpdir(), 'eval-cleanup-'));
  const bin = path.join(tmp, 'bin');
  const stub = path.join(tmp, 'stub');
  const work = path.join(tmp, 'work');
  const main = path.join(work, mainName);
  await mkdir(bin);
  await mkdir(stub);
  await mkdir(path.join(tmp, 'gh-config'));
  await mkdir(main, { recursive: true });
  await writeFile(path.join(bin, 'gh'), STUB_GH);
  await chmod(path.join(bin, 'gh'), 0o755);

  await writeFile(path.join(stub, 'user.json'), JSON.stringify({ login: ME }));
  await writeFile(path.join(stub, 'pr-70.json'), JSON.stringify({ number: 70, state, body }));
  for (const [nwo, repo] of Object.entries(repos)) {
    await writeFile(path.join(stub, `repo-${nwo.replace('/', '__')}.json`), JSON.stringify(repo));
  }
  await writeFile(path.join(stub, 'repo-list.json'), JSON.stringify(list));
  for (const name of folders) {
    await mkdir(path.join(work, name, 'inside'), { recursive: true });
    await writeFile(path.join(work, name, 'inside', 'file.txt'), 'x');
  }

  // Git without the caller's config, and gh with no account: a call that missed the stub could not
  // reach GitHub as the owner.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('GH_')),
  );
  Object.assign(env, {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GH_TOKEN: 'not-a-token',
    GH_CONFIG_DIR: path.join(tmp, 'gh-config'),
    GH_PROMPT_DISABLED: '1',
    STUB_DIR: stub,
    STUB_LOG: path.join(tmp, 'gh.log'),
    STUB_FAIL: fail,
    // git never looks above the temp folder for a repository.
    GIT_CEILING_DIRECTORIES: tmp,
  });
  if (init !== 'none') {
    const args = init === 'bare' ? ['init', '-q', '--bare', main] : ['init', '-q', '-b', 'main', main];
    const git = spawnSync('git', args, { env, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
  }
  if (setup) await setup({ tmp, work, main });

  const result = spawnSync(SCRIPT, ['70'], { cwd: main, env, encoding: 'utf8' });
  const log = existsSync(env.STUB_LOG) ? await readFile(env.STUB_LOG, 'utf8') : '';
  const exists = (name) => existsSync(path.join(work, name));
  const deletes = log.split('\n').filter((l) => l.startsWith('repo delete'));
  return { tmp, work, main, result, log, deletes, exists, cleanup: () => rm(tmp, { recursive: true, force: true }) };
}

test('deletes a marked, private, owned sandbox the merged PR lists, and its folders', opts, async () => {
  const s = await scenario({
    body: evidenceBody(gradeEntry(T)),
    repos: { [`${ME}/eval-${T}`]: sandbox(T) },
    folders: [`eval-${T}`, `eval-${T}-12`],
  });
  try {
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.deepEqual(s.deletes, [`repo delete ${ME}/eval-${T} --yes`]);
    assert.equal(s.exists(`eval-${T}`), false);
    assert.equal(s.exists(`eval-${T}-12`), false);
    assert.equal(s.exists('main'), true);
    assert.match(s.result.stdout, new RegExp(`deleted ${ME}/eval-${T}`));
  } finally {
    await s.cleanup();
  }
});

test('deletes every listed run, pass, fail or void, and each only once', opts, async () => {
  const t2 = '0f0f0f0f';
  const t3 = '99aa88bb';
  const s = await scenario({
    body: evidenceBody(
      gradeEntry(T),
      `- evals/work/claim.md, run ${t2}: Verdict: fail 1/2 (no: 2)`,
      `- evals/work/claim.md, run ${t3}: void, the sandbox could not be built`,
      '<details>',
      '',
      `Grade: evals/work/red-baseline.md, run ${T}, sandbox from 9f8e7d6`,
      '</details>',
    ),
    repos: { [`${ME}/eval-${T}`]: sandbox(T), [`${ME}/eval-${t2}`]: sandbox(t2), [`${ME}/eval-${t3}`]: sandbox(t3) },
  });
  try {
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.deepEqual(s.deletes.sort(), [
      `repo delete ${ME}/eval-${t2} --yes`,
      `repo delete ${ME}/eval-${t3} --yes`,
      `repo delete ${ME}/eval-${T} --yes`,
    ]);
  } finally {
    await s.cleanup();
  }
});

// Each guard fails alone, every other one holding. The repo a wrong token would name has a valid
// fixture, so only the guard stands between it and a delete. Its folder stays too.
const guards = [
  ['an uppercase token', { token: 'A1B2C3D4' }],
  ['a token of seven hex digits', { token: 'a1b2c3d' }],
  ['a token of nine hex digits', { token: 'a1b2c3d4e' }],
  ['a token with a non-hex letter', { token: 'g1b2c3d4' }],
  ['a repo that resolves to another name', { repo: { nameWithOwner: `${ME}/real-project`, name: 'real-project' } }],
  ['a repo that resolves to another run', { repo: { nameWithOwner: `${ME}/eval-deadbeef`, name: 'eval-deadbeef' } }],
  ['another owner', { repo: { nameWithOwner: `someone-else/eval-${T}` } }],
  ['a public repo', { repo: { visibility: 'PUBLIC' } }],
  ['an internal repo', { repo: { visibility: 'INTERNAL' } }],
  ['no description', { repo: { description: null } }],
  ['an empty description', { repo: { description: '' } }],
  ['a description that is not the marker', { repo: { description: 'My real project' } }],
  ['a marker naming another run', { repo: { description: marker('deadbeef') } }],
  ['a marker with a short sha', { repo: { description: marker(T, '9f8e7d6') } }],
  ['a marker with text after it', { repo: { description: `${marker(T)} (keep)` } }],
  ['a token listed outside the Evidence', { body: `## Summary\n\n${gradeEntry(T)}\n\n## Evidence\n\nNone.\n` }],
  ['a token in the Evidence not written as a run', { body: evidenceBody(`- the sandbox eval-${T} was used`) }],
  ['a PR that is not merged', { state: 'OPEN' }],
];

for (const [name, g] of guards) {
  test(`deletes nothing for ${name}`, opts, async () => {
    const token = g.token ?? T;
    const s = await scenario({
      body: g.body ?? evidenceBody(gradeEntry(token)),
      state: g.state,
      repos: { [`${ME}/eval-${token}`]: sandbox(token, g.repo) },
      folders: [`eval-${token}`, `eval-${token}-3`],
    });
    try {
      // It ran to the end, so the empty delete list is the guard's doing: only an unmerged PR stops it.
      assert.equal(s.result.status, g.state ? 1 : 0, s.result.stderr);
      assert.deepEqual(s.deletes, [], s.log);
      // A token that is not eight lowercase hex digits is never even looked up.
      if (g.token) assert.doesNotMatch(s.log, /^repo view/m);
      assert.equal(s.exists(`eval-${token}`), true);
      assert.equal(s.exists(`eval-${token}-3`), true);
    } finally {
      await s.cleanup();
    }
  });
}

test('a PR that is not merged stops the script before it reads any repo', opts, async () => {
  const s = await scenario({ body: evidenceBody(gradeEntry(T)), state: 'OPEN', repos: { [`${ME}/eval-${T}`]: sandbox(T) } });
  try {
    assert.notEqual(s.result.status, 0);
    assert.doesNotMatch(s.log, /^repo /m);
    assert.match(s.result.stderr, /not merged/);
  } finally {
    await s.cleanup();
  }
});

test('removes the folders of a listed run whose repo was never created, and nothing else', opts, async () => {
  const outside = 'kept-target';
  const s = await scenario({
    body: evidenceBody(`- evals/work/claim.md, run ${T}: void, gh repo create failed`),
    folders: [
      `eval-${T}`,
      `eval-${T}-2`,
      `eval-${T}-57`,
      `eval-${T}-x`,
      `eval-${T}-2-3`,
      `eval-${T}x`,
      `eval-${T}.bak`,
      `eval-${T}-`,
      'eval-deadbeef',
      'other',
      outside,
    ],
    setup: async ({ work, main }) => {
      await writeFile(path.join(work, `eval-${T}-5`), 'a file, not a folder');
      await symlink(path.join(work, outside), path.join(work, `eval-${T}-7`));
      await mkdir(path.join(main, `eval-${T}`));
    },
  });
  try {
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.deepEqual(s.deletes, []);
    for (const gone of [`eval-${T}`, `eval-${T}-2`, `eval-${T}-57`]) assert.equal(s.exists(gone), false, gone);
    for (const kept of [
      `eval-${T}-x`,
      `eval-${T}-2-3`,
      `eval-${T}x`,
      `eval-${T}.bak`,
      `eval-${T}-`,
      `eval-${T}-5`,
      'eval-deadbeef',
      'other',
      'main',
      `main/eval-${T}`,
      `${outside}/inside/file.txt`,
    ]) {
      assert.equal(s.exists(kept), true, kept);
    }
    assert.equal(lstatSync(path.join(s.work, `eval-${T}-7`)).isSymbolicLink(), true);
  } finally {
    await s.cleanup();
  }
});

test('never removes the main clone, even when it bears a listed run\'s name', opts, async () => {
  const s = await scenario({
    body: evidenceBody(`- evals/work/claim.md, run ${T}: void, gh repo create failed`),
    mainName: `eval-${T}`,
    folders: [`eval-${T}-4`],
  });
  try {
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.equal(s.exists(`eval-${T}`), true);
    assert.equal(s.exists(`eval-${T}/.git`), true);
    assert.equal(s.exists(`eval-${T}-4`), false);
  } finally {
    await s.cleanup();
  }
});

// Each gh call the script makes fails alone, as an unreachable API would, every guard otherwise
// holding: the script exits non-zero, prints no "deleted" line and removes no folder. Only the
// failed repo view and the failed delete let it go on to the end, and it still exits 1.
const failures = [
  ['logged-in account read', 'api user*'],
  ['PR state read', 'pr view 70 --json state*'],
  ['PR body read', 'pr view 70 --json body*'],
  ['repo lookup', 'repo view *'],
  ['repo delete', 'repo delete *'],
];

for (const [name, fail] of failures) {
  test(`a failed ${name} stops short, removing no folder`, opts, async () => {
    const s = await scenario({
      body: evidenceBody(gradeEntry(T)),
      repos: { [`${ME}/eval-${T}`]: sandbox(T) },
      folders: [`eval-${T}`, `eval-${T}-2`],
      fail,
    });
    try {
      assert.notEqual(s.result.status, 0, s.result.stdout);
      assert.doesNotMatch(s.result.stdout, /deleted/);
      assert.equal(s.exists(`eval-${T}`), true);
      assert.equal(s.exists(`eval-${T}-2`), true);
      // A delete is attempted only once every guard and every read before it held.
      assert.deepEqual(s.deletes, fail === 'repo delete *' ? [`repo delete ${ME}/eval-${T} --yes`] : []);
      if (fail === 'repo view *' || fail === 'repo delete *') {
        assert.equal(s.result.status, 1);
        assert.match(s.result.stderr, new RegExp(`eval-${T}`));
      }
    } finally {
      await s.cleanup();
    }
  });
}

// Folders are removed only beside a main clone. Run from no repository, or from a bare one, the
// script stops before any gh call, and a listed run's folder where it runs stays.
for (const [name, init] of [
  ['no repository', 'none'],
  ['a bare repository', 'bare'],
]) {
  test(`refuses to run from ${name}, removing no folder`, opts, async () => {
    const s = await scenario({
      body: evidenceBody(`- evals/work/claim.md, run ${T}: void, gh repo create failed`),
      init,
      folders: [`eval-${T}`],
      setup: async ({ main }) => {
        await mkdir(path.join(main, `eval-${T}`));
      },
    });
    try {
      assert.equal(s.result.status, 1, s.result.stdout);
      assert.match(s.result.stderr, /main clone/);
      assert.equal(s.log, '');
      assert.equal(s.exists(`main/eval-${T}`), true);
      assert.equal(s.exists(`eval-${T}`), true);
    } finally {
      await s.cleanup();
    }
  });
}

test('lists, never deletes, other eval-* repos older than 7 days', opts, async () => {
  const old = new Date(Date.now() - 30 * DAY).toISOString();
  const recent = new Date(Date.now() - 2 * DAY).toISOString();
  const s = await scenario({
    body: evidenceBody(gradeEntry(T)),
    repos: { [`${ME}/eval-${T}`]: sandbox(T, { createdAt: old }) },
    list: [
      sandbox(T, { createdAt: old }),
      sandbox('11112222', { createdAt: old }),
      sandbox('33334444', { createdAt: old, description: null }),
      { ...sandbox('55556666'), createdAt: recent },
      { nameWithOwner: `${ME}/project`, name: 'project', createdAt: old },
      { nameWithOwner: `${ME}/eval-notes`, name: 'eval-notes', createdAt: old },
    ],
  });
  try {
    assert.equal(s.result.status, 0, s.result.stderr);
    assert.deepEqual(s.deletes, [`repo delete ${ME}/eval-${T} --yes`]);
    const listed = s.result.stdout.split('\n').filter((l) => l.includes('not deleted'));
    assert.equal(listed.length, 3, s.result.stdout);
    assert.match(listed.join('\n'), /eval-11112222/);
    assert.match(listed.join('\n'), /eval-33334444/);
    assert.match(listed.join('\n'), /eval-notes/);
    assert.doesNotMatch(s.result.stdout, /eval-55556666|\/project\b/);
  } finally {
    await s.cleanup();
  }
});

test('refuses a PR argument that is not a number, calling nothing', opts, async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'eval-cleanup-'));
  try {
    // A gh that only records it was called.
    await mkdir(path.join(tmp, 'bin'));
    await writeFile(path.join(tmp, 'bin', 'gh'), `#!/usr/bin/env bash\ntouch "${path.join(tmp, 'called')}"\n`);
    await chmod(path.join(tmp, 'bin', 'gh'), 0o755);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GH_')));
    env.PATH = `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`;
    env.GH_TOKEN = 'not-a-token';
    for (const args of [[], [''], ['70; rm -rf /'], ['-1'], ['0'], ['abc'], ['70', '71']]) {
      const r = spawnSync(SCRIPT, args, { cwd: tmp, encoding: 'utf8', env });
      assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`);
      assert.match(r.stderr, /usage: scripts\/eval-cleanup\.sh <pr>/);
    }
    assert.equal(existsSync(path.join(tmp, 'called')), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
