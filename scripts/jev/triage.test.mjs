// Tests for the triage tool. Most drive its seam, `run(input, { client, root })`, with a fake client
// returning canned Jev answers; the CLI tests run it as a subprocess, as an agent would, against a
// fake Jev server on localhost and with a `gh` stub first on PATH. Nothing reaches Jev or needs a key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { fakeJev } from './fake-jev.mjs';
import { run } from './triage.mjs';
import { runCli } from './cli-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ISSUE = { title: 'Add a dark theme', body: 'The settings page needs a dark theme toggle.' };

// A client that answers every request with the given role and phase answers.
function fakeClient(role, phase) {
  const calls = [];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      return { status: 'ok', answers: { role: { type: 'choice', ...role }, phase: { type: 'choice', ...phase } } };
    },
  };
}

test('recommends both labels when Jev is confident, from one request of two Choices', async () => {
  const client = fakeClient({ choice: 'ready-for-agent', confidence: 0.93 }, { choice: 'phase:0', confidence: 0.85 });
  const result = await run(ISSUE, { client });
  assert.deepEqual(result, {
    status: 'ok',
    role: { label: 'ready-for-agent', confidence: 0.93, decision: 'recommend' },
    phase: { label: 'phase:0', confidence: 0.85, decision: 'recommend' },
  });
  assert.equal(client.calls.length, 1);
  const [request] = client.calls;
  assert.deepEqual(request.state, { issue: ISSUE });
  assert.equal(request.questions.role.type, 'choice');
  assert.equal(request.questions.phase.type, 'choice');
});

test('role options are the labels in docs/agents/triage-labels.md, less needs-triage, in table order', async () => {
  const client = fakeClient({ choice: 'needs-info', confidence: 0.9 }, { choice: 'phase:0', confidence: 0.9 });
  await run(ISSUE, { client });
  const { criteria } = client.calls[0].questions.role;
  assert.deepEqual(Object.keys(criteria), ['needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']);
  assert.equal(criteria['needs-info'], 'Waiting on the reporter for more information');
});

test('phase options are the docs/idea.md § Roadmap headings, each with its bullets', async () => {
  const client = fakeClient({ choice: 'needs-info', confidence: 0.9 }, { choice: 'phase:0', confidence: 0.9 });
  await run(ISSUE, { client });
  const { criteria } = client.calls[0].questions.phase;
  assert.deepEqual(Object.keys(criteria), ['phase:0', 'phase:1']);
  assert.match(criteria['phase:0'], /^Foundation: /);
  assert.match(criteria['phase:0'], /CI running every check/);
});

// The band edge sits at 0.8 (TRIAGE_CONFIDENT): a retune that moves it fails these on purpose.
test('a confidence just below the threshold leaves the answer open; just above recommends it', async () => {
  const client = fakeClient({ choice: 'needs-info', confidence: 0.79 }, { choice: 'phase:1', confidence: 0.81 });
  const result = await run(ISSUE, { client });
  assert.deepEqual(result.role, { label: 'needs-info', confidence: 0.79, decision: 'open' });
  assert.deepEqual(result.phase, { label: 'phase:1', confidence: 0.81, decision: 'recommend' });
});

test('the other way round: the role just above the threshold recommends; the phase just below is open', async () => {
  const client = fakeClient({ choice: 'wontfix', confidence: 0.81 }, { choice: 'phase:0', confidence: 0.79 });
  const result = await run(ISSUE, { client });
  assert.equal(result.role.decision, 'recommend');
  assert.equal(result.phase.decision, 'open');
});

test('a confidence exactly at the threshold recommends, for role and phase alike', async () => {
  const client = fakeClient({ choice: 'ready-for-human', confidence: 0.8 }, { choice: 'phase:1', confidence: 0.8 });
  const result = await run(ISSUE, { client });
  assert.equal(result.role.decision, 'recommend');
  assert.equal(result.phase.decision, 'recommend');
});

test('a choice that is not one of the options is an error', async () => {
  const client = fakeClient({ choice: 'needs-triage', confidence: 0.95 }, { choice: 'phase:0', confidence: 0.9 });
  const result = await run(ISSUE, { client });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /needs-triage/);
});

test('an issue with no title is an error and never reaches Jev', async () => {
  const client = fakeClient({ choice: 'needs-info', confidence: 0.9 }, { choice: 'phase:0', confidence: 0.9 });
  const result = await run({ title: '  ', body: '\n' }, { client });
  assert.equal(result.status, 'error');
  assert.equal(client.calls.length, 0);
});

