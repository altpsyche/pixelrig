// Tests for the finding verifier. Most drive its seam, `run(input, { client, root })`, with a fake
// client returning canned Noul answers; the CLI tests run it as a subprocess, as a Reviewer would,
// against a fake Jev server on localhost. Nothing reaches Jev or needs a key.

import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { fakeJev } from './fake-jev.mjs';
import { human, run } from './verify-findings.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A draft finding as a Reviewer writes it: the finding, the line it quotes, the source it cites,
// and the text of that source it relies on.
function finding(overrides = {}) {
  return {
    text: 'The CLI prints the raw error, so a message that echoes the key prints the key.',
    quote: 'console.log(`request failed: ${error.message}`);',
    source: 'scripts/jev/client.mjs, errorLine',
    excerpt: 'The client redacts the key from its own errors; a CLI never sees the key.',
    ...overrides,
  };
}

// A client that answers each Noul with the next value from `nouls`, in the order its questions
// arrive, and records every request.
function fakeClient(nouls = []) {
  const calls = [];
  const queue = [...nouls];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      const answers = {};
      for (const id of Object.keys(request.questions)) answers[id] = { type: 'noul', noul: queue.shift() ?? 0.9 };
      return { status: 'ok', answers };
    },
  };
}

const asked = (client) => client.calls.flatMap((c) => Object.values(c.questions));

test('keeps a supported finding and flags an unsupported one, from one request of Noul questions', async () => {
  const client = fakeClient([0.92, 0.12]);
  const result = await run([finding({ id: 'F1' }), finding({ id: 'F2', quote: 'MARK-F2' })], { client });
  assert.deepEqual(result, {
    status: 'ok',
    findings: [
      { id: 'F1', decision: 'keep', noul: 0.92, reason: 'checked' },
      { id: 'F2', decision: 'flag', noul: 0.12, reason: 'checked' },
    ],
  });
  assert.equal(client.calls.length, 1);
  const questions = asked(client);
  assert.equal(questions.length, 2);
  assert.ok(questions.every((q) => q.type === 'noul'));
  // Each question carries its own finding, so the batches can split them.
  assert.ok(JSON.stringify(questions[1]).includes('MARK-F2'));
  assert.ok(!JSON.stringify(questions[0]).includes('MARK-F2'));
});

// The band edge sits at 0.7 (VERIFY_KEEP_NOUL): a retune that moves it fails these on purpose.
test('keeps a finding exactly at the 0.7 threshold or just above it, and flags one just below', async () => {
  const client = fakeClient([0.69, 0.7, 0.71]);
  const result = await run([finding({ id: 'A' }), finding({ id: 'B' }), finding({ id: 'C' })], { client });
  assert.deepEqual(
    result.findings.map((f) => [f.id, f.decision]),
    [
      ['A', 'flag'],
      ['B', 'keep'],
      ['C', 'keep'],
    ],
  );
});

test('never drops a finding: every one comes back, in input order, however low its noul', async () => {
  const client = fakeClient([0, 0, 0]);
  const result = await run([finding(), finding(), finding()], { client });
  assert.deepEqual(
    result.findings.map((f) => [f.id, f.decision]),
    [
      ['F1', 'flag'],
      ['F2', 'flag'],
      ['F3', 'flag'],
    ],
  );
});

test('a finding whose source names the constitution is kept unasked', async () => {
  const client = fakeClient([0.05]);
  const constitutional = finding({ id: 'C1', source: 'docs/workflow.md § Review checklist, The constitution' });
  const result = await run([constitutional, finding({ id: 'F2' })], { client });
  assert.deepEqual(result.findings, [
    { id: 'C1', decision: 'keep', noul: null, reason: 'constitution' },
    { id: 'F2', decision: 'flag', noul: 0.05, reason: 'checked' },
  ]);
  assert.equal(asked(client).length, 1);
});

// This repo's own constitution bullet, which wraps onto a second line in docs/workflow.md.
for (const [name, excerpt] of [
  ['the whole bullet', 'No secret, credential, or personal or confidential data is committed, logged, or shared beyond where the owner put it.'],
  ["the bullet's opening words, cut short, in another case", 'NO SECRET, CREDENTIAL, OR PERSONAL…'],
]) {
  test(`a finding whose excerpt quotes ${name} is kept unasked, whatever its source says`, async () => {
    const client = fakeClient([0.05]);
    const result = await run([finding({ source: 'docs/workflow.md:150', excerpt })], { client });
    assert.deepEqual(result.findings, [{ id: 'F1', decision: 'keep', noul: null, reason: 'constitution' }]);
    assert.equal(client.calls.length, 0);
  });
}

