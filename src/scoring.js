/**
 * scoring.js — outcomes, speed bands, mastery transitions, and what a round pays.
 *
 * PURE MODULE. gradeAnswer() takes the old item state and returns a NEW one;
 * it never mutates its input. That immutability is what makes the simulation
 * harness trustworthy and would make undo/replay easy if we ever wanted it.
 */

/* =============================== outcomes ================================= */

/**
 * Every question ends in exactly one of four ways. Modelling this as four
 * named outcomes rather than a boolean is what lets "I don't know" and "I
 * guessed wrong" be treated differently — which is the whole point of the
 * scoring design below.
 */
export const OUTCOME = {
  CORRECT: 'correct',
  WRONG: 'wrong',
  SKIPPED: 'skipped', // pressed Skip
  TIMEOUT: 'timeout', // ran out of time (usually: got distracted)
};

/* ================================ timing ================================== */

/**
 * Per-question limit. Generous on purpose: children drift off mid-question and
 * the point of this limit is to catch a wandering mind, not to be a speed test.
 * A timeout is scored as a miss.
 */
export const QUESTION_TIME_LIMIT_MS = 15_000;

/**
 * Whole-round limit. The clock only runs while a question is on screen — it
 * pauses during answer feedback, so reading "8 × 7 = 56" for a moment never
 * costs them.
 *
 * 4 minutes over 20 questions is a 12-second average, against a 15-second
 * per-question ceiling. Fluent answers take 1-3s, so a normal round lands
 * around 90 seconds. This binds only on a child who is genuinely dawdling.
 */
export const ROUND_TIME_LIMIT_MS = 240_000;

/**
 * Speed bands, measured as time-to-FIRST-KEYPRESS (not time to submit).
 * That distinction matters: time-to-submit measures typing speed, whereas
 * time-to-first-keypress measures recall — which is the thing we care about.
 *
 * Under 3s  = retrieved from memory (fluent)
 * 3s to 6s  = worked it out (correct, but still computing)
 * Over 6s   = counting up, one step at a time
 */
export const SPEED_BANDS = {
  FAST_MS: 3000,
  SLOW_MS: 6000,
};

/* ============================ the point economy ===========================
 *
 * ROUND SCORE is the feedback number, shown live during the round:
 *
 *     correct  +1      wrong  −0.5      skipped / timed out   0
 *
 * A wrong answer costs more than not answering. That inversion is deliberate:
 * it makes a wild guess strictly worse than admitting you don't know, so the
 * incentive is to slow down and be sure rather than to fire off digits.
 *
 * REWARD is the payment, settled once at the end of the round:
 *
 *     perfect round (20/20)  ->  5 points
 *     otherwise              ->  4 − 0.5 × (misses), floored at 0, rounded down
 *
 * So a single mistake drops the round from 5 to 3, and eight misses pay
 * nothing. The cliff between "perfect" and "one mistake" is the mechanism: it
 * makes carefulness worth far more than pace.
 *
 * Note that the reward counts every question that was not answered correctly,
 * INCLUDING skips — while the round score leaves skips at zero. The two
 * numbers have different jobs. If skipping were free on the reward as well,
 * the optimal strategy would be to skip anything uncertain and still collect
 * the full base 4, which is exactly the carelessness this design is meant to
 * discourage. Skips are cheaper than wrong answers on the scoreboard; nothing
 * but a correct answer earns money.
 * ========================================================================= */

/** Number of questions in one round. Short enough to have a visible finish line. */
export const ROUND_LENGTH = 20;

export const ROUND_BASE_POINTS = 4;
export const PERFECT_ROUND_POINTS = 5;
export const MISS_PENALTY = 0.5;

/** Max points earnable per calendar day, i.e. max minutes of screen time. */
export const DAILY_POINT_CAP = 60;

export const MASTERY_BOX = 5;

