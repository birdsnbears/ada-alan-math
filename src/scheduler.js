/**
 * scheduler.js — WHICH fact to ask next, and WHEN to unlock a new table.
 *
 * PURE MODULE. This is the heart of the app; everything else is presentation.
 *
 * The model is a Leitner system applied per FACT, not per times table. A child
 * never masters "the 7s" uniformly — 7x2 is instant and 7x8 is a wall. The
 * times-table order is only the order in which new facts are INTRODUCED.
 */

import { UNLOCK_ORDER, factsForTables } from './curriculum.js';
import { MASTERY_BOX } from './scoring.js';

/**
 * Session mix. Most questions are review, because re-challenging old skills is
 * what actually builds retention; a slice is new material so it keeps moving.
 */
export const MIX = {
  new: 0.30,
  review: 0.55,
  mastered: 0.15,
};

/** Don't show the same fact again within this many questions. */
export const RECENT_COOLDOWN = 4;

/** A fact counts as "new" until it has been answered this many times. */
const NEW_THRESHOLD = 2;

export const UNLOCK_RULE = {
  /** Facts must be at least this box to count as solid. */
  minBox: 3,
  /** ...and this fraction of unlocked facts must be solid. */
  ratio: 0.8,
  /** ...and this many questions must have passed since the last unlock. */
  minQuestionsBetween: 20,
};

/** How overdue a fact is. Higher = more urgent to ask. */
function urgency(fact, profile, questionIndex) {
  const s = profile.facts[fact.id];
  if (!s || s.seen === 0) return 12;
  const staleness = Math.min(questionIndex - s.lastSeenIndex, 40) * 0.5;
  const weakness = (MASTERY_BOX - s.box) * 3;
  const errorRate = s.seen > 0 ? 1 - s.correct / s.seen : 0;
  return 1 + staleness + weakness + errorRate * 10;
}

function weightedPick(facts, profile, questionIndex, rng) {
  const weights = facts.map((f) => urgency(f, profile, questionIndex));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < facts.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return facts[i];
  }
  return facts[facts.length - 1];
}

/** Roll the mix, then fall through to whatever bucket actually has facts. */
function bucketOrder(rng) {
  const roll = rng();
  if (roll < MIX.new) return ['new', 'review', 'mastered'];
  if (roll < MIX.new + MIX.review) return ['review', 'new', 'mastered'];
  return ['mastered', 'review', 'new'];
}

/**
 * Pick the next fact to ask.
 *
 * @param {object} profile
 * @param {Array}  facts    candidate pool (all facts from unlocked tables)
 * @param {Function} rng    injectable for deterministic tests
 */
export function selectNextFact(profile, facts, rng = Math.random) {
  if (facts.length === 0) return null;
  const q = profile.questionCounter;

  const notRecent = facts.filter((f) => {
    const s = profile.facts[f.id];
    return !s || q - s.lastSeenIndex > RECENT_COOLDOWN;
  });
  const pool = notRecent.length > 0 ? notRecent : facts;

  const buckets = { new: [], review: [], mastered: [] };
  for (const f of pool) {
    const s = profile.facts[f.id];
    if (!s || s.seen < NEW_THRESHOLD) buckets.new.push(f);
    else if (s.box >= MASTERY_BOX) buckets.mastered.push(f);
    else buckets.review.push(f);
  }

  for (const name of bucketOrder(rng)) {
    if (buckets[name].length > 0) {
      return weightedPick(buckets[name], profile, q, rng);
    }
  }
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Should we unlock the next times table?
 * Returns the table number, or null if not yet.
 */
export function checkUnlock(profile, op = 'mul') {
  const order = UNLOCK_ORDER[op];
  const unlocked = profile.unlocked[op] ?? [];
  const next = order[unlocked.length];
  if (next === undefined) return null; // whole curriculum unlocked

  if (unlocked.length === 0) return next;
  if (profile.questionCounter - (profile.lastUnlockAt ?? 0) < UNLOCK_RULE.minQuestionsBetween) {
    return null;
  }

  const facts = factsForTables(unlocked);
  if (facts.length === 0) return next;
  const solid = facts.filter(
    (f) => (profile.facts[f.id]?.box ?? 0) >= UNLOCK_RULE.minBox
  ).length;

  return solid / facts.length >= UNLOCK_RULE.ratio ? next : null;
}

/** Fraction of currently-unlocked facts at the top box. Used for the progress bar. */
export function masteryProgress(profile, op = 'mul') {
  const facts = factsForTables(profile.unlocked[op] ?? []);
  if (facts.length === 0) return { mastered: 0, total: 0, ratio: 0 };
  const mastered = facts.filter(
    (f) => (profile.facts[f.id]?.box ?? 0) >= MASTERY_BOX
  ).length;
  return { mastered, total: facts.length, ratio: mastered / facts.length };
}
