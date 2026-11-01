// Tests for the duplicates tool. Most drive its seam, `run(input, { client })`, with a fake client
// returning canned Scores; the CLI tests run it as a subprocess, as an agent would, against a fake
// Jev server on localhost and with a `gh` stub first on PATH. Nothing reaches Jev or needs a key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';
import { fakeJev } from './fake-jev.mjs';
import { run } from './duplicates.mjs';
import { runCli } from './cli-runner.mjs';
import { DUPLICATES_BODY_CHARS } from './constants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ISSUE = { title: 'Add a dark theme', body: 'The settings page needs a dark theme toggle.' };
const OPEN = [
  { number: 4, title: 'Dark mode for settings', body: 'Users want a dark mode.' },
  { number: 9, title: 'Theme colours are hard-coded', body: 'Move colours to tokens.' },
  { number: 12, title: 'Crash on login', body: 'Stack trace attached.' },
];

// A client that answers each question with the score given for its id, or `fallback`.
function fakeClient(scores = {}, fallback = 0) {
  const calls = [];
  return {
    calls,
    async available() {
      return { status: 'ok' };
    },
    async ask(request) {
      calls.push(request);
      const answers = {};
      for (const id of Object.keys(request.questions)) {
        answers[id] = { type: 'score', score: scores[id] ?? fallback, probabilities: {}, confidence: 0.9 };
      }
      return { status: 'ok', answers };
    },
  };
}

test('asks one Score per open issue over the new issue, and lists same and maybe, highest first', async () => {
  const client = fakeClient({ issue_4: 1.9, issue_9: 0.8, issue_12: 0.1 });
  const result = await run({ ...ISSUE, openIssues: OPEN }, { client });
  assert.deepEqual(result, {
    status: 'ok',
    checked: 3,
    matches: [
      { number: 4, title: 'Dark mode for settings', band: 'same', score: 1.9 },
      { number: 9, title: 'Theme colours are hard-coded', band: 'maybe', score: 0.8 },
    ],
  });
  assert.equal(client.calls.length, 1);
  const [request] = client.calls;
  assert.deepEqual(request.state, { issue: ISSUE });
  assert.deepEqual(Object.keys(request.questions), ['issue_4', 'issue_9', 'issue_12']);
  const q = request.questions.issue_4;
  assert.equal(q.type, 'score');
  assert.equal(q.criteria.length, 3);
  assert.match(q.criteria[0], /different/i);
  assert.match(q.criteria[2], /same/i);
  // Quoted as JSON, since issue text is untrusted (ADR-0002).
  assert.ok(q.instructions.includes(JSON.stringify({ title: 'Dark mode for settings', body: 'Users want a dark mode.' })));
});

// Band edges: maybe from 0.5 (DUPLICATES_MAYBE), same from 1.5 (DUPLICATES_SAME). A retune that
// moves either fails these on purpose.
test('scores just either side of, and exactly at, each threshold fall in the right band', async () => {
  const open = [0.49, 0.5, 0.51, 1.49, 1.5, 1.51].map((s, i) => ({ number: i + 1, title: `t${s}`, body: '' }));
  const scores = Object.fromEntries(open.map((o, i) => [`issue_${o.number}`, [0.49, 0.5, 0.51, 1.49, 1.5, 1.51][i]]));
  const result = await run({ ...ISSUE, openIssues: open }, { client: fakeClient(scores) });
  const bands = Object.fromEntries(result.matches.map((m) => [m.score, m.band]));
  assert.deepEqual(bands, { 0.5: 'maybe', 0.51: 'maybe', 1.49: 'maybe', 1.5: 'same', 1.51: 'same' });
  assert.equal(result.checked, 6);
});

test('an open issue body longer than DUPLICATES_BODY_CHARS is cut to that length in its question', async () => {
  const long = 'a'.repeat(DUPLICATES_BODY_CHARS) + 'TAIL';
  const client = fakeClient();
  await run({ ...ISSUE, openIssues: [{ number: 1, title: 'Long', body: long }] }, { client });
  const { instructions } = client.calls[0].questions.issue_1;
  assert.ok(instructions.includes('a'.repeat(DUPLICATES_BODY_CHARS)));
  assert.ok(!instructions.includes('TAIL'));
});

test('with no open issues it asks nothing and lists nothing', async () => {
  const client = fakeClient();
  assert.deepEqual(await run({ ...ISSUE, openIssues: [] }, { client }), { status: 'ok', checked: 0, matches: [] });
  assert.equal(client.calls.length, 0);
});

test('a score outside the scale is an error, not a band', async () => {
  const result = await run({ ...ISSUE, openIssues: OPEN }, { client: fakeClient({ issue_9: 2.5 }) });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /issue_9/);
});

test('an issue with no title is an error and never reaches Jev', async () => {
  const client = fakeClient();
  const result = await run({ title: '', body: 'x', openIssues: OPEN }, { client });
  assert.equal(result.status, 'error');
  assert.equal(client.calls.length, 0);
});

