// The shared Jev client every tool here asks through (ADR-0002). It calls the HTTP API with Node's
// built-in `fetch`, with no package, and turns every failure into a value, so no tool ever throws
// into the caller's workflow. See README.md beside this file.
//
// `available()` checks for a key without a request; `ask()` resolves to exactly one of:
//   { status: 'ok', answers }        answers keyed by question id, as Jev returns them
//   { status: 'skipped', reason }    no TYPESAFE_API_KEY
//   { status: 'error', reason }      anything else; `reason` is one line with the key redacted

import {
  JEV_BACKOFF_MS,
  JEV_CHARS_PER_TOKEN,
  JEV_MAX_ATTEMPTS,
  JEV_QUESTION_TOKENS,
  JEV_REQUEST_TOKENS,
  JEV_TIMEOUT_MS,
  MODEL,
} from './constants.mjs';
import { jevEnv } from './env-file.mjs';

const KEY_VAR = 'TYPESAFE_API_KEY';
const BASE_URL_VAR = 'TYPESAFE_BASE_URL';
const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const RETRY_STATUSES = new Set([429, 529]);

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]  where the key and base-URL override
 *   are read; default `process.env`, with any it lacks from the main clone's `.env` (env-file.mjs)
 * @param {(ms: number) => Promise<void>} [options.sleep]  waits out a backoff; tests record it
 * @param {number} [options.timeoutMs]  how long one attempt may take
 */
export function createClient({ env = jevEnv(), sleep = defaultSleep, timeoutMs = JEV_TIMEOUT_MS } = {}) {
  const key = env[KEY_VAR]?.trim();
  const endpoint = `${(env[BASE_URL_VAR]?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/systemone`;
  const redact = (line) => (key ? line.replaceAll(key, '[redacted]') : line);

  /**
   * Whether a request could be made. Makes no request, so a tool calls it before any other work
   * (reading an issue, reading docs) and stops on a skip.
   */
  async function available() {
    return key ? { status: 'ok' } : { status: 'skipped', reason: `${KEY_VAR} is not set` };
  }

  async function post(state, questions) {
    const body = JSON.stringify({ model: MODEL, state, questions });
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        const parsed = await response.json().catch(() => null);
        if (!parsed || typeof parsed.answers !== 'object' || parsed.answers === null) {
          throw new Error('Jev returned no answers');
        }
        return parsed.answers;
      }
      const detail = (await response.text().catch(() => '')).split('\n')[0].slice(0, 200);
      if (RETRY_STATUSES.has(response.status) && attempt < JEV_MAX_ATTEMPTS) {
        await sleep(JEV_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      const tries = attempt > 1 ? ` after ${attempt} attempts` : '';
      throw new Error(`Jev answered ${response.status}${tries}${detail ? `: ${detail}` : ''}`);
    }
  }

  /**
   * Ask every question about one state. Questions go in as few requests as Jev's limits allow
   * (`batches`), and the answers come back merged, keyed by question id. If any request fails, the
   * whole call is one error: a tool never acts on half its answers.
   */
  async function ask({ state, questions }) {
    const ready = await available();
    if (ready.status !== 'ok') return ready;
    try {
      const answers = {};
      for (const batch of batches(state, questions)) {
        Object.assign(answers, await post(state, batch));
      }
      const missing = Object.keys(questions).filter((id) => !answers[id]);
      if (missing.length) throw new Error(`Jev left ${missing.join(', ')} unanswered`);
      return { status: 'ok', answers };
    } catch (error) {
      return { status: 'error', reason: redact(errorLine(error)) };
    }
  }

  return { available, ask };
}

/** A token estimate for any JSON value, erring high (`JEV_CHARS_PER_TOKEN`). */
function tokens(value) {
  return Math.ceil(JSON.stringify(value).length / JEV_CHARS_PER_TOKEN);
}

/**
 * Whether one question fits beside its state within `JEV_QUESTION_TOKENS`: the rule `ask` refuses
 * on. A tool sets aside what does not fit before asking, so one oversize item never turns the whole
 * call into an error.
 */
export function fitsBesideState(state, id, question) {
  return tokens(state) + tokens({ [id]: question }) <= JEV_QUESTION_TOKENS;
}

/**
 * The probability a Noul answer carries, or a throw: NaN, a string or a missing answer would
 * compare false against a threshold and decide silently, so a tool never compares one.
 */
export function noulOf(answer) {
  const noul = answer?.noul;
  if (typeof noul !== 'number' || !(noul >= 0 && noul <= 1)) throw new Error('Jev returned no usable answer');
  return noul;
}

/**
 * Packs questions first-fit, in order, into as few requests as the limits allow: the state plus
 * every question in a request within `JEV_REQUEST_TOKENS`, and the state plus any one question
 * within `JEV_QUESTION_TOKENS`. Throws, before anything is sent, on a question that cannot fit.
 */
function batches(state, questions) {
  const base = tokens(state);
  const out = [];
  let current = {};
  let size = base;
  for (const [id, question] of Object.entries(questions)) {
    const cost = tokens({ [id]: question });
    if (!fitsBesideState(state, id, question)) {
      throw new Error(`question ${id} is too large to ask beside its state (over ${JEV_QUESTION_TOKENS} tokens)`);
    }
    if (size + cost > JEV_REQUEST_TOKENS) {
      out.push(current);
      current = {};
      size = base;
    }
    current[id] = question;
    size += cost;
  }
  if (Object.keys(current).length) out.push(current);
  return out;
}

/**
 * The first line of an error's message, which every tool and CLI uses to report a failure. The
 * client redacts the key from its own errors; a CLI's errors never see the key.
 */
export function errorLine(error) {
  const cause = error?.cause?.code ? ` (${error.cause.code})` : '';
  return `${String(error?.message ?? error).split('\n')[0]}${cause}`;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
