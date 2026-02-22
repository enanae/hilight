/**
 * Review Mode: keyboard-driven word navigation and grading.
 *
 * Two modes exist in the app:
 * - Reading mode (default): arrow keys page, Space pages forward
 * - Review mode: n/N navigate words, 1/2/3 grade, d defines, Escape exits
 *
 * This module manages the review mode lifecycle and word focus state.
 * The keyboard bindings themselves live in main.js.
 */
import { state } from './app-state.js';
import { LEVEL_KNOWN } from './highlighter.js';

const FOCUSED_CLASS = 'hl-focused';

/** Whether review mode is currently active. */
export function isReviewMode() {
  return state.reviewMode;
}

/**
 * Enter review mode. Focuses the nearest eligible word to the last
 * mouse/touch interaction, or the first eligible word if none.
 * @param {Document} iframeDoc - the epub iframe document
 */
export function enterReviewMode(iframeDoc) {
  if (!iframeDoc) return;
  state.reviewMode = true;

  const words = getFilteredWordList(iframeDoc);
  if (words.length === 0) {
    // No words to review on this page
    state.reviewMode = false;
    return;
  }

  // Start from the last word the user interacted with, if it's on this page
  const lastWord = state.lastInteractedWord;
  if (lastWord) {
    const idx = words.indexOf(lastWord);
    if (idx >= 0) {
      focusWord(words[idx]);
      return;
    }
    // Last interacted word isn't eligible (e.g. filtered out as known) —
    // find the nearest eligible word by document position
    const allSpans = [...iframeDoc.querySelectorAll('.hl-word')];
    const lastPos = allSpans.indexOf(lastWord);
    if (lastPos >= 0) {
      // Find the closest eligible word after the last interacted position
      const nearest = words.find(w => allSpans.indexOf(w) >= lastPos);
      if (nearest) {
        focusWord(nearest);
        return;
      }
    }
  }

  focusWord(words[0]);
}

/** Exit review mode. Removes focus ring and resets state. */
export function exitReviewMode() {
  if (state.reviewFocusedWord) {
    state.reviewFocusedWord.classList.remove(FOCUSED_CLASS);
  }
  state.reviewMode = false;
  state.reviewFocusedWord = null;
}

/**
 * Focus the next word in document order.
 * @param {Document} iframeDoc
 * @returns {'moved'|'end'} - 'end' if already at last word (caller may page forward)
 */
export function focusNextWord(iframeDoc) {
  if (!iframeDoc) return 'end';
  const words = getFilteredWordList(iframeDoc);
  if (words.length === 0) return 'end';

  const currentIdx = findCurrentIndex(words);
  if (currentIdx < words.length - 1) {
    focusWord(words[currentIdx + 1]);
    return 'moved';
  }
  return 'end';
}

/**
 * Focus the previous word in document order.
 * @param {Document} iframeDoc
 * @returns {'moved'|'start'} - 'start' if already at first word
 */
export function focusPrevWord(iframeDoc) {
  if (!iframeDoc) return 'start';
  const words = getFilteredWordList(iframeDoc);
  if (words.length === 0) return 'start';

  const currentIdx = findCurrentIndex(words);
  if (currentIdx > 0) {
    focusWord(words[currentIdx - 1]);
    return 'moved';
  }
  return 'start';
}

/**
 * Apply focus ring to a specific word span.
 * @param {HTMLElement} span - the .hl-word span to focus
 */
export function focusWord(span) {
  // Remove previous focus
  if (state.reviewFocusedWord) {
    state.reviewFocusedWord.classList.remove(FOCUSED_CLASS);
  }
  span.classList.add(FOCUSED_CLASS);
  state.reviewFocusedWord = span;
  scrollWordIntoView(span);
}

/** Get the currently focused word span (or null). */
export function getFocusedWord() {
  return state.reviewFocusedWord;
}

/**
 * Toggle between reviewing all words vs only unknown+partial.
 * Re-focuses the nearest eligible word after toggling.
 * @param {Document} iframeDoc
 */
export function toggleFilter(iframeDoc) {
  state.reviewShowAll = !state.reviewShowAll;
  if (!iframeDoc) return;

  const words = getFilteredWordList(iframeDoc);
  if (words.length === 0) {
    // No eligible words with new filter — stay focused on current or exit
    return;
  }

  // Try to keep the current focused word if it's still eligible
  const current = state.reviewFocusedWord;
  if (current && words.includes(current)) return;

  // Otherwise focus the nearest eligible word
  focusWord(words[0]);
}

/** @returns {boolean} true if showing all words, false if filtering to unknown+partial */
export function isShowingAll() {
  return state.reviewShowAll;
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Get the list of words eligible for navigation based on current filter.
 * @param {Document} iframeDoc
 * @returns {HTMLElement[]}
 */
function getFilteredWordList(iframeDoc) {
  const all = [...iframeDoc.querySelectorAll('.hl-word')];
  if (state.reviewShowAll) return all;
  // Default: skip known words (level 2)
  return all.filter(span => parseInt(span.dataset.level, 10) !== LEVEL_KNOWN);
}

/**
 * Find the index of the currently focused word in the given list.
 * Returns 0 if not found (start from beginning).
 */
function findCurrentIndex(words) {
  if (!state.reviewFocusedWord) return -1;
  const idx = words.indexOf(state.reviewFocusedWord);
  return idx >= 0 ? idx : -1;
}

/**
 * Scroll the word span into view within the epub container.
 */
function scrollWordIntoView(span) {
  span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}
