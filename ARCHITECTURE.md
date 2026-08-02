# Architecture

Everything you need to pick this project up on a machine that has never seen it.
`README.md` covers *what* the app does and *why* the teaching model is shaped
the way it is; this document covers *how it is built*.

---

## 1. Starting from nothing

```powershell
git clone https://github.com/<you>/ada-alan-math.git
cd ada-alan-math
npm install          # only dependency is jsdom, and only for the test
npm run serve        # http://localhost:8080
```

`npm run simulate` needs no dependencies at all — plain Node.

**You cannot open `index.html` by double-clicking it.** The app uses ES modules,
which browsers refuse to load over `file://`. Use `npm run serve`, or GitHub
Pages for the kids (Settings → Pages → branch `main`, folder `/`).

There is no build step, no bundler, no transpiler, no framework. The files that
run in the browser are the files in the repo. That is a deliberate choice: this
project will be picked up after months away, and a toolchain that has rotted in
the meantime is a worse problem than any it would have solved.

---

## 2. File map

```
index.html            four <section> screens, one carries .active
styles.css            all styling; CSS custom properties at the top
ARCHITECTURE.md       this file
README.md             product overview and teaching rationale

src/
  curriculum.js       WHAT exists to learn, and in what order
  scheduler.js        WHICH item to ask next; WHEN a stage unlocks
  scoring.js          outcomes, speed bands, mastery boxes, the point economy
  state.js            the only file that touches localStorage
  ui/
    keypad.js         numeric input — on-screen buttons and physical keyboard
    drill.js          runs one round: render, time, collect, delegate
  main.js             bootstrap, screen routing, home + results screens

tools/
  simulate.js         synthetic learners run through the pure logic (no deps)
  smoke.test.mjs      end-to-end UI check via jsdom
```

---

## 3. The layering rule

This is the single most important thing in the repo. Everything else follows
from it.

```
        ┌──────────────────────────────────────────┐
        │  main.js          routing, home, results │   knows about the DOM
        │  ui/drill.js      one round               │
        │  ui/keypad.js     input                   │
        └───────────────┬──────────────────────────┘
                        │  calls down only
        ┌───────────────▼──────────────────────────┐
        │  state.js       persistence (localStorage)│   knows about storage
        └───────────────┬──────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │  scheduler.js   selection + unlocking     │   pure functions
        │  curriculum.js  content                   │   no DOM, no storage
        │  scoring.js     rules                     │   no timers, no globals
        └──────────────────────────────────────────┘
```

Exact import graph (no cycles):

| Module | Imports |
|---|---|
| `curriculum.js` | *nothing* |
| `scoring.js` | *nothing* |
| `scheduler.js` | `curriculum`, `scoring` |
| `state.js` | `curriculum` |
| `ui/keypad.js` | *nothing* |
| `ui/drill.js` | `curriculum`, `scheduler`, `scoring`, `state` |
| `main.js` | all of the above |

**The rules, stated plainly:**

1. `curriculum`, `scheduler` and `scoring` must never reference `document`,
   `window`, `localStorage`, `setTimeout`, `Date.now()` or `Math.random()`
   without an injectable override. They take state and arguments in; they return
   new state out; they mutate nothing they were given.
2. `state.js` is the only module allowed to touch `localStorage`.
3. Randomness is injected (`rng = Math.random` as a default parameter), so tests
   and the simulator can pass a seeded generator and get identical runs.

This is not architectural tidiness for its own sake. It is what makes
`tools/simulate.js` possible — 2,400 simulated questions in about 200ms, in
Node, with no browser. It has already caught two bugs that manual play would
have taken weeks to surface (§10).

---

## 4. Module contracts

### `curriculum.js` — what there is to learn

Exports the content model and helpers to turn it into concrete questions.

