/**
 * keypad.js — numeric input, on-screen and physical, behind one interface.
 *
 * Two decisions worth knowing about:
 *
 * 1. NO AUTO-SUBMIT. It's tempting to submit as soon as the digit count looks
 *    right, but "12" is a prefix of "120" — the child would be submitted
 *    mid-thought. Enter (or the ✓ key) always submits.
 *
 * 2. onFirstKey FIRES ONCE PER QUESTION. That's how the drill measures recall
 *    time. Time-to-submit would measure typing speed instead, which is not the
 *    thing we're trying to teach.
 */

const LAYOUT = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'enter'];

export class Keypad {
  constructor(container, { onSubmit, onFirstKey, onSkip, maxLength = 4 }) {
    this.container = container;
    this.onSubmit = onSubmit;
    this.onFirstKey = onFirstKey;
    this.onSkip = onSkip;
    this.maxLength = maxLength;
    this.value = '';
    this.hasTyped = false;
    this.locked = true;
    this.onChange = null;

    this.render();
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  render() {
    this.container.innerHTML = '';
    for (const k of LAYOUT) {
      const btn = document.createElement('button');
      btn.className = 'key' + (k === 'enter' ? ' enter' : k === 'back' ? ' back' : '');
      btn.textContent = k === 'enter' ? '✓' : k === 'back' ? '⌫' : k;
      btn.type = 'button';
      btn.addEventListener('click', () => this.press(k));
      this.container.appendChild(btn);
    }
  }

  attach() {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  detach() {
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  handleKeyDown(e) {
    if (e.key >= '0' && e.key <= '9') this.press(e.key);
    else if (e.key === 'Backspace') { e.preventDefault(); this.press('back'); }
    else if (e.key === 'Enter') { e.preventDefault(); this.press('enter'); }
    else if (e.key === 'Escape') { e.preventDefault(); this.skip(); }
    else return;
  }

  /** Give up on this question. Costs nothing on the scoreboard, unlike a guess. */
  skip() {
    if (this.locked) return;
    this.onSkip?.();
  }

  press(key) {
    if (this.locked) return;

    if (key === 'enter') {
      if (this.value.length > 0) this.onSubmit(Number(this.value));
      return;
    }
    if (key === 'back') {
      this.value = this.value.slice(0, -1);
      this.emitChange();
      return;
    }
    if (this.value.length >= this.maxLength) return;

    // Recall time is measured to the first keypress of the question.
    if (!this.hasTyped) {
      this.hasTyped = true;
      this.onFirstKey?.();
    }
    this.value += key;
    this.emitChange();
  }

  emitChange() {
    this.onChange?.(this.value);
  }

  /** Called at the start of each question. */
  reset() {
    this.value = '';
    this.hasTyped = false;
    this.locked = false;
    this.emitChange();
  }

  lock() { this.locked = true; }
}
