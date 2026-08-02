/**
 * curriculum.js — WHAT there is to learn, and in WHAT ORDER.
 *
 * PURE MODULE: no DOM, no localStorage, no timers. Everything is a plain
 * function of its arguments, which is what lets tools/simulate.js run thousands
 * of simulated answers in Node without a browser.
 *
 * ---------------------------------------------------------------------------
 * THE STAGE MODEL
 *
 * Each operation is an ordered list of STAGES. A stage is one chunk of skill
 * that gets unlocked as a unit. For multiplication a stage is a times table;
 * for addition it's a skill band ("sums within 10", "bridging through 10").
 *
 * Stages come in two kinds, and the distinction matters:
 *
 *   kind: 'facts'      A finite set of things to MEMORISE. 7x8 is a fact —
 *                      the goal is instant recall, and each one gets its own
 *                      Leitner box.
 *
 *   kind: 'procedure'  A method to APPLY. 37 + 48 is not memorised; it's
 *                      computed. There are thousands of instances, so tracking
 *                      each one is meaningless. Instead the whole stage gets a
 *                      single box, and problems are generated on demand. The
 *                      box then represents fluency at the *method*.
 *
 * Getting this distinction wrong is the most common flaw in drill apps: they
 * treat two-digit addition as 8,100 flashcards, the mastery bar never moves,
 * and the child concludes they're bad at it.
 * ---------------------------------------------------------------------------
 */

export const OPERATIONS = ['add', 'sub', 'mul', 'div'];

export const OPERATION_LABELS = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
};

export const OPERATION_SYMBOLS = { add: '+', sub: '−', mul: '×', div: '÷' };

/** Only + and × can be shown either way round. 9 − 4 is not 4 − 9. */
export const COMMUTATIVE = { add: true, sub: false, mul: true, div: false };

export const MAX_MULTIPLIER = 12;

/* ============================== fact builders ============================= */

/**
 * a + b and b + a are the SAME fact, so they share one id. Same for a x b.
 * This halves the workload and means practising one reinforces the other,
 * which is how a child's memory actually behaves.
 */
export function addFact(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: `add:${lo}+${hi}`, op: 'add', a: lo, b: hi, answer: lo + hi };
}

export function mulFact(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { id: `mul:${lo}x${hi}`, op: 'mul', a: lo, b: hi, answer: lo * hi };
}

/** Not commutative — order is part of the fact. */
export function subFact(total, part) {
  return { id: `sub:${total}-${part}`, op: 'sub', a: total, b: part, answer: total - part };
}

export function divFact(total, divisor) {
  return { id: `div:${total}/${divisor}`, op: 'div', a: total, b: divisor, answer: total / divisor };
}

function dedupe(facts) {
  const seen = new Map();
  for (const f of facts) if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}

/** Every subtraction fact implied by a set of addition facts. */
function inverseOfAddition(addFacts) {
  const out = [];
  for (const f of addFacts) {
    out.push(subFact(f.answer, f.a));
    if (f.a !== f.b) out.push(subFact(f.answer, f.b));
  }
  return dedupe(out);
}

/** Every division fact implied by a times table. */
function divisionTable(table) {
  const out = [];
  for (let m = 1; m <= MAX_MULTIPLIER; m++) out.push(divFact(table * m, table));
  return out;
}

function multiplicationTable(table) {
  const out = [];
  for (let m = 1; m <= MAX_MULTIPLIER; m++) out.push(mulFact(table, m));
  return out;
}

/** Unordered operand pairs from 0..10 whose sum falls in [minSum, maxSum]. */
function sumsBetween(minSum, maxSum) {
  const out = [];
  for (let a = 0; a <= 10; a++) {
    for (let b = a; b <= 10; b++) {
      const s = a + b;
      if (s >= minSum && s <= maxSum) out.push(addFact(a, b));
    }
  }
  return dedupe(out);
}

function doublesUpTo(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(addFact(i, i));
  return out;
}

/* ============================ stage constructors ========================== */

function factStage(id, label, facts, requires) {
  return { id, label, kind: 'facts', facts: dedupe(facts), requires };
}

/**
 * A procedural stage. `weight` boosts how often the scheduler picks it: it is
 * a single item competing against ~70 individual facts, so without a boost it
 * would come up once a round.
 */