| Export | Purpose |
|---|---|
| `OPERATIONS` | `['add','sub','mul','div']` |
| `OPERATION_LABELS`, `OPERATION_SYMBOLS`, `COMMUTATIVE` | display + behaviour metadata |
| `CURRICULUM` | `{ add: Stage[], sub: Stage[], mul: Stage[], div: Stage[] }`, each array in unlock order |
| `getStage(id)`, `stageCount(op)`, `firstStageId(op)` | lookups |
| `itemsForStages(op, stageIds)` | the candidate pool for a set of unlocked stages |
| `presentItem(item, rng?)` | turn a scheduler pick into a concrete on-screen question |
| `addFact`, `subFact`, `mulFact`, `divFact` | id-canonicalising fact builders |

**Stage shape:**

```js
{
  id: 'add:bridging',            // globally unique, namespaced by operation
  label: 'Bridging through 10',  // shown to the child
  kind: 'facts' | 'procedure',
  facts: Item[],                 // kind 'facts' only
  generate: (rng) => ({a,b,answer}),  // kind 'procedure' only
  weight: 8,                     // kind 'procedure' only — scheduler boost
  requires: {                    // optional cross-operation prerequisite
    op: 'add', stage: 'add:within-10', minBox: 2, ratio: 0.35
  }
}
```

**The two stage kinds, and why:**

- `facts` — a finite set to **memorise**. Each item gets its own Leitner box,
  because a child never masters "the 7s" uniformly: 7 × 2 is instant and 7 × 8
  is a wall.
- `procedure` — a method to **apply**. `37 + 48` isn't recalled, it's computed;
  there are thousands of instances so tracking each is meaningless. The stage
  gets **one** box and problems are generated on demand, so the box measures
  fluency at the *method*. It contributes a single item to the pool, which is
  why it carries a `weight` — otherwise it would come up once a round against
  ~70 individual facts.

Treating two-digit addition as 8,100 flashcards is the classic version of this
mistake: the mastery bar never moves and the child concludes they're bad at it.

**Item (question) shape** — what the scheduler picks and `presentItem` completes:

```js
{ id: 'mul:7x8', op: 'mul', a: 7, b: 8, answer: 56, kind: 'facts', stageId: 'mul:7',
  // added by presentItem():
  left: 8, right: 7, symbol: '×', display: '8 × 7' }
```

**ID canonicalisation.** Commutative facts share one id: `mulFact(8,7)` and
`mulFact(7,8)` both produce `mul:7x8` (low operand first). This halves the
workload — 144 multiplication facts become 78 — and means practising one
reinforces the other. `presentItem` then flips the display orientation at random
so the child learns they're the same question rather than memorising one side.
Subtraction and division are **not** commutative and keep operand order.

ID namespacing (`mul:`, `add:`, …) is why the v1 → v2 migration was three lines
instead of guesswork. Keep it.

### `scheduler.js` — what to ask, and when to open the next stage

| Export | Purpose |
|---|---|
| `selectNextItem(profile, items, rng?)` | pick the next question |
| `checkUnlock(profile, op)` | is this operation's next stage ready? returns stage id or null |
| `refreshUnlocks(profile)` | unlock everything eligible across **all** operations; mutates; returns what opened |
| `masteryProgress(profile, op)` | `{mastered, total, ratio}` for the progress bars |
| `isAvailable(profile, op)` | does this operation have any unlocked stage? |
| `nextStageBlocker(profile, op)` | which other operation is holding it shut |
| `progressNote(profile, op)` | that, as a sentence for the child |
| `stageSolidity(profile, op, stageId, minBox)` | fraction of a stage at or above a box |
| `MIX`, `RECENT_COOLDOWN`, `UNLOCK_RULE` | tuning constants |

`refreshUnlocks` loops until quiet, because unlocking an addition stage can
immediately open a subtraction stage in the same pass. It runs across every
operation after every answer — not just the one being played — because
subtraction and division only ever open as a consequence of *other* operations'
progress, and you cannot play an operation that has no unlocked stages.

### `scoring.js` — the rules

