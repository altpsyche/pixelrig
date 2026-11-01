// Tests for the eval runner scripts, scripts/eval-sandbox.sh and scripts/eval-collect.sh
// (evals/README.md § Sandbox and § Running a case). No network: a stub gh comes first on PATH, and
// its `repo create` makes a local bare repo the remote, so `gh repo create` itself stays untested.
// The checkout under test is a temp copy of this working tree, committed, so each sandbox lands
// beside it in the temp folder.
//
// For every case in evals/, eval-sandbox.sh must build its sandbox, run its Starting state blocks,
// mark the repo and print the token, path and prompt; eval-collect.sh must then append each Collect
// command and its output to a transcript. A fixture case with local commands pins the transcript's
// exact form. Expected values come from the case text and the temp folders, never from the parser.

import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '```';

// Logs every call. `repo create` makes the remote a local bare repo and pushes to it, as
// `--source . --remote origin --push` would. `repo view` names the repo bootstrap.sh labels. The
// rulesets list is refused the way a free private repo refuses it, so bootstrap.sh sets none. Any
// other `api` call prints 1, as an id or number would be. Every other call succeeds silently. A
// body read from stdin is drained, so a pipe into gh never breaks.
const STUB_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_LOG"
for a; do [ "$a" = - ] && cat >/dev/null; done
case "$1" in
  repo)
    case "$2" in
      create)
        git init -q --bare "$STUB_REMOTES/$3.git"
        git remote add origin "$STUB_REMOTES/$3.git"
        git push -q -u origin HEAD ;;
      view) echo "owner/$(basename "$PWD")" ;;
    esac ;;
  api)
    case "$*" in
      *rulesets*) echo "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)" >&2; exit 1 ;;
      *) echo 1 ;;
    esac ;;
esac
`;

const COLLECT_CASE = `# A collect fixture

## Prompt

${FENCE}
hello
${FENCE}

## Collect

${FENCE}bash
echo one
printf '%s\\n' a \\
  b
echo "to stderr" >&2
false
printf '${FENCE}\\nfenced\\n${FENCE}\\n'
basename "$PWD"
${FENCE}

## Pass criteria

1. Did it?
`;

// Starting state blocks that see the runner's T and S, as typed by hand they would.
const STEPS_CASE = `# A steps fixture

## Starting state

On main, before the push: a file that names the run.

${FENCE}bash
printf '%s %s\\n' "$T" "$S" > before-push.txt
git add before-push.txt
git commit -qm "Sandbox: before the push"
${FENCE}

After bootstrap: the same, untracked.

${FENCE}bash
printf '%s %s\\n' "$T" "$S" > after-bootstrap.txt
${FENCE}

## Prompt

${FENCE}
hello
${FENCE}

## Collect

