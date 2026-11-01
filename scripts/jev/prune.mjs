// The doc pruner: given a ticket or PR, lists the ADRs, specs, `docs/idea.md` sections and
// co-located `.md` files the work needs, so an agent reads those and `AGENTS.md` and skips the
// rest. It never removes a doc from the repo or from a step; it only orders the reading. See
// README.md beside this file and docs/agents/jev.md.
//
// The units are found on every run, not listed here, so a new ADR, spec or co-located doc is judged
// without an edit to this file.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { errorLine, fitsBesideState, noulOf } from './client.mjs';
import { PRUNE_INCLUDE_NOUL } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALWAYS = 'AGENTS.md';
const IDEA_DOC = 'docs/idea.md';
const ADR = /^docs\/adr\/\d{4}-[^/]+\.md$/;
const SPEC = /^docs\/specs\/.+\.md$/;

/**
 * `docs/idea.md` split into one section per `#` or `##` heading, each running to the next one, so a
 * `###` subsection stays inside its numbered section, the level other docs cite ("idea.md § 5").
 * A heading inside a code fence is not a heading. Text before the first heading is dropped.
 */
export function ideaSections(doc) {
  const sections = [];
  let current = null;
  let fenced = false;
  for (const line of doc.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,2} +(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = { path: IDEA_DOC, heading: heading[1], lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ lines, ...section }) => ({ ...section, text: lines.join('\n').trim() }));
}

/**
 * Whether a tracked `.md` path is a co-located doc: one in a subdirectory, beside the work it
 * describes. Not a root file (`AGENTS.md` is always read, `README.md` is the front page), not under
 * `docs/` (ADRs, specs and `docs/idea.md` are units of their own, and the rest of `docs/` says how
 * to work, reached by name at the step that needs it), not under `evals/` (its README is a step
 * reached by name, and its cases are read only by a grader), and not under a dot-directory or
 * `node_modules/`.
 */
export function isCoLocated(file) {
  const parts = file.split('/');
  if (parts.length < 2 || parts[0] === 'docs' || parts[0] === 'evals') return false;
  return !parts.some((part) => part.startsWith('.') || part === 'node_modules');
}

// Tracked files only: an untracked doc is not authoritative, and this keeps out build output and
// nested worktrees. GIT_* from the caller's environment is dropped so `root`, not an outer hook's
// GIT_DIR, decides which repo is listed.
async function trackedMarkdown(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const { stdout } = await promisify(execFile)('git', ['-C', root, 'ls-files', '-z', '--', '*.md'], {
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\0').filter(Boolean).sort();
}

/** Every unit judged, in `AGENTS.md`'s precedence order: ADRs, specs, idea.md, co-located docs. */
async function units(root) {
  const tracked = await trackedMarkdown(root);
  const read = async (file) => ({ path: file, text: (await readFile(path.join(root, file), 'utf8')).trim() });
  const adrs = await Promise.all(tracked.filter((f) => ADR.test(f)).map(read));
  const specs = await Promise.all(tracked.filter((f) => SPEC.test(f)).map(read));
  const idea = ideaSections(await readFile(path.join(root, IDEA_DOC), 'utf8'));
  const coLocated = await Promise.all(tracked.filter(isCoLocated).map(read));
  return [...adrs, ...specs, ...idea, ...coLocated];
}

// Phrased positively (ADR-0002: Jev reads negations literally), with the yes-case first.
function question(unit) {
  const document = { path: unit.path, ...(unit.heading && { section: unit.heading }), text: unit.text };
  return {
    type: 'noul',
    instructions: {
      document,
      question:
        'Should an agent doing the work described in `work` read `document` before starting, ' +
        'because it decides, constrains or describes something that work touches?',
    },
    criteria: {
      true: 'The document governs or explains code, files, behaviour or decisions the work changes or depends on.',
      false: 'The document is about an area of the project the work does not touch.',
    },
  };
}

const entry = ({ path: file, heading }) => ({ path: file, ...(heading && { heading }) });

/**
 * The read list for one ticket or PR.
 *
 * @param {{ title: string, body?: string, files?: string[] }} input  its title, body and the paths
 *   it changes (none for an issue). Only these three are sent, never a diff.
 * @param {{ client: { available(): Promise<object>, ask(request): Promise<object> }, root?: string }} deps
 *   a client from client.mjs, and the repo root the docs are read from (default: this repo)
 * @returns one of
 *   { status: 'ok', read: Entry[], skip: Entry[] }  `read` is `AGENTS.md` first, then each unit
 *     to read; `skip` is each unit answered below the bar. Both in precedence order.
 *     Entry = { path, heading?, reason?, noul? }: `heading` for a `docs/idea.md` section; a read
 *     entry's reason is 'always' (AGENTS.md), 'relevant' (with its noul) or 'oversize' (too large
 *     to ask about); a skip entry carries its noul
 *   { status: 'skipped', reason }  no key
 *   { status: 'error', reason }    anything else; never thrown
 */
export async function run(input, { client, root = ROOT }) {
  try {
    // Before any other work, so a keyless run skips even when the docs or git are unavailable.
    const ready = await client.available();
    if (ready.status !== 'ok') return ready;
    if (!input?.title?.trim()) {
      return { status: 'error', reason: 'the work has no title: give an issue or PR number, or pipe it on stdin' };
    }
    const state = { work: { title: input.title, body: input.body ?? '', changed_files: [...(input.files ?? [])] } };
    const all = (await units(root)).map((unit, i) => ({ id: `u${i + 1}`, unit, question: question(unit) }));
    // Too large to ask about beside the state: listed unasked; a missed doc costs more than a read.
    const oversize = new Set(all.filter((a) => !fitsBesideState(state, a.id, a.question)).map((a) => a.id));
    const asks = all.filter((a) => !oversize.has(a.id));

    let answers = {};
    if (asks.length) {
      const result = await client.ask({ state, questions: Object.fromEntries(asks.map((a) => [a.id, a.question])) });
      if (result.status !== 'ok') return { status: result.status, reason: result.reason };
      answers = result.answers;
    }

    const read = [{ path: ALWAYS, reason: 'always' }];
    const skip = [];
    for (const { id, unit } of all) {
      if (oversize.has(id)) {
        read.push({ ...entry(unit), reason: 'oversize' });
        continue;
      }
      const noul = noulOf(answers[id]);
      if (noul >= PRUNE_INCLUDE_NOUL) read.push({ ...entry(unit), reason: 'relevant', noul });
      else skip.push({ ...entry(unit), noul });
    }
    return { status: 'ok', read, skip };
  } catch (error) {
    return { status: 'error', reason: errorLine(error) };
  }
}

const label = ({ path: file, heading }) => (heading ? `${file} § ${heading}` : file);

/**
 * The CLI's line output: one line per unit, `read` lines first in read-list order, then `skip`
 * lines, or one line for a skip or an error. Each line says why: `always` for AGENTS.md, the noul
 * for an answered unit, and `oversize, not asked` for a unit that was never asked.
 */
export function human(result) {
  if (result.status !== 'ok') return `jev prune: ${result.status}, ${result.reason}; read the docs as normal`;
  const why = (e) => {
    if (e.reason === 'always') return 'always';
    if (e.reason === 'oversize') return 'oversize, not asked';
    return `noul ${e.noul.toFixed(2)}`;
  };
  return [
    ...result.read.map((e) => `read ${label(e)} (${why(e)})`),
    ...result.skip.map((e) => `skip ${label(e)} (noul ${e.noul.toFixed(2)})`),
  ].join('\n');
}
