// Tests for the doc pruner. Most drive its seam, `run(input, { client, root })`, with a fake client
// over a small git repo built in a temp dir, so unit discovery is proven on a real tree. The CLI
// tests run it as a subprocess, as an agent would, against a fake Jev server on localhost and with
// a `gh` stub first on PATH. Nothing reaches Jev or needs a key.

import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { fakeJev } from './fake-jev.mjs';
import { runCli as runCliAs } from './cli-runner.mjs';
import { human, run } from './prune.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = { title: 'Retry failed writes', body: 'Retry failed writes from the outbox.', files: ['src/sync/outbox.js'] };

// Git with no caller config, and no GIT_DIR from an outer hook (verify.sh runs inside the real
// pre-push), so it cannot touch the real repo. No TYPESAFE_ variable from the owner's shell either,
// so a CLI test only ever has the key and base URL it sets.
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('TYPESAFE_')),
);
Object.assign(GIT_ENV, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

// A minimal repo with every shape the pruner reads. Each unit's text carries a marker the fake
// client keys its answers on, so no test depends on how the question is worded.
const BASE = {
  'AGENTS.md': '# Agents\n\nMARK-AGENTS\n',
  'README.md': '# Readme\n\nMARK-README\n',
  'docs/adr/0001-first.md': '# First\n\nMARK-ADR-1\n',
  'docs/adr/0002-second.md': '# Second\n\nMARK-ADR-2\n',
  'docs/specs/outbox.md': '# Outbox spec\n\nMARK-SPEC\n',
  'docs/idea.md': '# Idea\n\nMARK-INTRO\n\n## 1. Vision\n\nMARK-VISION\n\n### Detail\n\nMARK-DETAIL\n\n## 2. Sync\n\nMARK-SYNC\n',
  'docs/workflow.md': '# Workflow\n\nMARK-WORKFLOW\n',
  'docs/agents/jev.md': '# Registry\n\nMARK-REGISTRY\n',
  'src/sync/README.md': '# Sync\n\nMARK-COLOCATED\n',
  '.agents/skills/x/SKILL.md': '# Skill\n\nMARK-SKILL\n',
  'evals/README.md': '# Evals\n\nMARK-EVALS\n',
  'evals/work/red-baseline.md': '# Case\n\nMARK-EVAL-CASE\n',
};
const UNITS = ['MARK-ADR-1', 'MARK-ADR-2', 'MARK-SPEC', 'MARK-INTRO', 'MARK-VISION', 'MARK-SYNC', 'MARK-COLOCATED'];

async function withRepo(files, fn, { untracked = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-prune-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: root, env: GIT_ENV });
    execFileSync('git', ['add', '-f', '--', ...Object.keys(files)], { cwd: root, env: GIT_ENV });
    for (const [file, text] of Object.entries(untracked)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A client that answers each Noul with the value for the first marker its question contains, or
// `fallback` when it contains none. `calls` records every request.
function fakeClient(nouls = {}, fallback = 0.9) {
  const calls = [];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      const answers = {};
      for (const [id, question] of Object.entries(request.questions)) {
        const text = JSON.stringify(question);
        const marker = Object.keys(nouls).find((m) => text.includes(m));
        answers[id] = { type: 'noul', noul: marker ? nouls[marker] : fallback };
      }
      return { status: 'ok', answers };
    },
  };
}

const asked = (client) => client.calls.flatMap((c) => Object.values(c.questions).map((q) => JSON.stringify(q)));
const listed = (result) => result.read.map(({ path: p, heading }) => (heading ? `${p} § ${heading}` : p));

test('the read list is AGENTS.md first, then each unit Jev finds relevant, in precedence order', () =>
  withRepo(BASE, async (root) => {
    const nouls = { 'MARK-ADR-1': 0.9, 'MARK-ADR-2': 0.05, 'MARK-SPEC': 0.6, 'MARK-SYNC': 0.7, 'MARK-COLOCATED': 0.3 };
    const result = await run(WORK, { client: fakeClient(nouls, 0), root });
    assert.equal(result.status, 'ok');
    assert.deepEqual(listed(result), [
      'AGENTS.md',
      'docs/adr/0001-first.md',
      'docs/specs/outbox.md',
      'docs/idea.md § 2. Sync',
      'src/sync/README.md',
    ]);
    assert.deepEqual(result.read[0], { path: 'AGENTS.md', reason: 'always' });
    assert.deepEqual(result.read[1], { path: 'docs/adr/0001-first.md', reason: 'relevant', noul: 0.9 });
  }));

