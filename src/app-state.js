/**
 * Centralized application state.
 *
 * All mutable state that was previously scattered across module-level
 * `let` variables is now in this single object. This eliminates the
 * three independent copies of `currentLanguage` that could drift out
 * of sync across main.js, epub-reader.js, and vocab-browser.js.
 */
export const state = {
  // Language — previously duplicated in main.js, epub-reader.js, vocab-browser.js
  currentLanguage: localStorage.getItem('hilight-lang') || 'en',
  defLanguage: localStorage.getItem('hilight-def-lang') || 'en',

  // Book lifecycle — previously in epub-reader.js + main.js
  currentBook: null,
  currentRendition: null,
  currentBookId: null,
  currentOnStatsUpdate: null,

  // Language switch guard — epub-reader.js
  languageVersion: 0,

  // Book scan cache — epub-reader.js
  cachedBookWords: null,
  cachedBookId: null,
  cachedBookLang: null,

  // Managed lifecycle — epub-adapter.js
  eventScope: null,      // managed event listener scope for rendition
  scrollCleanup: null,   // disposer for scroll listener

  // Review mode — keyboard word navigation
  reviewMode: false,           // true when keyboard word navigation is active
  reviewFocusedWord: null,     // the currently focused .hl-word span (or null)
  reviewLastGrade: null,       // last grade applied (for Space quick-advance)
  reviewShowAll: false,        // false = skip known words, true = navigate all
  reviewPendingResume: false,  // true = re-enter review after section change

  // Popup — highlighter.js
  popupActive: false,

  // Vocab panel — vocab-browser.js
  vocab: {
    panelEl: null,
    displayWords: [],
    dbWords: [],
    bookWordSet: null,
    bookScanInProgress: false,
    activeFilter: 'all',
    inBookOnly: false,
    lastBookId: null,
    searchQuery: '',
    onStatsUpdate: null,
    iframeDocGetter: null,
    openInProgress: false,
  },
};

/** Reset all state to initial values (for tests). */
export function resetState() {
  state.currentLanguage = 'en';
  state.defLanguage = 'en';
  state.currentBook = null;
  state.currentRendition = null;
  state.currentBookId = null;
  state.currentOnStatsUpdate = null;
  state.languageVersion = 0;
  state.eventScope = null;
  state.scrollCleanup = null;
  state.cachedBookWords = null;
  state.cachedBookId = null;
  state.cachedBookLang = null;
  state.reviewMode = false;
  state.reviewFocusedWord = null;
  state.reviewLastGrade = null;
  state.reviewShowAll = false;
  state.reviewPendingResume = false;
  state.popupActive = false;
  Object.assign(state.vocab, {
    panelEl: null,
    displayWords: [],
    dbWords: [],
    bookWordSet: null,
    bookScanInProgress: false,
    activeFilter: 'all',
    inBookOnly: false,
    lastBookId: null,
    searchQuery: '',
    onStatsUpdate: null,
    iframeDocGetter: null,
    openInProgress: false,
  });
}

// Expose for dev tools debugging
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__hilightState = state;
}
