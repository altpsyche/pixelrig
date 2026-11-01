// Tests for the ruleset step of scripts/bootstrap.sh. Each case copies the script into a temp repo
// with a stand-in install-hooks.sh and this repo's docs/idea.md, and puts a stub gh first on PATH.
// The stub logs every call and answers the rulesets list as the case asks: refused the way the API
// refuses a free private repo, or a list it filters with the caller's --jq, as gh does. It keeps the
// body of every PUT and POST, one per line, so a case can read the ruleset that was sent.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The body and message the API gave on a free private repo (#51).
const REFUSAL_BODY =
  '{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.",' +
  '"documentation_url":"https://docs.github.com/rest/repos/rules","status":"403"}';
const REFUSAL_MESSAGE =
  'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';

// On an error, gh prints the response body on stdout, unfiltered by --jq, and the message on
// stderr. On success it prints the body filtered by --jq, as `jq -r` would.
const STUB_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$STUB_LOG"
case "$1 $2" in
  "repo view") echo owner/repo ;;
  "label create") ;;
  "api repos/owner/repo/rulesets")
    if [ "$STUB_LIST" = refused ]; then
      printf '%s\\n' "$STUB_REFUSAL_BODY"
      printf '%s\\n' "$STUB_REFUSAL_MESSAGE" >&2
      exit 1
    fi
    [ "$3" = --jq ] || { echo "stub gh: list called without --jq" >&2; exit 2; }
    printf '%s' "$STUB_LIST" | jq -r "$4" ;;
  "api -X")
    { tr -d '\\n'; echo; } >>"$STUB_BODIES"
    if [ "$STUB_SET" = refused ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi ;;
  *) echo "stub gh: unexpected call: $*" >&2; exit 2 ;;
