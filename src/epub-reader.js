/**
 * Epub reader: loads an epub file and renders it into a container,
 * then hands off to the highlighter for word processing.
 *
 * Event handling uses epubjs's rendition event passthrough system.
 * This avoids cross-iframe touch event issues — epubjs already listens
 * for DOM events inside the iframe and re-emits them on the rendition.
 */
import ePub from 'epubjs';
import { highlightContainer, handleWordTap, showWordDefinition, popupActive, resetPopupState } from './highlighter.js';

let currentBook = null;
let currentRendition = null;
let currentLanguage = null;
let currentOnStatsUpdate = null;

/** Clean up the current book and rendition. */
export function destroyEpub() {
  resetPopupState();
  if (currentRendition) {
    // Remove all event emitter listeners we registered
    currentRendition.off('touchstart');
    currentRendition.off('touchmove');
    currentRendition.off('touchend');
    currentRendition.off('click');
    currentRendition.off('dblclick');
    currentRendition.destroy();
    currentRendition = null;
  }
  if (currentBook) {
    currentBook.destroy();
    currentBook = null;
  }
}

/**
 * Load and display an epub file.
 * @param {File|ArrayBuffer} source - epub file or array buffer
 * @param {HTMLElement} viewerEl - container element for the reader
 * @param {string} language - language code for vocab tracking
 * @param {object} options - { onStatsUpdate, onChapterChange, onBookLoaded }
 */
export async function loadEpub(source, viewerEl, language, options = {}) {
  // Clean up previous book
  destroyEpub();

  viewerEl.innerHTML = '';

  const data = source instanceof File ? await source.arrayBuffer() : source;
  const book = ePub(data);
  currentBook = book;

  await book.ready;

  if (options.onBookLoaded) {
    const meta = book.packaging.metadata;
    options.onBookLoaded({
      title: meta.title || 'Untitled',
      creator: meta.creator || '',
    });
  }

  const rendition = book.renderTo(viewerEl, {
    width: '100%',
    height: '100%',
    spread: 'none',
    flow: 'scrolled-doc',
    // allow-scripts in sandbox — required for touch events on mobile.
    // Without this, the iframe sandbox="allow-same-origin" blocks
    // touch event delivery on iOS/Android.
    allowScriptedContent: true,
  });

  currentRendition = rendition;
  currentLanguage = language;
  currentOnStatsUpdate = options.onStatsUpdate || null;

  // After each section renders, highlight words and fix iframe for touch.
  // Uses currentLanguage (mutable) so language changes take effect immediately.
  rendition.hooks.content.register(async (contents) => {
    const doc = contents.document;

    // If a popup was showing in the old section, reset the flag
    resetPopupState();

    injectStyles(doc);

    // Fix iframe element from parent context
    const iframe = viewerEl.querySelector('iframe');
    if (iframe) {
      iframe.style.touchAction = 'manipulation';
    }

    await highlightContainer(doc.body, currentLanguage, { onStatsUpdate: currentOnStatsUpdate });
  });

  // Word tap handling via epubjs's event passthrough system.
  setupWordTapHandler(rendition, currentOnStatsUpdate);

  await rendition.display();

  return { book, rendition };
}

/**
 * Set up word interaction through the rendition event system.
 *
 * Short tap: cycle knowledge state (unknown → learning → known → ...)
 * Long press (500ms): show dictionary definition
 *
 * On desktop, click = short tap, right-click or ctrl+click could be
 * used for definition, but we keep it simple: click cycles, and the
 * long-press logic handles touch.
 */
