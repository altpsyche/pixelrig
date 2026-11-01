// Tests for the readiness tool. Most drive its seam, `run(input, { client })`, with a fake client
// returning canned Nouls; the CLI tests run it as a subprocess, as an agent would, against a fake
// Jev server on localhost and with a `gh` stub first on PATH. Nothing reaches Jev or needs a key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { fakeJev } from './fake-jev.mjs';
import { run } from './readiness.mjs';
import { runCli } from './cli-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TICKET = {
  title: 'Add a dark theme',
  body: [
    '## What to build',
    '',
    'A dark theme toggle on the settings page.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The settings page has a dark theme toggle',
    '- [x] The choice survives a reload',
    '',
    '## Blocked by',
    '',
    '- #3',
  ].join('\n'),
};
const PLAN = 'Plan:\n- [ ] Add the toggle (check: settings.test toggles it)\n';

// A client that answers every question it is asked with the noul given for its id, or `fallback`.
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
      for (const id of Object.keys(request.questions)) answers[id] = { type: 'noul', noul: nouls[id] ?? fallback };
      return { status: 'ok', answers };
    },
  };
}

test('asks two Nouls about the ticket alone when there is no plan, and passes confident answers', async () => {
  const client = fakeClient({ criteria: 0.95, seams: 0.9 });
  const result = await run(TICKET, { client });
  assert.deepEqual(result, {
    status: 'ok',
    criteria: { decision: 'pass', noul: 0.95 },
    seams: { decision: 'pass', noul: 0.9 },
    plan: null,
  });
  assert.equal(client.calls.length, 1);
  const [request] = client.calls;
  assert.deepEqual(request.state, { ticket: TICKET });
  assert.deepEqual(Object.keys(request.questions), ['criteria', 'seams']);
  for (const q of Object.values(request.questions)) {
    assert.equal(q.type, 'noul');
    assert.deepEqual(Object.keys(q.criteria), ['true', 'false']);
  }
});

test('with a plan, asks one Noul per acceptance criterion, naming the criterion, over ticket and plan', async () => {
  const client = fakeClient({ criterion_1: 0.92, criterion_2: 0.1 });
  const result = await run({ ...TICKET, plan: PLAN }, { client });
  assert.deepEqual(result.plan, [
    { criterion: 'The settings page has a dark theme toggle', decision: 'pass', noul: 0.92 },
    { criterion: 'The choice survives a reload', decision: 'gap', noul: 0.1 },
  ]);
  const [request] = client.calls;
  assert.deepEqual(request.state, { ticket: TICKET, plan: PLAN });
  // Quoted as JSON, since ticket text is untrusted (ADR-0002).
  assert.ok(request.questions.criterion_1.instructions.includes('"The settings page has a dark theme toggle"'));
  assert.ok(request.questions.criterion_2.instructions.includes('"The choice survives a reload"'));
});

test('criteria are read from numbered or starred lists too, and end at the next heading', async () => {
  const body = '### Acceptance Criteria\n1. First thing\n* Second thing\n\n### Notes\n- not a criterion\n';
  const client = fakeClient();
  const result = await run({ title: 'T', body, plan: PLAN }, { client });
  assert.deepEqual(result.plan.map((p) => p.criterion), ['First thing', 'Second thing']);
});

test('criteria are read from a body with CRLF line endings, as the GitHub web form submits', async () => {
  const body = TICKET.body.replaceAll('\n', '\r\n');
  const client = fakeClient();
  const result = await run({ title: TICKET.title, body, plan: PLAN }, { client });
  assert.deepEqual(result.plan.map((p) => p.criterion), ['The settings page has a dark theme toggle', 'The choice survives a reload']);
});

test('with a plan but no acceptance criteria section, the plan list is empty and only two Nouls are asked', async () => {
  const client = fakeClient({ criteria: 0.05 });
  const result = await run({ title: 'Vague', body: 'Make it better.', plan: PLAN }, { client });
  assert.deepEqual(result.plan, []);
  assert.deepEqual(result.criteria, { decision: 'gap', noul: 0.05 });
  assert.deepEqual(Object.keys(client.calls[0].questions), ['criteria', 'seams']);
});

// The band edge sits at 0.7 (READINESS_PASS): a retune that moves it fails these on purpose.
test('a noul just below the threshold is a gap; just above, or exactly at it, passes', async () => {
  const client = fakeClient({ criteria: 0.69, seams: 0.71, criterion_1: 0.7, criterion_2: 0.69 });
  const result = await run({ ...TICKET, plan: PLAN }, { client });
  assert.equal(result.criteria.decision, 'gap');
  assert.equal(result.seams.decision, 'pass');
  assert.equal(result.plan[0].decision, 'pass');
  assert.equal(result.plan[1].decision, 'gap');
});

test('a noul outside 0 to 1 is an error, not a band', async () => {
  const result = await run(TICKET, { client: fakeClient({ seams: 1.4 }) });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /seams/);
});

test('a ticket with no title is an error and never reaches Jev', async () => {
  const client = fakeClient();
  const result = await run({ title: ' ', body: 'x' }, { client });
  assert.equal(result.status, 'error');
  assert.equal(client.calls.length, 0);
});

