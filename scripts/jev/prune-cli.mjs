#!/usr/bin/env node
// CLI for the doc pruner. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/prune-cli.mjs <number> [--json]   a PR (`gh pr view`), else an issue
//   gh pr view 12 --json title,body,files | node scripts/jev/prune-cli.mjs [--json]
//   node scripts/jev/prune-cli.mjs [--json] < ticket.txt   first non-blank line is the title
//
// Prints one line per unit, `read` or `skip` with why (`docs/idea.md § <heading>` for a section),
// AGENTS.md first: the read list is the `read` lines.
// Always exits 0: a skip or an error is one line, and the agent reads the docs as normal.

import { createClient, errorLine } from './client.mjs';
import { issueNumber, readPrOrIssue } from './issue-input.mjs';
import { human, run } from './prune.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = issueNumber(args);

// `gh` lists a PR's files as objects; piped JSON may list plain paths. Only the path is kept.
function work({ title, body, files }) {
  return {
    title: String(title ?? ''),
    body: String(body ?? ''),
    files: (files ?? []).map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean),
  };
}

// Check the key first: a keyless run must not call gh or read stdin, and must print the skip.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') {
    // A PR first, since it carries its changed files.
    result = await run(work(readPrOrIssue(number, { prFields: 'title,body,files', issueFields: 'title,body' })), { client });
  }
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