function setupWordTapHandler(rendition, onStatsUpdate) {
  let touchStartX = 0;
  let touchStartY = 0;
  let longPressTimer = null;
  let longPressFired = false;
  let lastActionTime = 0;
  let hadTouchRecently = false; // suppress synthetic click after touch
  const TAP_THRESHOLD = 10;
  const LONG_PRESS_MS = 500;
  const DEBOUNCE_MS = 300;

  rendition.on('touchstart', (e) => {
    // Don't start new interactions while popup is showing
    if (popupActive) return;
    if (!e.touches || !e.touches[0]) return;
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    longPressFired = false;
    hadTouchRecently = true;

    // Start long-press timer
    const span = findWordSpan(e.target);
    if (span) {
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        showWordDefinition(span);
      }, LONG_PRESS_MS);
    }
  });

  // Cancel long press if finger moves (scrolling)
  rendition.on('touchmove', (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    const t = e.changedTouches[0];
    const dx = Math.abs(t.clientX - touchStartX);
    const dy = Math.abs(t.clientY - touchStartY);
    if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) {
      clearTimeout(longPressTimer);
    }
  });

  rendition.on('touchend', (e) => {
    clearTimeout(longPressTimer);
    if (popupActive || longPressFired) return;

    if (!e.changedTouches || !e.changedTouches[0]) return;
    const span = findWordSpan(e.target);
    if (!span) return;

    const t = e.changedTouches[0];
    const dx = Math.abs(t.clientX - touchStartX);
    const dy = Math.abs(t.clientY - touchStartY);

    // Short tap: cycle state
    if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) {
      const now = Date.now();
      if (now - lastActionTime < DEBOUNCE_MS) return;
      lastActionTime = now;
      handleWordTap(span, onStatsUpdate);
    }
  });

  // Desktop only: click cycles state, dblclick shows definition.
  // On touch devices the browser fires a synthetic click after touchend —
  // skip it by checking hadTouchRecently.
  rendition.on('click', (e) => {
    if (hadTouchRecently) {
      hadTouchRecently = false;
      return;
    }
    if (popupActive) return;
    const span = findWordSpan(e.target);
    if (!span) return;

    const now = Date.now();
    if (now - lastActionTime < DEBOUNCE_MS) return;
    lastActionTime = now;
    handleWordTap(span, onStatsUpdate);
  });

  rendition.on('dblclick', (e) => {
    if (popupActive) return;
    const span = findWordSpan(e.target);
    if (!span) return;
    showWordDefinition(span);
  });
}

/**
 * Walk up from event target to find a .hl-word span.
 * e.target may be a text node on some browsers, so handle that.
 */
function findWordSpan(target) {
  if (!target) return null;
  // Text nodes don't have closest(), walk to parent element
  const el = target.nodeType === 3 ? target.parentElement : target;
  return el?.closest?.('.hl-word') || null;
}

/**
 * Navigate to the next "page" of content.
 * In scrolled-doc mode, rendition.next() jumps whole sections. Instead,
 * scroll the container by one viewport height and only advance to the
 * next section when scrolled to the bottom.
 */
export function nextPage() {
  if (!currentRendition) return;
  const container = getScrollContainer();
  if (container) {
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
    if (!atBottom) {
      container.scrollBy({ top: container.clientHeight - 40, behavior: 'smooth' });
      return;
    }
  }
  return currentRendition.next();
}

/** Navigate to previous page/section. Scrolls up first, then prev section. */
export function prevPage() {
  if (!currentRendition) return;
  const container = getScrollContainer();
  if (container) {
    if (container.scrollTop > 2) {
      container.scrollBy({ top: -(container.clientHeight - 40), behavior: 'smooth' });
      return;
    }
  }
  return currentRendition.prev();
}

/** Find the epubjs scrollable container div. */
function getScrollContainer() {
  if (!currentRendition?.manager?.container) return null;
  return currentRendition.manager.container;
}

/** Get table of contents. */
export async function getToc() {
  if (!currentBook) return [];
  const nav = await currentBook.loaded.navigation;
  return nav.toc || [];
}

/**
 * Navigate to a specific TOC item.
 * epub.js's spine.get() often fails because TOC hrefs have different path
 * prefixes than spine hrefs (e.g. "OEBPS/Text/ch1.xhtml" vs "Text/ch1.xhtml").
 * We try multiple strategies to resolve the href.
 */