${FENCE}bash
true
${FENCE}
`;

// A Starting state block whose first command fails, followed by commands that would succeed: none
// of them runs, and no repo is created.
const FAILING_CASE = STEPS_CASE.replace("printf '%s %s\\n' \"$T\" \"$S\" > before-push.txt", 'false\n$&');

// An After bootstrap block that fails, once the repo exists: the run is void, and its repo must still
// be named, so the runner can list it in the Evidence.
const FAILING_AFTER_CASE = STEPS_CASE.replace("printf '%s %s\\n' \"$T\" \"$S\" > after-bootstrap.txt", 'false');

let tmp;
let src;
let env;
let sourceSha;

// Git without the caller's config or repo, as in install-hooks.test.mjs, and gh with no account: a
// call that missed the stub could not reach GitHub as the owner.
before(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'eval-runner-'));
  src = path.join(tmp, 'src');
  await mkdir(path.join(tmp, 'bin'));
  await mkdir(path.join(tmp, 'remotes'));
  await mkdir(path.join(tmp, 'gh-config'));
  await writeFile(path.join(tmp, 'bin', 'gh'), STUB_GH);
  await chmod(path.join(tmp, 'bin', 'gh'), 0o755);

  // NODE_TEST_CONTEXT, set by this test runner, would change how the sandbox's own pre-push
  // verify.sh runs its tests; a real sandbox never has it.
  env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('GIT_') && !k.startsWith('GH_') && k !== 'NODE_TEST_CONTEXT',
    ),
  );
  Object.assign(env, {
    PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Eval Runner Test',
    GIT_AUTHOR_EMAIL: 'eval-runner@example.invalid',
    GIT_COMMITTER_NAME: 'Eval Runner Test',
    GIT_COMMITTER_EMAIL: 'eval-runner@example.invalid',
    GH_TOKEN: 'not-a-token',
    GH_CONFIG_DIR: path.join(tmp, 'gh-config'),
    GH_PROMPT_DISABLED: '1',
    STUB_REMOTES: path.join(tmp, 'remotes'),
    STUB_LOG: path.join(tmp, 'gh.log'),
  });

  // The working tree's files, tracked or not yet, as one commit: the branch under test.
  const listed = git(REPO, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0');
  for (const rel of listed.filter(Boolean)) {
    const from = path.join(REPO, rel);
    if (!existsSync(from)) continue;
    const to = path.join(src, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
    await chmod(to, (await stat(from)).mode);
  }
  git(src, 'init', '-q', '-b', 'work');
  git(src, 'add', '-A');
  git(src, 'commit', '-qm', 'Branch under test');
  sourceSha = git(src, 'rev-parse', 'HEAD').trim();

  await writeFile(path.join(tmp, 'collect-case.md'), COLLECT_CASE);
  await writeFile(path.join(tmp, 'broken-case.md'), COLLECT_CASE.replace('## Collect', '## Collected'));
  await writeFile(path.join(tmp, 'steps-case.md'), STEPS_CASE);
  await writeFile(path.join(tmp, 'failing-case.md'), FAILING_CASE);
  await writeFile(path.join(tmp, 'failing-after-case.md'), FAILING_AFTER_CASE);
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { env: env ?? process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function run(script, args, logName) {
  return spawnSync(path.join(src, 'scripts', script), args, {
    cwd: tmp,
    env: { ...env, STUB_LOG: path.join(tmp, logName) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// A fenced block under a case heading, read with a plain pattern rather than the parser.
function block(caseText, heading) {
  const match = new RegExp(`\\n## ${heading}\\n[\\s\\S]*?\\n${FENCE}[a-z]*\\n([\\s\\S]*?)\\n${FENCE}\\n`).exec(caseText);
  assert.ok(match, `no fenced block under ## ${heading}`);
  return match[1];
}

const evalsDir = path.join(REPO, 'evals');
const cases = existsSync(evalsDir)
  ? (await readdir(evalsDir, { recursive: true })).filter((rel) => rel.includes(path.sep) && rel.endsWith('.md')).sort()
  : [];

