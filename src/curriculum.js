/**
 * curriculum.js — WHAT facts exist and in WHAT ORDER they are introduced.
 *
 * PURE MODULE: no DOM, no localStorage, no timers. Everything here is a plain
 * function of its arguments. That's what lets tools/simulate.js run thousands
 * of simulated answers in Node without a browser.
 */

export const MAX_MULTIPLIER = 12;

/**
 * Unlock order for multiplication.
 *
 * Why this order:
 *  - 5s  : easiest pattern to see (everything ends in 0 or 5)
 *  - 2s  : doubling, which kids already do intuitively
 *  - 10s : trivial, and lands early to build confidence
 *  - then ascending. By the time 7, 8, 9 unlock, commutativity means the
 *    learner already knows 5x7, 2x7, 3x7, 4x7, 6x7 — so "the 7 times table"
 *    is only about 4 genuinely new facts, not 12.
 */
export const UNLOCK_ORDER = {
  mul: [5, 2, 10, 3, 4, 6, 7, 8, 9, 11, 12],
};

export const OPERATION_LABELS = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
};

export const OPERATION_SYMBOLS = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
};

/**
 * Canonical id for a multiplication fact.
 *
 * 7x8 and 8x7 are the SAME fact. Storing them under one key halves the number
 * of things to learn (144 -> 78) and means practising one reinforces the other,
 * which is exactly how a child's memory actually works.
 */
export function factId(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `mul:${lo}x${hi}`;
}

export function makeFact(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return {
    id: factId(lo, hi),
    op: 'mul',
    a: lo,
    b: hi,
    answer: lo * hi,
  };
}

/** Every fact belonging to one times table, 1..MAX_MULTIPLIER. */
export function factsForTable(table) {
  const out = [];
  for (let m = 1; m <= MAX_MULTIPLIER; m++) out.push(makeFact(table, m));
  return out;
}

/** Deduplicated union of the facts for a set of unlocked tables. */
export function factsForTables(tables) {
  const seen = new Map();
  for (const t of tables) {
    for (const f of factsForTable(t)) {
      if (!seen.has(f.id)) seen.set(f.id, f);
    }
  }
  return [...seen.values()];
}

/**
 * Decide which way round to show a fact. We deliberately alternate so the
 * learner internalises that 7x8 and 8x7 are the same question, rather than
 * memorising one orientation and freezing at the other.
 */
export function presentFact(fact, rng = Math.random) {
  const flipped = rng() < 0.5;
  return {
    ...fact,
    left: flipped ? fact.b : fact.a,
    right: flipped ? fact.a : fact.b,
    symbol: OPERATION_SYMBOLS.mul,
  };
}