| Export | Purpose |
|---|---|
| `OUTCOME` | `{CORRECT, WRONG, SKIPPED, TIMEOUT}` |
| `gradeAnswer(prevState, outcome, recallMs, questionIndex)` | → `{state, band, becameMastered, scoreDelta}` |
| `scoreDelta(outcome)` | live round score contribution |
| `roundPoints({asked, correct, elapsedMs})` | the **only** place points are created |
| `classifySpeed(ms)` | `'fast' \| 'medium' \| 'slow'` |
| `defaultFactState()` | a fresh item record |
| constants | `SPEED_BANDS`, `ROUND_LENGTH`, `ROUND_BASE_POINTS`, `PERFECT_ROUND_POINTS`, `MISS_PENALTY`, `DAILY_POINT_CAP`, `QUESTION_TIME_LIMIT_MS`, `ROUND_TIME_LIMIT_MS`, `MASTERY_BOX` |

`gradeAnswer` never mutates `prevState`; it returns a new object.

### `state.js` — persistence

| Export | Purpose |
|---|---|
| `newProfile(name)`, `loadProfile(name)`, `saveProfile(profile)` | lifecycle |
| `awardPoints(profile, amount, cap)` | credit, honouring the daily cap; returns what was actually granted |
| `resetPoints(profile)` | cash out — zero the balance, bank it in `pointsSpent` |
| `pointsEarnedToday(profile)`, `todayKey(d?)` | daily accounting, local time not UTC |
| `exportProfiles()`, `downloadBackup()`, `importProfiles(json)` | backup |
| `SCHEMA_VERSION`, `USERS` | constants |

Storage keys: `ada-alan-math:profile:<Name>` and `ada-alan-math:lastUser`.

### `ui/keypad.js` — input

A class wrapping the on-screen keypad and the physical keyboard behind one
interface. Callbacks: `onChange(value)`, `onFirstKey()`, `onSubmit(number)`,
`onSkip()`. Methods: `attach()`, `detach()`, `reset()`, `lock()`, `skip()`.

Two decisions worth preserving:

- **No auto-submit.** Submitting as soon as the digit count looks right is
  tempting, but `12` is a prefix of `120` — the child would be cut off
  mid-thought. Enter (or the ✓ key) always submits.
- **`onFirstKey` fires once per question.** That is how recall time is measured.

Physical keys: digits, Backspace, Enter, Escape (skip).

### `ui/drill.js` — one round

`startDrill({profile, op, els, keypad, onFinish}) → { abort }`

Renders, times, collects input, and delegates every decision downward. `els` is
a plain object of DOM nodes supplied by `main.js` — the drill never queries the
document itself, which keeps it one small step from being testable in isolation.

`resolve(outcome)` is the single exit point for a question, whichever of the four
ways it ended. That matters: correct, wrong, skipped and timed-out all need the
same bookkeeping (grade, advance counter, refresh unlocks, save, schedule next),
and four separate paths would drift apart.

### `main.js` — routing and the other screens

Four `<section>`s; `show(name)` toggles `.active`. No router, no framework. For
an app this size that is the correct amount of machinery.

---

## 5. Data model

```js
{
  version: 3,                     // schema version — see §6
  name: "Ada",
  createdAt: "2026-08-02T...",

  points: 12,                     // current balance = minutes of screen time
  pointsSpent: 45,                // lifetime cashed out
  dailyPoints: { "2026-08-02": 12 },   // enforces DAILY_POINT_CAP, local dates

  facts: {                        // one record per ITEM (fact or procedure stage)
    "mul:7x8":        { box: 3, seen: 11, correct: 9, streak: 2, avgMs: 2380, lastSeenIndex: 402 },
    "add:2d2d-carry": { box: 1, seen: 6,  correct: 4, streak: 0, avgMs: 5100, lastSeenIndex: 398 }
  },

  unlocked: {                     // stage ids, in the order they opened
    add: ["add:within-10", "add:doubles"],
    sub: ["sub:within-10"],
    mul: ["mul:5", "mul:2", "mul:10"],
    div: ["div:5"]
  },
  lastUnlockAt: { add: 260, sub: 180, mul: 448, div: 35 },  // questionCounter values

  questionCounter: 512,           // monotonic; the clock the scheduler runs on
  sessions: [                     // capped at the last 200
    { date, op, asked, correct, score, points, elapsedMs, avgMs }
  ]
}
```

