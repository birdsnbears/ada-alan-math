/**
 * smoke.test.mjs — end-to-end check that the UI actually wires up.
 *
 *   npm install          (installs jsdom, the only dependency)
 *   npm test
 *
 * jsdom is a fake browser that runs in Node. It plays whole rounds — picking a
 * user, starting a drill, tapping keypad buttons, skipping, letting questions
 * time out — and asserts the app reached the right screens and saved the right
 * data.
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
 * Seed a v1 profile for Alan BEFORE the app boots, so the schema migrations are
 * exercised against real saved data rather than being assumed to work.
 */
const V1_ALAN = {
  version: 1,
  name: 'Alan',
  createdAt: '2026-07-01T00:00:00.000Z',
  points: 17,
  pointsSpent: 0,
  dailyPoints: { '2026-07-01': 17 },
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
 * The drill pauses 450ms after a correct answer, 1700ms after a miss, and lets
 * a question sit for 15 SECONDS before timing out. At real speed this suite
 * would take minutes, which is long enough that nobody runs it. Scaling every
 * timeout preserves the ordering the app depends on while making the suite
 * finish in seconds. Patching the clock in the test is the right place for
 * this — production code shouldn't carry a "go faster for tests" flag.
 */
const realSetTimeout = globalThis.setTimeout;
const SPEEDUP = 10;
globalThis.setTimeout = (fn, ms = 0, ...rest) =>
  realSetTimeout(fn, Math.max(0, Math.round(ms / SPEEDUP)), ...rest);

const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const active = () => $$('.screen').find((e) => e.classList.contains('active')).id;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const btn = (op) => $(`.op-btn[data-op="${op}"]`);
const load = (name = 'Ada') =>
  JSON.parse(window.localStorage.getItem(`ada-alan-math:profile:${name}`));

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
check('addition is available on a new profile', !btn('add').disabled);
check('multiplication is available on a new profile', !btn('mul').disabled);
check('subtraction is locked on a new profile', btn('sub').disabled);
check('division is locked on a new profile', btn('div').disabled);
check('subtraction says it needs addition', /addition/i.test(btn('sub').textContent));
check('division says it needs multiplication', /multiplication/i.test(btn('div').textContent));

/* ------------------------------ playing rounds ---------------------------- */

const OPS = {
  '+': (a, b) => a + b,
  '−': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => a / b,
};

function keys() {
  const map = {};
  for (const k of $$('.key')) map[k.textContent] = k;
  return map;
}

/**
 * Answer the question on screen one of four ways.
 * @param {'correct'|'wrong'|'skip'|'timeout'} mode
 */
async function answerOne(mode = 'correct') {
  const [l, sym, r] = $('#question').textContent.split(' ');
  const truth = OPS[sym](Number(l), Number(r));

  if (mode === 'timeout') {
    // 15s scaled to 1.5s, plus the 1.7s -> 170ms miss pause, plus slack.
    await sleep(2100);
    return { truth };
  }
  if (mode === 'skip') {
    click($('#drill-skip'));
    await sleep(280);
    return { truth };
  }

  const value = String(mode === 'wrong' ? truth + 1 : truth);
  const k = keys();
  for (const d of value) click(k[d]);
  const shown = $('#answer-text').textContent;
  click(k['✓']);
  await sleep(mode === 'wrong' ? 280 : 120);
  return { truth, typedOk: shown === value };
}

/** Play until the round ends. `pattern(i)` picks the mode for question i. */
async function playRound(pattern = () => 'correct') {
  let n = 0;
  while (active() === 'screen-drill' && n < 30) {
    await answerOne(pattern(n));
    n++;
  }
  return n;
}

const points = () => Number($('#res-points').textContent);
const roundScore = () => $('#res-score').textContent;

click(btn('mul'));
check('the multiplication drill starts', active() === 'screen-drill');
check('a question is rendered', /^\d+ × \d+$/.test($('#question').textContent));
check('the keypad has 12 keys', $$('.key').length === 12);
check('there is a skip button', !!$('#drill-skip'));
check('there is a per-question timer', !!$('#drill-qtime'));
check('there is a round timer', !!$('#drill-roundtime'));

const first = await answerOne();
check('typed digits appear in the answer field', first.typedOk);
check('a correct answer advances the question', active() === 'screen-drill');
check('the live round score went up by 1', $('#drill-score').textContent === '1');

/* ------------------------- a perfect round pays 5 ------------------------- */

await playRound();
check('the round ends after 20 questions', active() === 'screen-results');
check('a perfect round scores 20', roundScore() === '20');
check('a perfect round pays 5 points', points() === 5);
check('the title celebrates a perfect round', /perfect/i.test($('#results-title').textContent));

let saved = load();
check('the profile persisted', saved?.name === 'Ada');
check('the schema version is stamped', saved.version === 3);
check('20 questions were counted', saved.questionCounter === 20);
check('the session recorded the round score', saved.sessions[0].score === 20);
check('the session recorded time on task', saved.sessions[0].elapsedMs >= 0);

click($('#results-home'));
check('division opened after multiplication practice', !btn('div').disabled);

/* --------------------- one mistake caps the round at 3 -------------------- */

click(btn('div'));
check('division questions render', /^\d+ ÷ \d+$/.test($('#question').textContent));
await playRound((i) => (i === 0 ? 'wrong' : 'correct'));
check('one wrong answer scores 18.5', roundScore() === '18.5');
check('one wrong answer pays 3 points', points() === 3);
check('the results explain the deduction', /4 − 0.5 = 3/.test($('#results-notes').textContent));
click($('#results-home'));

/* --------------------- three misses pay 2, skips count -------------------- */

click(btn('add'));
check('addition questions render', /^\d+ \+ \d+$/.test($('#question').textContent));
await playRound((i) => (i < 3 ? 'skip' : 'correct'));
check('skips leave the round score alone (17 correct = 17)', roundScore() === '17');
check('three skips still pay only 2 points', points() === 2);
click($('#results-home'));

/* ------------------------------ a timeout is a miss ----------------------- */

click(btn('add'));
await answerOne('timeout');
check('a timed-out question advances the round', active() === 'screen-drill');
check('the live score is unchanged by a timeout', $('#drill-score').textContent === '0');
await playRound();
check('a timeout counts as a miss for the reward', points() === 3);
check('a timeout does not dent the round score (19)', roundScore() === '19');
click($('#results-home'));

/* --------------------- subtraction opens from addition -------------------- */

let addRounds = 0;
while (btn('sub').disabled && addRounds < 6) {
  click(btn('add'));
  await playRound();
  click($('#results-home'));
  addRounds++;
}
check(`subtraction opened after addition practice (${addRounds} more rounds)`, !btn('sub').disabled);

click(btn('sub'));
check('subtraction questions render', /^\d+ − \d+$/.test($('#question').textContent));
const subQ = $('#question').textContent.split(' ');
check('subtraction never asks for a negative answer', Number(subQ[0]) >= Number(subQ[2]));
await playRound();
click($('#results-home'));

saved = load();
check('all four operations were played', new Set(saved.sessions.map((s) => s.op)).size === 4);
check(
  'every operation has unlocked stages',
  ['add', 'sub', 'mul', 'div'].every((o) => saved.unlocked[o].length > 0)
);
check('points stayed under the daily cap', saved.points <= 60);
check('home shows the running total', Number($('#home-points').textContent) === saved.points);

/* ------------------------- the exploits stay closed ----------------------- */

const before = saved.points;

// Skipping everything: full round, zero effort. Must pay nothing, or the
// optimal strategy becomes "skip anything you're unsure of and collect base".
click(btn('add'));
await playRound(() => 'skip');
check('skipping every question still reaches the results', active() === 'screen-results');
check('skipping every question pays nothing', points() === 0);
click($('#results-home'));
check('skipping every question earns no balance', load().points === before);

// Spamming wrong answers: same, and worse on the scoreboard.
click(btn('add'));
await playRound(() => 'wrong');
check('spamming wrong answers pays nothing', points() === 0);
check('spamming wrong answers gives a negative round score', Number(roundScore()) < 0);
click($('#results-home'));
check('spamming wrong answers earns no balance', load().points === before);

// Quitting halfway, or "answer two, bail, repeat".
click(btn('add'));
await answerOne();
await answerOne();
click($('#drill-quit'));
saved = load();
check('quitting mid-round pays nothing', saved.points === before);
check('quitting mid-round still saves what was learned', saved.questionCounter > 20);

/* ------------------------------- cashing out ------------------------------ */

global.confirm = () => false;
click($('#btn-reset-points'));
check('declining the confirm keeps the points', load().points === before);

global.confirm = () => true;
click($('#btn-reset-points'));
saved = load();
check('cashing out zeroes the balance', saved.points === 0);
check('cashing out records what was spent', saved.pointsSpent === before);
check('cashing out clears the daily tally', Object.keys(saved.dailyPoints).length === 0);
check('cashing out leaves mastery alone', Object.keys(saved.facts).length > 0);
check('cashing out leaves unlocked stages alone', saved.unlocked.sub.length > 0);
check('the home screen reflects the reset', $('#home-points').textContent === '0');

/* --------------------------- the v1 -> v3 migration ----------------------- */

click($('#home-switch'));
click(window.document.querySelector('[data-user="Alan"]'));
const alan = load('Alan');

check('migration bumps the schema version', alan.version === 3);
check('migration wipes the old point balance', alan.points === 0);
check('migration wipes the old daily tally', Object.keys(alan.dailyPoints).length === 0);
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
