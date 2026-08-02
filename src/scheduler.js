/**
 * scheduler.js — WHICH item to ask next, and WHEN to unlock a new stage.
 *
 * PURE MODULE. This is the heart of the app; everything else is presentation.
 *
 * The model is a Leitner system applied per ITEM, not per stage. A child never
 * masters "the 7s" uniformly — 7x2 is instant and 7x8 is a wall. The stage
 * order is only the order in which new items are INTRODUCED.
 */

import { CURRICULUM, OPERATIONS, getStage, itemsForStages, firstStageId } from './curriculum.js';
import { MASTERY_BOX } from './scoring.js';

/**
 * Session mix. Most questions are review, because re-challenging old skills is
 * what actually builds retention; a slice is new material so it keeps moving.
 */
export const MIX = { new: 0.3, review: 0.55, mastered: 0.15 };

/** Don't show the same item again within this many questions. */
export const RECENT_COOLDOWN = 4;

/** An item counts as "new" until it has been answered this many times. */
const NEW_THRESHOLD = 2;

/**
 * The unlock gate has two parts, and the split matters.
 *
 * An earlier version required 80% of EVERYTHING unlocked to be solid. That
 * looks reasonable and is quietly wrong: the pool grows with every stage, so
 * each unlock gets harder than the last, and operations with large fact sets
 * (subtraction has roughly twice as many facts as addition, since 9 = 4 + 5
 * yields both 9 - 4 and 9 - 5) grind to a halt several stages in.
 *
 * The fix is to make progress depend on the CURRENT stage, and use overall
 * health only as a brake. You move on when you've got the thing you're working
 * on; you're held back only if the material behind you has genuinely rotted.
 */
export const UNLOCK_RULE = {
  /** Items must be at least this box to count as solid. */
  minBox: 3,
  /** The stage currently being worked on must be this solid. Drives progress. */
  currentStageRatio: 0.8,
  /** Everything unlocked so far must be at least this solid. Acts as a brake. */
  overallRatio: 0.6,
  /** ...and this many questions must have passed since this op last unlocked. */
  minQuestionsBetween: 20,
};

/** Defaults for a stage's cross-operation prerequisite. */
const DEFAULT_REQUIRES = { minBox: 3, ratio: 0.6 };

/* ------------------------------ item selection ---------------------------- */

/** How overdue an item is. Higher = more urgent to ask. */
function urgency(item, profile, questionIndex) {
  const s = profile.facts[item.id];
  const weight = item.weight ?? 1;
  if (!s || s.seen === 0) return 12 * weight;
  const staleness = Math.min(questionIndex - s.lastSeenIndex, 40) * 0.5;
  const weakness = (MASTERY_BOX - s.box) * 3;
  const errorRate = s.seen > 0 ? 1 - s.correct / s.seen : 0;
  return (1 + staleness + weakness + errorRate * 10) * weight;
}