test('a finding citing a checklist line outside the constitution is still checked', async () => {
  const client = fakeClient([0.05]);
  const excerpt = 'A behaviour change has a check that fails without it.';
  const result = await run([finding({ source: 'docs/workflow.md § Review checklist', excerpt })], { client });
  assert.deepEqual(result.findings, [{ id: 'F1', decision: 'flag', noul: 0.05, reason: 'checked' }]);
});

// A checklist whose constitution bullet wraps, its second sentence only on the continuation line.
async function withChecklist(checklist, fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-verify-'));
  try {
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs/workflow.md'), checklist);
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a constitution clause on a bullet\'s continuation line counts as citing it', () =>
  withChecklist(
    '## Review checklist\n\n**The constitution** — blocks\n\n- Ship no telemetry of any\n  kind. Never sell what users enter.\n\n**Domain**\n\n- Keep the build green.\n',
    async (root) => {
      const client = fakeClient([0.05, 0.05]);
      const input = [finding({ excerpt: 'never sell what users enter' }), finding({ excerpt: 'Keep the build green.' })];
      const result = await run(input, { client, root });
      assert.deepEqual(
        result.findings.map((f) => f.reason),
        ['constitution', 'checked'],
      );
    },
  ));

test('a checklist with no constitution bullets is an error, not a run without the exemption', () =>
  withChecklist('## Review checklist\n\n**Correctness**\n\n- Every criterion is met.\n', async (root) => {
    const client = fakeClient();
    const result = await run([finding()], { client, root });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /constitution/);
    assert.equal(client.calls.length, 0);
  }));

// About 33k tokens at the estimate's 3 characters a token: too large to sit beside the state.
const HUGE = 'x'.repeat(100_000);

test('a finding too large to ask about is kept unasked, and the rest are still checked', async () => {
  const client = fakeClient([0.1]);
  const result = await run([finding({ id: 'BIG', excerpt: HUGE }), finding({ id: 'F2' })], { client });
  assert.deepEqual(result.findings, [
    { id: 'BIG', decision: 'keep', noul: null, reason: 'too-large' },
    { id: 'F2', decision: 'flag', noul: 0.1, reason: 'checked' },
  ]);
  assert.equal(asked(client).length, 1);
});

// Each about 22k tokens: one fits beside the state, but three do not fit one 64k request.
const LARGE = 'x'.repeat(66_000);

test('through the real client, findings beyond one request go in several, and none is dropped', async () => {
  const jev = await fakeJev((request) => ({
    status: 200,
    body: { answers: Object.fromEntries(Object.keys(request.body.questions).map((id) => [id, { type: 'noul', noul: 0.8 }])) },
  }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
    const input = [finding({ excerpt: LARGE }), finding({ excerpt: LARGE }), finding({ excerpt: LARGE }), finding()];
    const result = await run(input, { client });
    assert.equal(result.status, 'ok');
    assert.ok(jev.requests.length >= 2, `expected several requests, got ${jev.requests.length}`);
    assert.equal(jev.requests.reduce((n, r) => n + Object.keys(r.body.questions).length, 0), 4);
    assert.deepEqual(result.findings.map((f) => [f.id, f.decision]), [
      ['F1', 'keep'],
      ['F2', 'keep'],
      ['F3', 'keep'],
      ['F4', 'keep'],
    ]);
  } finally {
    await jev.close();
  }
});

for (const [name, input] of [
  ['no findings at all', []],
  ['something other than an array', { text: 'one finding, not in a list' }],
  ['a finding with a blank quote', [finding({ quote: '   ' })]],
  ['a finding with no excerpt', [{ text: 't', quote: 'q', source: 's' }]],
  ['two findings with one id', [finding({ id: 'F1' }), finding({ id: 'F1' })]],
  ['a finding that is not an object', ['F1: the key is logged']],
  ['an id that is not a string', [finding({ id: 7 })]],
]) {
  test(`input with ${name} is one error line and never reaches Jev`, async () => {
    const client = fakeClient();
    const result = await run(input, { client });
    assert.equal(result.status, 'error');
    assert.ok(!result.reason.includes('\n'));
    assert.equal(client.calls.length, 0);
  });
}

test('a defaulted id that collides with a given one says how to fix it', async () => {
  const result = await run([finding({ id: 'F2' }), finding()], { client: fakeClient() });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /give every finding an id/);
});

test('an answer that is not a probability is an error, never a silent keep', async () => {
  const client = fakeClient([Number.NaN]);
  const result = await run([finding()], { client });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /no usable answer/);
});

