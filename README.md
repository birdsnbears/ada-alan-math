# Ada & Alan Math

Adaptive math-fact practice for two kids. Times tables now; addition, subtraction
and division to follow.

The premise: **timed recall is the signal that matters.** A child who answers
7 × 8 in 1.5 seconds has memorised it. One who takes 8 seconds is counting up.
Most drill apps only track right/wrong and miss the difference entirely, so they
happily mark a child "done" who is still doing arithmetic the slow way.

---

## Running it

**For the kids — GitHub Pages.** Push to `main`, then in the repo on GitHub go to
Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)`.
It'll be live at `https://<your-username>.github.io/ada-alan-math/`. Works on a
tablet, a laptop, anything with a browser.

**Locally, while developing:**

```powershell
npm run serve
```

Note: you cannot just double-click `index.html`. The app uses ES modules, which
browsers refuse to load over `file://` for security reasons — you need a server,
even a trivial one.

**Checks:**

```powershell
npm run simulate   # run a synthetic learner through the scheduler, no deps needed
npm install        # installs jsdom
npm test           # end-to-end check that the UI is wired up
```

---

## How the teaching model works

### Facts, not tables

Mastery is tracked per **fact**, not per times table. A child never masters
"the 7s" uniformly — 7 × 2 is instant and 7 × 8 is a wall. The times-table order
is only the order in which new facts are *introduced*.

`7 × 8` and `8 × 7` share one record. That halves the workload (144 facts → 78)
and means practising one reinforces the other, which is how memory actually
works. Questions are shown in a random orientation so the child doesn't memorise
one direction and freeze at the other.

### Unlock order

`5, 2, 10, 3, 4, 6, 7, 8, 9, 11, 12`

5s have the most visible pattern, 2s are doubling, 10s are trivial and land
early to build confidence. By the time the 7s unlock, commutativity means the
child already knows 5×7, 2×7, 3×7, 4×7 and 6×7 — so "the 7 times table" is
about four genuinely new facts, not twelve.

A new table unlocks when **80% of currently-unlocked facts are at box 3+**, and
at least 20 questions have passed since the last unlock.

### Speed bands

Measured as time from the question appearing to the **first keypress** — not to
submitting. Time-to-submit measures typing speed; time-to-first-keypress
measures recall, which is the thing being taught.

| Band | Time | Meaning | Points |
|---|---|---|---|
| Fast | under 3s | Retrieved from memory | 2 |
| Medium | 3–6s | Correct, but worked out | 1 |
| Slow | over 6s | Counting up | 0 |
| Wrong | — | — | 0 |

### Boxes (Leitner)

Each fact sits in a box from 0 to 5. Box 5 is mastered.

- Correct and **fast** → up one box
- Correct and **medium** → up one box, but capped at box 3
- Correct and **slow** → no change
- **Wrong** → down two boxes

That medium cap is the important rule: **you cannot reach mastery without
fluency.** Getting there by slowly working it out every time doesn't count.

A wrong answer drops two boxes rather than resetting to zero — forgetting one
fact shouldn't erase weeks of work, but it should bring the fact back soon.

### No point penalties

Points convert to screen time, so deducting them means confiscating minutes the
child already earned. That reads as punishment and makes kids avoid the app. The
corrective mechanism is already built in: a missed fact drops down the boxes and
starts appearing more often. Natural consequence, not a fine.

### Question mix

Roughly 30% newly-unlocked facts, 55% review, 15% mastered facts kept warm.
Within each bucket, selection is weighted by how overdue, how weak, and how
error-prone the fact is. No fact repeats within 4 questions.

---

## Tuning knobs

Nearly everything worth adjusting is a named constant:

| What | Where |
|---|---|
| Daily point cap (= max minutes of screen time) | `src/scoring.js` → `DAILY_POINT_CAP` |
| Speed thresholds | `src/scoring.js` → `SPEED_BANDS` |
| Points per band, mastery bonus | `src/scoring.js` → `POINTS` |
| Questions per round | `src/scoring.js` → `ROUND_LENGTH` |
| New/review/mastered mix | `src/scheduler.js` → `MIX` |
| How hard it is to unlock a table | `src/scheduler.js` → `UNLOCK_RULE` |
| Which table comes next | `src/curriculum.js` → `UNLOCK_ORDER` |

After changing any of them, run `npm run simulate` — it plays 1,200 questions and
prints when each table unlocked, so you can see the effect immediately instead of
guessing.

---

## Architecture

```
index.html          four <section> screens, one gets .active
styles.css
src/
  curriculum.js     what facts exist, in what order they're introduced
  scheduler.js      which fact to ask next; when to unlock a table
  scoring.js        speed bands, points, box transitions
  state.js          the ONLY file that touches localStorage
  ui/
    keypad.js       numeric input, on-screen and physical
    drill.js        runs one round: render, time, collect, delegate
  main.js           bootstrap, routing, home + results screens
tools/
  simulate.js       synthetic learner (no dependencies)
  smoke.test.mjs    end-to-end UI check (needs jsdom)
```

Two rules hold this together:

**1. `curriculum`, `scheduler` and `scoring` never touch the DOM.** They're plain
functions: state in, new state out, nothing mutated. That's the only reason
`simulate.js` can exist — it converts "click through the UI for twenty minutes
and guess whether the pacing feels right" into "run a command and read a table."

**2. `state.js` is the only file that knows about `localStorage`.** Swapping to a
file, a server, or IndexedDB later is a one-file change.

### Data shape

```js
{
  version: 1,                  // migrate, never wipe
  name: "Ada",
  points: 0,
  dailyPoints: { "2026-08-02": 12 },
  facts: {
    "mul:5x3": { box: 2, seen: 8, correct: 7, streak: 3, avgMs: 2400, lastSeenIndex: 91 }
  },
  unlocked: { mul: [5, 2, 10] },
  questionCounter: 91,
  lastUnlockAt: 62,
  sessions: [{ date, op, asked, correct, points, avgMs }]
}
```

The `version` field earns its keep the first time the mastery model changes.
Add a migration in `state.js`; don't make the choice be "wipe Ada's progress" or
"never improve the app."

### Backups

`localStorage` is per-browser and per-device. One cache clear and six weeks of
progress is gone. The **Save progress to a file** button on the home screen is the
least exciting feature here and the most important one. Use it occasionally.

---

## Roadmap

1. **Addition and subtraction** for Alan. Different curriculum shape — there are
   no "tables". The progression that works is: sums within 10 → doubles (4+4,
   7+7) → make-10 (8+2, 6+4) → bridging through 10 (8+5 = 8+2+3) → within 20 →
   two-digit. Subtraction rides on addition the way division rides on
   multiplication.
2. **Division**, derived from multiplication mastery: only introduce 56 ÷ 7 once
   7 × 8 is mastered. Division taught as the inverse of a known fact is
   dramatically easier than division taught cold.
3. **The store.** Spend points on things other than screen time.
4. **Progress view for the grown-up** — which facts are weak, session history.

### Known future tasks

- Sound effects and a correct-answer animation
- A "practice just the 8s" mode for targeted work
- Streak tracking across days
