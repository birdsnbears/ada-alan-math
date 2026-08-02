/**
 * state.js — the only module that touches localStorage.
 *
 * Everything else takes a profile object and returns a new one. Keeping
 * persistence in exactly one file means swapping localStorage for a file, a
 * server, or IndexedDB later is a one-file change.
 *
 * SCHEMA VERSIONING: every saved profile carries a `version`. When the model
 * changes (and it does — see the v1 -> v2 migration below), add a migration
 * rather than wiping progress.
 */

import { OPERATIONS, firstStageId } from './curriculum.js';

const KEY_PREFIX = 'ada-alan-math:profile:';
const LAST_USER_KEY = 'ada-alan-math:lastUser';
export const SCHEMA_VERSION = 3;

export const USERS = ['Ada', 'Alan'];

export function newProfile(name) {
  return {
    version: SCHEMA_VERSION,
    name,
    createdAt: new Date().toISOString(),
    points: 0,
    pointsSpent: 0,
    dailyPoints: {}, // { 'YYYY-MM-DD': n } — enforces DAILY_POINT_CAP
    facts: {}, // { itemId: {box, seen, correct, streak, avgMs, lastSeenIndex} }
    // Addition and multiplication open immediately. Subtraction and division
    // open once their prerequisite stage is solid — see scheduler.refreshUnlocks.
    unlocked: {
      add: [firstStageId('add')],
      sub: [],
      mul: [firstStageId('mul')],
      div: [],
    },
    lastUnlockAt: Object.fromEntries(OPERATIONS.map((op) => [op, 0])),
    questionCounter: 0,
    sessions: [], // { date, op, asked, correct, points, avgMs }
  };
}

/**
 * Migrations. Each entry upgrades a profile FROM that version to the next.
 * Add one whenever the shape changes; never edit an old migration.
 */
const MIGRATIONS = {
  /**
   * v1 -> v2: multiplication-only became four operations.
   *   unlocked.mul was [5, 2, 10]      -> ['mul:5', 'mul:2', 'mul:10']
   *   lastUnlockAt was a single number -> one entry per operation
   * Fact ids ('mul:5x3') were already namespaced, so they carry over untouched
   * and no mastery is lost.
   */
  1: (p) => ({
    ...p,
    version: 2,
    unlocked: {
      add: [firstStageId('add')],
      sub: [],
      mul: (p.unlocked?.mul ?? [5]).map((t) => `mul:${t}`),
      div: [],
    },
    lastUnlockAt: Object.fromEntries(
      OPERATIONS.map((op) => [op, op === 'mul' ? (p.lastUnlockAt ?? 0) : 0])
    ),
  }),

  /**
   * v2 -> v3: points moved from per-question to per-round, so any balance
   * earned under the old rules was priced differently and is wiped once.
   *
   * Worth noting what this migration is: not a shape change but a DATA reset,
   * run exactly once per profile because the version number only crosses 2 -> 3
   * a single time. That's the cheap way to do a one-off correction — no
   * "hasReset" flag to remember, no risk of it firing twice. Mastery, unlocked
   * stages and session history all survive untouched; only the currency resets.
   */
  2: (p) => ({
    ...p,
    version: 3,
    points: 0,
    pointsSpent: 0,
    dailyPoints: {},
  }),
};

function migrate(profile) {
  let p = profile;
  while ((p.version ?? 0) < SCHEMA_VERSION) {
    const step = MIGRATIONS[p.version ?? 0];
    if (!step) {
      console.warn(`No migration from v${p.version} — starting fresh for ${p.name}.`);
      return newProfile(p.name);
    }
    p = step(p);
  }
  return p;
}

export function loadProfile(name) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + name);
    if (!raw) return newProfile(name);
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.error('Could not read saved progress, starting fresh.', err);
    return newProfile(name);
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY_PREFIX + profile.name, JSON.stringify(profile));
    localStorage.setItem(LAST_USER_KEY, profile.name);
    return true;
  } catch (err) {
    console.error('Could not save progress.', err);
    return false;
  }
}

export function getLastUser() {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

export function todayKey(d = new Date()) {
  // Local date, not UTC — "today" should mean the child's today.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pointsEarnedToday(profile) {
  return profile.dailyPoints[todayKey()] ?? 0;
}

/**
 * Award points, respecting the daily cap. Returns the number actually awarded
 * so the UI can show the true figure rather than the requested one.
 */
export function awardPoints(profile, amount, cap) {
  const key = todayKey();
  const already = profile.dailyPoints[key] ?? 0;
  const granted = Math.max(0, Math.min(amount, cap - already));
  profile.dailyPoints[key] = already + granted;
  profile.points += granted;
  return granted;
}

/**
 * Zero the balance without touching anything learned.
 *
 * Use this after the points have been spent — the app has no idea when screen
 * time is actually handed over, so cashing out is a manual act. Mastery,
 * unlocked stages and history are deliberately untouched: the currency and the
 * learning are separate things and resetting one should never disturb the other.
 */
export function resetPoints(profile) {
  const had = profile.points;
  profile.points = 0;
  profile.pointsSpent = (profile.pointsSpent ?? 0) + had;
  profile.dailyPoints = {};
  saveProfile(profile);
  return had;
}

/* ---------------------------------------------------------------------------
 * Export / import.
 *
 * localStorage is per-browser and per-device. One cache clear and the progress
 * is gone. The least exciting feature in the app and the most important one.
 * ------------------------------------------------------------------------- */

export function exportProfiles() {
  const data = { exportedAt: new Date().toISOString(), profiles: {} };
  for (const name of USERS) {
    const raw = localStorage.getItem(KEY_PREFIX + name);
    if (raw) data.profiles[name] = JSON.parse(raw);
  }
  return data;
}

export function downloadBackup() {
  const blob = new Blob([JSON.stringify(exportProfiles(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ada-alan-math-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProfiles(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data.profiles !== 'object') {
    throw new Error('That file does not look like a progress backup.');
  }
  const restored = [];
  for (const [name, profile] of Object.entries(data.profiles)) {
    saveProfile(migrate(profile));
    restored.push(name);
  }
  return restored;
}