for (const rel of cases) {
  test(`evals/${rel}: eval-sandbox.sh builds and marks its sandbox, and eval-collect.sh collects it`, async () => {
    const caseText = await readFile(path.join(evalsDir, rel), 'utf8');
    const logName = `gh-${rel.replace(/\W/g, '-')}.log`;
    const built = run('eval-sandbox.sh', [`evals/${rel}`], logName);
    assert.equal(built.status, 0, `eval-sandbox.sh failed:\n${built.stdout}\n${built.stderr}`);

    // It prints the token, the path and the prompt, last.
    const token = /^token: ([0-9a-f]{8})$/m.exec(built.stdout)?.[1];
    assert.ok(token, `no token line in:\n${built.stdout}`);
    const sandbox = path.join(tmp, `eval-${token}`);
    assert.match(built.stdout, new RegExp(`^path: ${sandbox.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.ok(built.stdout.endsWith(`prompt:\n${block(caseText, 'Prompt')}\n`), built.stdout);

    // The repo is created private, from the sandbox, and marked with the token and source commit.
    const log = (await readFile(path.join(tmp, logName), 'utf8')).split('\n');
    assert.ok(
      log.includes(
        `repo create eval-${token} --private --source . --remote origin --push ` +
          `--description eval-sandbox run ${token} from ${sourceSha}`,
      ),
      log.join('\n'),
    );

    // main is the tree under test, without the cases, plus what "On main, before the push" commits.
    const tree = git(sandbox, 'ls-tree', '-r', '--name-only', 'origin/main').split('\n');
    assert.ok(tree.includes('evals/README.md'));
    assert.deepEqual(tree.filter((p) => /^evals\/[^/]+\//.test(p)), []);
    const commits = git(sandbox, 'log', '--format=%s', 'origin/main').trim().split('\n');
    assert.equal(commits.at(-1), 'Sandbox');
    assert.equal(commits.length > 1, caseText.includes('\nOn main, before the push:'));

    // bootstrap.sh ran, and so did "After bootstrap": every issue it creates, every branch it makes.
    assert.equal(git(sandbox, 'config', 'core.hooksPath').trim(), '.githooks');
    assert.ok(log.some((line) => line.startsWith('label create ready-for-agent ')));
    const afterBootstrap = /\nAfter bootstrap:[\s\S]*?\n## Prompt\n/.exec(caseText)?.[0] ?? '';
    const issues = log.filter((line) => line.startsWith('issue create '));
    assert.equal(issues.length, afterBootstrap.split('gh issue create ').length - 1);
    for (const [, branch] of caseText.matchAll(/git switch -qc (\S+)/g)) {
      assert.equal(git(sandbox, 'branch', '--list', branch).trim().replace(/^[*+] /, ''), branch);
    }

    // Collect appends to the transcript, every line of the case's Collect block among it.
    const transcript = path.join(tmp, `${token}.md`);
    await writeFile(transcript, 'the run session transcript\n');
    const collected = run('eval-collect.sh', [`evals/${rel}`, token, transcript], logName);
    assert.equal(collected.status, 0, collected.stderr);
    const text = await readFile(transcript, 'utf8');
    assert.ok(text.startsWith('the run session transcript\n'));
    for (const line of block(caseText, 'Collect').split('\n')) {
      assert.ok(text.includes(line.trimEnd()), `transcript lacks the Collect line ${JSON.stringify(line)}`);
    }
  });
}


test('eval-collect.sh appends each command and its output, in order, in the documented form', async () => {
  const token = '0123abcd';
  await mkdir(path.join(tmp, `eval-${token}`));
  const caseFile = path.join(tmp, 'collect-case.md');
  const transcript = path.join(tmp, 'collect-transcript.md');
  await writeFile(transcript, 'before\n');

  const result = run('eval-collect.sh', [caseFile, token, transcript], 'gh-collect.log');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(transcript, 'utf8'),
    `before

## Collect, run ${token}

${FENCE}console
$ echo one
one
${FENCE}

${FENCE}console
$ printf '%s\\n' a \\
  b
a
b
${FENCE}

${FENCE}console
$ echo "to stderr" >&2
to stderr
${FENCE}

${FENCE}console
$ false
(exit 1)
${FENCE}

\`\`\`\`console
$ printf '${FENCE}\\nfenced\\n${FENCE}\\n'
${FENCE}
fenced
${FENCE}
\`\`\`\`

${FENCE}console
$ basename "$PWD"
eval-${token}
${FENCE}
`,
  );
});

test('eval-collect.sh appends nothing and fails without its sandbox, a valid token or a parsable case', async () => {
  const caseFile = path.join(tmp, 'collect-case.md');
  const broken = path.join(tmp, 'broken-case.md');
  await mkdir(path.join(tmp, 'eval-4567cdef'), { recursive: true });
  const transcript = path.join(tmp, 'untouched.md');

  for (const [args, why] of [
    [[caseFile, 'fedc9876', transcript], /no sandbox/],
    [[caseFile, '../x', transcript], /token/],
    [[broken, '4567cdef', transcript], /^eval-case: .*broken-case\.md: /],
  ]) {
    await writeFile(transcript, 'before\n');
    const result = run('eval-collect.sh', args, 'gh-fail.log');
    assert.equal(result.status, 1, `${args}: ${result.stdout}`);
    assert.match(result.stderr, why);
    assert.equal(await readFile(transcript, 'utf8'), 'before\n');
  }
});

test('eval-sandbox.sh builds nothing from a checkout with uncommitted changes or a case it cannot parse', async () => {
  const parse = run('eval-sandbox.sh', [path.join(tmp, 'broken-case.md')], 'gh-refused.log');
  assert.equal(parse.status, 1);
  assert.match(parse.stderr, /^eval-case: .*broken-case\.md: /);

  await writeFile(path.join(src, 'uncommitted.txt'), 'work in progress\n');
  try {
    const dirty = run('eval-sandbox.sh', [path.join(tmp, 'collect-case.md')], 'gh-refused.log');
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /commit/);
  } finally {
    await rm(path.join(src, 'uncommitted.txt'));
  }
  assert.equal(existsSync(path.join(tmp, 'gh-refused.log')), false, 'gh was called');
});

test('eval-sandbox.sh runs each step with the run token as T and the source commit as S', async () => {
  const built = run('eval-sandbox.sh', [path.join(tmp, 'steps-case.md')], 'gh-steps.log');
  assert.equal(built.status, 0, built.stderr);
  const token = /^token: ([0-9a-f]{8})$/m.exec(built.stdout)?.[1];
  const sandbox = path.join(tmp, `eval-${token}`);
  assert.equal(git(sandbox, 'show', 'origin/main:before-push.txt'), `${token} ${sourceSha}\n`);
  assert.equal(await readFile(path.join(sandbox, 'after-bootstrap.txt'), 'utf8'), `${token} ${sourceSha}\n`);
});

test('eval-sandbox.sh stops at the first failing Starting state command, before any repo is created', async () => {
  assert.notEqual(FAILING_CASE, STEPS_CASE, 'the fixture edit must change the case');
  const sandboxes = async () => (await readdir(tmp)).filter((name) => /^eval-[0-9a-f]{8}$/.test(name));
  const earlier = await sandboxes();
  const built = run('eval-sandbox.sh', [path.join(tmp, 'failing-case.md')], 'gh-failing.log');
  assert.notEqual(built.status, 0);
  assert.doesNotMatch(built.stdout, /^token: /m);
  const log = existsSync(path.join(tmp, 'gh-failing.log')) ? await readFile(path.join(tmp, 'gh-failing.log'), 'utf8') : '';
  assert.doesNotMatch(log, /^repo create /m);
  // Its sandbox folder is left for the runner to see why, but holds nothing the failing step was
  // to write after its first command.
  const created = (await sandboxes()).filter((name) => !earlier.includes(name));
  assert.equal(created.length, 1);
  assert.equal(existsSync(path.join(tmp, created[0], 'before-push.txt')), false);
  assert.equal(git(path.join(tmp, created[0]), 'log', '--format=%s').trim(), 'Sandbox');
});

test('eval-sandbox.sh names the token, path and void note when a step fails after the repo exists', async () => {
  assert.notEqual(FAILING_AFTER_CASE, STEPS_CASE, 'the fixture edit must change the case');
  const built = run('eval-sandbox.sh', [path.join(tmp, 'failing-after-case.md')], 'gh-failing-after.log');
  assert.notEqual(built.status, 0);
  const log = await readFile(path.join(tmp, 'gh-failing-after.log'), 'utf8');
  const token = /^repo create eval-([0-9a-f]{8}) /m.exec(log)?.[1];
  assert.ok(token, log);
  assert.match(built.stderr, new RegExp(`^token: ${token}$`, 'm'));
  assert.match(built.stderr, new RegExp(`^path: ${path.join(tmp, `eval-${token}`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(built.stderr, new RegExp(`eval-${token} exists.*void.*Evidence`));
});
