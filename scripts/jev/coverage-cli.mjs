#!/usr/bin/env node
// CLI for the coverage checker. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/coverage-cli.mjs <pr-number> [--json]   reads the PR, the issue its body
//                                                            closes and its diff with gh
//   node scripts/jev/coverage-cli.mjs <issue-file> <diff-file> [--json]
//
// An issue file is the issue body as markdown, or `gh issue view --json body` output. Always exits
// 0: a skip or an error is one line, and the Reviewer checks every criterion as normal.

import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { human, run } from './coverage.mjs';
import { gh } from './issue-input.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const paths = args.filter((a) => !a.startsWith('--'));
const number = paths.length === 1 && /^\d+$/.test(paths[0]) ? paths[0] : null;

function body(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.body === 'string') return parsed.body;
  } catch {
    // Not JSON: the body as markdown.
  }
  return text;
}

function readInput() {
  if (number) {
    const pr = JSON.parse(gh(['pr', 'view', number, '--json', 'body'])).body ?? '';
    const closes = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i.exec(pr);
    if (!closes) throw new Error(`PR #${number} closes no issue: review the Spec axis against its body`);
    return { issue: body(gh(['issue', 'view', closes[1], '--json', 'body'])), diff: gh(['pr', 'diff', number]) };
  }
  if (paths.length !== 2) throw new Error('give a PR number, or an issue file and a diff file');
  return { issue: body(readFileSync(paths[0], 'utf8')), diff: readFileSync(paths[1], 'utf8') };
}

// Check the key first: a keyless run must not call gh or read any input, and must print the skip.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') result = await run(readInput(), { client });
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
