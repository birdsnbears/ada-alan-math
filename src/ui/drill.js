/**
 * drill.js — runs one round of questions.
 *
 * Deliberately thin: it renders, it times, it collects input, and it hands
 * everything to the pure modules to decide. All the interesting logic (which
 * item next, what it's worth, whether a stage unlocks) lives in scheduler.js
 * and scoring.js so it can be tested without a browser.
 *
 * TIMING MODEL — three separate clocks, easy to confuse:
 *
 *   recallMs      question shown -> FIRST keypress. Feeds the speed bands and
 *                 therefore mastery. Measures recall, not typing.
 *   questionMs    question shown -> resolved. Capped at QUESTION_TIME_LIMIT_MS,
 *                 after which the question is a timeout.
 *   round elapsed sum of questionMs across the round. Excludes feedback pauses,
 *                 so reading "8 x 7 = 56" for a beat never costs them.
 */

import { itemsForStages, presentItem } from '../curriculum.js';
import { selectNextItem, refreshUnlocks } from '../scheduler.js';
import {
  gradeAnswer,
  roundPoints,
  OUTCOME,
  ROUND_LENGTH,
  DAILY_POINT_CAP,
  QUESTION_TIME_LIMIT_MS,
  ROUND_TIME_LIMIT_MS,
} from '../scoring.js';
import { awardPoints, saveProfile } from '../state.js';

const CORRECT_PAUSE_MS = 450;
const MISS_PAUSE_MS = 1700; // long enough to actually read the right answer
const METER_TICK_MS = 100;

