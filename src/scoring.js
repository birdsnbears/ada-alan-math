/**
 * scoring.js — speed bands, points, and mastery transitions.
 *
 * PURE MODULE. gradeAnswer() takes the old fact state and returns a NEW one;
 * it never mutates its input. That immutability is what makes the simulation
 * harness trustworthy and will make undo/replay easy if we ever want it.
 *
 * ============================ TUNING KNOBS ================================
 * Points convert 1:1 to minutes of screen time, so the earn rate matters.
 * A 20-question round takes roughly 3-5 minutes. A flawless fast round is
 * 20 x 2 = 40 points, which is far too generous, so DAILY_POINT_CAP is the
 * real governor. Change that one number to change the whole economy.
 * ==========================================================================
 */

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

export const POINTS = {
  fast: 2,
  medium: 1,
  slow: 0,
  wrong: 0,
  masteryBonus: 3, // one-off, the first time a fact reaches the top box
  perfectRound: 5, // round-completion bonus at >= 90% correct
};

/** Max points earnable per calendar day, i.e. max minutes of screen time. */
export const DAILY_POINT_CAP = 30;

export const MASTERY_BOX = 5;

/** Number of questions in one round. Short enough to have a visible finish line. */
export const ROUND_LENGTH = 20;

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
 * Advance a fact's Leitner box.
 *
 * Key rule: a "medium" answer can carry you to box 3 but no further. Mastery
 * requires FLUENCY, not just correctness — you cannot reach the top box by
 * slowly working the answer out every time. This is the whole point of the app.
 *
 * A wrong answer drops two boxes rather than resetting to zero: forgetting one
 * fact shouldn't erase weeks of work, but it should bring the fact back soon.
 */
function nextBox(box, correct, band) {
  if (!correct) return Math.max(0, box - 2);
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
 * Grade one answer.
 *
 * @param {object}  prevState  fact state before this answer
 * @param {boolean} correct
 * @param {number}  recallMs   ms from question shown to first keypress
 * @param {number}  questionIndex  profile-wide counter, used for scheduling
 * @returns {{state: object, band: string, points: number, becameMastered: boolean}}
 */
export function gradeAnswer(prevState, correct, recallMs, questionIndex) {
  const prev = prevState ?? defaultFactState();
  const band = classifySpeed(recallMs);
  const box = nextBox(prev.box, correct, band);
  const becameMastered = prev.box < MASTERY_BOX && box >= MASTERY_BOX;

  const state = {
    box,
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    streak: correct ? prev.streak + 1 : 0,
    avgMs: correct ? updateAvg(prev.avgMs, recallMs) : prev.avgMs,
    lastSeenIndex: questionIndex,
  };

  let points = correct ? POINTS[band] : POINTS.wrong;
  if (becameMastered) points += POINTS.masteryBonus;

  return { state, band, points, becameMastered };
}

/** Bonus awarded once, at the end of a round. */
export function roundBonus(asked, correct) {
  if (asked === 0) return 0;
  return correct / asked >= 0.9 ? POINTS.perfectRound : 0;
}
