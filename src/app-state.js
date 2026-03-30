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

  // Reading preferences
  fontSize: parseInt(typeof localStorage !== 'undefined' ? localStorage.getItem('hilight-font-size') || '16' : '16', 10),

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
  reviewResumeDirection: null, // 'forward' | 'backward' — which end to start from on resume

  // Last word the user interacted with via mouse/touch (for review mode start position)
  lastInteractedWord: null,

  // Popup — highlighter.js
  popupActive: false,

  // Reference pane — side-by-side reading
  reference: {
    book: null,           // epubjs Book instance (null for PDF)
    rendition: null,      // epubjs Rendition instance (null for PDF)
    fileType: null,       // 'epub' | 'pdf' | null
    fileName: null,       // display name
    pdfUrl: null,         // blob URL for PDF iframe (revoked on destroy)
    eventScope: null,     // managed event listeners
    scrollCleanup: null,  // scroll listener disposer
  },
  refPaneOpen: false,
  refSplitRatio: parseFloat(typeof localStorage !== 'undefined' ? localStorage.getItem('hilight-ref-split') || '0.5' : '0.5'),

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
    lemmaMap: null,              // Map<word, lemma|null> from cache
    lemmaFetchController: null,  // AbortController for background fetch
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
  state.reviewResumeDirection = null;
  state.lastInteractedWord = null;
  state.popupActive = false;
  Object.assign(state.reference, {
    book: null, rendition: null, fileType: null, fileName: null,
    pdfUrl: null, eventScope: null, scrollCleanup: null,
  });
  state.refPaneOpen = false;
  state.refSplitRatio = 0.5;
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
    lemmaMap: null,
    lemmaFetchController: null,
  });
}

// Expose for dev tools debugging
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__hilightState = state;
}