/** What one question does to the live round score. */
export function scoreDelta(outcome) {
  if (outcome === OUTCOME.CORRECT) return 1;
  if (outcome === OUTCOME.WRONG) return -MISS_PENALTY;
  return 0; // skipped or timed out
}

/**
 * What a finished round pays. The only place points are created.
 *
 * @param {object} round
 * @param {number} round.asked      questions presented
 * @param {number} round.correct    how many were answered correctly
 * @param {number} round.elapsedMs  time spent with a question on screen
 */
export function roundPoints({ asked, correct, elapsedMs }) {
  if (asked < ROUND_LENGTH) return 0; // quitting early pays nothing
  if (elapsedMs > ROUND_TIME_LIMIT_MS) return 0; // over the round limit
  if (correct === asked) return PERFECT_ROUND_POINTS;
  const misses = asked - correct;
  return Math.max(0, Math.floor(ROUND_BASE_POINTS - MISS_PENALTY * misses));
}

/* ================================ mastery ================================= */

export function classifySpeed(recallMs) {
  if (recallMs == null) return 'slow';
  if (recallMs < SPEED_BANDS.FAST_MS) return 'fast';
  if (recallMs < SPEED_BANDS.SLOW_MS) return 'medium';
  return 'slow';
}

export function defaultFactState() {
  return {
    box: 0,
    seen: 0,
    correct: 0,
    streak: 0,
    avgMs: null,
    lastSeenIndex: -999,
  };
}

/**
 * Advance an item's Leitner box.
 *
 * Key rule: a "medium" answer can carry you to box 3 but no further. Mastery
 * requires FLUENCY, not just correctness — you cannot reach the top box by
 * slowly working the answer out every time. This is the whole point of the app.
 *
 * The three ways to miss are not equal:
 *   wrong    −2  a wrong association may be forming; bring it back hard
 *   skipped  −1  honest "I don't know"; bring it back, but don't punish honesty
 *   timeout  −1  usually distraction rather than ignorance
 *
 * Nothing resets to zero — forgetting one fact shouldn't erase weeks of work,
 * it should just make the fact come round again sooner.
 */
function nextBox(box, outcome, band) {
  if (outcome === OUTCOME.WRONG) return Math.max(0, box - 2);
  if (outcome === OUTCOME.SKIPPED || outcome === OUTCOME.TIMEOUT) return Math.max(0, box - 1);
  if (band === 'fast') return Math.min(MASTERY_BOX, box + 1);
  if (band === 'medium') return box < 3 ? box + 1 : box;
  return box; // slow but correct: no progress, no punishment
}

/** Exponential moving average — recent answers count more than old ones. */
function updateAvg(prev, sample, alpha = 0.3) {
  if (sample == null) return prev;
  if (prev == null) return sample;
  return Math.round(prev * (1 - alpha) + sample * alpha);
}

/**
 * Grade one question. Returns the new item state; points settle at round end.
 *
 * @param {object} prevState      item state before this answer
 * @param {string} outcome        one of OUTCOME
 * @param {number} recallMs       ms from question shown to first keypress
 * @param {number} questionIndex  profile-wide counter, used for scheduling
 * @returns {{state, band, becameMastered, scoreDelta}}
 */
export function gradeAnswer(prevState, outcome, recallMs, questionIndex) {
  const prev = prevState ?? defaultFactState();
  const correct = outcome === OUTCOME.CORRECT;
  const band = correct ? classifySpeed(recallMs) : null;
  const box = nextBox(prev.box, outcome, band);
  const becameMastered = prev.box < MASTERY_BOX && box >= MASTERY_BOX;

  const state = {
    box,
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    streak: correct ? prev.streak + 1 : 0,
    // Only correct answers inform the speed average; a timeout would poison it.
    avgMs: correct ? updateAvg(prev.avgMs, recallMs) : prev.avgMs,
    lastSeenIndex: questionIndex,
  };

  return { state, band, becameMastered, scoreDelta: scoreDelta(outcome) };
}
