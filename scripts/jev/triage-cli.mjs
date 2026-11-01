#!/usr/bin/env node
// CLI for the triage tool. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/triage-cli.mjs <issue-number> [--json]   reads the issue with `gh issue view`
//   gh issue view 3 --json title,body | node scripts/jev/triage-cli.mjs [--json]
//   node scripts/jev/triage-cli.mjs [--json] < issue.txt       first non-blank line is the title
//
// Always exits 0: a skip or an error is one line, and the caller triages as normal.

import { createClient, errorLine } from './client.mjs';
import { issueNumber, readIssue } from './issue-input.mjs';
import { run } from './triage.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = issueNumber(args);

function human(result) {
  if (result.status !== 'ok') return `jev triage: ${result.status}, ${result.reason}; triage as normal`;
  const line = (name, s, onOpen) =>
    `${name}: ${s.label} (confidence ${s.confidence.toFixed(2)}) ${s.decision}` +
    (s.decision === 'open' ? ` - ${onOpen}` : '');
  return [
    line('role', result.role, 'decide the role yourself'),
    line('phase', result.phase, 'phase unclear: ask the owner'),
  ].join('\n');
}

// Check the key first: a keyless run must not call gh or read stdin, and must print the skip.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') result = await run(readIssue(number), { client });
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
