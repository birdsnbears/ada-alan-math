/**
 * simulate.js — run a synthetic learner through the whole curriculum.
 *
 *   npm run simulate
 *
 * WHY THIS EXISTS. The difficulty curve is the product. If stages unlock too
 * fast the child drowns; too slow and they're bored doing 5x3 for a fortnight.
 * The only way to know is to play hundreds of rounds — which is exactly what
 * you will never do by hand.
 *
 * This is only possible because curriculum/scheduler/scoring never touch the
 * DOM. That boundary is the single most valuable design decision in the repo:
 * it converts "click through the UI for twenty minutes and guess" into "run a
 * command and read a table."
 */

import {
  CURRICULUM,
  OPERATIONS,
  OPERATION_LABELS,
  itemsForStages,
  presentItem,
} from '../src/curriculum.js';
import {
  selectNextItem,
  refreshUnlocks,
  masteryProgress,
  isAvailable,
  nextStageBlocker,
} from '../src/scheduler.js';
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
 * A crude but honest model of a primary-school child:
 *  - facts involving 0, 1, 2, 5 or 10 are much easier (patterns they can see)
 *  - bigger numbers are harder; multi-step procedures harder still
 *  - both speed and accuracy improve with exposure, on an exponential curve
 * -------------------------------------------------------------------------- */
function difficulty(q) {
  if (q.kind === 'procedure') {
    // Procedures are a method, not a lookup — slower to become fluent, and
    // carrying/borrowing is the step that actually trips children up.
    return /carry|borrow/.test(q.id) ? 1.5 : 1.15;
  }
  const easy = [0, 1, 2, 5, 10].includes(q.left) || [0, 1, 2, 5, 10].includes(q.right);
  const size = Math.min(q.answer, 144) / 144;
  const opCost = { add: 0.75, sub: 0.95, mul: 1.0, div: 1.2 }[q.op];
  return (easy ? 0.4 : 1.0) * (0.55 + 0.65 * size) * opCost;
}

function answerAs(learner, q, rng) {
  const exposures = learner.get(q.id) ?? 0;
  const d = difficulty(q);
  const decay = Math.exp(-exposures / 5);

  const correct = rng() > 0.55 * d * decay;
  const recallMs = Math.max(700, Math.round(1100 + 5200 * d * decay + (rng() - 0.5) * 900));

  learner.set(q.id, exposures + (correct ? 1 : 0.4));
  return { correct, recallMs };
}

/* --------------------------------- the run -------------------------------- */
/**
 * `plan` decides which operation the child chooses each round — a real child
 * bounces between them, so we round-robin across whatever is unlocked.
 */

/** Which operation must be practised before another one can open at all. */
const PREREQ_OP = { sub: 'add', div: 'mul' };

function chooseFocused(profile, focus, round) {
  const prereq = PREREQ_OP[focus];
  if (!prereq) return focus;
  if (!isAvailable(profile, focus)) return prereq;
  // Blocked on the prerequisite: split time between the two rather than
  // grinding a fully-mastered operation forever.
  return nextStageBlocker(profile, focus) && round % 2 === 0 ? prereq : focus;
}

function run({ rounds = 120, seed = 42, focus = null } = {}) {
  const rng = mulberry32(seed);
  const profile = newProfile('SimKid');
  const learner = new Map();
  const rows = [];
  const unlockLog = [];
  let opCursor = 0;

  for (let r = 1; r <= rounds; r++) {
    const playable = OPERATIONS.filter((op) => isAvailable(profile, op));
    // A focused run models a child who mostly wants one operation but takes the
    // home screen's advice: when subtraction says "practise addition to unlock
    // more", they alternate. That's the behaviour the UI is now nudging toward,
    // so it's the behaviour the simulation should validate.
    const op = focus ? chooseFocused(profile, focus, r) : playable[opCursor++ % playable.length];

    let correct = 0;
    let totalMs = 0;
    let fast = 0;

    for (let i = 0; i < ROUND_LENGTH; i++) {
      const pool = itemsForStages(op, profile.unlocked[op]);
      const item = selectNextItem(profile, pool, rng);
      const q = presentItem(item, rng);
      const res = answerAs(learner, q, rng);

      const graded = gradeAnswer(
        profile.facts[q.id],
        res.correct,
        res.recallMs,
        profile.questionCounter
      );
      profile.facts[q.id] = graded.state;
      profile.questionCounter += 1;

      if (res.correct) {
        correct++;
        totalMs += res.recallMs;
        if (graded.band === 'fast') fast++;
      }

      for (const u of refreshUnlocks(profile)) {
        unlockLog.push({ ...u, round: r, atQuestion: profile.questionCounter });
      }
    }

    rows.push({
      round: r,
      op,
      questions: profile.questionCounter,
      accuracy: `${Math.round((correct / ROUND_LENGTH) * 100)}%`,
      fluent: `${Math.round((fast / ROUND_LENGTH) * 100)}%`,
      avgMs: correct ? Math.round(totalMs / correct) : 0,
      add: stageStr(profile, 'add'),
      sub: stageStr(profile, 'sub'),
      mul: stageStr(profile, 'mul'),
      div: stageStr(profile, 'div'),
    });
  }

  return { rows, unlockLog, profile };
}

function stageStr(profile, op) {
  return `${(profile.unlocked[op] ?? []).length}/${CURRICULUM[op].length}`;
}

