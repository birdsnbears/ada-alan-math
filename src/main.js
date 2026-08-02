/**
 * main.js — bootstrap, screen routing, and the home/results screens.
 *
 * Routing here is deliberately primitive: four <section>s, one gets the
 * `.active` class. No router, no framework. For an app this size that is the
 * correct amount of machinery — a team building something larger would reach
 * for a router and a component library, but every abstraction you add is one
 * more thing to debug at 11pm when it isn't working for your niece.
 */

import { OPERATION_LABELS, UNLOCK_ORDER } from './curriculum.js';
import { masteryProgress } from './scheduler.js';
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

/** Operations that are actually implemented. The rest render as "coming soon". */
const ENABLED_OPS = ['mul'];

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

const keypad = new Keypad($('#keypad'), {
  onSubmit: () => {},
  onFirstKey: () => {},
  maxLength: 4,
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

function renderHome() {
  $('#home-greeting').textContent = `Hi ${profile.name}`;
  $('#home-points').textContent = profile.points;

  const tables = profile.unlocked.mul ?? [];
  $('#home-tables').textContent = tables.join('  ');

  const { mastered, total, ratio } = masteryProgress(profile, 'mul');
  $('#home-mastery-bar').style.width = `${Math.round(ratio * 100)}%`;
  $('#home-mastery-text').textContent =
    `${mastered} of ${total} facts mastered` +
    (tables.length < UNLOCK_ORDER.mul.length
      ? ` — next table unlocks at ${Math.ceil(total * 0.8)} solid facts`
      : ' — every table unlocked!');

  const today = pointsEarnedToday(profile);
  $('#home-daily').textContent =
    today >= DAILY_POINT_CAP
      ? `Daily maximum reached (${DAILY_POINT_CAP} points). Come back tomorrow!`
      : `${today} of ${DAILY_POINT_CAP} points earned today`;

  document.querySelectorAll('.op-btn').forEach((btn) => {
    btn.disabled = !ENABLED_OPS.includes(btn.dataset.op);
  });
}

document.querySelectorAll('.op-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const op = btn.dataset.op;
    if (!ENABLED_OPS.includes(op)) return;
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
  for (const table of round.unlockedTables) {
    notes.appendChild(note(`New: the ${table} times table is unlocked!`, 'unlock'));
  }
  for (const fact of round.newlyMastered) {
    notes.appendChild(note(`Mastered ${fact}`, 'mastered'));
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
  `Ada & Alan Math — round length ${ROUND_LENGTH}, daily cap ${DAILY_POINT_CAP}. ` +
    `Operations enabled: ${ENABLED_OPS.map((o) => OPERATION_LABELS[o]).join(', ')}.`
);
