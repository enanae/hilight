/**
 * Epub reader: loads an epub file and renders it into a container,
 * then hands off to the highlighter for word processing.
 */
import ePub from 'epubjs';
import { highlightContainer } from './highlighter.js';

let currentBook = null;
let currentRendition = null;

/**
 * Load and display an epub file.
 * @param {File|ArrayBuffer} source - epub file or array buffer
 * @param {HTMLElement} viewerEl - container element for the reader
 * @param {string} language - language code for vocab tracking
 * @param {object} options - { onStatsUpdate, onChapterChange, onBookLoaded }
 */
export async function loadEpub(source, viewerEl, language, options = {}) {
  // Clean up previous book
  if (currentRendition) {
    currentRendition.destroy();
    currentRendition = null;
  }
  if (currentBook) {
    currentBook.destroy();
    currentBook = null;
  }

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
  });

  currentRendition = rendition;

  // After each section renders, highlight words
  rendition.hooks.content.register(async (contents) => {
    const doc = contents.document;
    const body = doc.body;

    // Inject highlight styles into the epub iframe
    injectStyles(doc);

    await highlightContainer(body, language, { onStatsUpdate: options.onStatsUpdate });

    if (options.onChapterChange) {
      const loc = rendition.currentLocation();
      options.onChapterChange(loc);
    }
  });

  await rendition.display();

  return { book, rendition };
}

/** Navigate to next page/section. */
export function nextPage() {
  if (currentRendition) return currentRendition.next();
}

/** Navigate to previous page/section. */
export function prevPage() {
  if (currentRendition) return currentRendition.prev();
}

/** Get table of contents. */
export async function getToc() {
  if (!currentBook) return [];
  const nav = await currentBook.loaded.navigation;
  return nav.toc || [];
}

/** Navigate to a specific TOC item. */
export function goToHref(href) {
  if (currentRendition) return currentRendition.display(href);
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
    }
    /* Force all text to light color on dark background */
    * {
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