// The band edge sits at 0.2 (PRUNE_INCLUDE_NOUL): a retune that moves it fails these on purpose.
test('a unit at exactly the 0.2 threshold is included, just above is included, just below is not', () =>
  withRepo(BASE, async (root) => {
    const nouls = { 'MARK-ADR-1': 0.2, 'MARK-ADR-2': 0.19, 'MARK-SPEC': 0.21 };
    const result = await run(WORK, { client: fakeClient(nouls, 0), root });
    assert.deepEqual(listed(result), ['AGENTS.md', 'docs/adr/0001-first.md', 'docs/specs/outbox.md']);
  }));

// The CLI contract (README § Adding a tool): one line per answer. Every unit gets exactly one line,
// a `skip` one as much as a `read` one, and an oversize unit says it was never asked.
test('the line output has one line per unit, read or skip, and marks AGENTS.md and oversize units', () =>
  withRepo({ ...BASE, 'docs/adr/0003-huge.md': `MARK-HUGE ${'x'.repeat(100_000)}` }, async (root) => {
    const result = await run(WORK, { client: fakeClient({ 'MARK-ADR-1': 0.9, 'MARK-SYNC': 0.25 }, 0.05), root });
    assert.deepEqual(result.skip.map((e) => e.path), [
      'docs/adr/0002-second.md',
      'docs/specs/outbox.md',
      'docs/idea.md',
      'docs/idea.md',
      'src/sync/README.md',
    ]);
    assert.equal(
      human(result),
      [
        'read AGENTS.md (always)',
        'read docs/adr/0001-first.md (noul 0.90)',
        'read docs/adr/0003-huge.md (oversize, not asked)',
        'read docs/idea.md § 2. Sync (noul 0.25)',
        'skip docs/adr/0002-second.md (noul 0.05)',
        'skip docs/specs/outbox.md (noul 0.05)',
        'skip docs/idea.md § Idea (noul 0.05)',
        'skip docs/idea.md § 1. Vision (noul 0.05)',
        'skip src/sync/README.md (noul 0.05)',
      ].join('\n'),
    );
    assert.equal(human({ status: 'skipped', reason: 'no key' }), 'jev prune: skipped, no key; read the docs as normal');
  }));

test('AGENTS.md is on the read list even when Jev finds nothing relevant, and is never asked about', () =>
  withRepo(BASE, async (root) => {
    const client = fakeClient({}, 0);
    const result = await run(WORK, { client, root });
    assert.deepEqual(result.read, [{ path: 'AGENTS.md', reason: 'always' }]);
    assert.ok(!asked(client).some((q) => q.includes('MARK-AGENTS')));
  }));

test('units are ADRs, specs, idea.md sections at # and ## and co-located docs; nothing else is asked', () =>
  withRepo(
    BASE,
    async (root) => {
      const client = fakeClient();
      await run({ ...WORK, diff: 'MARK-DIFF' }, { client, root });
      assert.equal(client.calls.length, 1);
      const [request] = client.calls;
      assert.deepEqual(request.state, { work: { title: WORK.title, body: WORK.body, changed_files: WORK.files } });
      assert.ok(Object.values(request.questions).every((q) => q.type === 'noul'));
      for (const marker of UNITS) assert.equal(asked(client).filter((q) => q.includes(marker)).length, 1, marker);
      // A ### subsection stays inside its ## section.
      assert.ok(asked(client).some((q) => q.includes('MARK-VISION') && q.includes('MARK-DETAIL')));
      for (const marker of ['MARK-AGENTS', 'MARK-README', 'MARK-WORKFLOW', 'MARK-REGISTRY', 'MARK-SKILL', 'MARK-EVALS', 'MARK-EVAL-CASE', 'MARK-UNTRACKED', 'MARK-DIFF']) {
        assert.ok(!JSON.stringify(request).includes(marker), `${marker} reached Jev`);
      }
      assert.equal(Object.keys(request.questions).length, UNITS.length);
    },
    { untracked: { 'docs/adr/0003-draft.md': 'MARK-UNTRACKED', 'lib/notes.md': 'MARK-UNTRACKED' } },
  ));

test('a heading inside a code fence in docs/idea.md does not start a section', () =>
  withRepo(
    { ...BASE, 'docs/idea.md': '# Idea\n\n## 1. Code\n\n```\n## not a heading MARK-FENCED\n```\n' },
    async (root) => {
      const result = await run(WORK, { client: fakeClient(), root });
      assert.deepEqual(
        listed(result).filter((l) => l.startsWith('docs/idea.md')),
        ['docs/idea.md § Idea', 'docs/idea.md § 1. Code'],
      );
    },
  ));