test('with no key it skips before reading the docs, even where they are missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-triage-'));
  try {
    const result = await run(ISSUE, { client: createClient({ env: {} }), root });
    assert.deepEqual(result, { status: 'skipped', reason: 'TYPESAFE_API_KEY is not set' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed request is an error, handled like a skip', async () => {
  const jev = await fakeJev(() => ({ status: 401, body: 'invalid key' }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
    const result = await run(ISSUE, { client });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /401/);
    assert.equal(jev.requests.length, 1);
  } finally {
    await jev.close();
  }
});

// A repo root holding this repo's two docs, with the triage labels doc passed through `edit`.
async function withDocs(edit, fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-docs-'));
  try {
    await mkdir(path.join(root, 'docs', 'agents'), { recursive: true });
    const labels = await readFile(path.join(REPO, 'docs/agents/triage-labels.md'), 'utf8');
    await writeFile(path.join(root, 'docs/agents/triage-labels.md'), edit(labels));
    await writeFile(path.join(root, 'docs/idea.md'), await readFile(path.join(REPO, 'docs/idea.md'), 'utf8'));
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('role options follow the label column, so a renamed label is asked about live', () =>
  withDocs(
    (doc) => doc.replace('| `ready-for-agent` | `ready-for-agent` |', '| `ready-for-agent` | `agent-ready` |'),
    async (root) => {
      const client = fakeClient({ choice: 'agent-ready', confidence: 0.9 }, { choice: 'phase:0', confidence: 0.9 });
      const result = await run(ISSUE, { client, root });
      assert.equal(result.status, 'ok');
      assert.deepEqual(Object.keys(client.calls[0].questions.role.criteria), [
        'needs-info',
        'agent-ready',
        'ready-for-human',
        'wontfix',
      ]);
    },
  ));

test('a table row outside the five triage roles is an error, not silently dropped', () =>
  withDocs(
    (doc) => doc.replace('| `wontfix` | `wontfix` |', '| `duplicate` | `duplicate` | Tracked elsewhere |\n| `wontfix` | `wontfix` |'),
    async (root) => {
      const client = fakeClient({ choice: 'wontfix', confidence: 0.9 }, { choice: 'phase:0', confidence: 0.9 });
      const result = await run(ISSUE, { client, root });
      assert.equal(result.status, 'error');
      assert.match(result.reason, /duplicate/);
      assert.equal(client.calls.length, 0);
    },
  ));

// The CLI, run as an agent runs it, through cli-runner.mjs: a subprocess with a `gh` stub on PATH.
const CLI = path.join(HERE, 'triage-cli.mjs');

const ANSWERS = {
  role: { type: 'choice', choice: 'ready-for-agent', probabilities: {}, confidence: 0.93 },
  phase: { type: 'choice', choice: 'phase:0', probabilities: {}, confidence: 0.62 },
};

test('the CLI with no key prints one skip line, exits 0 and never calls gh', async () => {
  const { status, stdout, ghCalls } = await runCli(CLI, ['7'], { gh: { 'issue view': JSON.stringify(ISSUE) } });
  assert.equal(status, 0);
  assert.equal(stdout, 'jev triage: skipped, TYPESAFE_API_KEY is not set; triage as normal\n');
  assert.deepEqual(ghCalls, []);
});

test('the CLI on a failed request prints one error line and exits 0', async () => {
  const jev = await fakeJev(() => ({ status: 422, body: 'state too long' }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli(CLI, ['7'], { env, gh: { 'issue view': JSON.stringify(ISSUE) } });
    assert.equal(status, 0);
    assert.match(stdout, /^jev triage: error, [^\n]*422[^\n]*; triage as normal\n$/);
  } finally {
    await jev.close();
  }
});

test('the CLI prints one line per answer, reads the issue with gh and never edits it', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: { answers: ANSWERS } }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli(CLI, ['7'], { env, gh: { 'issue view': JSON.stringify(ISSUE) } });
    assert.equal(status, 0);
    assert.equal(
      stdout,
      'role: ready-for-agent (confidence 0.93) recommend\n' +
        'phase: phase:0 (confidence 0.62) open - phase unclear: ask the owner\n',
    );
    assert.deepEqual(ghCalls, ['issue view 7 --json title,body']);
    assert.deepEqual(jev.requests[0].body.state, { issue: ISSUE });
  } finally {
    await jev.close();
  }
});

test('the CLI prints JSON with --json, reading a plain-text issue from stdin', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: { answers: ANSWERS } }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli(CLI, ['--json'], { env, stdin: '\nAdd a dark theme\nThe body.\n' });
    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(stdout), {
      status: 'ok',
      role: { label: 'ready-for-agent', confidence: 0.93, decision: 'recommend' },
      phase: { label: 'phase:0', confidence: 0.62, decision: 'open' },
    });
    assert.deepEqual(ghCalls, []);
    assert.deepEqual(jev.requests[0].body.state, { issue: { title: 'Add a dark theme', body: 'The body.' } });
  } finally {
    await jev.close();
  }
});
