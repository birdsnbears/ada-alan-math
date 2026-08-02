/**
 * state.js — the only module that touches localStorage.
 *
 * Everything else takes a profile object and returns a new one. Keeping
 * persistence in exactly one file means that swapping localStorage for a file,
 * a server, or IndexedDB later is a one-file change.
 *
 * SCHEMA VERSIONING: every saved profile carries a `version`. When the mastery
 * model changes (and it will), add a migration below rather than wiping
 * progress. Six weeks of Ada's work is not something to throw away because we
 * renamed a field.
 */

import { UNLOCK_ORDER } from './curriculum.js';

const KEY_PREFIX = 'ada-alan-math:profile:';
const LAST_USER_KEY = 'ada-alan-math:lastUser';
export const SCHEMA_VERSION = 1;

export const USERS = ['Ada', 'Alan'];

export function newProfile(name) {
  return {
    version: SCHEMA_VERSION,
    name,
    createdAt: new Date().toISOString(),
    points: 0,
    pointsSpent: 0,
    dailyPoints: {}, // { 'YYYY-MM-DD': n } — enforces DAILY_POINT_CAP
    facts: {}, // { factId: {box, seen, correct, streak, avgMs, lastSeenIndex} }
    unlocked: { mul: [UNLOCK_ORDER.mul[0]] },
    questionCounter: 0,
    lastUnlockAt: 0,
    sessions: [], // { date, op, asked, correct, points, avgMs }
  };
}

/**
 * Migrations. Each entry upgrades a profile FROM that version to the next.
 * Add one whenever the shape changes; never edit an old migration.
 *
 *   const MIGRATIONS = {
 *     1: (p) => ({ ...p, version: 2, newField: defaultValue }),
 *   };
 */
const MIGRATIONS = {};

function migrate(profile) {
  let p = profile;
  while ((p.version ?? 0) < SCHEMA_VERSION) {
    const step = MIGRATIONS[p.version ?? 0];
    if (!step) {
      console.warn(
        `No migration from v${p.version} — starting a fresh profile for ${p.name}.`
      );
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

/* ---------------------------------------------------------------------------
 * Export / import.
 *
 * localStorage is per-browser and per-device. One cache clear and the progress
 * is gone. This is the least exciting feature in the app and the most important.
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
