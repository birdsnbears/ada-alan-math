/**
 * smoke.test.mjs — end-to-end check that the UI actually wires up.
 *
 *   npm install          (installs jsdom, the only dependency)
 *   npm test
 *
 * jsdom is a fake browser that runs in Node. It plays whole rounds — picking a
 * user, starting a drill, tapping keypad buttons, finishing 20 questions — and
 * asserts the app reached the right screens and saved the right data.
 *
 * This catches the class of bug simulate.js cannot: the pure logic being
 * perfect while a button is wired to the wrong handler. Two tests for two
 * failure modes is how a professional team splits it too — unit tests for
 * logic, one thin end-to-end test for the wiring.
 */

import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const indexUrl = new URL('../index.html', import.meta.url);
const mainUrl = new URL('../src/main.js', import.meta.url);
const html = fs.readFileSync(indexUrl, 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.Blob = window.Blob;
global.alert = () => {};
// jsdom's own performance object recurses when hoisted onto globalThis, so stub it.
global.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };

/**
 * Seed a v1 profile for Alan BEFORE the app boots, so the schema migration is
 * exercised against real saved data rather than being assumed to work.
 */
const V1_ALAN = {
  version: 1,
  name: 'Alan',
  createdAt: '2026-07-01T00:00:00.000Z',
  points: 17,
  pointsSpent: 0,
  dailyPoints: {},
  facts: {
    'mul:5x3': { box: 4, seen: 6, correct: 6, streak: 4, avgMs: 2100, lastSeenIndex: 40 },
  },
  unlocked: { mul: [5, 2] },
  questionCounter: 42,
  lastUnlockAt: 20,
  sessions: [],
};
window.localStorage.setItem('ada-alan-math:profile:Alan', JSON.stringify(V1_ALAN));

/**
 * Run the clock 10x fast.
 *
 * The drill pauses 450ms after a correct answer and 1700ms after a wrong one so
 * a child can read the feedback. Playing ten rounds at real speed would take
 * two minutes, which is long enough that nobody runs the test. Scaling every
 * timeout preserves the ordering the app depends on while making the suite
 * finish in seconds. Patching the clock in the test is the right place for
 * this — production code shouldn't carry a "go faster for tests" flag.
 */
const realSetTimeout = globalThis.setTimeout;
const SPEEDUP = 10;
globalThis.setTimeout = (fn, ms = 0, ...rest) =>
  realSetTimeout(fn, Math.max(0, Math.round(ms / SPEEDUP)), ...rest);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const active = () => $$('.screen').find((e) => e.classList.contains('active')).id;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const fails = [];
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fails.push(name);
};

await import(mainUrl.href);

/* ------------------------------- boot & home ------------------------------ */

check('boots on the profile screen', active() === 'screen-profile');

click(window.document.querySelector('[data-user="Ada"]'));
check('picking Ada goes home', active() === 'screen-home');
check('greeting shows the name', $('#home-greeting').textContent === 'Hi Ada');

const btn = (op) => $(`.op-btn[data-op="${op}"]`);
check('addition is available on a new profile', !btn('add').disabled);
check('multiplication is available on a new profile', !btn('mul').disabled);
check('subtraction is locked on a new profile', btn('sub').disabled);
check('division is locked on a new profile', btn('div').disabled);
check(
  'subtraction explains it needs addition',
  /addition/i.test(btn('sub').querySelector('.op-meta').textContent)
);
check(
  'division explains it needs multiplication',
  /multiplication/i.test(btn('div').querySelector('.op-meta').textContent)
);
check(
  'available operations show their stage',
  /Stage 1 of 7/.test(btn('add').querySelector('.op-meta').textContent)
);

/* --------------------------------- drills --------------------------------- */

const OPS = { '+': (a, b) => a + b, '−': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => a / b };

function keys() {
  const map = {};
  for (const k of $$('.key')) map[k.textContent] = k;
  return map;
}

async function answerOne(wrong = false) {
  const [l, sym, r] = $('#question').textContent.split(' ');
  const truth = OPS[sym](Number(l), Number(r));
  const value = String(wrong ? truth + 1 : truth);
  const k = keys();
  for (const d of value) click(k[d]);
  const shown = $('#answer-text').textContent;
  click(k['✓']);
  await sleep(wrong ? 1900 : 600);
  return { ok: shown === value, truth };
}