function procStage(id, label, generate, requires, weight = 8) {
  return { id, label, kind: 'procedure', generate, requires, weight };
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/* ============================== the curriculum ============================ */

/**
 * ADDITION — the standard fluency progression, aimed at Alan (8).
 *
 * Sums within 10 are the bedrock. Doubles are anchor facts a child uses to
 * derive neighbours (7+8 is "double 7, plus one"). Bridging through 10 is the
 * single most important strategy in early arithmetic: 8+5 becomes 8+2+3. Only
 * after those are automatic does two-digit work stop being painful, because
 * two-digit work is just the fact set plus a carry.
 */
const ADD_STAGES = [
  factStage('add:within-10', 'Sums up to 10', sumsBetween(0, 10)),
  factStage('add:doubles', 'Doubles', doublesUpTo(12)),
  factStage('add:bridging', 'Bridging through 10', sumsBetween(11, 20)),
  procStage('add:2d1d', 'Two-digit + one-digit', (rng) => {
    const ones = randInt(rng, 0, 8);
    const a = randInt(rng, 1, 9) * 10 + ones;
    const b = randInt(rng, 1, 9 - ones); // no carry
    return { a, b, answer: a + b };
  }),
  procStage('add:2d1d-carry', 'Two-digit + one-digit, carrying', (rng) => {
    const ones = randInt(rng, 1, 9);
    const a = randInt(rng, 1, 8) * 10 + ones;
    const b = randInt(rng, Math.max(1, 10 - ones), 9); // forces a carry
    return { a, b, answer: a + b };
  }),
  procStage('add:2d2d', 'Two-digit + two-digit', (rng) => {
    const o1 = randInt(rng, 0, 9);
    const o2 = randInt(rng, 0, 9 - o1); // no carry
    const t1 = randInt(rng, 1, 8);
    const t2 = randInt(rng, 1, 9 - t1);
    const a = t1 * 10 + o1;
    const b = t2 * 10 + o2;
    return { a, b, answer: a + b };
  }),
  procStage('add:2d2d-carry', 'Two-digit + two-digit, carrying', (rng) => {
    const o1 = randInt(rng, 1, 9);
    const o2 = randInt(rng, 10 - o1, 9); // forces a carry
    const t1 = randInt(rng, 1, 7);
    const t2 = randInt(rng, 1, 8 - t1); // keeps the total under 100
    const a = t1 * 10 + o1;
    const b = t2 * 10 + o2;
    return { a, b, answer: a + b };
  }),
];

/**
 * SUBTRACTION — every stage is the inverse of the matching addition stage,
 * and is gated on it. "What plus 4 makes 9?" is a far easier question for a
 * child than "9 take away 4", and it's the same fact. Teaching subtraction
 * before the addition fact is fluent guarantees finger-counting.
 */
const SUB_STAGES = [
  // The FIRST stage of an operation is about access, not mastery: a deliberately
  // loose gate (half the addition facts answered correctly twice, ~2 rounds) so
  // the button stops being greyed out quickly. Later stages use the stricter
  // default, because by then the child is being paced, not admitted.
  factStage('sub:within-10', 'Take away, within 10', inverseOfAddition(sumsBetween(0, 10)), {
    op: 'add',
    stage: 'add:within-10',
    minBox: 2,
    ratio: 0.35,
  }),
  factStage('sub:halves', 'Halving doubles', inverseOfAddition(doublesUpTo(12)), {
    op: 'add',
    stage: 'add:doubles',
  }),
  factStage('sub:bridging', 'Bridging back through 10', inverseOfAddition(sumsBetween(11, 20)), {
    op: 'add',
    stage: 'add:bridging',
  }),
  procStage(
    'sub:2d1d',
    'Two-digit − one-digit',
    (rng) => {
      const ones = randInt(rng, 1, 9);
      const a = randInt(rng, 1, 9) * 10 + ones;
      const b = randInt(rng, 1, ones); // no borrow
      return { a, b, answer: a - b };
    },
    { op: 'add', stage: 'add:2d1d' }
  ),
  procStage(
    'sub:2d1d-borrow',
    'Two-digit − one-digit, borrowing',
    (rng) => {
      const ones = randInt(rng, 0, 8);
      const a = randInt(rng, 1, 9) * 10 + ones;
      const b = randInt(rng, ones + 1, 9); // forces a borrow
      return { a, b, answer: a - b };
    },
    { op: 'add', stage: 'add:2d1d-carry' }
  ),
  procStage(
    'sub:2d2d',
    'Two-digit − two-digit',
    (rng) => {
      const o1 = randInt(rng, 0, 9);
      const o2 = randInt(rng, 0, o1); // no borrow
      const t1 = randInt(rng, 2, 9);
      const t2 = randInt(rng, 1, t1 - 1);
      const a = t1 * 10 + o1;
      const b = t2 * 10 + o2;
      return { a, b, answer: a - b };
    },
    { op: 'add', stage: 'add:2d2d' }
  ),
  procStage(
    'sub:2d2d-borrow',
    'Two-digit − two-digit, borrowing',
    (rng) => {
      const o1 = randInt(rng, 0, 8);
      const o2 = randInt(rng, o1 + 1, 9); // forces a borrow
      const t1 = randInt(rng, 2, 9);
      const t2 = randInt(rng, 1, t1 - 1);
      const a = t1 * 10 + o1;
      const b = t2 * 10 + o2;
      return { a, b, answer: a - b };
    },
    { op: 'add', stage: 'add:2d2d-carry' }
  ),
];

/**
 * MULTIPLICATION — aimed at Ada (10). One stage per times table.
 *
 * Order: 5s have the most visible pattern, 2s are doubling, 10s are trivial
 * and land early to build confidence. By the time the 7s unlock, commutativity
 * means she already knows 5x7, 2x7, 3x7, 4x7 and 6x7 — so "the 7 times table"
 * is about four genuinely new facts, not twelve.
 */
export const MUL_TABLE_ORDER = [5, 2, 10, 3, 4, 6, 7, 8, 9, 11, 12];

const MUL_STAGES = MUL_TABLE_ORDER.map((t) =>
  factStage(`mul:${t}`, `${t} times table`, multiplicationTable(t))
);

/**
 * DIVISION — each table gated on the matching multiplication table.
 *
 * 56 ÷ 7 taught cold is a search problem. Taught as "7 times what makes 56",
 * once 7 x 8 is already fluent, it's a lookup. The gate is deliberately loose
 * (40% of the table at box 2) so it opens after roughly one round of practice
 * rather than making the child wait days.
 */
const DIV_STAGES = MUL_TABLE_ORDER.map((t) =>
  factStage(`div:${t}`, `Dividing by ${t}`, divisionTable(t), {
    op: 'mul',
    stage: `mul:${t}`,
    minBox: 2,
    ratio: 0.4,
  })
);

export const CURRICULUM = {
  add: ADD_STAGES,
  sub: SUB_STAGES,
  mul: MUL_STAGES,
  div: DIV_STAGES,
};

/* ================================ lookups ================================= */

const STAGE_INDEX = new Map();
for (const [op, stages] of Object.entries(CURRICULUM)) {
  stages.forEach((s, i) => STAGE_INDEX.set(s.id, { op, stage: s, index: i }));
}

export function getStage(stageId) {
  return STAGE_INDEX.get(stageId)?.stage ?? null;
}

export function stageCount(op) {
  return CURRICULUM[op].length;
}

/** The first stage of an operation, i.e. what a brand-new profile starts with. */
export function firstStageId(op) {
  return CURRICULUM[op][0].id;
}

/**
 * The candidate pool for a set of unlocked stages.
 * Fact stages contribute every fact; a procedural stage contributes one stub
 * that generates a fresh problem each time it is drawn.
 */
export function itemsForStages(op, stageIds) {
  const out = [];
  for (const id of stageIds ?? []) {
    const stage = getStage(id);
    if (!stage) continue;
    if (stage.kind === 'procedure') {
      out.push({
        id: stage.id,
        op,
        kind: 'procedure',
        stage,
        weight: stage.weight,
        label: stage.label,
      });
    } else {
      for (const f of stage.facts) out.push({ ...f, kind: 'facts', stageId: stage.id });
    }
  }
  return dedupe(out);
}

/**
 * Turn a scheduler pick into a concrete on-screen question.
 * Commutative operations are shown in a random orientation so the child learns
 * that 7 x 8 and 8 x 7 are the same question rather than memorising one side.
 */
export function presentItem(item, rng = Math.random) {
  const symbol = OPERATION_SYMBOLS[item.op];

  if (item.kind === 'procedure') {
    const { a, b, answer } = item.stage.generate(rng);
    return { ...item, left: a, right: b, answer, symbol, display: item.stage.label };
  }

  const flip = COMMUTATIVE[item.op] && rng() < 0.5;
  const left = flip ? item.b : item.a;
  const right = flip ? item.a : item.b;
  return { ...item, left, right, symbol, display: `${left} ${symbol} ${right}` };
}
