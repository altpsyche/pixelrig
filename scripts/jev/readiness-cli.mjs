#!/usr/bin/env node
// CLI for the readiness tool. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/readiness-cli.mjs <issue-number> [--plan <file>] [--json]
//   node scripts/jev/readiness-cli.mjs [--plan <file>] [--json] < ticket.txt   title on the first line
//
// The issue is read as triage-cli.mjs reads it; `--plan` names a file holding the `Plan:` comment,
// such as the draft about to be posted. Always exits 0: a skip or an error is one line, and the
// caller checks readiness itself.

import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { issueNumber, readIssue } from './issue-input.mjs';
import { run } from './readiness.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const planAt = args.indexOf('--plan');
const planFile = planAt === -1 ? undefined : args[planAt + 1];
const number = issueNumber(args.filter((_, i) => planAt === -1 || i !== planAt + 1));

function human(result) {
  if (result.status !== 'ok') return `jev readiness: ${result.status}, ${result.reason}; check readiness yourself`;
  const check = (label, c, onGap) => `${label} ${c.decision} (noul ${c.noul.toFixed(2)})${c.decision === 'gap' ? ` - ${onGap}` : ''}`;
  const lines = [
    check('criteria:', result.criteria, 'add acceptance criteria, or raise it with the owner'),
    check('seams:', result.seams, 'name the seams the work is checked at, or raise it with the owner'),
  ];
  if (result.plan?.length === 0) lines.push('plan: no acceptance criteria found in the ticket to check the plan against');
  result.plan?.forEach((p, i) => lines.push(`${check(`plan: criterion ${i + 1}`, p, 'add a plan step that covers it')}: ${p.criterion}`));
  return lines.join('\n');
}

// Check the key first: a keyless run must not call gh, read stdin or read the plan.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') {
    if (planAt !== -1 && !planFile) throw new Error('--plan needs a file');
    const plan = planFile === undefined ? undefined : readFileSync(planFile, 'utf8');
    result = await run({ ...readIssue(number), plan }, { client });
  }
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
