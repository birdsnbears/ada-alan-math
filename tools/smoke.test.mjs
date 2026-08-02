/**
 * smoke.test.mjs — end-to-end check that the UI actually wires up.
 *
 *   npm install          (installs jsdom, the only dependency)
 *   npm test
 *
 * jsdom is a fake browser that runs in Node. It plays a whole round — picking
 * a user, starting a drill, tapping keypad buttons, finishing 20 questions —
 * and asserts the app got to the right screens and saved the right data.
 *
 * This catches the class of bug that simulate.js cannot: the pure logic being
 * perfect while a button is wired to the wrong handler. Two different tests for
 * two different failure modes is how a professional team splits it too — unit
 * tests for logic, one thin end-to-end test for the wiring.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => window.document.querySelector(s);
const active = () =>
  [...window.document.querySelectorAll('.screen')].find((e) =>
    e.classList.contains('active')
  ).id;
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const fails = [];
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) fails.push(name);
};

await import(mainUrl.href);

check('boots on the profile screen', active() === 'screen-profile');

click(window.document.querySelector('[data-user="Ada"]'));
check('picking Ada goes home', active() === 'screen-home');
check('greeting shows the name', $('#home-greeting').textContent === 'Hi Ada');
check('a new profile starts with the 5x table only', $('#home-tables').textContent.trim() === '5');
check('unimplemented operations are disabled', $('[data-op="add"]').disabled && $('[data-op="div"]').disabled);
check('multiplication is enabled', !$('[data-op="mul"]').disabled);

click($('[data-op="mul"]'));
check('the drill starts', active() === 'screen-drill');
check('a question is rendered', /^\d+ × \d+$/.test($('#question').textContent));
check('the keypad has 12 keys', window.document.querySelectorAll('.key').length === 12);

const keys = {};
for (const k of window.document.querySelectorAll('.key')) keys[k.textContent] = k;

async function answerOne(deliberatelyWrong = false) {
  const [l, , r] = $('#question').textContent.split(' ');
  const value = String(Number(l) * Number(r) + (deliberatelyWrong ? 1 : 0));
  for (const digit of value) click(keys[digit]);
  const shown = $('#answer-text').textContent;
  click(keys['✓']);
  await sleep(deliberatelyWrong ? 1900 : 600);
  return shown === value;
}

check('typed digits appear in the answer field', await answerOne());
check('a correct answer advances the question', active() === 'screen-drill');

await answerOne(true);
check('a wrong answer does not end the round', active() === 'screen-drill');

let asked = 2;
while (active() === 'screen-drill' && asked < 25) {
  await answerOne();
  asked++;
}

check('the round ends after 20 questions', active() === 'screen-results');
check('results show a score', /^\d+\/20$/.test($('#res-correct').textContent));
check('points were awarded', Number($('#res-points').textContent) > 0);

const saved = JSON.parse(window.localStorage.getItem('ada-alan-math:profile:Ada'));
check('the profile persisted', saved?.name === 'Ada');
check('the schema version is stamped', saved.version === 1);
check('20 questions were counted', saved.questionCounter === 20);
check('per-fact state was recorded', Object.keys(saved.facts).length > 0);
check('the daily cap was respected', saved.points <= 30);
check('the session was logged', saved.sessions.length === 1);

click($('#results-home'));
check('returns home', active() === 'screen-home');
check('home shows the running total', Number($('#home-points').textContent) === saved.points);

console.log(fails.length ? `\n${fails.length} check(s) FAILED\n` : '\nAll smoke checks passed.\n');
process.exit(fails.length ? 1 : 0);
