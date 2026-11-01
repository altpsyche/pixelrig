// Tests for check-skills.mjs. Each case builds a minimal repo in a temp dir, so a check is proven
// to fire on a real tree rather than on a mocked filesystem.

import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepo, insideRoot, parseFrontmatter, relativeLinks } from './check-skills.mjs';

const SKILL = `---
name: demo
description: "Use when testing the checker."
---

Body.
`;

// A repo that passes every check. Each test breaks exactly one thing.
async function validRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'check-skills-'));
  await mkdir(path.join(root, '.agents', 'skills', 'demo'), { recursive: true });
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), SKILL);
  await writeFile(path.join(root, '.agents', 'skills', 'README.md'), '[demo](./demo/SKILL.md)\n');
  await writeFile(path.join(root, 'AGENTS.md'), '# Agents\n\n[docs](docs/guide.md)\n');
  await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  return root;
}

async function withRepo(fn) {
  const root = await validRepo();
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a valid repo has no errors', () =>
  withRepo(async (root) => {
    const { skillCount, errors } = await checkRepo(root);
    assert.equal(skillCount, 1);
    assert.deepEqual(errors, []);
  }));

test('a broken link in docs/ is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'guide.md'), '[gone](./nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['docs/guide.md: broken relative link -> ./nope.md']);
  }));

test('a broken link in a skill support file is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, '.agents', 'skills', 'demo', 'extra.md'), '[gone](./gone.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['.agents/skills/demo/extra.md: broken relative link -> ./gone.md']);
  }));

test('a link into a sibling directory sharing the repo name prefix escapes the repo', () =>
  withRepo(async (root) => {
    const sibling = `../${path.basename(root)}-x/a.md`;
    await writeFile(path.join(root, 'docs', 'guide.md'), `[sib](../${sibling})\n`);
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [`docs/guide.md: link escapes the repo: ../${sibling}`]);
  }));

test('a harness-specific file or folder is reported, a dangling symlink included', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'CLAUDE.md'), '# Agents\n');
    await mkdir(path.join(root, '.claude'));
    await symlink('gone.md', path.join(root, 'GEMINI.md'));
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      'CLAUDE.md: harness-specific; every agent gets the same base (ADR-0001)',
      'GEMINI.md: harness-specific; every agent gets the same base (ADR-0001)',
      '.claude: harness-specific; every agent gets the same base (ADR-0001)',
    ]);
  }));

test('per-harness metadata inside a skill is reported', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, '.agents', 'skills', 'demo', 'agents'));
    await writeFile(path.join(root, '.agents', 'skills', 'demo', 'agents', 'openai.yaml'), 'interface: {}\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      '.agents/skills/demo/agents: harness-specific; every agent gets the same base (ADR-0001)',
    ]);
  }));

test('links inside inline and fenced code are ignored', () => {
  const md = '`[a](./inline.md)`\n\n```md\n[b](./fenced.md)\n```\n\n~~~\n[c](./tilde.md)\n~~~\n';
  assert.deepEqual(relativeLinks(md), []);
});

test('links with a scheme or a bare anchor are ignored; anchors are stripped', () => {
  const md = '[w](https://x.dev) [m](mailto:a@b.c) [h](#top) [d](./doc.md#part)';
  assert.deepEqual(relativeLinks(md), ['./doc.md']);
});

test('insideRoot rejects parents and prefix-sharing siblings', () => {
  assert.equal(insideRoot('/r/repo', '/r/repo'), true);
  assert.equal(insideRoot('/r/repo', '/r/repo/docs/a.md'), true);
  assert.equal(insideRoot('/r/repo', '/r/repo-x/a.md'), false);
  assert.equal(insideRoot('/r/repo', '/r/a.md'), false);
  assert.equal(insideRoot('/r/repo', '/r/repo/..notes/a.md'), true);
});

test('links inside a fence indented under a list item are ignored', () => {
  const md = '1. Step:\n\n   ```ts\n   [a](./indented.md)\n   ```\n';
  assert.deepEqual(relativeLinks(md), []);
});

test('a link to the repo root resolves', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'guide.md'), '[repo](../)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, []);
  }));

