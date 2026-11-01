#!/usr/bin/env node
// Reads an eval case (evals/README.md § Case format) for the runner scripts, eval-sandbox.sh and
// eval-collect.sh: its Starting state blocks by step, its Prompt and its Collect commands.
//
//   node scripts/eval-case.mjs <check|before-push|after-bootstrap|prompt|collect> <case-file | ->
//
// It prints the part asked for: a block as written, or each Collect command followed by a NUL. A
// case it cannot parse is one `eval-case: <file>: <why>` line on stderr and exit 1, never a partial
// parse, so a sandbox is never built from half a case. `parseCase` is exported for its test.
//
// Sections are found outside fences only, and only at the case's own headings: a heredoc in a
// Starting state block holds headings of its own (`## Acceptance criteria`), which stay in the
// block. A Collect command ends where bash says it is whole, so a backslash continuation, a quote
// over several lines or a loop is one command.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SECTIONS = ['Exercises', 'Starting state', 'Prompt', 'Owner replies', 'Collect', 'Pass criteria'];
const STEPS = { 'On main, before the push': 'beforePush', 'After bootstrap': 'afterBootstrap' };

// Splits a case into its sections, each a list of items: { prose } for a line outside a fence and
// { fence, info, body } for a fenced block. Text before the first case heading is the title.
function sections(markdown) {
  const out = new Map();
  let items = [];
  let fence = null;
  for (const line of markdown.split(/\r\n?|\n/)) {
    if (fence) {
      const close = /^(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
        items.push({ fence: true, info: fence.info, body: fence.lines.map((l) => `${l}\n`).join('') });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const open = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      fence = { marker: open[1], info: open[2].trim(), lines: [] };
      continue;
    }
    const heading = /^## (.+?)[ \t]*$/.exec(line);
    if (heading && SECTIONS.includes(heading[1])) {
      if (out.has(heading[1])) throw new Error(`section "## ${heading[1]}" appears twice`);
      items = [];
      out.set(heading[1], items);
      continue;
    }
    items.push({ prose: line });
  }
  if (fence) throw new Error(`a fence opened with ${fence.marker} is never closed`);
  return out;
}

// True when bash reads `source` as complete: it parses, and no heredoc runs into the end. bash only
// warns on an unclosed heredoc, so any message counts against it. A trailing backslash continues
// the command on the next line, though bash accepts it at the end of input.
function whole(source) {
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(source)) return false; // an odd run of backslashes at the end
  const result = spawnSync('bash', ['-n'], { input: source, encoding: 'utf8' });
  if (result.error) throw new Error(`cannot run bash to parse commands: ${result.error.message}`);
  return result.status === 0 && result.stderr === '';
}

function startingState(items) {
  const blocks = { beforePush: '', afterBootstrap: '' };
  const named = new Set();
  let step = null;
  for (const item of items ?? []) {
    if (!item.fence) {
      const label = Object.keys(STEPS).find((l) => item.prose.startsWith(`${l}:`));
      if (label) {
        if (named.has(label)) throw new Error(`Starting state gives "${label}" twice`);
        named.add(label);
        step = STEPS[label];
      }
      continue;
    }
    if (!step) {
      throw new Error(
        `a Starting state block has no step before it; open its paragraph with "On main, before the push:" or "After bootstrap:"`,
      );
    }
    if (!whole(item.body)) throw new Error(`bash cannot parse the "${step}" Starting state block`);
    blocks[step] = item.body;
    step = null;
  }
  return blocks;
}

function onlyBlock(items, name) {
  if (!items) throw new Error(`no "## ${name}" section`);
  const blocks = items.filter((item) => item.fence);
  if (blocks.length !== 1) throw new Error(`"## ${name}" holds ${blocks.length} fenced blocks, not one`);
  return blocks[0].body;
}

// Collect's block, cut into whole commands. Blank and comment lines between commands are dropped.
function collectCommands(block) {
  const commands = [];
  let pending = [];
  for (const line of block.replace(/\n$/, '').split('\n')) {
    if (!pending.length && (line.trim() === '' || line.trim().startsWith('#'))) continue;
    pending.push(line);
    const command = pending.join('\n');
    if (whole(command)) {
      commands.push(command);
      pending = [];
    }
  }
  if (pending.length) throw new Error(`bash cannot parse the Collect command starting "${pending[0].trim()}"`);
  if (!commands.length) throw new Error('"## Collect" holds no command');
  return commands;
}

export function parseCase(markdown) {
  const parts = sections(markdown);
  // The sections every case has come first, so a missing one is named, not read as a stray block.
  const prompt = onlyBlock(parts.get('Prompt'), 'Prompt');
  const collect = collectCommands(onlyBlock(parts.get('Collect'), 'Collect'));
  return { ...startingState(parts.get('Starting state')), prompt, collect };
}

const PARTS = {
  check: () => '',
  'before-push': (c) => c.beforePush,
  'after-bootstrap': (c) => c.afterBootstrap,
  prompt: (c) => c.prompt,
  collect: (c) => c.collect.map((command) => `${command}\0`).join(''),
};

function main([part, file]) {
  if (!PARTS[part] || !file) {
    process.stderr.write(`usage: eval-case.mjs <${Object.keys(PARTS).join('|')}> <case-file | ->\n`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = parseCase(readFileSync(file === '-' ? 0 : file, 'utf8'));
  } catch (error) {
    process.stderr.write(`eval-case: ${file}: ${error.message}\n`);
    process.exit(1);
  }
  process.stdout.write(PARTS[part](parsed));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