test('with no key it skips before reading the input or the checklist', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jev-verify-'));
  try {
    const result = await run('not findings', { client: createClient({ env: {} }), root });
    assert.deepEqual(result, { status: 'skipped', reason: 'TYPESAFE_API_KEY is not set' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed request is an error, handled like a skip', async () => {
  const jev = await fakeJev(() => ({ status: 401, body: 'invalid key' }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
    const result = await run([finding()], { client });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /401/);
    assert.equal(jev.requests.length, 1);
  } finally {
    await jev.close();
  }
});

test('the default output is one line per finding, and a flag line says what to do', async () => {
  const client = fakeClient([0.92, 0.31]);
  const input = [
    finding({ id: 'F1' }),
    finding({ id: 'F2' }),
    finding({ id: 'F3', source: 'docs/workflow.md § The constitution' }),
    finding({ id: 'F4', excerpt: HUGE }),
  ];
  assert.equal(
    human(await run(input, { client })),
    [
      'F1: keep (noul 0.92)',
      'F2: flag (noul 0.31) - re-read the cited source once, then keep or drop the finding',
      'F3: keep (cites the constitution, never flagged)',
      'F4: keep (too large to check)',
    ].join('\n'),
  );
});

// The CLI, run as a Reviewer runs it: a subprocess against the fake server, with no TYPESAFE_
// variable from the owner's shell, so it only has the key and base URL a test sets.
const CLI = path.join(HERE, 'verify-findings-cli.mjs');
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TYPESAFE_')));

async function runCli(args, { env = {}, stdin = '' } = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...BASE_ENV, TYPESAFE_ENV_FILE: 'none', ...env } });
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stdin.end(stdin);
  const status = await new Promise((resolve) => child.on('close', resolve));
  return { status, stdout };
}

const noulsOf = (value) => (request) => ({
  status: 200,
  body: { answers: Object.fromEntries(Object.keys(request.body.questions).map((id) => [id, { type: 'noul', noul: value }])) },
});

test('the CLI with no key prints one skip line and exits 0, without reading the findings', async () => {
  const { status, stdout } = await runCli(['/nonexistent/findings.json']);
  assert.equal(status, 0);
  assert.equal(stdout, 'jev verify-findings: skipped, TYPESAFE_API_KEY is not set; continue as normal\n');
});

test('the CLI on a failed request prints one error line and exits 0', async () => {
  const jev = await fakeJev(() => ({ status: 500, body: 'server error' }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli([], { env, stdin: JSON.stringify([finding()]) });
    assert.equal(status, 0);
    assert.match(stdout, /^jev verify-findings: error, [^\n]*500[^\n]*; continue as normal\n$/);
  } finally {
    await jev.close();
  }
});

test('the CLI turns empty or non-JSON input into one error line, with no request', async () => {
  const jev = await fakeJev(noulsOf(0.9));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const empty = await runCli([], { env, stdin: '  \n' });
    assert.match(empty.stdout, /^jev verify-findings: error, [^\n]*no findings[^\n]*\n$/);
    const prose = await runCli([], { env, stdin: 'F1: the key is logged\n' });
    assert.match(prose.stdout, /^jev verify-findings: error, [^\n]*JSON[^\n]*\n$/);
    assert.equal(jev.requests.length, 0);
  } finally {
    await jev.close();
  }
});

test('the CLI reads findings from a file and prints one line per finding', async () => {
  const jev = await fakeJev(noulsOf(0.5));
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-verify-cli-'));
  try {
    const file = path.join(dir, 'findings.json');
    await writeFile(file, JSON.stringify([finding({ id: 'F1' }), finding({ id: 'C', source: 'The constitution' })]));
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli([file], { env });
    assert.equal(status, 0);
    assert.equal(
      stdout,
      'F1: flag (noul 0.50) - re-read the cited source once, then keep or drop the finding\n' +
        'C: keep (cites the constitution, never flagged)\n',
    );
    assert.equal(jev.requests.length, 1);
    assert.equal(jev.requests[0].body.model, 'jev-1.13.0');
  } finally {
    await jev.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the CLI reads findings from stdin and prints JSON with --json', async () => {
  const jev = await fakeJev(noulsOf(0.9));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli(['--json'], { env, stdin: JSON.stringify([finding()]) });
    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(stdout), {
      status: 'ok',
      findings: [{ id: 'F1', decision: 'keep', noul: 0.9, reason: 'checked' }],
    });
  } finally {
    await jev.close();
  }
});