// About 33k tokens at the estimate's 3 characters a token: too large to sit beside the state in
// one question (32k), so it is listed without asking.
const OVERSIZE = 'x'.repeat(100_000);

test('a unit too large to ask about is listed as oversize without asking, and the rest are asked', () =>
  withRepo({ ...BASE, 'docs/adr/0003-huge.md': `MARK-HUGE ${OVERSIZE}` }, async (root) => {
    const client = fakeClient({}, 0);
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.read, [
      { path: 'AGENTS.md', reason: 'always' },
      { path: 'docs/adr/0003-huge.md', reason: 'oversize' },
    ]);
    assert.ok(!asked(client).some((q) => q.includes('MARK-HUGE')));
    assert.equal(asked(client).length, UNITS.length);
  }));

test('a unit that fits alone but not beside a large work body is listed as oversize', () =>
  withRepo({ ...BASE, 'docs/adr/0003-big.md': `MARK-BIG ${'x'.repeat(60_000)}` }, async (root) => {
    const client = fakeClient({}, 0);
    const big = { ...WORK, body: 'y'.repeat(40_000) };
    const result = await run(big, { client, root });
    assert.deepEqual(result.read.at(-1), { path: 'docs/adr/0003-big.md', reason: 'oversize' });
    const alone = await run(WORK, { client: fakeClient({}, 0), root });
    assert.equal(alone.read.length, 1, 'with a short body the same unit is asked, not oversize');
  }));

test('a blank title is an error and never reaches Jev', () =>
  withRepo(BASE, async (root) => {
    const client = fakeClient();
    const result = await run({ title: '  ', body: 'x' }, { client, root });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /no title/);
    assert.equal(client.calls.length, 0);
  }));

test('a docs tree without docs/idea.md is an error, not a shorter read list', () =>
  withRepo(Object.fromEntries(Object.entries(BASE).filter(([f]) => f !== 'docs/idea.md')), async (root) => {
    const client = fakeClient();
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'error');
    assert.equal(client.calls.length, 0);
  }));

test('an answer that is not a probability is an error, not a silent exclusion', () =>
  withRepo(BASE, async (root) => {
    const client = fakeClient({ 'MARK-SPEC': 'high' }, 0.9);
    const result = await run(WORK, { client, root });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /no usable answer/);
  }));

