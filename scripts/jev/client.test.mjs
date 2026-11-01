// Tests for the shared Jev client. Every request goes to a fake HTTP server on localhost, reached
// through the base-URL override, so nothing here touches the network or needs a real key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, fitsBesideState, noulOf } from './client.mjs';
import { fakeJev } from './fake-jev.mjs';

const KEY = 'fake-key';
const QUESTIONS = {
  role: { type: 'choice', instructions: 'Which role fits?', criteria: { a: 'first', b: 'second' } },
};
const ANSWERS = { role: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 } };

// A sleep that records each backoff delay instead of waiting it out.
function recordingSleep() {
  const delays = [];
  return { delays, sleep: async (ms) => void delays.push(ms) };
}

test('skips with no request when TYPESAFE_API_KEY is not set', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: { answers: ANSWERS } }));
  try {
    const client = createClient({ env: { TYPESAFE_BASE_URL: jev.url } });
    assert.deepEqual(await client.available(), { status: 'skipped', reason: 'TYPESAFE_API_KEY is not set' });
    const result = await client.ask({ state: {}, questions: QUESTIONS });
    assert.equal(result.status, 'skipped');
    assert.equal(jev.requests.length, 0);
  } finally {
    await jev.close();
  }
});

test('a blank key counts as no key', async () => {
  const client = createClient({ env: { TYPESAFE_API_KEY: '  ' } });
  assert.equal((await client.available()).status, 'skipped');
});

test('posts the pinned model, state and questions with the key, and returns the answers', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: { model: 'jev-1.13.0', answers: ANSWERS, usage: {} } }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url } });
    const result = await client.ask({ state: { issue: 'x' }, questions: QUESTIONS });
    assert.deepEqual(result, { status: 'ok', answers: ANSWERS });
    assert.equal(jev.requests.length, 1);
    const [request] = jev.requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/systemone');
    assert.equal(request.headers.authorization, `Bearer ${KEY}`);
    assert.match(request.headers['content-type'], /^application\/json/);
    assert.deepEqual(request.body, { model: 'jev-1.13.0', state: { issue: 'x' }, questions: QUESTIONS });
  } finally {
    await jev.close();
  }
});

test('retries 429 and 529 with exponential backoff, then returns the answers', async () => {
  const replies = [{ status: 429 }, { status: 529 }, { status: 200, body: { answers: ANSWERS } }];
  const jev = await fakeJev(() => replies.shift());
  const { delays, sleep } = recordingSleep();
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url }, sleep });
    const result = await client.ask({ state: {}, questions: QUESTIONS });
    assert.equal(result.status, 'ok');
    assert.equal(jev.requests.length, 3);
    assert.deepEqual(delays, [500, 1000]);
  } finally {
    await jev.close();
  }
});

test('gives up after four attempts at 529 with one error line', async () => {
  const jev = await fakeJev(() => ({ status: 529, body: { error: 'overloaded' } }));
  const { delays, sleep } = recordingSleep();
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url }, sleep });
    const result = await client.ask({ state: {}, questions: QUESTIONS });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /529/);
    assert.equal(jev.requests.length, 4);
    assert.deepEqual(delays, [500, 1000, 2000]);
  } finally {
    await jev.close();
  }
});

for (const status of [401, 422]) {
  test(`does not retry a ${status}, and reports it as one line with the key redacted`, async () => {
    const jev = await fakeJev(() => ({ status, body: `bad request for ${KEY}\nsecond line` }));
    const { delays, sleep } = recordingSleep();
    try {
      const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url }, sleep });
      const result = await client.ask({ state: {}, questions: QUESTIONS });
      assert.equal(result.status, 'error');
      assert.match(result.reason, new RegExp(String(status)));
      assert.ok(!result.reason.includes(KEY), `key leaked: ${result.reason}`);
      assert.ok(!result.reason.includes('\n'), 'reason is more than one line');
      assert.equal(jev.requests.length, 1);
      assert.deepEqual(delays, []);
    } finally {
      await jev.close();
    }
  });
}