test('with no key it skips before any other work, even on input it would reject', async () => {
  const result = await run({}, { client: createClient({ env: {} }) });
  assert.deepEqual(result, { status: 'skipped', reason: 'TYPESAFE_API_KEY is not set' });
});

test('a failed request is an error, handled like a skip', async () => {
  const jev = await fakeJev(() => ({ status: 401, body: 'invalid key' }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url } });
    const result = await run({ ...ISSUE, openIssues: OPEN }, { client });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /401/);
    assert.equal(jev.requests.length, 1);
  } finally {
    await jev.close();
  }
});

// The CLI, run as an agent runs it, through cli-runner.mjs: a subprocess with a `gh` stub on PATH.
const CLI = path.join(HERE, 'duplicates-cli.mjs');
const LIST = 'issue list --state open --limit 1000 --json number,title,body';
const GH = {
  'issue view': JSON.stringify(ISSUE),
  'issue list': JSON.stringify([...OPEN, { number: 7, title: ISSUE.title, body: ISSUE.body }]),
};

// A fake Jev server that answers each question with the score given for its id, or 0.
function scores(byId) {
  return (request) => ({
    status: 200,
    body: {
      answers: Object.fromEntries(
        Object.keys(request.body.questions).map((id) => [id, { type: 'score', score: byId[id] ?? 0, probabilities: {}, confidence: 0.8 }]),
      ),
    },
  });
}

test('the CLI with no key prints one skip line, exits 0 and never calls gh', async () => {
  const { status, stdout, ghCalls } = await runCli(CLI, ['7'], { gh: GH });
  assert.equal(status, 0);
  assert.equal(stdout, 'jev duplicates: skipped, TYPESAFE_API_KEY is not set; check for duplicates yourself\n');
  assert.deepEqual(ghCalls, []);
});

test('the CLI on a failed request prints one error line and exits 0', async () => {
  const jev = await fakeJev(() => ({ status: 422, body: 'state too long' }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout } = await runCli(CLI, ['7'], { env, gh: GH });
    assert.equal(status, 0);
    assert.match(stdout, /^jev duplicates: error, [^\n]*422[^\n]*; check for duplicates yourself\n$/);
  } finally {
    await jev.close();
  }
});

test('the CLI lists likely duplicates of an issue, leaving the issue itself out, and never edits', async () => {
  const jev = await fakeJev(scores({ issue_4: 1.7, issue_9: 0.6 }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { status, stdout, ghCalls } = await runCli(CLI, ['7'], { env, gh: GH });
    assert.equal(status, 0);
    assert.equal(
      stdout,
      '#4 same (score 1.70): Dark mode for settings\n' +
        '#9 maybe (score 0.60): Theme colours are hard-coded\n' +
        'duplicates: 2 of 3 open issues may duplicate this one; read each and decide\n',
    );
    assert.deepEqual(ghCalls, ['issue view 7 --json title,body', LIST]);
    assert.deepEqual(Object.keys(jev.requests[0].body.questions), ['issue_4', 'issue_9', 'issue_12']);
  } finally {
    await jev.close();
  }
});

test('the CLI checks a draft from stdin against every open issue, and says when none match', async () => {
  const jev = await fakeJev(scores({}));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { stdout, ghCalls } = await runCli(CLI, [], { env, gh: GH, stdin: 'Add a dark theme\nDraft body.\n' });
    assert.equal(stdout, 'duplicates: none of 4 open issues looks like a duplicate\n');
    assert.deepEqual(ghCalls, [LIST]);
    assert.deepEqual(jev.requests[0].body.state, { issue: { title: 'Add a dark theme', body: 'Draft body.' } });
  } finally {
    await jev.close();
  }
});

test('the CLI reads a plain-text draft with CRLF line endings without carrying the CRs', async () => {
  const jev = await fakeJev(scores({}));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    await runCli(CLI, [], { env, gh: GH, stdin: 'Add a dark theme\r\nLine one.\r\nLine two.\r\n' });
    assert.deepEqual(jev.requests[0].body.state, { issue: { title: 'Add a dark theme', body: 'Line one.\nLine two.' } });
  } finally {
    await jev.close();
  }
});

test('the CLI with no open issues says so and asks Jev nothing', async () => {
  const jev = await fakeJev(scores({}));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { stdout } = await runCli(CLI, [], { env, gh: { 'issue list': '[]' }, stdin: 'A title\n' });
    assert.equal(stdout, 'duplicates: no open issues to compare against\n');
    assert.equal(jev.requests.length, 0);
  } finally {
    await jev.close();
  }
});

test('the CLI prints JSON with --json', async () => {
  const jev = await fakeJev(scores({ issue_4: 1.5 }));
  try {
    const env = { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url };
    const { stdout } = await runCli(CLI, ['7', '--json'], { env, gh: GH });
    assert.deepEqual(JSON.parse(stdout), {
      status: 'ok',
      checked: 3,
      matches: [{ number: 4, title: 'Dark mode for settings', band: 'same', score: 1.5 }],
    });
  } finally {
    await jev.close();
  }
});
