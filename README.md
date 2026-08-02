# Ada & Alan Math

Adaptive math-fact practice for two kids — Ada (10) and Alan (8). All four
operations, each with its own curriculum.

The premise: **timed recall is the signal that matters.** A child who answers
7 × 8 in 1.5 seconds has memorised it. One who takes 8 seconds is counting up.
Most drill apps only track right/wrong and miss the difference entirely, so they
happily mark a child "done" who is still doing arithmetic the slow way.

---

## Running it

**For the kids — GitHub Pages.** Push to `main`, then Settings → Pages → Source:
`Deploy from a branch`, branch `main`, folder `/ (root)`. It'll be live at
`https://<your-username>.github.io/ada-alan-math/`. Works on a tablet, a laptop,
anything with a browser.

**Locally, while developing:**

```powershell
npm run serve
```

Note: you cannot just double-click `index.html`. The app uses ES modules, which
browsers refuse to load over `file://` — you need a server, even a trivial one.

**Checks:**

```powershell
npm run simulate   # run synthetic learners through every curriculum (no deps)
npm install        # installs jsdom
npm test           # end-to-end check that the UI is wired up (~11s)
```

---

## How the teaching model works

### Stages

Each operation is an ordered list of **stages** — one chunk of skill unlocked as
a unit. Stages come in two kinds, and the distinction is the thing most drill
apps get wrong:

- **Facts** — a finite set to *memorise*. 7 × 8 is a fact. Each one gets its own
  Leitner box, because a child never masters "the 7s" uniformly: 7 × 2 is
  instant and 7 × 8 is a wall.
- **Procedures** — a method to *apply*. 37 + 48 is not memorised, it's computed.
  There are thousands of instances, so tracking each is meaningless. The stage
  gets one box and problems are generated on demand; the box then represents
  fluency at the *method*.

Treat two-digit addition as 8,100 flashcards and the mastery bar never moves,
which teaches the child that they're bad at it.

`7 + 3` and `3 + 7` share one record — commutative operations are stored once and
shown in a random orientation, so practising one reinforces the other.

### The curricula