**`questionCounter` is the scheduler's clock.** Staleness and the cooldown are
measured in questions answered, not wall time, because sessions are short and
sporadic — "seen 5 questions ago" is meaningful in a way "seen 3 days ago" is
not for a 20-question round.

**`box`** is 0–5. `MASTERY_BOX = 5`.

---

## 6. Schema versioning

Every saved profile carries `version`. `loadProfile` runs it through `MIGRATIONS`
until it reaches `SCHEMA_VERSION`. Each migration upgrades **from** its key to
the next version. Never edit a shipped migration; add another.

| Version | Change |
|---|---|
| 1 | multiplication only; `unlocked.mul` was `[5, 2]`, `lastUnlockAt` a single number |
| 2 | four operations; `unlocked.mul` → `['mul:5','mul:2']`, `lastUnlockAt` → per-operation object |
| 3 | points moved from per-question to per-round; old balances wiped once |

The v2 → v3 migration is worth understanding because it isn't a shape change at
all — it's a **one-off data correction riding the migration system**. Old
balances were priced under different rules, so they reset. No `hasReset` flag to
store, no risk of firing twice, no cleanup code to delete later: a profile
crosses 2 → 3 exactly once, ever. This is the standard trick for one-time data
fixes.

If a migration is missing, `loadProfile` logs a warning and starts a fresh
profile rather than crashing or corrupting.

**Backups.** `localStorage` is per-browser and per-device. The **Save progress to
a file** button on the home screen exports both profiles as JSON; **Restore from
a file** imports and migrates them. It is the least exciting feature here and
the most important one.

---

## 7. The algorithms

### 7.1 Selecting the next item

```
pool = itemsForStages(op, profile.unlocked[op])
drop anything seen within RECENT_COOLDOWN (4) questions   ← unless that empties the pool
bucket into:  new (seen < 2) | review | mastered (box >= 5)
roll MIX = { new 30%, review 55%, mastered 15% }          ← fall through to a non-empty bucket
within the bucket, weighted-random by urgency
```

```
urgency = (1 + staleness + weakness + errorRate*10) * weight
  staleness = min(questionCounter - lastSeenIndex, 40) * 0.5
  weakness  = (5 - box) * 3
  errorRate = 1 - correct/seen
  weight    = item.weight ?? 1        (procedure stages carry 8)
Never-seen items short-circuit to 12 * weight.
```

Review dominates because re-challenging old skills is what builds retention; the
mastered slice keeps finished material warm.

### 7.2 Mastery (Leitner boxes)

| Outcome | Box change | Why |
|---|---|---|
| correct, **fast** (<3s) | +1, capped at 5 | recalled |
| correct, **medium** (3–6s) | +1, but **capped at box 3** | computed, not recalled |
| correct, **slow** (>6s) | no change | counting up |
| **wrong** | −2 | a wrong association may be forming |
| **skipped** | −1 | honest "I don't know" — don't punish honesty |
| **timeout** | −1 | usually distraction, not ignorance |

**The medium cap is the core rule of the whole app: you cannot reach mastery
without fluency.** Getting there by slowly working it out every time doesn't
count. Nothing ever resets to zero — forgetting one fact shouldn't erase weeks
of work, it should just bring that fact round again sooner.

`avgMs` is an exponential moving average (α = 0.3) fed **only by correct
answers**, so a timeout can't poison it.

### 7.3 Speed measurement — three separate clocks

| Clock | Span | Used for |
|---|---|---|
| `recallMs` | question shown → **first keypress** | speed bands, therefore mastery |
| question time | question shown → resolved | the 15s per-question limit |
| round `elapsedMs` | sum of question times | the 4-minute round limit |

Measuring to first keypress rather than to submit is the difference between
measuring **recall** and measuring **typing speed**. A child who knows 7 × 8
instantly but types slowly must not be scored as hesitant.

