// Tests for the **List the frontier** query in docs/agents/issue-tracker.md. The jq is read from
// that doc, not copied here, so the doc and the test cannot drift. Each case feeds it issues shaped
// like the ones `gh issue list --json number,title,labels,assignees,createdAt` returns and checks
// which come back, in what order.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const QUERY = (() => {
  const match = bullet('List the frontier').match(/--jq '([^']+)'/);
  assert.ok(match, 'the **List the frontier** bullet has no --jq expression');
  return match[1];
})();

const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;

// An issue numbered n, created on day n, with these labels and assignees.
function issue(n, labels = [], assignees = []) {
  return {
    number: n,
    title: `Issue ${n}`,
    createdAt: `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`,
    labels: ['ready-for-agent', ...labels].map((name) => ({ name })),
    assignees: assignees.map((login) => ({ login })),
  };
}

function frontier(issues) {
  const run = spawnSync('jq', ['-c', QUERY], { input: JSON.stringify(issues), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const numbers = (issues) => frontier(issues).map((i) => i.number);
// Skipped locally without jq. CI never skips: ubuntu runners ship jq, and a missing one fails.
const opts = { skip: HAVE_JQ || process.env.CI ? false : 'jq not found (CI runs it)' };

test('with no priority labels, the oldest comes first', opts, () => {
  assert.deepEqual(numbers([issue(3), issue(1), issue(2)]), [1, 2, 3]);
});

test('a newer priority:high issue comes before an older unlabelled one', opts, () => {
  assert.deepEqual(numbers([issue(1), issue(5, ['priority:high'])]), [5, 1]);
});

test('a priority:low issue comes after a newer unlabelled one', opts, () => {
  assert.deepEqual(numbers([issue(1, ['priority:low']), issue(5)]), [5, 1]);
});

test('high, then normal, then low, oldest first within each', opts, () => {
  const issues = [
    issue(1, ['priority:low']),
    issue(2),
    issue(3, ['priority:high']),
    issue(4, ['priority:low']),
    issue(5),
    issue(6, ['priority:high']),
  ];
  assert.deepEqual(numbers(issues), [3, 6, 2, 5, 1, 4]);
});

test('an assigned issue is left out', opts, () => {
  assert.deepEqual(numbers([issue(1, [], ['owner']), issue(2)]), [2]);
});

test('a status:blocked issue is left out, whatever its priority', opts, () => {
  assert.deepEqual(numbers([issue(1, ['priority:high', 'status:blocked']), issue(2)]), [2]);
});

test('each line names the number, the title and the priority', opts, () => {
  assert.deepEqual(frontier([issue(1, ['priority:high']), issue(2)]), [
    { number: 1, title: 'Issue 1', priority: 'high' },
    { number: 2, title: 'Issue 2', priority: 'normal' },
  ]);
});

test('an issue carrying both priority labels counts as high, and prints as high', opts, () => {
  assert.deepEqual(frontier([issue(1), issue(2, ['priority:low', 'priority:high'])]), [
    { number: 2, title: 'Issue 2', priority: 'high' },
    { number: 1, title: 'Issue 1', priority: 'normal' },
  ]);
});

test('two issues created in the same second come oldest number first, whatever order gh returns', opts, () => {
  const tie = (n) => ({ ...issue(n), createdAt: '2026-10-04T00:00:00Z' });
  assert.deepEqual(numbers([tie(5), tie(4)]), [4, 5]);
});

test('an empty frontier prints nothing', opts, () => {
  assert.deepEqual(frontier([]), []);
});