async function playRound({ missOne = false } = {}) {
  let n = 0;
  while (active() === 'screen-drill' && n < 30) {
    await answerOne(missOne && n === 1);
    n++;
  }
  return n;
}

click(btn('mul'));
check('the multiplication drill starts', active() === 'screen-drill');
check('a question is rendered', /^\d+ × \d+$/.test($('#question').textContent));
check('the keypad has 12 keys', $$('.key').length === 12);

const first = await answerOne();
check('typed digits appear in the answer field', first.ok);
check('a correct answer advances the question', active() === 'screen-drill');

await answerOne(true);
check('a wrong answer does not end the round', active() === 'screen-drill');

await playRound();
check('the round ends after 20 questions', active() === 'screen-results');
check('results show a score', /^\d+\/20$/.test($('#res-correct').textContent));
check('points were awarded', Number($('#res-points').textContent) > 0);

let saved = JSON.parse(window.localStorage.getItem('ada-alan-math:profile:Ada'));
check('the profile persisted', saved?.name === 'Ada');
check('the schema version is stamped', saved.version === 2);
check('20 questions were counted', saved.questionCounter === 20);
check('per-fact state was recorded', Object.keys(saved.facts).length > 0);
check('the session was logged', saved.sessions.length === 1);
check('the daily cap was respected', saved.points <= 60);

/* ------------------- prerequisites open the locked operations -------------- */

click($('#results-home'));
check('returns home', active() === 'screen-home');
check('division opened after multiplication practice', !btn('div').disabled);

click(btn('div'));
check('the division drill starts', active() === 'screen-drill');
check('division questions render', /^\d+ ÷ \d+$/.test($('#question').textContent));
await playRound();
check('the division round completes', active() === 'screen-results');
click($('#results-home'));

click(btn('add'));
check('the addition drill starts', active() === 'screen-drill');
check('addition questions render', /^\d+ \+ \d+$/.test($('#question').textContent));
await playRound();
click($('#results-home'));

// Subtraction should open after a couple of addition rounds, not instantly and
// not never. Loop with a bound rather than hardcoding a round count, so tuning
// the gate doesn't break the test for the wrong reason.
let addRounds = 1;
while (btn('sub').disabled && addRounds < 6) {
  click(btn('add'));
  await playRound();
  click($('#results-home'));
  addRounds++;
}
check(`subtraction opened after addition practice (${addRounds} rounds)`, !btn('sub').disabled);
check('subtraction was not free on round one', addRounds > 1);

click(btn('sub'));
check('subtraction questions render', /^\d+ − \d+$/.test($('#question').textContent));
const subQ = $('#question').textContent.split(' ');
check('subtraction never asks for a negative answer', Number(subQ[0]) >= Number(subQ[2]));
await playRound();
click($('#results-home'));

saved = JSON.parse(window.localStorage.getItem('ada-alan-math:profile:Ada'));
check('all four operations were played', new Set(saved.sessions.map((s) => s.op)).size === 4);
check('every operation has unlocked stages', ['add', 'sub', 'mul', 'div'].every((o) => saved.unlocked[o].length > 0));
check('points still under the daily cap', saved.points <= 60);
check('home shows the running total', Number($('#home-points').textContent) === saved.points);

/* --------------------------- the v1 -> v2 migration ----------------------- */

click($('#home-switch'));
click(window.document.querySelector('[data-user="Alan"]'));
const alan = JSON.parse(window.localStorage.getItem('ada-alan-math:profile:Alan'));

check('migration bumps the schema version', alan.version === 2);
check('migration keeps earned points', alan.points === 17);
check('migration keeps the question count', alan.questionCounter === 42);
check('migration preserves mastery of a known fact', alan.facts['mul:5x3'].box === 4);
check(
  'migration rewrites table numbers as stage ids',
  alan.unlocked.mul[0] === 'mul:5' && alan.unlocked.mul[1] === 'mul:2'
);
check('migration gives the new operations a home', Array.isArray(alan.unlocked.sub));
check('migration opens addition', alan.unlocked.add.length > 0);
check('migration makes lastUnlockAt per-operation', alan.lastUnlockAt.mul === 20);
check('the migrated profile is playable', !btn('mul').disabled);

console.log(fails.length ? `\n${fails.length} check(s) FAILED\n` : '\nAll smoke checks passed.\n');
process.exit(fails.length ? 1 : 0);
