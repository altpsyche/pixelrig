#!/usr/bin/env node
// CLI for the injection screen. See README.md beside this file and docs/agents/jev.md.
//
//   node scripts/jev/injection-cli.mjs <number> [--json]   a PR (`gh pr view`), else an issue
//   gh issue view 7 --json title,body,comments | node scripts/jev/injection-cli.mjs [--json]
//   node scripts/jev/injection-cli.mjs [--json] < text.txt   first non-blank line is the title
//
// Prints one line per text, `clear`, `uncertain` or `hit`, then a summary line.
// Always exits 0: a skip or an error is one line, and the agent reads the text as it would anyway.

import { createClient, errorLine } from './client.mjs';
import { human, run } from './injection.mjs';
import { issueNumber, readPrOrIssue } from './issue-input.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const number = issueNumber(args);

// `gh` gives each comment and review an `author` object; piped JSON may give a plain login.
function work({ title, body, comments, reviews }) {
  const texts = (list) => (list ?? []).map((c) => ({ author: c?.author?.login ?? c?.author, body: c?.body }));
  return { title: String(title ?? ''), body: String(body ?? ''), comments: texts(comments), reviews: texts(reviews) };
}

// Check the key first: a keyless run must not call gh or read stdin.
const client = createClient();
let result = await client.available();
try {
  if (result.status === 'ok') {
    // A PR first, since it also carries reviews.
    result = await run(work(readPrOrIssue(number, { prFields: 'title,body,comments,reviews', issueFields: 'title,body,comments' })), { client });
  }
} catch (error) {
  result = { status: 'error', reason: errorLine(error) };
}
console.log(json ? JSON.stringify(result) : human(result));