test('a missing skills folder does not hide the other checks', () =>
  withRepo(async (root) => {
    await rm(path.join(root, '.agents'), { recursive: true });
    await writeFile(path.join(root, 'docs', 'guide.md'), '[gone](./nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      '.agents/skills/ does not exist',
      'docs/guide.md: broken relative link -> ./nope.md',
    ]);
  }));

test('running the checker through a symlinked path still runs it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'check-skills-link-'));
  try {
    const scripts = path.dirname(fileURLToPath(import.meta.url));
    await symlink(scripts, path.join(dir, 'scripts'));
    const run = spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-skills.mjs')], { encoding: 'utf8' });
    assert.match(run.stdout, /agent layer: \d+ skills/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reference-style link definitions are extracted', () => {
  assert.deepEqual(relativeLinks('See [doc][d].\n\n[d]: ./missing-ref.md\n'), ['./missing-ref.md']);
  assert.deepEqual(relativeLinks('[d]: <./spaced ref.md> "Title"\n'), ['./spaced ref.md']);
  assert.deepEqual(relativeLinks('[^1]: A footnote, not a link.\n'), []);
});

test('angle-bracket link targets are extracted', () => {
  assert.deepEqual(relativeLinks('[a](<./with space.md>)\n'), ['./with space.md']);
});

test('a longer fence is not closed by a shorter fence inside it', () => {
  const md = '````md\n```\n[x](./inner.md)\n```\n[y](./after-inner.md)\n````\n[z](./real.md)\n';
  assert.deepEqual(relativeLinks(md), ['./real.md']);
});

test('a broken link in any root-level markdown file is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'GLOSSARY.md'), '[gone](./nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['GLOSSARY.md: broken relative link -> ./nope.md']);
  }));

test('code spans pair backtick runs of equal length', () => {
  assert.deepEqual(relativeLinks('A `` ` `` tick. See [a](./after-double.md) and `x`.\n'), ['./after-double.md']);
  assert.deepEqual(relativeLinks('A stray ` here.\n\nSee [b](./after-stray.md).\n'), ['./after-stray.md']);
  // CommonMark §6.1: a code span binds tighter than a link, so this link is code.
  assert.deepEqual(relativeLinks('A ` tick. See [c](./in-span.md) and `x`.\n'), []);
});

test('inline links with an image, nested brackets or any title form are extracted', () => {
  const badge = '[![License](https://img.shields.io/badge/License-MIT.svg)](./LICENSE)';
  assert.deepEqual(relativeLinks(badge), ['./LICENSE']);
  assert.deepEqual(relativeLinks('[![logo](./logo.png)](./home.md)'), ['./home.md', './logo.png']);
  assert.deepEqual(relativeLinks('[see [1]](./nested.md)'), ['./nested.md']);
  assert.deepEqual(relativeLinks(`[a](./sq.md 'Title') [b](./paren.md (Title)) [c](./dq.md "T")`), [
    './sq.md',
    './paren.md',
    './dq.md',
  ]);
});

test('reference definitions inside containers are extracted', () => {
  assert.deepEqual(relativeLinks('> [d]: ./quote.md\n'), ['./quote.md']);
  assert.deepEqual(relativeLinks('- item\n\n    [d]: ./deep.md\n'), ['./deep.md']);
  assert.deepEqual(relativeLinks('[a]: ./one.md\n[b]: ./two.md "T"\n'), ['./one.md', './two.md']);
});

test('prose shaped like a reference definition is not one', () => {
  assert.deepEqual(relativeLinks('[WIP]: finish later\n'), []);
  assert.deepEqual(relativeLinks('[status:in-review]: means a Reviewer picks it up\n'), []);
  assert.deepEqual(relativeLinks('Text line\n[d]: ./para-ref.md\n'), []);
  assert.deepEqual(relativeLinks('> Quoted line\n> [d]: ./para-quote.md\n'), []);
});

test('a fence closes only on its own character, and an unclosed fence runs to the end', () => {
  assert.deepEqual(relativeLinks('```\n[x](./in.md)\n```~~\n[y](./after.md)\n'), []);
  assert.deepEqual(relativeLinks('```\n[x](./unclosed.md)\n'), []);
  assert.deepEqual(relativeLinks('~~~\n[x](./in.md)\n```\n~~~~\n[y](./out.md)\n'), ['./out.md']);
});

