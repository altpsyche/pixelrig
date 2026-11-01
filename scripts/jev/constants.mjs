// Every tunable number the Jev tools use, and the model they use it with, in one reviewed place
// (ADR-0002). Thresholds are calibrated against this exact model id: a new model is a deliberate
// edit here, never `jev-latest`, so its calibration cannot shift silently. Each threshold names the
// sample it came from, or says plainly that it has none, so live runs can retune it. See README.md
// beside this file.

/** The pinned System One model every Jev tool asks. */
export const MODEL = 'jev-1.13.0';

/**
 * Triage turns a Choice into the agent's recommendation at a confidence at or above this; below
 * it, the question is left open. Sample: none. An unsampled default, ported unchanged from
 * errand-knight's TRIAGE_APPLY_CONFIDENCE, which records no sample for it either. Retune it from
 * the first live triage runs here.
 */
export const TRIAGE_CONFIDENT = 0.8;

/**
 * The pruner puts a doc on the read list at a Noul (probability that the work needs it) at or above
 * this; below it, the doc is skipped. A low bar: a missed doc costs more than an extra read.
 * Sample: none. Ported unchanged from errand-knight's PRUNE_INCLUDE_NOUL, which records no sample
 * for it either. Retune it from the first live prune runs here.
 */
export const PRUNE_INCLUDE_NOUL = 0.2;

/**
 * The finding verifier keeps a draft finding at a Noul (probability that its cited source supports
 * it) at or above this, and flags it for one re-read below it. A flag costs one re-read, a kept
 * false finding a fix round, so the bar errs towards flagging. Sample: one, from errand-knight,
 * whose README documents one live run of its sample findings file: the supported finding scored
 * 0.89 and the unsupported one 0.61, so its first guess of 0.5 kept both. Ported unchanged. There
 * the findings sat in the request's state; here each sits in its own question, a shape no live run
 * has checked yet. Retune it from the first live runs here.
 */
export const VERIFY_KEEP_NOUL = 0.7;

/**
 * Readiness passes a check (has acceptance criteria, names seams, a plan step covers a criterion)
 * at a Noul at or above this; below it, the check is a gap the agent fixes or raises. Sample: none.
 * A first guess, set high because a false gap costs one look and a false pass lets work start on a
 * gap. Retune it from the first live readiness runs here.
 */
export const READINESS_PASS = 0.7;

/**
 * Duplicates places each open issue on a three-level Score against the issue being checked: 0
 * different, 1 maybe, 2 same. Jev's score is a float on that scale, so these cut it into bands: at
 * or above DUPLICATES_SAME is `same`, at or above DUPLICATES_MAYBE is `maybe`, and both are listed
 * for the agent to decide; below is `different`. Sample: none. First guesses, at the midpoints
 * between levels, as rounding to the nearest level would give. Retune them from the first live
 * duplicates runs here.
 */
export const DUPLICATES_MAYBE = 0.5;
export const DUPLICATES_SAME = 1.5;

/**
 * How much of each open issue's body duplicates puts in its question, in characters; the rest is
 * cut. A size limit, not a threshold: about 1,300 tokens at JEV_CHARS_PER_TOKEN, so many open
 * issues pack into one request. Sample: none.
 */
export const DUPLICATES_BODY_CHARS = 4_000;

/**
 * The evidence checker notes an Evidence claim whose output Jev says `supports` its criterion at a
 * confidence at or above this; below it, and on `contradicts` or `silent` at any confidence, the
 * claim is flagged for the Reviewer to check first. Sample: none. A first guess, set at triage's bar
 * for want of any run to set it from. Retune it from the first live evidence runs here.
 */
export const EVIDENCE_SUPPORTS_CONFIDENT = 0.8;

/**
 * The coverage checker notes an acceptance criterion as covered at a Noul ("does the diff cover
 * it?") at or above this, with its Choice on a hunk or a test; below it the criterion is flagged.
 * Sample: none. A first guess, at verify-findings' keep bar, erring towards a flag: a flag costs one
 * look, a wrong note a missed criterion. Retune it from the first live coverage runs here.
 */
export const COVERAGE_COVERED_NOUL = 0.7;

/**
 * Below this Noul a flagged criterion is labelled uncovered rather than uncertain. Both are flags;
 * the label only says which way Jev leans. Sample: none. A first guess, the mirror of the covered
 * bar. Retune it with COVERAGE_COVERED_NOUL.
 */
export const COVERAGE_UNCOVERED_NOUL = 0.3;

/**
 * Lines of each diff hunk the coverage checker shows Jev; the rest are counted, not sent, so a long
 * diff still fits beside its questions. Not a threshold. Sample: none; a design default.
 */
export const COVERAGE_HUNK_LINES = 60;

/**
 * The injection screen calls a text a `hit` at a Noul (probability that it directs the agent beyond
 * the work) at or above INJECTION_HIT, `clear` below INJECTION_CLEAR, and `uncertain` between; a
 * hit and an uncertain text are both flagged for a re-read. Sample: none. First guesses, set to
 * flag widely, because a false flag costs one re-read and a missed injection can cost a leak.
 * Retune them from the first live injection runs here.
 */
export const INJECTION_CLEAR = 0.1;
export const INJECTION_HIT = 0.7;

/**
 * The grade tool advises `yes` on an eval pass criterion at a Noul (probability that the transcript
 * shows the answer is yes) at or above GRADE_YES, `no` below GRADE_NO, and `unsure` between, which
 * goes to the owner. Both sit far from 0.5, so a coin flip is never advised as a pass. Sample: none.
 * First guesses: an unsure costs the owner one look, a false yes a passed case. Retune them from
 * the first live grade runs here.
 */
export const GRADE_YES = 0.8;
export const GRADE_NO = 0.2;

// Jev's context limits, not thresholds: a request holds at most 64k tokens, and its state plus its
// longest single question at most 32k. Source: the TypeSafe docs as errand-knight's constants
// recorded them on 2026-10-11; not re-checked against the docs for this repo.
export const JEV_REQUEST_TOKENS = 64_000;
export const JEV_QUESTION_TOKENS = 32_000;

/**
 * Characters per token for sizing a request without a tokenizer. Sample: none. Ported unchanged
 * from errand-knight, on the rule of thumb that English prose runs nearer 4; 3 overestimates, so a
 * batch the estimate accepts should fit the real limits. No tokenizer has been run against it.
 */
export const JEV_CHARS_PER_TOKEN = 3;

// Retry and timeout settings. Sample: none; design defaults chosen for this repo, not measured.

/** Attempts per request, the first included, when Jev answers 429 (rate limit) or 529 (busy). */
export const JEV_MAX_ATTEMPTS = 4;

/** The first backoff before a retry, in milliseconds; each later one doubles it. */
export const JEV_BACKOFF_MS = 500;

/** How long one attempt may take before it is abandoned as an error, in milliseconds. */
export const JEV_TIMEOUT_MS = 30_000;