export function goToHref(href) {
  if (!currentRendition || !currentBook) return;

  // Strategy 1: try the href as-is (may work for well-formed epubs)
  const hrefBase = href.split('#')[0];
  const fragment = href.includes('#') ? '#' + href.split('#')[1] : '';
  const spine = currentBook.spine;

  // Direct lookup
  let section = spine.get(hrefBase);

  // Strategy 2: try basename match (strip path prefixes)
  if (!section) {
    const basename = hrefBase.split('/').pop();
    section = spine.items.find(item => {
      const itemBasename = (item.href || '').split('/').pop();
      return itemBasename === basename;
    });
  }

  // Strategy 3: try URL-decoded match
  if (!section) {
    try {
      const decoded = decodeURIComponent(hrefBase);
      section = spine.get(decoded);
    } catch { /* ignore */ }
  }

  // Strategy 4: partial suffix match
  if (!section) {
    section = spine.items.find(item =>
      item.href && (item.href.endsWith(hrefBase) || hrefBase.endsWith(item.href))
    );
  }

  if (section) {
    return currentRendition.display(section.href + fragment);
  }
  // Last resort: pass through and let epub.js try
  return currentRendition.display(href);
}

/**
 * Update the active language and re-highlight the current content.
 * Called when user changes the language selector while a book is open.
 */
export async function setLanguage(language) {
  currentLanguage = language;
  const doc = getIframeDocument();
  if (doc && doc.body) {
    await highlightContainer(doc.body, currentLanguage, { onStatsUpdate: currentOnStatsUpdate });
  }
}

/** Get the active iframe document (for querying highlighted words). */
export function getIframeDocument() {
  if (!currentRendition?.manager) return null;
  const views = currentRendition.manager.views;
  if (views && views._views && views._views.length > 0) {
    const view = views._views[views._views.length - 1];
    return view?.document || null;
  }
  return null;
}

/** Inject highlight CSS into the epub's iframe document. */
function injectStyles(doc) {
  const style = doc.createElement('style');
  style.textContent = `
    body {
      background: #12121a !important;
      color: #e0dfe6 !important;
      touch-action: manipulation;
      -webkit-tap-highlight-color: rgba(168, 85, 247, 0.2);
      -webkit-user-select: none;
      user-select: none;
      /* Prevent iframe body from creating a competing scroll context —
         the epubjs container div handles scrolling in scrolled-doc mode. */
      overflow: hidden !important;
    }
    /* Force all text to light color on dark background.
       Scoped to common text elements to avoid clobbering SVGs / code blocks. */
    p, span, div, li, td, th, dt, dd, blockquote, figcaption,
    h1, h2, h3, h4, h5, h6 {
      color: inherit !important;
    }
    a, a:link, a:visited, a:active {
      color: #a78bfa !important;
      text-decoration: underline;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #e0dfe6 !important;
    }
    img {
      max-width: 100%;
    }
    .hl-word {
      cursor: pointer;
      border-radius: 2px;
      transition: background-color 0.15s ease;
      padding: 1px 2px;
    }
    .hl-word.hl-unknown {
      background-color: rgba(192, 132, 252, 0.18);
      border-bottom: 2px solid rgba(192, 132, 252, 0.6);
      color: #e0dfe6 !important;
    }
    .hl-word.hl-partial {
      background-color: rgba(96, 165, 250, 0.15);
      border-bottom: 2px solid rgba(96, 165, 250, 0.5);
      color: #e0dfe6 !important;
    }
    .hl-word.hl-known {
      background-color: transparent;
      border-bottom: none;
      color: #e0dfe6 !important;
    }
    .hl-word:hover {
      filter: brightness(1.2);
    }
    .hl-word:active {
      transform: scale(0.97);
    }
    .hl-popup {
      position: fixed;
      z-index: 10000;
      background: #1a1a26;
      border: 1px solid #2a2a3a;
      border-radius: 8px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(168,85,247,0.1);
      padding: 12px 16px;
      max-width: 340px;
      min-width: 200px;
      font-size: 14px;
      line-height: 1.5;
      font-family: system-ui, sans-serif;
      color: #e0dfe6;
    }
    .hl-popup-word {
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 6px;
      color: #a855f7;
    }
    .hl-popup-phonetic {
      font-weight: 400;
      color: #6b6a7a;
      font-size: 13px;
    }
    .hl-popup-defs {
      margin: 0;
      padding-left: 18px;
    }
    .hl-popup-defs li {
      margin-bottom: 4px;
    }
    .hl-popup-defs em {
      color: #6b6a7a;
      font-style: italic;
    }
    .hl-popup-loading, .hl-popup-empty {
      color: #6b6a7a;
      font-style: italic;
    }
  `;
  doc.head.appendChild(style);
}