esac
`;

const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
// Skipped locally without jq. CI never skips: ubuntu runners ship jq, and a missing one fails.
const needsJq = { skip: HAVE_JQ || process.env.CI ? false : 'jq not found (CI runs it)' };

// Git without the caller's config or repo, as in install-hooks.test.mjs: GIT_DIR from an outer hook
// cannot point these commands at the real repo.
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(BASE_ENV, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

// Runs bootstrap.sh in a fresh temp repo. `list` is 'refused' or a JSON array of rulesets; `set` is
// 'refused' to refuse every PUT and POST. Returns the exit status, output, the gh calls made and
// each ruleset sent, parsed, in the order sent.
async function bootstrap({ list, set = 'ok' }) {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-'));
  try {
    const clone = path.join(root, 'clone');
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'gh.log');
    const bodies = path.join(root, 'bodies.log');
    await mkdir(path.join(clone, 'scripts'), { recursive: true });
    await mkdir(path.join(clone, 'docs'));
    await mkdir(bin);
    await copyFile(path.join(REPO, 'scripts/bootstrap.sh'), path.join(clone, 'scripts/bootstrap.sh'));
    await copyFile(path.join(REPO, 'docs/idea.md'), path.join(clone, 'docs/idea.md'));
    await writeFile(path.join(clone, 'scripts/install-hooks.sh'), '#!/usr/bin/env bash\necho hooks\n');
    await writeFile(path.join(bin, 'gh'), STUB_GH);
    await writeFile(log, '');
    await writeFile(bodies, '');
    for (const file of ['scripts/bootstrap.sh', 'scripts/install-hooks.sh']) {
      await chmod(path.join(clone, file), 0o755);
    }
    await chmod(path.join(bin, 'gh'), 0o755);
    const init = spawnSync('git', ['init', '-q', clone], { env: BASE_ENV, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);

    const env = {
      ...BASE_ENV,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      STUB_LOG: log,
      STUB_BODIES: bodies,
      STUB_LIST: list === 'refused' ? 'refused' : JSON.stringify(list),
      STUB_SET: set,
      STUB_REFUSAL_BODY: REFUSAL_BODY,
      STUB_REFUSAL_MESSAGE: REFUSAL_MESSAGE,
    };
    const result = spawnSync('scripts/bootstrap.sh', [], { cwd: clone, env, encoding: 'utf8', input: '' });
    const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean);
    const sent = (await readFile(bodies, 'utf8')).split('\n').filter(Boolean).map((b) => JSON.parse(b));
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, sent };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const writes = (calls) => calls.filter((c) => /^api -X (PUT|POST) /.test(c));
const lines = (text) => text.split('\n').filter(Boolean);
const named = (sent, name) => sent.find((r) => r.name === name);
const rule = (ruleset, type) => ruleset.rules.find((r) => r.type === type);
// GitHub applies every rule in a ruleset whatever its order, so the cases compare the set of types.
const ruleTypes = (ruleset) => ruleset.rules.map((r) => r.type).sort();

test('a refused rulesets list sets no ruleset and warns once with the API message', async () => {
  const run = await bootstrap({ list: 'refused' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(writes(run.calls), [], 'no PUT or POST after a refused list');
  const warnings = lines(run.stderr);
  assert.equal(warnings.length, 1, `one warning, got:\n${run.stderr}`);
  assert.ok(warnings[0].includes(REFUSAL_MESSAGE), `the warning carries the API message:\n${warnings[0]}`);
  assert.ok(!run.stderr.includes('documentation_url'), 'the refusal body is never used as an id');
});

test('a ruleset the list already has is updated in place by its id', needsJq, async () => {
  const run = await bootstrap({
    list: [{ id: 7, name: 'other' }, { id: 42, name: 'main' }, { id: 9, name: 'integration-branches' }],
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(writes(run.calls), [
    'api -X PUT repos/owner/repo/rulesets/42 --input -',
    'api -X PUT repos/owner/repo/rulesets/9 --input -',
  ]);
  assert.equal(run.stderr, '');
  assert.match(run.stdout, /^Ruleset main: /m);
  assert.match(run.stdout, /^Ruleset integration-branches: /m);
});

test('a ruleset the list does not have is created', needsJq, async () => {
  const run = await bootstrap({ list: [{ id: 7, name: 'main-old' }, { id: 8, name: 'integration-branches-old' }] });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(writes(run.calls), [
    'api -X POST repos/owner/repo/rulesets --input -',
    'api -X POST repos/owner/repo/rulesets --input -',
  ]);
  assert.deepEqual(run.sent.map((r) => r.name), ['main', 'integration-branches']);
  assert.equal(run.stderr, '');
});

test('a refused write still warns for that ruleset and the script goes on', needsJq, async () => {
  const run = await bootstrap({ list: [], set: 'refused' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(writes(run.calls).length, 2);
  // Whole lines, so a warning that reads wrong around the ruleset's description fails here.
  assert.deepEqual(lines(run.stderr).filter((l) => !l.startsWith('gh: ')), [
    'Could not set ruleset main, so this does not hold: the default branch takes changes only by PR' +
      ' with verify green and one approval, admin bypass aside.',
    'The gh error above says why; on a private repo, a plan without rulesets is the usual cause.',
    'Could not set ruleset integration-branches, so this does not hold: every integration/* branch' +
      ' takes changes only by PR with verify green, no bypass.',
    'The gh error above says why; on a private repo, a plan without rulesets is the usual cause.',
  ]);
});

test('the integration-branches ruleset takes changes only by PR with verify green, and has no bypass', needsJq, async () => {
  const run = await bootstrap({ list: [] });
  assert.equal(run.status, 0, run.stderr);
  const integration = named(run.sent, 'integration-branches');
  assert.ok(integration, `a ruleset named integration-branches is sent, got: ${run.sent.map((r) => r.name)}`);
  assert.equal(integration.target, 'branch');
  assert.equal(integration.enforcement, 'active');
  assert.deepEqual(integration.conditions.ref_name.include, ['refs/heads/integration/*']);
  assert.deepEqual(integration.bypass_actors, []);
  // No deletion rule: the branch is deleted once its integration PR merges.
  assert.deepEqual(ruleTypes(integration), ['non_fast_forward', 'pull_request', 'required_status_checks']);
  assert.equal(rule(integration, 'pull_request').parameters.required_approving_review_count, 0);
  assert.deepEqual(rule(integration, 'required_status_checks').parameters.required_status_checks, [{ context: 'verify' }]);
});

// The live `main` ruleset on this repo, as the owner set it (#38): the default-branch ruleset must
// carry all of it, so a bootstrap run never weakens it, and add only the `verify` check.
test('the default-branch ruleset is named main and keeps the admin bypass and every live rule', needsJq, async () => {
  const run = await bootstrap({ list: [] });
  assert.equal(run.status, 0, run.stderr);
  const main = named(run.sent, 'main');
  assert.ok(main, `a ruleset named main is sent, got: ${run.sent.map((r) => r.name)}`);
  assert.equal(main.target, 'branch');
  assert.equal(main.enforcement, 'active');
  assert.deepEqual(main.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(main.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]);
  assert.deepEqual(ruleTypes(main),
    ['deletion', 'non_fast_forward', 'pull_request', 'required_linear_history', 'required_status_checks']);
  assert.deepEqual(rule(main, 'pull_request').parameters, {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: false,
    required_reviewers: [],
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
    require_extra_approval_for_unattributed_changes: true,
    allowed_merge_methods: ['merge', 'squash', 'rebase'],
  });
  assert.deepEqual(rule(main, 'required_status_checks').parameters, {
    strict_required_status_checks_policy: true,
    do_not_enforce_on_create: false,
    required_status_checks: [{ context: 'verify' }],
  });
});