test('percent-encoded targets are decoded before resolving', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'with space.md'), '# Spaced\n');
    await writeFile(path.join(root, 'docs', 'guide.md'), '[a](./with%20space.md) [b](./bad%zz.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['docs/guide.md: broken relative link -> ./bad%zz.md']);
  }));

test('CRLF and CR line endings close fences and end reference definitions', () => {
  assert.deepEqual(relativeLinks('```\r\ncode\r\n```\r\n[a](./after-fence.md)\r\n'), ['./after-fence.md']);
  assert.deepEqual(relativeLinks('[a]: ./crlf-ref.md\r\n'), ['./crlf-ref.md']);
  assert.deepEqual(relativeLinks('~~~\rcode\r~~~\r[b]: ./cr-ref.md\r'), ['./cr-ref.md']);
});

test('a block-scalar description is read, as upstream skills write it', () =>
  withRepo(async (root) => {
    const skill = '---\nname: demo\ndescription: >\n  Fetch the thing.\n  Use when testing the checker.\n---\n\nBody.\n';
    await writeFile(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), skill);
    const { errors, warnings } = await checkRepo(root);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  }));

test('block-scalar headers with an indentation indicator or a comment are read', async () => {
  for (const header of ['>2', '>-2', '|2-', '|+', '> # note', '|-1 # note']) {
    await withRepo(async (root) => {
      const skill = `---\nname: demo\ndescription: ${header}\n  Use when testing the checker.\n---\n\nBody.\n`;
      await writeFile(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), skill);
      const { errors, warnings } = await checkRepo(root);
      assert.deepEqual({ header, errors, warnings }, { header, errors: [], warnings: [] });
    });
  }
});

test('blank lines inside a block scalar are kept: `|` as breaks, `>` as folded breaks', () => {
  const read = (header) =>
    parseFrontmatter(`---\ndescription: ${header}\n  one\n  two\n\n  three\n\n\n  four\nname: demo\n---\n`, 'x', {
      err: assert.fail,
    }).description;
  assert.equal(read('|'), 'one\ntwo\n\nthree\n\n\nfour');
  assert.equal(read('>'), 'one two\nthree\n\nfour');
});

test('a skill name over 64 characters is reported', () =>
  withRepo(async (root) => {
    const name = 'a'.repeat(65);
    const dir = path.join(root, '.agents', 'skills', name);
    await mkdir(dir);
    await writeFile(path.join(dir, 'SKILL.md'), SKILL.replace('name: demo', `name: ${name}`));
    await writeFile(path.join(root, '.agents', 'skills', 'README.md'), `[demo](./demo/SKILL.md) [x](./${name}/SKILL.md)\n`);
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [`.agents/skills/${name}/SKILL.md: name is 65 chars, over the 64 limit`]);
  }));

test('compatibility is a known key, and over 500 characters is reported', () =>
  withRepo(async (root) => {
    const file = path.join(root, '.agents', 'skills', 'demo', 'SKILL.md');
    await writeFile(file, SKILL.replace('---\n\n', 'compatibility: Needs gh.\n---\n\n'));
    assert.deepEqual(await checkRepo(root).then((r) => [r.errors, r.warnings]), [[], []]);
    await writeFile(file, SKILL.replace('---\n\n', `compatibility: ${'x'.repeat(501)}\n---\n\n`));
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['.agents/skills/demo/SKILL.md: compatibility is 501 chars, over the 500 limit']);
  }));

test('AGENTS.md over 32 KiB is reported even under the line budget', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'AGENTS.md'), `${'x'.repeat(33 * 1024)}\n`);
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['AGENTS.md is 33793 bytes, over the 32768-byte budget']);
  }));

test('a Jev CLI missing from the registry in docs/agents/jev.md is reported; a listed one is not', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'scripts', 'jev'), { recursive: true });
    await mkdir(path.join(root, 'docs', 'agents'));
    await writeFile(path.join(root, 'scripts', 'jev', 'triage-cli.mjs'), '');
    await writeFile(path.join(root, 'scripts', 'jev', 'prune-cli.mjs'), '');
    await writeFile(path.join(root, 'scripts', 'jev', 'client.mjs'), '');
    await writeFile(path.join(root, 'docs', 'agents', 'jev.md'), '| triage | `scripts/jev/triage-cli.mjs` |\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['scripts/jev/prune-cli.mjs: Jev CLI not listed in docs/agents/jev.md']);
  }));