export function startDrill({ profile, op, els, keypad, onFinish }) {
  const round = {
    op,
    asked: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
    timedOut: 0,
    score: 0,
    points: 0,
    earned: 0,
    elapsedMs: 0,
    recallTimes: [],
    newlyMastered: [],
    unlocked: [],
    aborted: false,
  };

  let current = null;
  let shownAt = 0;
  let firstKeyAt = null;
  let pauseTimer = null;
  let questionTimer = null;
  let meterTimer = null;

  keypad.onChange = (v) => { els.answerText.textContent = v; };
  keypad.onFirstKey = () => { firstKeyAt = performance.now(); };
  keypad.onSubmit = (value) => resolve(value === current.answer ? OUTCOME.CORRECT : OUTCOME.WRONG);
  keypad.onSkip = () => resolve(OUTCOME.SKIPPED);
  keypad.attach();

  /* ------------------------------- rendering ------------------------------ */

  function renderChrome() {
    els.score.textContent = formatScore(round.score);
    els.progress.style.width = `${(round.asked / ROUND_LENGTH) * 100}%`;
  }

  /** Both countdown bars, redrawn on a tick while a question is on screen. */
  function renderMeters() {
    const onScreen = shownAt ? performance.now() - shownAt : 0;

    const qLeft = Math.max(0, 1 - onScreen / QUESTION_TIME_LIMIT_MS);
    els.qtime.style.width = `${qLeft * 100}%`;
    els.qtime.classList.toggle('urgent', qLeft < 0.25);

    const roundLeft = Math.max(
      0,
      1 - (round.elapsedMs + onScreen) / ROUND_TIME_LIMIT_MS
    );
    els.roundtime.style.width = `${roundLeft * 100}%`;
    els.roundtime.classList.toggle('urgent', roundLeft < 0.2);
  }

  /* ------------------------------ question loop --------------------------- */

  function nextQuestion() {
    if (round.aborted) return;
    if (round.asked >= ROUND_LENGTH) return finish();

    const pool = itemsForStages(op, profile.unlocked[op]);
    const item = selectNextItem(profile, pool);
    if (!item) return finish();

    current = presentItem(item);
    els.question.textContent = `${current.left} ${current.symbol} ${current.right}`;
    els.feedback.textContent = ' ';
    els.feedback.className = 'feedback';
    els.answerText.textContent = '';

    firstKeyAt = null;
    shownAt = performance.now();
    keypad.reset();
    renderChrome();
    renderMeters();

    questionTimer = setTimeout(() => resolve(OUTCOME.TIMEOUT), QUESTION_TIME_LIMIT_MS);
    meterTimer = setInterval(renderMeters, METER_TICK_MS);
  }

  /** The single exit point for a question, whichever of the four ways it ended. */
  function resolve(outcome) {
    if (round.aborted || current == null) return;
    keypad.lock();
    clearTimeout(questionTimer);
    clearInterval(meterTimer);

    const now = performance.now();
    // Cap the contribution so a backgrounded tab can't eat the round clock.
    round.elapsedMs += Math.min(now - shownAt, QUESTION_TIME_LIMIT_MS);
    const recallMs = Math.round((firstKeyAt ?? now) - shownAt);

    const result = gradeAnswer(
      profile.facts[current.id],
      outcome,
      recallMs,
      profile.questionCounter
    );

    profile.facts[current.id] = result.state;
    profile.questionCounter += 1;

    round.asked += 1;
    round.score += result.scoreDelta;
    if (outcome === OUTCOME.CORRECT) {
      round.correct += 1;
      round.recallTimes.push(recallMs);
    } else if (outcome === OUTCOME.WRONG) round.wrong += 1;
    else if (outcome === OUTCOME.SKIPPED) round.skipped += 1;
    else round.timedOut += 1;

    if (result.becameMastered) round.newlyMastered.push(current.display);

    // Runs across ALL operations: getting better at addition is what opens
    // subtraction, and that has to be noticed even mid-round.
    round.unlocked.push(...refreshUnlocks(profile));

    showFeedback(outcome, result.band);
    saveProfile(profile);
    renderChrome();
    renderMeters();

    const pause = outcome === OUTCOME.CORRECT ? CORRECT_PAUSE_MS : MISS_PAUSE_MS;
    shownAt = 0; // the round clock is paused while feedback is up
    pauseTimer = setTimeout(nextQuestion, pause);
  }

  function showFeedback(outcome, band) {
    const answer = `${current.left} ${current.symbol} ${current.right} = ${current.answer}`;
    if (outcome === OUTCOME.CORRECT) {
      els.feedback.textContent = band === 'fast' ? 'Fast!' : 'Correct';
      els.feedback.className = 'feedback good';
      return;
    }
    els.feedback.className = 'feedback bad';
    els.feedback.textContent =
      outcome === OUTCOME.TIMEOUT ? `Out of time — ${answer}` : answer;
  }

  /* -------------------------------- finish -------------------------------- */

  function finish() {
    stopTimers();
    keypad.detach();
    keypad.lock();

    round.earned = roundPoints(round);
    round.points = awardPoints(profile, round.earned, DAILY_POINT_CAP);
    round.cappedOut = round.earned > round.points;
    round.outOfTime = round.elapsedMs > ROUND_TIME_LIMIT_MS;

    const avgMs = round.recallTimes.length
      ? Math.round(round.recallTimes.reduce((a, b) => a + b, 0) / round.recallTimes.length)
      : null;

    profile.sessions.push({
      date: new Date().toISOString(),
      op,
      asked: round.asked,
      correct: round.correct,
      score: round.score,
      points: round.points,
      elapsedMs: Math.round(round.elapsedMs),
      avgMs,
    });
    // Keep the log from growing without bound.
    if (profile.sessions.length > 200) profile.sessions = profile.sessions.slice(-200);

    saveProfile(profile);
    onFinish({ ...round, avgMs });
  }

  function stopTimers() {
    clearTimeout(pauseTimer);
    clearTimeout(questionTimer);
    clearInterval(meterTimer);
  }

  function abort() {
    round.aborted = true;
    stopTimers();
    keypad.detach();
    keypad.lock();
    saveProfile(profile);
  }

  renderChrome();
  nextQuestion();

  return { abort };
}

/** 12.5 reads better than 12.5000001, and 12 better than 12.0. */
export function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