test('with no key it skips before reading anything, even outside a git repo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-prune-'));
  try {
    const result = await run(WORK, { client: createClient({ env: {} }), root });
    assert.deepEqual(result, { status: 'skipped', reason: 'TYPESAFE_API_KEY is not set' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed request is an error, handled like a skip', () =>
  withRepo(BASE, async (root) => {
    const jev = await fakeJev(() => ({ status: 401, body: 'invalid key' }));
    try {
      const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
      const result = await run(WORK, { client, root });
      assert.equal(result.status, 'error');
      assert.match(result.reason, /401/);
      assert.equal(jev.requests.length, 1);
    } finally {
      await jev.close();
    }
  }));

// Each about 22k tokens: one fits beside the state, but three do not fit one 64k request.
const LARGE = 'x'.repeat(66_000);
const nouls = (value) => (request) => ({
  status: 200,
  body: { answers: Object.fromEntries(Object.keys(request.body.questions).map((id) => [id, { type: 'noul', noul: value }])) },
});

test('through the real client, units beyond one request go in several, and their answers merge', () =>
  withRepo(
    { ...BASE, 'docs/adr/0003-a.md': `A ${LARGE}`, 'docs/adr/0004-b.md': `B ${LARGE}`, 'docs/adr/0005-c.md': `C ${LARGE}` },
    async (root) => {
      const jev = await fakeJev(nouls(0.5));
      try {
        const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
        const result = await run(WORK, { client, root });
        assert.equal(result.status, 'ok');
        assert.ok(jev.requests.length >= 2, `expected several requests, got ${jev.requests.length}`);
        assert.ok(jev.requests.every((r) => r.body.model === 'jev-1.13.0'));
        const total = jev.requests.reduce((n, r) => n + Object.keys(r.body.questions).length, 0);
        assert.equal(total, UNITS.length + 3);
        assert.equal(result.read.length, UNITS.length + 3 + 1);
      } finally {
        await jev.close();
      }
    },
  ));

// The CLI, run as an agent runs it, through cli-runner.mjs: a `gh` stub first on PATH, with the
// caller's PATH after it, since the CLI lists this repo's tracked docs with git. The CLI reads this
// repo's docs, so these tests assert only what does not depend on their content.
const CLI = path.join(HERE, 'prune-cli.mjs');

function runCli(args, { env = {}, stdin = '', gh = {} } = {}) {
  return runCliAs(CLI, args, { env: { ...GIT_ENV, ...env }, stdin, gh, keepPath: true });
}

test('the CLI with no key prints one skip line, exits 0 and never calls gh', async () => {
  const { status, stdout, ghCalls } = await runCli(['12']);
  assert.equal(status, 0);
  assert.equal(stdout, 'jev prune: skipped, TYPESAFE_API_KEY is not set; read the docs as normal\n');
  assert.deepEqual(ghCalls, []);
});

test('the CLI on a failed request prints one error line and exits 0', async () => {
  const jev = await fakeJev(() => ({ status: 500, body: 'server error' }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli([], { env, stdin: 'A title\nA body\n' });
    assert.equal(status, 0);
    assert.match(stdout, /^jev prune: error, [^\n]*500[^\n]*; read the docs as normal\n$/);
  } finally {
    await jev.close();
  }
});

test('the CLI reads a PR with its changed files and prints the read list, AGENTS.md first', async () => {
  const jev = await fakeJev(nouls(0.9));
  try {
    const pr = { title: 'Outbox retries', body: 'Retry writes.', files: [{ path: 'src/sync/outbox.js', additions: 3 }] };
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli(['12'], { env, gh: { 'pr view': JSON.stringify(pr) } });
    assert.equal(status, 0);
    assert.deepEqual(ghCalls, ['pr view 12 --json title,body,files']);
    for (const request of jev.requests) {
      assert.deepEqual(request.body.state, {
        work: { title: 'Outbox retries', body: 'Retry writes.', changed_files: ['src/sync/outbox.js'] },
      });
    }
    // Every unit was found relevant: AGENTS.md, then one `read` line per answer.
    const lines = stdout.trimEnd().split('\n');
    const questions = jev.requests.reduce((n, r) => n + Object.keys(r.body.questions).length, 0);
    assert.equal(lines[0], 'read AGENTS.md (always)');
    assert.equal(lines.length, questions + 1);
    assert.ok(lines.includes('read docs/adr/0002-jev-optional-dev-tooling.md (noul 0.90)'));
    assert.ok(lines.some((l) => /^read docs\/idea\.md § \S.* \(noul 0\.90\)$/.test(l)), 'no docs/idea.md section line');
  } finally {
    await jev.close();
  }
});

test('the CLI falls back to the issue when the number is not a PR, and prints JSON with --json', async () => {
  const jev = await fakeJev(nouls(0));
  try {
    const issue = { title: 'Doc pruner', body: 'Prune the docs.' };
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli(['8', '--json'], { env, gh: { 'issue view': JSON.stringify(issue) } });
    assert.equal(status, 0);
    assert.deepEqual(ghCalls, ['pr view 8 --json title,body,files', 'issue view 8 --json title,body']);
    assert.deepEqual(jev.requests[0].body.state, { work: { title: 'Doc pruner', body: 'Prune the docs.', changed_files: [] } });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.status, 'ok');
    assert.deepEqual(parsed.read, [{ path: 'AGENTS.md', reason: 'always' }]);
    const questions = jev.requests.reduce((n, r) => n + Object.keys(r.body.questions).length, 0);
    assert.equal(parsed.skip.length, questions);
    assert.ok(parsed.skip.every((e) => e.noul === 0));
  } finally {
    await jev.close();
  }
});

test('the CLI takes the first non-blank stdin line as the title, and never calls gh', async () => {
  const jev = await fakeJev(nouls(0));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli([], { env, stdin: '\n\nSome title\nthe body\n' });
    assert.equal(status, 0);
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines[0], 'read AGENTS.md (always)');
    assert.ok(lines.slice(1).every((l) => /^skip .+ \(noul 0\.00\)$/.test(l)), stdout);
    assert.deepEqual(ghCalls, []);
    assert.deepEqual(jev.requests[0].body.state, { work: { title: 'Some title', body: 'the body', changed_files: [] } });
  } finally {
    await jev.close();
  }
});

test('the CLI reads plain text with CRLF line endings from stdin, leaving no CR in the body', async () => {
  const jev = await fakeJev(nouls(0));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, ghCalls } = await runCli([], { env, stdin: 'Some title\r\nthe body\r\nmore body\r\n' });
    assert.equal(status, 0);
    assert.deepEqual(ghCalls, []);
    assert.deepEqual(jev.requests[0].body.state, { work: { title: 'Some title', body: 'the body\nmore body', changed_files: [] } });
  } finally {
    await jev.close();
  }
});