test('Jev CLIs with no registry at all are each reported', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'scripts', 'jev'), { recursive: true });
    await writeFile(path.join(root, 'scripts', 'jev', 'triage-cli.mjs'), '');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['scripts/jev/triage-cli.mjs: Jev CLI not listed in docs/agents/jev.md']);
  }));

test('an evals/ folder that names no skill is reported; one naming a skill, and a file, are not', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'evals', 'demo'), { recursive: true });
    await mkdir(path.join(root, 'evals', 'gone'));
    await writeFile(path.join(root, 'evals', 'README.md'), '# Evals\n');
    await writeFile(path.join(root, 'evals', 'demo', 'case.md'), '# Case\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['evals/gone/: names no skill in .agents/skills/']);
  }));

test('a broken link in an eval case is reported', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'evals', 'demo'), { recursive: true });
    await writeFile(path.join(root, 'evals', 'demo', 'case.md'), '[gone](../nope.md)\n');
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, ['evals/demo/case.md: broken relative link -> ../nope.md']);
  }));

// Tracker commands must run as written under a non-interactive shell guard (ADR-0003).
const BRACES = 'command inlines braces; put a query in a file, build jq objects with pick (ADR-0003)';
const JQ_FILE = 'jq reads a file through a flag a shell guard refuses; keep the filter inline (ADR-0003)';
const CD = 'command starts with cd and chains another; address the folder with git -C (ADR-0003)';

test('a tracker command that inlines braces is reported, in a code span and in a fenced block', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'docs', 'agents'));
    await writeFile(
      path.join(root, 'docs', 'agents', 'issue-tracker.md'),
      "- **List**: `gh issue list --json number --jq '.[] | {number}'`\n",
    );
    await mkdir(path.join(root, 'evals', 'demo'), { recursive: true });
    await writeFile(
      path.join(root, 'evals', 'demo', 'case.md'),
      "## Collect\n\n```bash\ngh pr list --json number \\\n  --jq '.[] | {number,\n    title}'\ngit status --short\n```\n",
    );
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      `docs/agents/issue-tracker.md: ${BRACES}: gh issue list --json number --jq '.[] | {number}'`,
      `evals/demo/case.md: ${BRACES}: gh pr list --json number --jq '.[] | {number, title}'`,
    ]);
  }));

test('a tracker command that starts with cd and chains a command is reported', () =>
  withRepo(async (root) => {
    await writeFile(path.join(root, 'docs', 'workflow.md'), 'Run `cd ../repo-7 && gh pr checkout 7`.\n');
    await writeFile(
      path.join(root, '.agents', 'skills', 'demo', 'extra.md'),
      '```sh\ncd ../repo-7; git status\n```\n',
    );
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      `docs/workflow.md: ${CD}: cd ../repo-7 && gh pr checkout 7`,
      `.agents/skills/demo/extra.md: ${CD}: cd ../repo-7; git status`,
    ]);
  }));

test('gh placeholders, git -C, braces outside a command and non-shell fences are not reported', () =>
  withRepo(async (root) => {
    await writeFile(
      path.join(root, 'docs', 'workflow.md'),
      [
        "`gh api 'repos/{owner}/{repo}/issues/7' --jq '.labels |= map(.name) | pick(.number, .labels)'`",
        '`git -C ../repo-7 status --short`, then `cd` nowhere.',
        'A `{ "key": 1 }` example, and a lone `cd ../repo-7` line.',
        '```ts\nconst x = { gh: 1 };\n```',
        '```markdown\n`gh x --jq \'{a}\'`\n```',
        '',
      ].join('\n'),
    );
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, []);
  }));

