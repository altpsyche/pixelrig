// Runs a Jev CLI as an agent runs it, for tests only: a subprocess with a `gh` stub first on PATH
// that logs every call and answers the subcommands in `gh` with canned output, failing on any
// other. The stub uses only shell builtins, since PATH holds nothing else unless `keepPath` is
// set. Async, so a fake Jev server in the test's own process can answer the CLI.
//
//   const { status, stdout, ghCalls } = await runCli(CLI, ['7'], {
//     env: { TYPESAFE_API_KEY: 'fake-key', TYPESAFE_BASE_URL: jev.url },
//     gh: { 'issue view': JSON.stringify(issue), 'issue list': JSON.stringify(openIssues) },
//     stdin: '',
//     keepPath: false,  // true keeps the caller's PATH after the stub, for a CLI that runs git;
//                       // a PATH in `env` is ignored either way, so the stub always comes first
//   });

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function runCli(cli, args, { env = {}, stdin = '', gh = {}, keepPath = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jev-cli-'));
  const log = path.join(dir, 'gh.log');
  const cases = Object.entries(gh).map(([command, out], i) => {
    const file = path.join(dir, `out-${i}`);
    return { command, file, out };
  });
  for (const { file, out } of cases) await writeFile(file, out);
  const branches = cases.map(({ command, file }) => `  "${command}") while IFS= read -r l || [ -n "$l" ]; do printf "%s\\n" "$l"; done < "${file}"; exit 0 ;;\n`).join('');
  await writeFile(path.join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\ncase "$1 $2" in\n${branches}esac\nexit 1\n`);
  await chmod(path.join(dir, 'gh'), 0o755);
  try {
    const PATH = keepPath ? `${dir}:${process.env.PATH}` : dir;
    const child = spawn(process.execPath, [cli, ...args], { env: { ...env, TYPESAFE_ENV_FILE: 'none', PATH } });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stdin.end(stdin);
    const status = await new Promise((resolve) => child.on('close', resolve));
    const ghCalls = existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n') : [];
    return { status, stdout, ghCalls };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
