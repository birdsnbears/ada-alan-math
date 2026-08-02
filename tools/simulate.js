/**
 * simulate.js — run a synthetic learner through the scheduler.
 *
 *   npm run simulate
 *
 * WHY THIS EXISTS. The difficulty curve is the product. If tables unlock too
 * fast the child drowns; too slow and they're bored doing 5x3 for a fortnight.
 * The only way to know is to play hundreds of rounds — which is exactly what
 * you will never do by hand.
 *
 * This is only possible because curriculum/scheduler/scoring never touch the
 * DOM. That boundary is the single most valuable design decision in the repo:
 * it converts "click through the UI for twenty minutes and guess" into "run a
 * command and read a table."
 */

import { factsForTables, UNLOCK_ORDER, MAX_MULTIPLIER } from '../src/curriculum.js';
import { selectNextFact, checkUnlock, masteryProgress } from '../src/scheduler.js';
import { gradeAnswer, ROUND_LENGTH } from '../src/scoring.js';
import { newProfile } from '../src/state.js';

/* --- deterministic RNG so a run is reproducible and regressions are visible - */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------ learner model ------------------------------
 * A crude but honest model of a 7-year-old:
 *  - facts involving 1, 2, 5 or 10 are much easier (patterns they can see)
 *  - bigger products are harder
 *  - both speed and accuracy improve with exposure, on an exponential curve
 * -------------------------------------------------------------------------- */
function difficulty(fact) {
  const easyOperand = [1, 2, 5, 10].includes(fact.a) || [1, 2, 5, 10].includes(fact.b);
  const size = (fact.a * fact.b) / (MAX_MULTIPLIER * MAX_MULTIPLIER);
  return (easyOperand ? 0.35 : 1.0) * (0.55 + 0.65 * size);
}

function answerAs(learner, fact, rng) {
  const exposures = learner.get(fact.id) ?? 0;
  const d = difficulty(fact);
  const decay = Math.exp(-exposures / 5);

  const pWrong = 0.55 * d * decay;
  const correct = rng() > pWrong;

  const recallMs = Math.max(
    700,
    Math.round(1100 + 5200 * d * decay + (rng() - 0.5) * 900)
  );

  learner.set(fact.id, exposures + (correct ? 1 : 0.4));
  return { correct, recallMs };
}

/* --------------------------------- the run -------------------------------- */
function run({ rounds = 60, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const profile = newProfile('SimKid');
  const learner = new Map();
  const rows = [];
  const unlockLog = [];

  for (let r = 1; r <= rounds; r++) {
    let correct = 0;
    let totalMs = 0;
    let fast = 0;

    for (let q = 0; q < ROUND_LENGTH; q++) {
      const pool = factsForTables(profile.unlocked.mul);
      const fact = selectNextFact(profile, pool, rng);
      const res = answerAs(learner, fact, rng);

      const graded = gradeAnswer(
        profile.facts[fact.id],
        res.correct,
        res.recallMs,
        profile.questionCounter
      );
      profile.facts[fact.id] = graded.state;
      profile.questionCounter += 1;

      if (res.correct) { correct++; totalMs += res.recallMs; }
      if (graded.band === 'fast' && res.correct) fast++;

      const next = checkUnlock(profile, 'mul');
      if (next != null) {
        profile.unlocked.mul.push(next);
        profile.lastUnlockAt = profile.questionCounter;
        unlockLog.push({ table: next, atQuestion: profile.questionCounter, round: r });
      }
    }

    const m = masteryProgress(profile, 'mul');
    rows.push({
      round: r,
      questions: profile.questionCounter,
      tables: profile.unlocked.mul.length,
      accuracy: `${Math.round((correct / ROUND_LENGTH) * 100)}%`,
      fluent: `${Math.round((fast / ROUND_LENGTH) * 100)}%`,
      avgMs: correct ? Math.round(totalMs / correct) : 0,
      mastered: `${m.mastered}/${m.total}`,
    });
  }

  return { rows, unlockLog, profile };
}

/* --------------------------------- report --------------------------------- */
const { rows, unlockLog, profile } = run();

console.log('\n=== Progress every 5th round (20 questions per round) ===\n');
console.table(rows.filter((r) => r.round % 5 === 0));

console.log('\n=== When each times table unlocked ===\n');
console.table(
  unlockLog.map((u) => ({
    table: `${u.table}x`,
    afterRound: u.round,
    afterQuestions: u.atQuestion,
  }))
);

const total = UNLOCK_ORDER.mul.length;
const done = profile.unlocked.mul.length;
const m = masteryProgress(profile, 'mul');
console.log(
  `\nAfter ${rows.length} rounds (${profile.questionCounter} questions, ` +
    `~${Math.round((profile.questionCounter * 5) / 60)} min of practice):\n` +
    `  tables unlocked : ${done}/${total}  [${profile.unlocked.mul.join(', ')}]\n` +
    `  facts mastered  : ${m.mastered}/${m.total} (${Math.round(m.ratio * 100)}%)\n`
);

/* ------------------------------ sanity checks ----------------------------- */
const problems = [];
if (unlockLog.length === 0) problems.push('No table ever unlocked — the gate is too tight.');
if (unlockLog.some((u, i) => i > 0 && u.atQuestion - unlockLog[i - 1].atQuestion < 20)) {
  problems.push('Two tables unlocked less than 20 questions apart — gate too loose.');
}
if (rows.at(-1).avgMs > 3500) problems.push('Learner never reached fluent average speed.');
if (m.ratio < 0.4) problems.push('Fewer than 40% of unlocked facts mastered — too punishing.');

if (problems.length) {
  console.log('CHECKS FAILED:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('All sanity checks passed.\n');
}