**Addition** (Alan's main track). The standard fluency progression. Sums within
10 are the bedrock. Doubles are anchor facts a child derives neighbours from
(7 + 8 is "double 7, plus one"). Bridging through 10 is the single most important
strategy in early arithmetic: 8 + 5 becomes 8 + 2 + 3. Only once those are
automatic does two-digit work stop being painful — because two-digit work is
just the fact set plus a carry.

> Sums up to 10 → Doubles → Bridging through 10 → 2-digit + 1-digit →
> …carrying → 2-digit + 2-digit → …carrying

**Subtraction.** Every stage is the inverse of the matching addition stage and
is gated on it. "What plus 4 makes 9?" is far easier for a child than "9 take
away 4", and it's the same fact. Teaching subtraction before the addition fact
is fluent guarantees finger-counting.

**Multiplication** (Ada's main track). One stage per table, in the order
`5, 2, 10, 3, 4, 6, 7, 8, 9, 11, 12`. 5s have the most visible pattern, 2s are
doubling, 10s are trivial and land early to build confidence. By the time the 7s
unlock, commutativity means she already knows 5×7, 2×7, 3×7, 4×7 and 6×7 — so
"the 7 times table" is about four genuinely new facts, not twelve.

**Division.** Each table gated on the matching times table. 56 ÷ 7 taught cold is
a search problem; taught as "7 times what makes 56", once 7 × 8 is fluent, it's a
lookup.

Addition and multiplication are open from day one. Subtraction and division
unlock from progress in their prerequisite — roughly 2–3 rounds of practice.

### Speed bands

Measured from the question appearing to the **first keypress** — not to
submitting. Time-to-submit measures typing speed; time-to-first-keypress
measures recall, which is the thing being taught.

| Band | Time | Meaning | Points |
|---|---|---|---|
| Fast | under 3s | Retrieved from memory | 2 |
| Medium | 3–6s | Correct, but worked out | 1 |
| Slow | over 6s | Counting up | 0 |
| Wrong | — | — | 0 |

### Boxes (Leitner)

Each item sits in a box from 0 to 5. Box 5 is mastered.

- Correct and **fast** → up one box
- Correct and **medium** → up one box, but capped at box 3
- Correct and **slow** → no change
- **Wrong** → down two boxes

That medium cap is the important rule: **you cannot reach mastery without
fluency.** Getting there by slowly working it out every time doesn't count.

A wrong answer drops two boxes rather than resetting to zero — forgetting one
fact shouldn't erase weeks of work, but it should bring the fact back soon.

### Unlocking

Two conditions, and the split matters:

- The **current stage** must be 80% at box 3 — this is what drives progress.
- **Everything unlocked so far** must be 60% at box 3 — a brake, so you don't run
  ahead while earlier material rots.

An earlier version required 80% of *everything*. That looks reasonable and is
quietly wrong: the pool grows with every stage, so each unlock is harder than the
last, and subtraction (which has roughly twice as many facts as addition, since
9 = 4 + 5 yields both 9 − 4 and 9 − 5) ground to a halt three stages in. The
simulator caught it.

### No point penalties

Points convert to screen time, so deducting them means confiscating minutes the
child already earned. That reads as punishment and makes kids avoid the app. The
corrective mechanism is already built in: a missed fact drops down the boxes and
starts appearing more often. Natural consequence, not a fine.

### Question mix

Roughly 30% newly-unlocked items, 55% review, 15% mastered items kept warm.
Within each bucket, selection is weighted by how overdue, how weak, and how
error-prone the item is. Nothing repeats within 4 questions.

---

## Tuning knobs

Nearly everything worth adjusting is a named constant:

| What | Where |
|---|---|
| Daily point cap (= max minutes of screen time) | `src/scoring.js` → `DAILY_POINT_CAP` (60) |
| Speed thresholds | `src/scoring.js` → `SPEED_BANDS` |
| Points per band, mastery bonus | `src/scoring.js` → `POINTS` |
| Questions per round | `src/scoring.js` → `ROUND_LENGTH` (20) |
| New/review/mastered mix | `src/scheduler.js` → `MIX` |
| How hard it is to unlock a stage | `src/scheduler.js` → `UNLOCK_RULE` |
| Cross-operation prerequisites | `src/curriculum.js` → each stage's `requires` |
| Stage order and content | `src/curriculum.js` → `CURRICULUM` |

After changing any of them, run `npm run simulate` — it plays 2,400 mixed
questions plus a focused run per operation and prints when every stage unlocked,
so you see the effect immediately instead of guessing.

---

## Architecture

```
index.html          four <section> screens, one gets .active
styles.css
src/
  curriculum.js     what facts and procedures exist, in what order
  scheduler.js      which item to ask next; when to unlock a stage
  scoring.js        speed bands, points, box transitions
  state.js          the ONLY file that touches localStorage
  ui/
    keypad.js       numeric input, on-screen and physical
    drill.js        runs one round: render, time, collect, delegate
  main.js           bootstrap, routing, home + results screens
tools/
  simulate.js       synthetic learners (no dependencies)
  smoke.test.mjs    end-to-end UI check (needs jsdom)
```

Two rules hold this together:

**1. `curriculum`, `scheduler` and `scoring` never touch the DOM.** They're plain
functions: state in, new state out, nothing mutated. That's the only reason
`simulate.js` can exist — it converts "click through the UI for twenty minutes
and guess whether the pacing feels right" into "run a command and read a table."
It has already paid for itself twice: it caught the unlock gate that stalled
subtraction, and a dead end where a child could master everything available in
subtraction and silently plateau forever because the next stage needed addition
progress they weren't doing.

**2. `state.js` is the only file that knows about `localStorage`.** Swapping to a
file, a server, or IndexedDB later is a one-file change.

The two test files split along the standard line: `simulate.js` tests the
**logic** (is the curve right?), `smoke.test.mjs` tests the **wiring** (is the
button connected?). Different failure modes; conflating them is how test suites
become slow and useless.

### Data shape

```js
{
  version: 2,                  // migrate, never wipe
  name: "Ada",
  points: 0,
  dailyPoints: { "2026-08-02": 12 },
  facts: {
    "mul:5x3":   { box: 2, seen: 8, correct: 7, streak: 3, avgMs: 2400, lastSeenIndex: 91 },
    "add:2d2d-carry": { box: 1, ... }   // a whole procedural stage, one record
  },
  unlocked: { add: ["add:within-10"], sub: [], mul: ["mul:5","mul:2"], div: [] },
  lastUnlockAt: { add: 0, sub: 0, mul: 62, div: 0 },
  questionCounter: 91,
  sessions: [{ date, op, asked, correct, points, avgMs }]
}
```

The `version` field earned its keep at v2, when multiplication-only became four
operations: `unlocked.mul` went from `[5, 2]` to `['mul:5', 'mul:2']` and
`lastUnlockAt` from a number to a per-operation object. Fact ids were already
namespaced, so no mastery was lost. Add migrations in `state.js`; don't make the
choice be "wipe Ada's progress" or "never improve the app."

### Backups

`localStorage` is per-browser and per-device. One cache clear and six weeks of
progress is gone. The **Save progress to a file** button on the home screen is the
least exciting feature here and the most important one. Use it occasionally.

---

## Roadmap

1. **The store.** Spend points on things other than screen time.
2. **Progress view for the grown-up** — which facts are weak, session history,
   time spent.
3. **Targeted practice** — "just the 8s", or "just the facts I keep missing".

### Known future tasks

- Sound effects and a correct-answer animation
- Streak tracking across days
- Mixed-operation rounds once several operations are solid
