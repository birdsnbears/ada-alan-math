/**
 * main.js — bootstrap, screen routing, and the home/results screens.
 *
 * Routing here is deliberately primitive: four <section>s, one gets the
 * `.active` class. No router, no framework. For an app this size that is the
 * correct amount of machinery — a team building something larger would reach
 * for a router and a component library, but every abstraction you add is one
 * more thing to debug at 11pm when it isn't working for your niece.
 */

import { OPERATIONS, OPERATION_LABELS, CURRICULUM, getStage } from './curriculum.js';
import { masteryProgress, refreshUnlocks, isAvailable, progressNote } from './scheduler.js';
import { DAILY_POINT_CAP, ROUND_LENGTH } from './scoring.js';
import {
  loadProfile,
  saveProfile,
  downloadBackup,
  importProfiles,
  pointsEarnedToday,
} from './state.js';
import { Keypad } from './ui/keypad.js';
import { startDrill } from './ui/drill.js';

const $ = (sel) => document.querySelector(sel);

const screens = {
  profile: $('#screen-profile'),
  home: $('#screen-home'),
  drill: $('#screen-drill'),
  results: $('#screen-results'),
};

const drillEls = {
  question: $('#question'),
  answerText: $('#answer-text'),
  feedback: $('#feedback'),
  points: $('#drill-points'),
  progress: $('#drill-progress'),
};

let profile = null;
let activeDrill = null;
let lastOp = 'mul';

// Longest possible answer is 198 (99 + 99), so three digits is the ceiling.
const keypad = new Keypad($('#keypad'), {
  onSubmit: () => {},
  onFirstKey: () => {},
  maxLength: 3,
});

function show(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('active', key === name);
  }
}

/* ------------------------------ profile screen ---------------------------- */

document.querySelectorAll('.user-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    profile = loadProfile(btn.dataset.user);
    refreshUnlocks(profile); // catch anything a migration or rule change opened
    saveProfile(profile);
    renderHome();
    show('home');
  });
});

$('#home-switch').addEventListener('click', () => {
  profile = null;
  show('profile');
});

/* -------------------------------- home ------------------------------------ */

/** The stage a child is currently working through, i.e. the most recent unlock. */
function currentStage(op) {
  const unlocked = profile.unlocked[op] ?? [];
  if (unlocked.length === 0) return null;
  return getStage(unlocked[unlocked.length - 1]);
}

function renderHome() {
  $('#home-greeting').textContent = `Hi ${profile.name}`;
  $('#home-points').textContent = profile.points;

  for (const op of OPERATIONS) {
    const btn = document.querySelector(`.op-btn[data-op="${op}"]`);
    const meta = btn.querySelector('.op-meta');
    const fill = btn.querySelector('.bar-fill');
    const available = isAvailable(profile, op);

    btn.disabled = !available;

    if (!available) {
      meta.textContent = progressNote(profile, op) ?? 'Locked';
      fill.style.width = '0%';
      continue;
    }

    const done = profile.unlocked[op].length;
    const total = CURRICULUM[op].length;
    const { mastered, total: items, ratio } = masteryProgress(profile, op);
    fill.style.width = `${Math.round(ratio * 100)}%`;

    // A cross-operation blocker is the more useful thing to say, because it's
    // the only one the child can act on.
    const blocked = progressNote(profile, op);
    meta.textContent =
      blocked ??
      (done < total
        ? `Stage ${done} of ${total} — ${mastered}/${items} mastered`
        : `All stages — ${mastered}/${items} mastered`);
  }

  const working = OPERATIONS.filter((op) => isAvailable(profile, op))
    .map((op) => currentStage(op)?.label)
    .filter(Boolean);
  $('#home-current').textContent = working.join(' · ');

  const today = pointsEarnedToday(profile);
  $('#home-daily').textContent =
    today >= DAILY_POINT_CAP
      ? `Daily maximum reached (${DAILY_POINT_CAP} points). Come back tomorrow!`
      : `${today} of ${DAILY_POINT_CAP} points earned today`;
}

document.querySelectorAll('.op-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const op = btn.dataset.op;
    if (!isAvailable(profile, op)) return;
    beginDrill(op);
  });
});

/* -------------------------------- drill ----------------------------------- */

function beginDrill(op) {
  lastOp = op;
  show('drill');
  activeDrill = startDrill({
    profile,
    op,
    els: drillEls,
    keypad,
    onFinish: showResults,
  });
}

$('#drill-quit').addEventListener('click', () => {
  activeDrill?.abort();
  activeDrill = null;
  renderHome();
  show('home');
});

/* ------------------------------- results ---------------------------------- */

function showResults(round) {
  activeDrill = null;
  $('#res-correct').textContent = `${round.correct}/${round.asked}`;
  $('#res-speed').textContent = round.avgMs ? `${(round.avgMs / 1000).toFixed(1)}s` : '—';
  $('#res-points').textContent = round.points;

  const accuracy = round.asked ? round.correct / round.asked : 0;
  $('#results-title').textContent =
    accuracy === 1 ? 'Perfect round!' : accuracy >= 0.8 ? 'Great work!' : 'Round complete';

  const notes = $('#results-notes');
  notes.innerHTML = '';
  for (const u of round.unlocked) {
    notes.appendChild(
      note(`New in ${OPERATION_LABELS[u.op].toLowerCase()}: ${u.label}!`, 'unlock')
    );
  }
  for (const label of [...new Set(round.newlyMastered)]) {
    notes.appendChild(note(`Mastered ${label}`, 'mastered'));
  }
  if (pointsEarnedToday(profile) >= DAILY_POINT_CAP) {
    notes.appendChild(note(`You've hit today's ${DAILY_POINT_CAP} point maximum.`));
  }

  show('results');
}

function note(text, extra = '') {
  const div = document.createElement('div');
  div.className = `note ${extra}`.trim();
  div.textContent = text;
  return div;
}

$('#results-again').addEventListener('click', () => beginDrill(lastOp));
$('#results-home').addEventListener('click', () => {
  renderHome();
  show('home');
});

/* ------------------------- backup / restore ------------------------------- */

$('#btn-backup').addEventListener('click', downloadBackup);
$('#btn-restore').addEventListener('click', () => $('#restore-input').click());

$('#restore-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const names = importProfiles(await file.text());
    alert(`Restored progress for: ${names.join(', ')}`);
    if (profile) {
      profile = loadProfile(profile.name);
      renderHome();
    }
  } catch (err) {
    alert(`Could not restore that file.\n\n${err.message}`);
  } finally {
    e.target.value = '';
  }
});

/* --------------------------------- boot ----------------------------------- */

show('profile');
console.info(
  `Ada & Alan Math — ${ROUND_LENGTH} questions per round, ${DAILY_POINT_CAP} point daily cap.`
);
