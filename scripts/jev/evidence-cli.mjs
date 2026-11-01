#!/usr/bin/env node
// CLI for the evidence checker. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/evidence-cli.mjs <pr-number> <outputs.json> [--json]   reads the PR body with gh
//   node scripts/jev/evidence-cli.mjs <outputs.json> [--json] < body.md       or the body on stdin
//
// outputs.json is { "<command as the claim writes it>": "<what it printed when you ran it>" }. The
// CLI never runs a command itself. Always exits 0: a skip or an error is one line, and the Reviewer
// checks every entry as normal.

import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { human, run } from './evidence.mjs';
import { gh } from './issue-input.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = args.find((a) => /^\d+$/.test(a));
const outputsFile = args.find((a) => !a.startsWith('--') && a !== number);

function readBody() {
  if (number) {
    return JSON.parse(gh(['pr', 'view', number, '--json', 'body'])).body ?? '';
  }
  if (process.stdin.isTTY) throw new Error('give a PR number, or pipe the PR body on stdin');
  const text = readFileSync(0, 'utf8');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.body === 'string') return parsed.body;
  } catch {
    // Not JSON: the body as markdown.
  }
  return text;
}

function readOutputs() {
  if (!outputsFile) throw new Error('give the outputs file: a JSON object of { "<command>": "<what it printed>" }');
  try {
    return JSON.parse(readFileSync(outputsFile, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${outputsFile} as JSON: ${errorLine(error)}`);
  }
}

// Check the key first: a keyless run must not call gh or read any input, and must print the skip.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') result = await run({ outputs: readOutputs(), body: readBody() }, { client });
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
