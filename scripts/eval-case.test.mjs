// Tests for scripts/eval-case.mjs, the case parser the eval runner scripts read cases through
// (evals/README.md § Case format). A fixture case with literal expectations covers the shapes
// earlier manual runs tripped on: heredoc bodies with their own `## ` headings, and Collect commands
// that span lines. Then every case in evals/ must parse, so a case the runner cannot read fails CI
// rather than a run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCase } from './eval-case.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '```';

const FIXTURE = `# A fixture case

## Exercises

- Nothing; it is a parser fixture.

## Starting state

On main, before the push: a spec whose body has headings of its own.

${FENCE}bash
cat > docs/specs/x.md <<'EOF'
# X

## Prompt

## Pass criteria
EOF
git add docs/specs/x.md
git commit -qm "Sandbox: x"
${FENCE}

After bootstrap: one issue.

${FENCE}bash
gh issue create --title "One" --body-file - <<'EOF'
## Acceptance criteria

- [ ] it works
EOF
${FENCE}

## Prompt

${FENCE}
let's work
${FENCE}

## Owner replies

- When it asks: \`Yes, go ahead.\`

## Collect

${FENCE}bash
echo "head: $(git rev-parse HEAD)"

gh pr view 2 --json labels \\
  --jq '.labels |= map(.name)'
gh api 'repos/{owner}/{repo}/issues/2/timeline' --paginate \\
  --jq '.[] | select(.event == "labeled")
    | pick(.event, .label.name)'
for n in 1 2; do
  echo "#$n"
done
${FENCE}

## Pass criteria

1. Did it work?
`;

test('a case parses into its steps, prompt and whole Collect commands', () => {
  assert.deepEqual(parseCase(FIXTURE), {
    beforePush: `cat > docs/specs/x.md <<'EOF'
# X

## Prompt

## Pass criteria
EOF
git add docs/specs/x.md
git commit -qm "Sandbox: x"
`,
    afterBootstrap: `gh issue create --title "One" --body-file - <<'EOF'
## Acceptance criteria

- [ ] it works
EOF
`,
    prompt: "let's work\n",
    collect: [
      'echo "head: $(git rev-parse HEAD)"',
      "gh pr view 2 --json labels \\\n  --jq '.labels |= map(.name)'",
      "gh api 'repos/{owner}/{repo}/issues/2/timeline' --paginate \\\n" +
        "  --jq '.[] | select(.event == \"labeled\")\n    | pick(.event, .label.name)'",
      'for n in 1 2; do\n  echo "#$n"\ndone',
    ],
  });
});

test('a Collect line ending in an escaped backslash is whole', () => {
  const parsed = parseCase(FIXTURE.replace('echo "head: $(git rev-parse HEAD)"', 'echo a\\\\'));
  assert.equal(parsed.collect[0], 'echo a\\\\');
});

test('a step that is absent parses as an empty block', () => {
  const noBefore = FIXTURE.replace(/On main, before the push:[\s\S]*?(?=After bootstrap:)/, '');
  const parsed = parseCase(noBefore);
  assert.equal(parsed.beforePush, '');
  assert.match(parsed.afterBootstrap, /^gh issue create/);
});

// Each broken fixture, and the words its error must carry so the runner knows what to fix.
const BROKEN = [
  ['a Starting state block with no step before it', FIXTURE.replace('After bootstrap: one issue.', 'Then: one issue.'), /no step/],
  ['a step given twice', FIXTURE.replace('After bootstrap: one issue.', 'On main, before the push: again.'), /twice/],
  ['a step given twice before its block', FIXTURE.replace('On main, before the push: a spec', 'On main, before the push: a spec.\n\nOn main, before the push: a spec'), /twice/],
  ['a Starting state block bash cannot parse', FIXTURE.replace('git add docs/specs/x.md', 'if true; then'), /cannot parse/],
  ['no Prompt section', FIXTURE.replace('## Prompt\n\n```\n', '## Prompts\n\n```\n'), /Prompt/],
  ['a Prompt with two blocks', FIXTURE.replace("let's work\n```\n", "let's work\n```\n\n```\nagain\n```\n"), /Prompt/],
  ['no Collect section', FIXTURE.replace('## Collect', '## Collected'), /Collect/],
  ['a Collect command left open', FIXTURE.replace('done\n```', '```'), /cannot parse/],
  ['a Collect quote left open', FIXTURE.replace(`echo "head: $(git rev-parse HEAD)"`, `echo 'head`), /cannot parse/],
  ['a Collect heredoc left open', FIXTURE.replace('echo "head: $(git rev-parse HEAD)"', 'cat <<EOF'), /cannot parse/],
  ['a Collect line ending in a continuation', FIXTURE.replace('done\n```', 'done \\\n```'), /cannot parse/],
  ['a Collect line ending in an escaped backslash then a continuation', FIXTURE.replace('done\n```', 'done \\\\\\\n```'), /cannot parse/],
  ['a fence left open', FIXTURE.replace(/```\n\n## Pass criteria/, '\n## Pass criteria'), /fence/],
];

for (const [name, source, error] of BROKEN) {
  test(`${name} is an error, never a partial parse`, () => {
    assert.notEqual(source, FIXTURE, 'the fixture edit must change the case');
    assert.throws(() => parseCase(source), error);
  });
}

test('the CLI prints a part, NUL-separates Collect commands and fails on a bad case', () => {
  const file = path.join(REPO, 'scripts', 'eval-case.mjs');
  const run = (part, input) => spawnSync('node', [file, part, '-'], { input, encoding: 'utf8' });

  assert.equal(run('prompt', FIXTURE).stdout, "let's work\n");
  assert.equal(run('collect', FIXTURE).stdout.split('\0').length, 5); // four commands, then the end
  assert.equal(run('check', FIXTURE).status, 0);

  const bad = run('check', FIXTURE.replace('## Collect', '## Collected'));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^eval-case: -: .*Collect/);
  assert.equal(run('nonsense', FIXTURE).status, 2);
});

// The cases themselves: in this repo every one must parse. A sandbox has none, since its tree
// leaves out evals/*/ (evals/README.md § Sandbox), so there this test checks nothing.
const evalsDir = path.join(REPO, 'evals');
const cases = existsSync(evalsDir)
  ? (await readdir(evalsDir, { recursive: true }))
      .filter((rel) => rel.includes(path.sep) && rel.endsWith('.md'))
      .sort()
  : [];

for (const rel of cases) {
  test(`evals/${rel} parses, with a prompt and at least one Collect command`, async () => {
    const parsed = parseCase(await readFile(path.join(evalsDir, rel), 'utf8'));
    assert.notEqual(parsed.prompt.trim(), '');
    assert.ok(parsed.collect.length > 0);
  });
}
