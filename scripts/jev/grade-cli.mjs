#!/usr/bin/env node
// CLI for the grade tool. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/grade-cli.mjs <case.md> <transcript.md> [--json]
//
// The transcript file is the one evals/README.md § Running a case saves, collected output included.
// Prints one line per pass criterion, then a reminder that the answers are advice. Always exits 0:
// a skip or an error is one line, and the grader grades every criterion itself.

import { readFileSync } from 'node:fs';
import { createClient, errorLine } from './client.mjs';
import { human, run } from './grade.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => a !== '--json');

// Check the key first: a keyless run must not read either file.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') {
    if (files.length !== 2) throw new Error('give a case file and a transcript file');
    const [caseText, transcript] = files.map((f) => readFileSync(f, 'utf8'));
    result = await run({ caseText, transcript }, { client });
  }
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