The round clock **pauses during answer feedback**, so reading "8 × 7 = 56" for a
beat never costs them. Each question's contribution is capped at
`QUESTION_TIME_LIMIT_MS` so a backgrounded tab can't eat the round.

### 7.4 Unlocking a stage

Three conditions, all required:

1. Any `requires` prerequisite on the next stage is satisfied — that is, the
   named stage in the other operation is unlocked *and* `stageSolidity` meets
   its `minBox`/`ratio`.
2. At least `UNLOCK_RULE.minQuestionsBetween` (20) questions since this
   operation last unlocked. *(Skipped for an operation's first stage — that's
   about access, not pacing.)*
3. The **current** stage is ≥80% at box 3 **and** everything unlocked so far is
   ≥60% at box 3.

The split in (3) matters and is the fix for a real bug (§10). Progress depends
on the stage you're actually working on; overall health is only a brake.

### 7.5 The point economy

**Round score** — live feedback, shown during the round:

```
correct +1        wrong −0.5        skipped 0        timeout 0
```

A wrong answer costs more than not answering. That inversion makes a wild guess
strictly worse than admitting you don't know.

**Reward** — settled once, at the end:

```
round not finished         → 0
round elapsed > 4 minutes  → 0
all 20 correct             → 5
otherwise                  → floor(4 − 0.5 × misses), floored at 0
```

| Misses | 0 | 1 | 2 | 3 | 4 | 6 | 8+ |
|---|---|---|---|---|---|---|---|
| **Points** | **5** | 3 | 3 | 2 | 2 | 1 | 0 |

The cliff between perfect and one-mistake is the mechanism: carefulness is worth
far more than pace.

Note that the reward counts **every** question not answered correctly, including
skips, while the round score leaves skips at zero. The two numbers have
different jobs. If skips were free on the reward too, the optimal strategy would
be to skip anything uncertain and still collect the full base 4 — exactly the
carelessness the design is meant to discourage. Skips are cheaper than wrong
answers on the *scoreboard*; nothing but a correct answer earns *money*.

Daily cap is 60 points. `awardPoints` returns what was actually granted, so the
UI shows the true figure rather than the requested one.

---

## 8. Invariants

Things that must stay true. Most are asserted in one of the two test suites; if
you break one, something will go red.

1. `curriculum`, `scheduler`, `scoring` never touch DOM, storage or unseeded
   randomness.
2. `state.js` is the only module that calls `localStorage`.
3. `roundPoints()` is the only function that creates points.
4. Every saved profile has a `version`, and a migration path to `SCHEMA_VERSION`.
5. Stage ids and fact ids are globally unique and namespaced by operation.
6. Generated (procedural) problems never produce a negative answer, a
   non-integer, or a result above 999 (the keypad accepts three digits).
   A stage whose id contains `carry` or `borrow` always actually carries or
   borrows. `simulate.js` audits 4,000 samples per stage.
7. Subtraction and division questions never require a negative answer.
8. `gradeAnswer` does not mutate its input.
9. An unfinished round pays nothing.
10. No operation can plateau silently: if the next stage is blocked by another
    operation, `progressNote` says so and the home screen shows it.

---

## 9. Extending it

### Add a stage to an existing operation

Add a `factStage(...)` or `procStage(...)` to the relevant array in
`CURRICULUM`. Position in the array *is* the unlock order. Then run
`npm run simulate` and read the unlock table.

### Add a whole operation

1. Add it to `OPERATIONS`, `OPERATION_LABELS`, `OPERATION_SYMBOLS`,
   `COMMUTATIVE`, and give it a `CURRICULUM` entry.
2. Add a fact builder if the id format is new.
3. Add a button to the `.op-grid` in `index.html` with `data-op="<op>"` and the
   same inner spans as its siblings; add a colour rule in `styles.css`.
4. Add it to `newProfile`'s `unlocked` / `lastUnlockAt`, and write a migration.

`main.js` iterates `OPERATIONS`, so the home screen picks it up automatically.

### Change the economy