/* ------------------------- generated-problem audit ------------------------ */
/**
 * Procedural stages build problems from random numbers, so it's worth proving
 * they never produce something nonsensical: a negative answer, a result over
 * 999 (won't fit the 3-digit keypad), or a "carrying" problem that doesn't
 * actually carry.
 */
function auditProcedures(samples = 4000) {
  const rng = mulberry32(7);
  const bad = [];
  for (const [op, stages] of Object.entries(CURRICULUM)) {
    for (const stage of stages) {
      if (stage.kind !== 'procedure') continue;
      for (let i = 0; i < samples; i++) {
        const { a, b, answer } = stage.generate(rng);
        const expected = op === 'add' ? a + b : a - b;
        if (answer !== expected) bad.push(`${stage.id}: ${a} ${op} ${b} = ${answer}`);
        if (answer < 0) bad.push(`${stage.id}: negative answer ${a} ${op} ${b}`);
        if (answer > 999) bad.push(`${stage.id}: answer too wide (${answer})`);
        if (!Number.isInteger(answer)) bad.push(`${stage.id}: non-integer ${answer}`);

        const carries = op === 'add' ? (a % 10) + (b % 10) >= 10 : a % 10 < b % 10;
        const shouldCarry = /carry|borrow/.test(stage.id);
        if (carries !== shouldCarry) {
          bad.push(`${stage.id}: ${a} ${op} ${b} carry=${carries}, expected ${shouldCarry}`);
        }
      }
    }
  }
  return [...new Set(bad)];
}

/* --------------------------------- report --------------------------------- */
const { rows, unlockLog, profile } = run();

console.log('\n=== Every 10th round (20 questions each) ===\n');
console.table(
  rows
    .filter((r) => r.round % 10 === 0)
    .map(({ round, op, questions, accuracy, fluent, avgMs, add, sub, mul, div }) => ({
      round, op, questions, accuracy, fluent, avgMs, add, sub, mul, div,
    }))
);

console.log('\n=== When each stage unlocked ===\n');
console.table(
  unlockLog.map((u) => ({
    op: u.op,
    stage: u.label,
    afterRound: u.round,
    afterQuestions: u.atQuestion,
  }))
);

console.log('=== Final state ===\n');
for (const op of OPERATIONS) {
  const m = masteryProgress(profile, op);
  console.log(
    `  ${OPERATION_LABELS[op].padEnd(15)} ` +
      `stages ${String((profile.unlocked[op] ?? []).length).padStart(2)}/${CURRICULUM[op].length}   ` +
      `mastered ${String(m.mastered).padStart(3)}/${String(m.total).padEnd(3)} (${Math.round(m.ratio * 100)}%)`
  );
}
console.log(
  `\n  ${profile.questionCounter} questions total, roughly ` +
    `${Math.round((profile.questionCounter * 5) / 60)} minutes of practice.\n`
);

/* ------------------- focused runs: does each curriculum work? --------------
 * The mixed run above is realistic but shares 2,400 questions across four
 * operations, so a low mastery figure there might just mean "didn't practise
 * it much". These runs give one operation the child's full attention, which is
 * the right place to ask whether that curriculum is completable at all.
 * ------------------------------------------------------------------------- */
console.log('=== Focused runs (80 rounds on one operation) ===\n');
const focused = {};
for (const op of OPERATIONS) {
  const res = run({ rounds: 80, seed: 11, focus: op });
  const m = masteryProgress(res.profile, op);
  focused[op] = { ...m, stages: (res.profile.unlocked[op] ?? []).length };
  console.log(
    `  ${OPERATION_LABELS[op].padEnd(15)} ` +
      `stages ${String(focused[op].stages).padStart(2)}/${CURRICULUM[op].length}   ` +
      `mastered ${String(m.mastered).padStart(3)}/${String(m.total).padEnd(3)} (${Math.round(m.ratio * 100)}%)`
  );
}
console.log('');

/* ------------------------------ sanity checks ----------------------------- */
const problems = [];

const procIssues = auditProcedures();
if (procIssues.length) {
  problems.push(`Generated problems are malformed:\n      ${procIssues.slice(0, 5).join('\n      ')}`);
}

if (!unlockLog.some((u) => u.op === 'sub')) problems.push('Subtraction never unlocked.');
if (!unlockLog.some((u) => u.op === 'div')) problems.push('Division never unlocked.');

for (const op of OPERATIONS) {
  const opUnlocks = unlockLog.filter((u) => u.op === op);
  const tooFast = opUnlocks.some(
    (u, i) => i > 0 && u.atQuestion - opUnlocks[i - 1].atQuestion < 20
  );
  if (tooFast) problems.push(`${op}: two stages unlocked under 20 questions apart.`);

  if (focused[op].ratio < 0.6) {
    problems.push(
      `${op}: only ${Math.round(focused[op].ratio * 100)}% mastered even with focused practice.`
    );
  }
  if (focused[op].stages < 3) {
    problems.push(`${op}: only reached stage ${focused[op].stages} with focused practice — gate too tight.`);
  }
}

// A prerequisite gate that never actually delays anything isn't a gate.
const firstSub = unlockLog.find((u) => u.op === 'sub');
if (firstSub && firstSub.atQuestion < 60) {
  problems.push('Subtraction opened almost immediately — the addition prerequisite is too loose.');
}

if (problems.length) {
  console.log('CHECKS FAILED:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('All sanity checks passed.\n');
}
