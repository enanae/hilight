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
    .hl-word {
      cursor: pointer;
      border-radius: 2px;
      transition: background-color 0.15s ease;
      padding: 0 1px;
    }
    .hl-unknown {
      background-color: rgba(255, 200, 50, 0.35);
      border-bottom: 2px solid rgba(255, 160, 0, 0.6);
    }
    .hl-partial {
      background-color: rgba(100, 180, 255, 0.3);
      border-bottom: 2px solid rgba(60, 130, 220, 0.5);
    }
    .hl-known {
      background-color: transparent;
      border-bottom: none;
    }
    .hl-word:hover {
      filter: brightness(0.9);
    }
    .hl-popup {
      position: fixed;
      z-index: 10000;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      padding: 12px 16px;
      max-width: 340px;
      min-width: 200px;
      font-size: 14px;
      line-height: 1.5;
      font-family: system-ui, sans-serif;
      color: #222;
    }
    .hl-popup-word {
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 6px;
    }
    .hl-popup-phonetic {
      font-weight: 400;
      color: #666;
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
      color: #888;
      font-style: italic;
    }
    .hl-popup-loading, .hl-popup-empty {
      color: #888;
      font-style: italic;
    }
  `;
  doc.head.appendChild(style);
}