test('a command naming a query file that does not exist is reported; one that exists is not', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'scripts', 'queries'), { recursive: true });
    await writeFile(path.join(root, 'scripts', 'queries', 'a.graphql'), 'query { viewer { login } }\n');
    await mkdir(path.join(root, 'docs', 'agents'));
    await writeFile(
      path.join(root, 'docs', 'agents', 'issue-tracker.md'),
      [
        "`gh api graphql -F n=<number> -F query=@scripts/queries/a.graphql --jq '.data.viewer.login'`",
        '`gh api graphql -F query=@scripts/queries/missing.graphql`',
        '`gh api graphql -F query=@<file>`',
        '',
      ].join('\n'),
    );
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      'docs/agents/issue-tracker.md: command names scripts/queries/missing.graphql, which does not exist',
    ]);
  }));

test('a jq command that reads its filter or data through a file flag is reported, bundled short flags and --argfile included; a file argument is not', () =>
  withRepo(async (root) => {
    await writeFile(
      path.join(root, 'docs', 'workflow.md'),
      [
        '`gh issue list --json number | jq -c -f scripts/queries/a.jq`',
        "`jq -n --rawfile v out.txt '.[\"a\"] = $v'`",
        "`jq -Rs '. as $v | null | .[\"a\"] = $v' out.txt`",
        '`gh issue list --json number | jq -cf scripts/queries/a.jq`',
        '`jq -nrf a.jq in.json`',
        '`jq -f a.jq in.json`',
        "`jq -n --argfile a f.json '.'`",
        "`jq -n --slurpfile a f.json '.'`",
        "`jq -L lib -n '.'`",
        "`gh issue list --json number,title --jq '.[] | pick(.number, .title)'`",
        '',
      ].join('\n'),
    );
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      `docs/workflow.md: ${JQ_FILE}: gh issue list --json number | jq -c -f scripts/queries/a.jq`,
      `docs/workflow.md: ${JQ_FILE}: jq -n --rawfile v out.txt '.["a"] = $v'`,
      `docs/workflow.md: ${JQ_FILE}: gh issue list --json number | jq -cf scripts/queries/a.jq`,
      `docs/workflow.md: ${JQ_FILE}: jq -nrf a.jq in.json`,
      `docs/workflow.md: ${JQ_FILE}: jq -f a.jq in.json`,
      `docs/workflow.md: ${JQ_FILE}: jq -n --argfile a f.json '.'`,
      `docs/workflow.md: ${JQ_FILE}: jq -n --slurpfile a f.json '.'`,
      `docs/workflow.md: ${JQ_FILE}: jq -L lib -n '.'`,
    ]);
  }));

test('commands in ADRs and specs, which quote old commands, are not checked', () =>
  withRepo(async (root) => {
    await mkdir(path.join(root, 'docs', 'adr'));
    await mkdir(path.join(root, 'docs', 'specs'));
    await writeFile(path.join(root, 'docs', 'adr', '0001-x.md'), "Refused `cd <worktree> && gh pr checkout`.\n");
    await writeFile(path.join(root, 'docs', 'specs', 'x.md'), "Was `gh x --jq '{a}'`.\n");
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, []);
  }));

test('a jq file flag after a filter containing a pipe is reported; flag-like text inside a quoted filter, and gh --jq, are not', () =>
  withRepo(async (root) => {
    await writeFile(
      path.join(root, 'docs', 'workflow.md'),
      [
        "`jq '.a | .b' -f x`",
        "`jq '.[] | .a' --rawfile v f`",
        '`gh api x | jq ".a | .b" -cf x.jq`',
        "`jq -n --argfile=a f.json '.'`",
        "`jq -r '.a | .b'`",
        "`jq '.f'`",
        "`jq -c '.x' file.json`",
        "`jq -r '.a | \"-f\"'`",
        "`gh api 'repos/{owner}/{repo}/issues' --jq '.a | .b'`",
        "`gh issue list --json number --jq '.[] | .number' | jq -c '.' -`",
        '',
      ].join('\n'),
    );
    const { errors } = await checkRepo(root);
    assert.deepEqual(errors, [
      `docs/workflow.md: ${JQ_FILE}: jq '.a | .b' -f x`,
      `docs/workflow.md: ${JQ_FILE}: jq '.[] | .a' --rawfile v f`,
      `docs/workflow.md: ${JQ_FILE}: gh api x | jq ".a | .b" -cf x.jq`,
      `docs/workflow.md: ${JQ_FILE}: jq -n --argfile=a f.json '.'`,
    ]);
  }));