function weightedPick(items, profile, questionIndex, rng) {
  const weights = items.map((i) => urgency(i, profile, questionIndex));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Roll the mix, then fall through to whatever bucket actually has items. */
function bucketOrder(rng) {
  const roll = rng();
  if (roll < MIX.new) return ['new', 'review', 'mastered'];
  if (roll < MIX.new + MIX.review) return ['review', 'new', 'mastered'];
  return ['mastered', 'review', 'new'];
}

/**
 * Pick the next item to ask.
 *
 * @param {object}   profile
 * @param {Array}    items  candidate pool (everything from unlocked stages)
 * @param {Function} rng    injectable so tests and the simulator are repeatable
 */
export function selectNextItem(profile, items, rng = Math.random) {
  if (!items || items.length === 0) return null;
  const q = profile.questionCounter;

  const notRecent = items.filter((i) => {
    const s = profile.facts[i.id];
    return !s || q - s.lastSeenIndex > RECENT_COOLDOWN;
  });
  const pool = notRecent.length > 0 ? notRecent : items;

  const buckets = { new: [], review: [], mastered: [] };
  for (const i of pool) {
    const s = profile.facts[i.id];
    if (!s || s.seen < NEW_THRESHOLD) buckets.new.push(i);
    else if (s.box >= MASTERY_BOX) buckets.mastered.push(i);
    else buckets.review.push(i);
  }

  for (const name of bucketOrder(rng)) {
    if (buckets[name].length > 0) return weightedPick(buckets[name], profile, q, rng);
  }
  return pool[Math.floor(rng() * pool.length)];
}

/* --------------------------------- unlocks -------------------------------- */

/** Fraction of a stage's items sitting at or above `minBox`. */
export function stageSolidity(profile, op, stageId, minBox) {
  const items = itemsForStages(op, [stageId]);
  if (items.length === 0) return 0;
  const solid = items.filter((i) => (profile.facts[i.id]?.box ?? 0) >= minBox).length;
  return solid / items.length;
}

/**
 * Is a stage's cross-operation prerequisite satisfied?
 * Subtraction stages require the matching addition stage; division stages
 * require the matching times table.
 */
export function requirementMet(profile, requires) {
  if (!requires) return true;
  const rule = { ...DEFAULT_REQUIRES, ...requires };
  const unlocked = profile.unlocked[rule.op] ?? [];
  if (!unlocked.includes(rule.stage)) return false;
  return stageSolidity(profile, rule.op, rule.stage, rule.minBox) >= rule.ratio;
}

const OP_WORD = {
  add: 'addition',
  sub: 'subtraction',
  mul: 'multiplication',
  div: 'division',
};

/**
 * What, if anything, is holding this operation's next stage shut because of a
 * DIFFERENT operation. Returns null when nothing is (either it's ready to
 * unlock on its own merits, or the operation is finished).
 */
export function nextStageBlocker(profile, op) {
  const stages = CURRICULUM[op];
  const unlocked = profile.unlocked[op] ?? [];
  const next = stages[unlocked.length];
  if (!next || !next.requires) return null;
  if (requirementMet(profile, next.requires)) return null;
  return {
    op: next.requires.op,
    stageId: next.requires.stage,
    label: getStage(next.requires.stage).label,
  };
}

/**
 * A message for the child explaining why an operation isn't moving.
 *
 * This exists because the simulator found a genuine dead end: master
 * everything available in subtraction without touching addition and the
 * operation silently stops progressing forever. The dependency is correct
 * pedagogy — you shouldn't drill 13 − 5 before 8 + 5 is fluent — but an
 * invisible ceiling just reads as "this app is broken".
 */
export function progressNote(profile, op) {
  const blocker = nextStageBlocker(profile, op);
  if (!blocker) return null;
  const started = (profile.unlocked[op] ?? []).length > 0;
  return started
    ? `Practise ${OP_WORD[blocker.op]} — "${blocker.label}" unlocks more`
    : `Practise ${OP_WORD[blocker.op]} first — opens after "${blocker.label}"`;
}

/**
 * Should this operation unlock its next stage? Returns the stage id, or null.
 */
export function checkUnlock(profile, op) {
  const stages = CURRICULUM[op];
  const unlocked = profile.unlocked[op] ?? [];
  const next = stages[unlocked.length];
  if (!next) return null; // whole operation complete

  if (!requirementMet(profile, next.requires)) return null;

  // The very first stage of an operation opens as soon as its prerequisite is
  // met — no need to wait out the pacing gate.
  if (unlocked.length === 0) return next.id;

  const since = profile.questionCounter - (profile.lastUnlockAt?.[op] ?? 0);
  if (since < UNLOCK_RULE.minQuestionsBetween) return null;

  const items = itemsForStages(op, unlocked);
  if (items.length === 0) return next.id;

  const overall =
    items.filter((i) => (profile.facts[i.id]?.box ?? 0) >= UNLOCK_RULE.minBox).length /
    items.length;
  const currentId = unlocked[unlocked.length - 1];
  const current = stageSolidity(profile, op, currentId, UNLOCK_RULE.minBox);

  return current >= UNLOCK_RULE.currentStageRatio && overall >= UNLOCK_RULE.overallRatio
    ? next.id
    : null;
}

/**
 * Unlock whatever is eligible across ALL operations, mutating the profile.
 * Returns the newly unlocked stages so the UI can celebrate them.
 *
 * This runs for every operation, not just the one being played, because
 * subtraction and division open as a consequence of addition and
 * multiplication progress — they'd never open otherwise, since you cannot play
 * an operation that has no unlocked stages.
 */
export function refreshUnlocks(profile) {
  const opened = [];
  let changed = true;
  // Loop until quiet: unlocking addition can immediately open subtraction.
  while (changed) {
    changed = false;
    for (const op of OPERATIONS) {
      const next = checkUnlock(profile, op);
      if (next == null) continue;
      profile.unlocked[op] = [...(profile.unlocked[op] ?? []), next];
      profile.lastUnlockAt[op] = profile.questionCounter;
      opened.push({ op, stageId: next, label: getStage(next).label });
      changed = true;
    }
  }
  return opened;
}

/* -------------------------------- progress -------------------------------- */

export function masteryProgress(profile, op) {
  const items = itemsForStages(op, profile.unlocked[op] ?? []);
  if (items.length === 0) return { mastered: 0, total: 0, ratio: 0 };
  const mastered = items.filter((i) => (profile.facts[i.id]?.box ?? 0) >= MASTERY_BOX).length;
  return { mastered, total: items.length, ratio: mastered / items.length };
}

/** Whether an operation has anything to play right now. */
export function isAvailable(profile, op) {
  return (profile.unlocked[op] ?? []).length > 0;
}

export { firstStageId };
