// The finding verifier: before a Reviewer posts, asks Jev whether each draft finding's quoted line,
// read against its cited source, supports it, and marks each finding keep or flag. It never removes
// a finding; the Reviewer re-reads the source of a flagged one and decides. See README.md beside
// this file and docs/agents/jev.md.
//
// The constitution bullets are read from the review checklist on every run, not copied here, so a
// checklist edit changes which findings are exempt without a second edit.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorLine, fitsBesideState, noulOf } from './client.mjs';
import { VERIFY_KEEP_NOUL } from './constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DOC = 'docs/workflow.md';
const FIELDS = ['text', 'quote', 'source', 'excerpt'];

// How many opening words of a constitution bullet an excerpt must quote to count as citing it.
const PREFIX_WORDS = 5;

/**
 * The phrases that mark a quote of the review checklist's **The constitution** bullets: each
 * bullet's sentences and semicolon clauses, and its first PREFIX_WORDS words, all normalised. A
 * bullet's indented continuation lines belong to it. Throws when the section has no bullets.
 */
export function constitutionPhrases(workflowDoc) {
  const bullets = [];
  let inSection = false;
  for (const line of workflowDoc.split('\n')) {
    if (/^\*\*/.test(line)) {
      inSection = /^\*\*The constitution\*\*/.test(line);
      continue;
    }
    if (/^#/.test(line)) inSection = false;
    if (!inSection) continue;
    if (/^\s*[-*] /.test(line)) bullets.push(line.replace(/^\s*[-*] /, ''));
    else if (bullets.length && /^\s+\S/.test(line)) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  if (!bullets.length) throw new Error(`${WORKFLOW_DOC} has no bullets under "**The constitution**"`);
  const phrases = new Set();
  for (const bullet of bullets) {
    for (const clause of bullet.split(/[.;!?]/)) if (normalise(clause)) phrases.add(normalise(clause));
    phrases.add(normalise(bullet).split(' ').slice(0, PREFIX_WORDS).join(' '));
  }
  return [...phrases];
}

/** Lower-case words separated by single spaces: punctuation, markup and spacing do not count. */
function normalise(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * A finding cites the constitution when its source names it, or its excerpt quotes any sentence or
 * clause of a constitution bullet, or a bullet's opening words, ignoring case and punctuation. The
 * match errs towards exempting: keeping a finding unasked is cheap, flagging a constitution one is
 * not, and ADR-0002 says Jev never judges a constitution item.
 */
function citesConstitution(finding, phrases) {
  if (/constitution/i.test(finding.source)) return true;
  const excerpt = ` ${normalise(finding.excerpt)} `;
  return phrases.some((phrase) => excerpt.includes(` ${phrase} `));
}

/** Checks the input's shape; throws one line naming the first problem, so nothing bad is sent. */
function validate(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('no findings: give a JSON array of findings, each with text, quote, source and excerpt');
  }
  const seen = new Set();
  return input.map((raw, index) => {
    const label = `finding ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} is not an object`);
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) {
      throw new Error(`${label} has an id that is not a non-empty string`);
    }
    const id = raw.id?.trim() ?? `F${index + 1}`;
    if (seen.has(id)) {
      const how = raw.id === undefined ? ', the default for its position: give every finding an id' : '';
      throw new Error(`${label} repeats the id ${id}${how}`);
    }
    seen.add(id);
    for (const field of FIELDS) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) throw new Error(`${label} (${id}) has no ${field}`);
    }
    return { id, text: raw.text, quote: raw.quote, source: raw.source, excerpt: raw.excerpt };
  });
}

// What every question shares. Each finding travels in its own question, so the client can split
// the findings across requests without resending them all in the state.
const STATE = {
  review:
    'Draft findings from a code review of this repository. Each question carries one finding: ' +
    '`text` is the finding, `quote` is the line under review it is about, `source` names the rule ' +
    'or spec it cites, and `excerpt` is the text of that source it relies on.',
};

// Phrased positively (ADR-0002: Jev reads negations literally), with the yes-case first.
function question({ text, quote, source, excerpt }) {
  return {
    type: 'noul',
    instructions: {
      finding: { text, quote, source, excerpt },
      question: 'Read `quote` against `excerpt`. Does that line, read against that source, support the finding in `text`?',
    },
    criteria: {
      true: 'The quoted line does what the finding says, and the excerpt says what the finding relies on it saying.',
      false: 'The quoted line does not show what the finding claims, or the excerpt does not say what the finding relies on.',
    },
  };
}

function judge(answer) {
  const noul = noulOf(answer);
  return { decision: noul >= VERIFY_KEEP_NOUL ? 'keep' : 'flag', noul, reason: 'checked' };
}

const ON_FLAG = 're-read the cited source once, then keep or drop the finding';

/** The CLI's line output: one line per finding, in input order, or one for a skip or an error. */
export function human(result) {
  if (result.status !== 'ok') return `jev verify-findings: ${result.status}, ${result.reason}; continue as normal`;
  return result.findings
    .map((f) => {
      if (f.reason === 'constitution') return `${f.id}: keep (cites the constitution, never flagged)`;
      if (f.reason === 'too-large') return `${f.id}: keep (too large to check)`;
      const line = `${f.id}: ${f.decision} (noul ${f.noul.toFixed(2)})`;
      return f.decision === 'flag' ? `${line} - ${ON_FLAG}` : line;
    })
    .join('\n');
}

/**
 * Check draft review findings against their cited sources.
 *
 * @param {Array<{ id?: string, text: string, quote: string, source: string, excerpt: string }>} input
 *   the findings; `id` defaults to F1, F2, … by position
 * @param {{ client: { available(): Promise<object>, ask(request): Promise<object> }, root?: string }} deps
 *   a client from client.mjs, and the repo root the review checklist is read from
 * @returns one of
 *   { status: 'ok', findings: Verdict[] }, every finding, in input order, Verdict =
 *     { id, decision: 'keep' | 'flag', noul: number | null, reason: 'checked' | 'constitution' | 'too-large' }
 *   { status: 'skipped', reason }  no key
 *   { status: 'error', reason }    anything else, including malformed input; never thrown
 */
export async function run(input, { client, root = ROOT }) {
  try {
    // Before any other work, so a keyless run skips even when the input or the checklist is bad.
    const ready = await client.available();
    if (ready.status !== 'ok') return ready;
    const findings = validate(input);
    const phrases = constitutionPhrases(await readFile(path.join(root, WORKFLOW_DOC), 'utf8'));

    const verdicts = new Map();
    const questions = {};
    findings.forEach((f, index) => {
      const key = `f${index + 1}`;
      const ask = question(f);
      if (citesConstitution(f, phrases)) {
        verdicts.set(f.id, { decision: 'keep', noul: null, reason: 'constitution' });
      } else if (!fitsBesideState(STATE, key, ask)) {
        verdicts.set(f.id, { decision: 'keep', noul: null, reason: 'too-large' });
      } else {
        questions[key] = ask;
      }
    });

    if (Object.keys(questions).length) {
      const result = await client.ask({ state: STATE, questions });
      if (result.status !== 'ok') return { status: result.status, reason: result.reason };
      findings.forEach((f, index) => {
        const key = `f${index + 1}`;
        if (questions[key]) verdicts.set(f.id, judge(result.answers[key]));
      });
    }

    return { status: 'ok', findings: findings.map((f) => ({ id: f.id, ...verdicts.get(f.id) })) };
  } catch (error) {
    return { status: 'error', reason: errorLine(error) };
  }
}
