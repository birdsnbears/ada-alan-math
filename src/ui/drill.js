/**
 * drill.js — runs one round of questions.
 *
 * Deliberately thin: it renders, it times, it collects input, and it hands
 * everything to the pure modules to decide. All the interesting logic (which
 * item next, what it's worth, whether a stage unlocks) lives in scheduler.js
 * and scoring.js so it can be tested without a browser.
 */

import { itemsForStages, presentItem } from '../curriculum.js';
import { selectNextItem, refreshUnlocks } from '../scheduler.js';
import { gradeAnswer, roundBonus, ROUND_LENGTH, DAILY_POINT_CAP } from '../scoring.js';
import { awardPoints, saveProfile } from '../state.js';

const CORRECT_PAUSE_MS = 450;
const WRONG_PAUSE_MS = 1700; // long enough to actually read the right answer

export function startDrill({ profile, op, els, keypad, onFinish }) {
  const round = {
    op,
    asked: 0,
    correct: 0,
    points: 0,
    recallTimes: [],
    newlyMastered: [],
    unlocked: [],
    aborted: false,
  };

  let current = null;
  let shownAt = 0;
  let firstKeyAt = null;
  let timer = null;

  keypad.onChange = (v) => { els.answerText.textContent = v; };
  keypad.onFirstKey = () => { firstKeyAt = performance.now(); };
  keypad.onSubmit = submit;
  keypad.attach();

  function renderChrome() {
    els.points.textContent = profile.points;
    els.progress.style.width = `${(round.asked / ROUND_LENGTH) * 100}%`;
  }

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
  }

  function submit(value) {
    keypad.lock();
    // If they somehow submitted without typing, fall back to now.
    const recallMs = Math.round((firstKeyAt ?? performance.now()) - shownAt);
    const correct = value === current.answer;

    const result = gradeAnswer(
      profile.facts[current.id],
      correct,
      recallMs,
      profile.questionCounter
    );

    profile.facts[current.id] = result.state;
    profile.questionCounter += 1;

    const granted = awardPoints(profile, result.points, DAILY_POINT_CAP);
    round.points += granted;
    round.asked += 1;
    if (correct) {
      round.correct += 1;
      round.recallTimes.push(recallMs);
    }
    if (result.becameMastered) round.newlyMastered.push(current.display);

    // Runs across ALL operations: getting better at addition is what opens
    // subtraction, and that has to be noticed even mid-round.
    round.unlocked.push(...refreshUnlocks(profile));

    showFeedback(correct, result.band, granted);
    saveProfile(profile);
    renderChrome();

    timer = setTimeout(nextQuestion, correct ? CORRECT_PAUSE_MS : WRONG_PAUSE_MS);
  }

  function showFeedback(correct, band, granted) {
    if (correct) {
      const praise = band === 'fast' ? 'Fast!' : 'Correct';
      els.feedback.textContent = granted > 0 ? `${praise}  +${granted}` : praise;
      els.feedback.className = 'feedback good';
    } else {
      els.feedback.textContent =
        `${current.left} ${current.symbol} ${current.right} = ${current.answer}`;
      els.feedback.className = 'feedback bad';
    }
  }

  function finish() {
    keypad.detach();
    keypad.lock();
    clearTimeout(timer);

    const bonus = roundBonus(round.asked, round.correct);
    if (bonus > 0) round.points += awardPoints(profile, bonus, DAILY_POINT_CAP);

    const avgMs = round.recallTimes.length
      ? Math.round(round.recallTimes.reduce((a, b) => a + b, 0) / round.recallTimes.length)
      : null;

    profile.sessions.push({
      date: new Date().toISOString(),
      op,
      asked: round.asked,
      correct: round.correct,
      points: round.points,
      avgMs,
    });
    // Keep the log from growing without bound.
    if (profile.sessions.length > 200) profile.sessions = profile.sessions.slice(-200);

    saveProfile(profile);
    onFinish({ ...round, avgMs });
  }

  function abort() {
    round.aborted = true;
    clearTimeout(timer);
    keypad.detach();
    keypad.lock();
    saveProfile(profile);
  }

  renderChrome();
  nextQuestion();

  return { abort };
}