test('an unreachable server is an error naming why, never a throw', async () => {
  // A port that was just listening and is now closed refuses the connection.
  const gone = await fakeJev(() => ({ status: 200 }));
  await gone.close();
  const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: gone.url } });
  const result = await client.ask({ state: {}, questions: QUESTIONS });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /ECONNREFUSED/);
  assert.ok(!result.reason.includes('\n'));
});

test('a 200 without answers is an error', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: 'not json' }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url } });
    assert.equal((await client.ask({ state: {}, questions: QUESTIONS })).status, 'error');
  } finally {
    await jev.close();
  }
});

test('a request that outlasts the timeout is an error', async () => {
  const jev = await fakeJev(() => new Promise(() => {}));
  try {
    const env = { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url };
    const client = createClient({ env, timeoutMs: 50 });
    const result = await client.ask({ state: {}, questions: QUESTIONS });
    assert.equal(result.status, 'error');
  } finally {
    await jev.close();
  }
});

// Batching: sizes are estimated at 3 characters a token (constants.mjs), so a question of ~45k
// characters is ~15k tokens: two fit a 32k pair beside an empty state, but five overflow 64k.
function bigQuestion(chars) {
  return { type: 'noul', instructions: 'x'.repeat(chars), criteria: 'y' };
}

test('packs questions into as few requests as the 64k limit allows, and merges the answers', async () => {
  const jev = await fakeJev((request) => ({
    status: 200,
    body: { answers: Object.fromEntries(Object.keys(request.body.questions).map((id) => [id, { type: 'noul', noul: 0.5 }])) },
  }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url } });
    const questions = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`q${n}`, bigQuestion(45_000)]));
    const result = await client.ask({ state: {}, questions });
    assert.equal(result.status, 'ok');
    assert.deepEqual(Object.keys(result.answers).sort(), ['q1', 'q2', 'q3', 'q4', 'q5']);
    assert.deepEqual(jev.requests.map((r) => Object.keys(r.body.questions).length), [4, 1]);
  } finally {
    await jev.close();
  }
});

test('a question too large to sit beside the state within 32k is an error, and nothing is sent', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: { answers: {} } }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url } });
    const result = await client.ask({ state: { text: 'z'.repeat(60_000) }, questions: { big: bigQuestion(40_000) } });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /big/);
    assert.equal(jev.requests.length, 0);
  } finally {
    await jev.close();
  }
});

test('an answer missing from the response is an error', async () => {
  const jev = await fakeJev(() => ({ status: 200, body: { answers: {} } }));
  try {
    const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: jev.url } });
    const result = await client.ask({ state: {}, questions: QUESTIONS });
    assert.equal(result.status, 'error');
    assert.match(result.reason, /role/);
  } finally {
    await jev.close();
  }
});

// The rule a tool uses to set aside a unit it cannot ask about is the same one `ask` refuses on, so
// a tool never sends a question that turns the whole call into an error.
test('fitsBesideState accepts a question within 32k beside its state and refuses one over it', async () => {
  const state = { text: 'z'.repeat(60_000) };
  assert.equal(fitsBesideState(state, 'small', bigQuestion(30_000)), true);
  assert.equal(fitsBesideState(state, 'big', bigQuestion(40_000)), false);
  const client = createClient({ env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: 'http://127.0.0.1:1' } });
  const result = await client.ask({ state, questions: { big: bigQuestion(40_000) } });
  assert.match(result.reason, /too large/);
});

test('noulOf returns a probability from 0 to 1, and throws on anything a threshold could misread', () => {
  assert.equal(noulOf({ type: 'noul', noul: 0 }), 0);
  assert.equal(noulOf({ type: 'noul', noul: 1 }), 1);
  for (const answer of [undefined, {}, { noul: Number.NaN }, { noul: '0.9' }, { noul: 1.01 }, { noul: -0.01 }]) {
    assert.throws(() => noulOf(answer), /no usable answer/);
  }
});
