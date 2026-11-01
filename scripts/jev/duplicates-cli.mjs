#!/usr/bin/env node
// CLI for the duplicates tool. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/duplicates-cli.mjs <issue-number> [--json]   an issue already filed
//   node scripts/jev/duplicates-cli.mjs [--json] < draft.txt       a draft, title on the first line
//
// The issue is read as triage-cli.mjs reads it; the open issues with `gh issue list`, the issue
// itself left out. Always exits 0: a skip or an error is one line, and the caller checks for
// duplicates itself.

import { createClient, errorLine } from './client.mjs';
import { run } from './duplicates.mjs';
import { gh, issueNumber, readIssue } from './issue-input.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = issueNumber(args);

function openIssues() {
  const all = JSON.parse(gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,body']));
  return all.filter((o) => String(o.number) !== number);
}

function human(result) {
  if (result.status !== 'ok') return `jev duplicates: ${result.status}, ${result.reason}; check for duplicates yourself`;
  if (!result.checked) return 'duplicates: no open issues to compare against';
  if (!result.matches.length) return `duplicates: none of ${result.checked} open issues looks like a duplicate`;
  return [
    ...result.matches.map((m) => `#${m.number} ${m.band} (score ${m.score.toFixed(2)}): ${m.title}`),
    `duplicates: ${result.matches.length} of ${result.checked} open issues may duplicate this one; read each and decide`,
  ].join('\n');
}

// Check the key first: a keyless run must not call gh or read stdin.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') result = await run({ ...readIssue(number), openIssues: openIssues() }, { client });
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
