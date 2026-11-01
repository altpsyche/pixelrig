// The triage tool: suggests one role label and one `phase:N` for an issue, each with Jev's
// confidence and a band, `recommend` or `open`. It never applies a label; the triager does, and only
// the owner puts work on a frontier. See README.md beside this file and docs/agents/jev.md.
//
// The options are read from their authoritative docs on every run, not copied here, so an edit to
// either doc changes what Jev is asked without a second edit.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorLine } from './client.mjs';
import { TRIAGE_CONFIDENT } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LABELS_DOC = 'docs/agents/triage-labels.md';
const IDEA_DOC = 'docs/idea.md';

// The five canonical triage roles the vendored skills speak in. `needs-triage` is the state being
// left, so its label is never an option.
const CANONICAL_ROLES = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
const LEAVING = 'needs-triage';

/**
 * Role options from the triage labels table: each row's label (second column) mapped to its
 * "Meaning", in table order, for every role but `needs-triage`. Jev favours the first option
 * (ADR-0002), and the table lists `needs-info`, the cheapest wrong answer, first. Throws on a row
 * outside the canonical five, or a canonical role with no row.
 */
export function roleCriteria(labelsDoc) {
  const rows = new Map();
  for (const line of labelsDoc.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | `role` | `label` | meaning |  →  ['', '`role`', '`label`', 'meaning', '']
    const role = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
    const label = /^`([^`]+)`$/.exec(cells[2] ?? '')?.[1];
    if (cells.length < 5 || !role || !label) continue;
    if (!CANONICAL_ROLES.includes(role)) {
      throw new Error(`${LABELS_DOC} has a row for \`${role}\`, which is not one of the five triage roles`);
    }
    rows.set(role, { label, meaning: cells[3] });
  }
  const missing = CANONICAL_ROLES.filter((r) => !rows.get(r)?.meaning);
  if (missing.length) throw new Error(`${LABELS_DOC} has no row for ${missing.join(', ')}`);
  const criteria = {};
  for (const [role, { label, meaning }] of rows) if (role !== LEAVING) criteria[label] = meaning;
  return criteria;
}

/**
 * Phase options from the roadmap: `phase:N` mapped to "<title>: <bullet>; <bullet>", for each
 * `### Phase N — Title` heading under the `## ` heading that names the Roadmap. Throws when there
 * is none.
 */
export function phaseCriteria(ideaDoc) {
  const phases = {};
  let inRoadmap = false;
  let current = null;
  for (const line of ideaDoc.split('\n')) {
    if (/^## /.test(line)) {
      inRoadmap = /roadmap/i.test(line);
      current = null;
      continue;
    }
    if (!inRoadmap) continue;
    const heading = /^### Phase (\d+)\s*[—–-]\s*(.+)$/.exec(line);
    if (heading) {
      current = { title: heading[2].trim(), covers: [] };
      phases[`phase:${heading[1]}`] = current;
    } else if (current && /^\s*[-*] /.test(line)) {
      current.covers.push(line.replace(/^\s*[-*] /, '').trim());
    }
  }
  const entries = Object.entries(phases);
  if (!entries.length) throw new Error(`${IDEA_DOC} has no "### Phase N — Title" headings under its Roadmap`);
  return Object.fromEntries(entries.map(([id, { title, covers }]) => [id, `${title}: ${covers.join('; ')}`]));
}

function questions(roles, phases) {
  return {
    role: {
      type: 'choice',
      instructions: "This is an issue in the project's GitHub tracker. Which triage state should it move to next?",
      criteria: roles,
    },
    phase: {
      type: 'choice',
      instructions:
        "Which phase of the project's roadmap does the work this issue asks for belong to? " +
        'Each option lists the work that phase covers.',
      criteria: phases,
    },
  };
}

function band(answer, options, id) {
  if (!answer || typeof answer.choice !== 'string' || typeof answer.confidence !== 'number') {
    throw new Error(`Jev returned no usable ${id} answer`);
  }
  if (!Object.hasOwn(options, answer.choice)) {
    throw new Error(`Jev chose ${answer.choice} for ${id}, which is not an option`);
  }
  return {
    label: answer.choice,
    confidence: answer.confidence,
    decision: answer.confidence >= TRIAGE_CONFIDENT ? 'recommend' : 'open',
  };
}

/**
 * Suggest a role label and a phase label for one issue.
 *
 * @param {{ title: string, body?: string }} input  the issue
 * @param {{ client: { available(): Promise<object>, ask(request): Promise<object> }, root?: string }} deps
 *   a client from client.mjs, and the repo root the docs are read from (default: this repo)
 * @returns one of
 *   { status: 'ok', role: Suggestion, phase: Suggestion }, Suggestion = { label, confidence, decision }
 *   { status: 'skipped', reason }  no key
 *   { status: 'error', reason }    anything else; never thrown
 */
export async function run(input, { client, root = ROOT }) {
  try {
    // Before any other work, so a keyless run skips even when a doc no longer parses.
    const ready = await client.available();
    if (ready.status !== 'ok') return ready;
    if (!input?.title?.trim()) {
      return { status: 'error', reason: 'the issue has no title: give an issue number, or pipe the issue on stdin' };
    }
    const [labels, idea] = await Promise.all([
      readFile(path.join(root, LABELS_DOC), 'utf8'),
      readFile(path.join(root, IDEA_DOC), 'utf8'),
    ]);
    const roles = roleCriteria(labels);
    const phases = phaseCriteria(idea);
    const state = { issue: { title: input.title, body: input.body ?? '' } };
    const result = await client.ask({ state, questions: questions(roles, phases) });
    if (result.status !== 'ok') return { status: result.status, reason: result.reason };
    return {
      status: 'ok',
      role: band(result.answers.role, roles, 'role'),
      phase: band(result.answers.phase, phases, 'phase'),
    };
  } catch (error) {
    return { status: 'error', reason: errorLine(error) };
  }
}
