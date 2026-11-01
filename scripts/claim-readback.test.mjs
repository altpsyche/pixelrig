// Tests for the **Read back a claim** query in docs/agents/issue-tracker.md. The jq is read from
// that doc's command, not copied here, and the GraphQL file is the one that command names, so the
// doc and the test cannot drift. Each case feeds the jq a GraphQL response shaped like the one
// `gh api graphql` returns and checks which claim wins.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(path.join(ROOT, 'docs', 'agents', 'issue-tracker.md'), 'utf8');

// The bullet runs from its bold name to the next top-level bullet or heading.
function bullet(name) {
  const start = DOC.indexOf(`- **${name}**`);
  assert.notEqual(start, -1, `issue-tracker.md has no **${name}** bullet`);
  const rest = DOC.slice(start + 1);
  const end = rest.search(/\n(- |#)/);
  return end === -1 ? rest : rest.slice(0, end);
}

const COMMAND = bullet('Read back a claim');
const GRAPHQL = (() => {
  const match = COMMAND.match(/-F query=@([^\s`]+)/);
  assert.ok(match, 'the **Read back a claim** bullet names no GraphQL file');
  const file = path.join(ROOT, match[1]);
  assert.ok(existsSync(file), `the **Read back a claim** bullet names ${match[1]}, which does not exist`);
  return file;
})();
const QUERY = (() => {
  const match = COMMAND.match(/--jq '([^']+)'/);
  assert.ok(match, 'the **Read back a claim** bullet has no --jq expression');
  return match[1];
})();

const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
const ME = 'owner';

// A response for an issue with these labels and comments, oldest first. A comment is a body by
// this account, or [author, body] for another account.
function response(comments, labels = ['ready-for-agent']) {
  return {
    data: {
      viewer: { login: ME },
      repository: {
        issueOrPullRequest: {
          labels: { nodes: labels.map((name) => ({ name })) },
          comments: {
            nodes: comments.map((c) =>
              Array.isArray(c) ? { body: c[1], author: { login: c[0] } } : { body: c, author: { login: ME } },
            ),
          },
        },
      },
    },
  };
}

function readBack(comments, labels) {
  const run = spawnSync('jq', ['-c', QUERY], { input: JSON.stringify(response(comments, labels)), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const A = 'Claimed: branch 7-demo (session aaaaaaaa)';
const B = 'Claimed: branch 7-demo (session bbbbbbbb)';
const PLAN = 'Plan:\n- [ ] write the test (check: node --test)';
// Skipped locally without jq. CI never skips: ubuntu runners ship jq, and a missing one fails.
const opts = { skip: HAVE_JQ || process.env.CI ? false : 'jq not found (CI runs it)' };

test('a lone claim wins, and the labels come back', opts, () => {
  assert.deepEqual(readBack([A], ['ready-for-agent', 'phase:0']), { labels: ['ready-for-agent', 'phase:0'], winner: A });
});

test('a Plan: comment posted after a claim leaves the claim held', opts, () => {
  assert.equal(readBack([A, PLAN]).winner, A);
});

test('a Plan: comment between two claims does not reset them: the earliest still wins', opts, () => {
  assert.equal(readBack([A, PLAN, B]).winner, A);
});

test('of two claims, the earliest wins', opts, () => {
  assert.equal(readBack([A, B]).winner, A);
});

test('any other comment by this account releases the claim', opts, () => {
  assert.equal(readBack([A, PLAN, 'Released: red baseline, see #9']).winner, null);
});

test('a claim after a release wins, even with a Plan: comment from the earlier session between', opts, () => {
  assert.equal(readBack([A, 'Released: red baseline', PLAN, B]).winner, B);
});

test('comments by other accounts neither release nor forge a claim', opts, () => {
  assert.equal(readBack([A, ['bot', 'CI passed'], ['stranger', B]]).winner, A);
  assert.equal(readBack([['stranger', B]]).winner, null);
});

test('no comments means no winner', opts, () => {
  assert.equal(readBack([]).winner, null);
});

test('the GraphQL file asks for the viewer, and an issue or PR\'s labels and comments by author', () => {
  const query = readFileSync(GRAPHQL, 'utf8');
  for (const field of ['viewer', 'issueOrPullRequest', '... on Issue', '... on PullRequest', 'labels', 'comments(last: 100)', 'author']) {
    assert.ok(query.includes(field), `${path.relative(ROOT, GRAPHQL)} has no ${field}`);
  }
});
