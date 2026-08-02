# Ada & Alan Math

Adaptive math-fact practice for two kids — Ada (10) and Alan (8). All four
operations, each with its own curriculum, all tracked per-fact.

The premise: **timed recall is the signal that matters.** A child who answers
7 × 8 in 1.5 seconds has memorised it. One who takes 8 seconds is counting up.
Most drill apps only track right/wrong and miss the difference entirely, so they
happily mark a child "done" who is still doing arithmetic the slow way.

> Building on this, or picking it up on another machine? **[ARCHITECTURE.md](ARCHITECTURE.md)**
> has the full technical reference — module contracts, data model, algorithms,
> invariants, and how to extend it.

---

## Running it

**For the kids — GitHub Pages.** Push to `main`, then Settings → Pages → Source:
`Deploy from a branch`, branch `main`, folder `/ (root)`. It'll be live at
`https://<your-username>.github.io/ada-alan-math/`. Works on a tablet, a laptop,
anything with a browser.

**Locally:**

```powershell
npm run serve      # http://localhost:8080
npm run simulate   # run synthetic learners through every curriculum (no deps)
npm install        # installs jsdom
npm test           # end-to-end check that the UI is wired up (~15s)
```

You cannot double-click `index.html` — ES modules don't load over `file://`.

---

## How it works, for the grown-up

### Facts vs. procedures

`7 × 8` is a **fact** — the goal is instant recall, and every fact gets its own
mastery record. A child never masters "the 7s" uniformly: 7 × 2 is instant and
7 × 8 is a wall.

`37 + 48` is a **procedure** — it's computed, not recalled. There are thousands
of instances, so the whole skill gets one record and problems are generated on
demand. Treating two-digit addition as 8,100 flashcards is how drill apps end up
with a mastery bar that never moves.

`7 + 3` and `3 + 7` are stored as one fact and shown in random orientation, so
practising one reinforces the other.

### The curricula

**Addition** (Alan's main track). Sums within 10 are the bedrock. Doubles are
anchor facts a child derives neighbours from (7 + 8 is "double 7, plus one").
Bridging through 10 is the single most important strategy in early arithmetic:
8 + 5 becomes 8 + 2 + 3. Only once those are automatic does two-digit work stop
being painful — because two-digit work is just the fact set plus a carry.

> Sums to 10 → Doubles → Bridging through 10 → 2-digit + 1-digit → …carrying →
> 2-digit + 2-digit → …carrying

**Subtraction** mirrors addition stage for stage, each gated on its counterpart.
"What plus 4 makes 9?" is far easier for a child than "9 take away 4", and it's
the same fact. Teaching subtraction before the addition fact is fluent
guarantees finger-counting.

**Multiplication** (Ada's main track), one stage per table:
`5, 2, 10, 3, 4, 6, 7, 8, 9, 11, 12`. 5s have the most visible pattern, 2s are
doubling, 10s are trivial and land early to build confidence. By the time the 7s
unlock, commutativity means she already knows 5×7, 2×7, 3×7, 4×7 and 6×7 — so
"the 7 times table" is about four genuinely new facts, not twelve.

**Division** mirrors multiplication the same way. 56 ÷ 7 taught cold is a search
problem; taught as "7 times what makes 56", once 7 × 8 is fluent, it's a lookup.

Addition and multiplication are open on day one. Subtraction and division unlock
after 2–3 rounds of their prerequisite, and until then the button says exactly
what to go practise.

### Mastery

Every fact sits in a box from 0 to 5. Answer it fast (under 3s) and it moves up.
Answer it correctly but slowly and it moves up **only as far as box 3** — you
cannot reach mastery without fluency, which is the core rule of the whole app.
A wrong answer drops it two boxes; a skip or a timeout drops it one. Nothing ever
resets to zero.

Speed is measured to the **first keypress**, not to pressing enter, so a child
who knows the answer but types slowly isn't scored as hesitant.

### Time limits

- **15 seconds per question.** Generous on purpose — it's there to catch a
  wandering mind, not to be a speed test. Running out counts as a miss.
- **4 minutes per round.** The clock pauses while feedback is on screen, so
  reading "8 × 7 = 56" for a beat never costs them. A normal round takes about
  90 seconds; this only bites a child who is genuinely dawdling.

### Points

Each round is 20 questions. Two numbers come out of it.

**Round score** (live, during the round):

| | correct | wrong | skipped | timed out |
|---|---|---|---|---|
| | **+1** | **−0.5** | 0 | 0 |

A wrong answer costs more than not answering — so a wild guess is strictly worse
than admitting you don't know.

**Points** (settled at the end, 1 point = 1 minute of screen time):

| Misses | 0 | 1 | 2 | 3 | 4 | 6 | 8+ |
|---|---|---|---|---|---|---|---|
| **Points** | **5** | 3 | 3 | 2 | 2 | 1 | 0 |

A perfect round pays 5. Anything else is `4 − 0.5 × misses`, rounded down. The
cliff between perfect and one-mistake is the whole mechanism: carefulness is
worth far more than pace.

Nothing but a correct answer earns points — skips are cheaper than wrong answers
on the scoreboard, but they still cost you on payday. Quitting halfway or
blowing the round time limit pays zero. Daily cap is 60 points.

**Cashing out.** The app can't know when screen time actually gets handed over,
so that's manual: **Cash out points** on the home screen zeroes the balance and
banks it in `pointsSpent`. Nothing they've learned is affected.

### No point penalties

Points convert to screen time, so deducting from the *balance* would mean
confiscating minutes already earned — that reads as punishment and makes kids
avoid the app. A bad round pays little or nothing, but it never takes anything
away. The corrective mechanism is the box drop: a missed fact starts appearing
more often. Natural consequence, not a fine.

---

## Tuning

Nearly everything worth adjusting is a named constant. After changing any of
them run `npm run simulate`, which plays 2,400 mixed questions plus a focused run
per operation and prints the reward table and every stage unlock — so you see the
effect immediately instead of guessing.

| What | Where |
|---|---|
| Points for a perfect round / base / per-miss penalty | `src/scoring.js` → `PERFECT_ROUND_POINTS`, `ROUND_BASE_POINTS`, `MISS_PENALTY` |
| Daily cap (= max minutes of screen time) | `src/scoring.js` → `DAILY_POINT_CAP` |
| Question and round time limits | `src/scoring.js` → `QUESTION_TIME_LIMIT_MS`, `ROUND_TIME_LIMIT_MS` |
| Speed thresholds | `src/scoring.js` → `SPEED_BANDS` |
| Questions per round | `src/scoring.js` → `ROUND_LENGTH` |
| New / review / mastered mix | `src/scheduler.js` → `MIX` |
| How hard stages are to unlock | `src/scheduler.js` → `UNLOCK_RULE` |
| Stage order, content, prerequisites | `src/curriculum.js` → `CURRICULUM` |

---

## Backups

`localStorage` is per-browser and per-device. One cache clear and six weeks of
progress is gone, and Ada practising on the tablet and the laptop keeps two
separate profiles. **Save progress to a file** on the home screen is the least
exciting feature here and the most important one. Use it occasionally.

---

## Roadmap

1. **The store.** Spend points on things other than screen time. `pointsSpent`
   is already tracked.
2. **Progress view for the grown-up** — which facts are weak, session history,
   time on task. All of it is recorded already; nothing renders it.
3. **Targeted practice** — "just the 8s", or "just the ones I keep missing".

### Smaller ideas

- Sound effects and a correct-answer animation
- Streak tracking across days
- Mixed-operation rounds once several operations are solid
- Offline install (service worker + manifest)