test('a blank plan is an error and never reaches Jev', async () => {
  const client = fakeClient();
  const result = await run({ ...TICKET, plan: '  \n' }, { client });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /plan/);
  assert.equal(client.calls.length, 0);
});

test('with no key it skips before any other work, even on input it would reject', async () => {
  const result = await run({ title: '' }, { client: createClient({ env: {} }) });
  assert.deepEqual(result, { status: 'skipped', reason: 'TYPESAFE_API_KEY is not set' });
});

test('a failed request is an error, handled like a skip', async () => {
  const jev = await fakeJev(() => ({ status: 401, body: 'invalid key' }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
    const result = await run(TICKET, { client });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /401/);
    assert.equal(jev.requests.length, 1);
  } finally {
    await jev.close();
  }
});

// The CLI, run as an agent runs it, through cli-runner.mjs: a subprocess with a `gh` stub on PATH.
const CLI = path.join(HERE, 'readiness-cli.mjs');
const GH = { 'issue view': JSON.stringify(TICKET) };

// A fake Jev server that answers each question with the noul given for its id.
function nouls(byId) {
  return (request) => ({
    status: 200,
    body: { answers: Object.fromEntries(Object.keys(request.body.questions).map((id) => [id, { type: 'noul', noul: byId[id] }])) },
  });
}

test('the CLI with no key prints one skip line, exits 0 and never calls gh', async () => {
  const { status, stdout, ghCalls } = await runCli(CLI, ['7'], { gh: GH });
  assert.equal(status, 0);
  assert.equal(stdout, 'jev readiness: skipped, TYPESAFE_API_KEY is not set; check readiness yourself\n');
  assert.deepEqual(ghCalls, []);
});

test('the CLI on a failed request prints one error line and exits 0', async () => {
  const jev = await fakeJev(() => ({ status: 422, body: 'state too long' }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli(CLI, ['7'], { env, gh: GH });
    assert.equal(status, 0);
    assert.match(stdout, /^jev readiness: error, [^\n]*422[^\n]*; check readiness yourself\n$/);
  } finally {
    await jev.close();
  }
});

test('the CLI prints one line per check, reading the issue with gh and the plan from --plan', async () => {
  const jev = await fakeJev(nouls({ criteria: 0.93, seams: 0.4, criterion_1: 0.88, criterion_2: 0.2 }));
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-plan-'));
  try {
    const planFile = path.join(dir, 'plan.md');
    await writeFile(planFile, PLAN);
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli(CLI, ['7', '--plan', planFile], { env, gh: GH });
    assert.equal(status, 0);
    assert.equal(
      stdout,
      'criteria: pass (noul 0.93)\n' +
        'seams: gap (noul 0.40) - name the seams the work is checked at, or raise it with the owner\n' +
        'plan: criterion 1 pass (noul 0.88): The settings page has a dark theme toggle\n' +
        'plan: criterion 2 gap (noul 0.20) - add a plan step that covers it: The choice survives a reload\n',
    );
    assert.deepEqual(ghCalls, ['issue view 7 --json title,body']);
    assert.deepEqual(jev.requests[0].body.state, { ticket: TICKET, plan: PLAN });
  } finally {
    await jev.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the CLI says so when --plan is given and the ticket has no criteria to check it against', async () => {
  const jev = await fakeJev(nouls({ criteria: 0.1, seams: 0.1 }));
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-plan-'));
  try {
    const planFile = path.join(dir, 'plan.md');
    await writeFile(planFile, PLAN);
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { stdout } = await runCli(CLI, ['--plan', planFile], { env, stdin: 'Vague\nMake it better.\n' });
    assert.match(stdout, /^criteria: gap \(noul 0\.10\) - /);
    assert.match(stdout, /\nplan: no acceptance criteria found in the ticket to check the plan against\n$/);
  } finally {
    await jev.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the CLI prints JSON with --json, reading a plain-text ticket from stdin', async () => {
  const jev = await fakeJev(nouls({ criteria: 0.93, seams: 0.71 }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const stdin = `${TICKET.title}\n${TICKET.body}\n`;
    const { status, stdout, ghCalls } = await runCli(CLI, ['--json'], { env, stdin });
    assert.equal(status, 0);
    assert.deepEqual(JSON.parse(stdout), {
      status: 'ok',
      criteria: { decision: 'pass', noul: 0.93 },
      seams: { decision: 'pass', noul: 0.71 },
      plan: null,
    });
    assert.deepEqual(ghCalls, []);
  } finally {
    await jev.close();
  }
});

test('the CLI on an unreadable --plan file prints one error line and exits 0', async () => {
  const jev = await fakeJev(nouls({}));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli(CLI, ['7', '--plan', '/nonexistent/plan.md'], { env, gh: GH });
    assert.equal(status, 0);
    assert.match(stdout, /^jev readiness: error, [^\n]*plan\.md[^\n]*; check readiness yourself\n$/);
    assert.equal(jev.requests.length, 0);
  } finally {
    await jev.close();
  }
});