Everything lives in `scoring.js`: `ROUND_BASE_POINTS`, `PERFECT_ROUND_POINTS`,
`MISS_PENALTY`, `DAILY_POINT_CAP`, `ROUND_LENGTH`, `QUESTION_TIME_LIMIT_MS`,
`ROUND_TIME_LIMIT_MS`. The reward table in `simulate.js` and the tier assertions
will tell you immediately what you changed.

### Change the pacing

`UNLOCK_RULE` in `scheduler.js` (how hard stages are to open), `MIX` (what gets
asked), each stage's `requires` (cross-operation gates). Re-run
`npm run simulate` and compare the unlock table.

### The store (next feature)

`pointsSpent` already exists and `resetPoints` already banks into it. A store
would replace the "cash out" button with an item list, decrement `points`, and
append to a new `purchases` array — a schema v4 migration adding `purchases: []`.

---

## 10. Testing

Two suites, deliberately split along the standard line.

### `npm run simulate` — does the *logic* work?

No dependencies. Builds a synthetic learner (facts involving 0/1/2/5/10 are
easier, bigger numbers harder, procedures harder still; speed and accuracy
improve exponentially with exposure; 3% chance per question of drifting off and
timing out) and runs it through the real scheduler and scoring modules with a
seeded RNG.

Reports: progress every 10th round, when every stage unlocked, per-operation
mastery, the earn rate, and a reward table. Then asserts: the reward formula at
every tier, that generated problems are well-formed, that prerequisites actually
gate, that no two stages open under 20 questions apart, and that every
curriculum is completable under focused practice.

The mixed run models a child bouncing between operations; the focused runs give
one operation full attention, which is the right place to ask whether a
curriculum is completable at all rather than just under-practised.

### `npm test` — is the *wiring* right?

jsdom, ~15 seconds, 71 assertions. Plays real rounds by clicking real buttons:
a perfect round, a round with one wrong answer, a round with skips, a round with
a timeout, a skip-everything round, a spam-everything round, quitting halfway,
cashing out, and a v1 profile seeded into `localStorage` before boot to exercise
both migrations.

It patches `globalThis.setTimeout` to run the clock 10× fast — otherwise the 15
second question timeout alone would make the suite too slow to bother running.
That belongs in the test; production code shouldn't carry a "go faster for
tests" flag.

### What the simulator has already caught

Both of these would have taken weeks of real play to notice:

- **The unlock gate stalled subtraction.** The original rule required 80% of
  *everything unlocked* to be solid. That looks reasonable and is quietly wrong:
  the pool grows with every stage, so each unlock is harder than the last.
  Subtraction — which has roughly twice as many facts as addition, since
  9 = 4 + 5 yields both 9 − 4 and 9 − 5 — froze at 3 of 7 stages permanently.
  Splitting the gate into "current stage drives, overall health brakes" took
  subtraction from 33% to 91% mastered.
- **A silent dead end.** A child could master everything available in
  subtraction and plateau forever, because the next stage needed addition
  progress they weren't making. The dependency is correct pedagogy; the
  invisible ceiling was a bug. Hence `progressNote` and invariant 10.

---

## 11. Deployment

GitHub Pages, straight from `main`, no build step. Every file in the repo is
served as-is.

`.gitattributes` sets `* text=auto`, so files are stored LF and checked out CRLF
on Windows — no phantom whole-file diffs when moving between machines.

`.gitignore` covers `node_modules/` and `package-lock.json`.

---

## 12. Known limitations

- **Progress is per-device.** `localStorage` doesn't sync. Ada practising on the
  tablet and the laptop keeps two separate profiles. The backup file is the
  manual bridge. A real fix means a backend, which isn't worth it for two kids.
- **No grown-up view.** Session history is recorded but nothing renders it.
- **Procedural stages don't diagnose.** `add:2d2d-carry` gets one box, so the app
  knows the child struggles with carrying but not *which* carrying pattern.
- **No offline install.** No service worker or manifest; it needs a connection to
  load, though nothing after that.
