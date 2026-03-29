/**
 * Reference Reader: loads a second EPUB or PDF file for side-by-side reading.
 *
 * This is a read-only viewer with NO vocab, highlighting, or review features.
 * It exists purely as a reference companion to the main vocab reader.
 *
 * EPUB files are rendered via epubjs with dark-mode styling.
 * PDF files are rendered in a browser-native iframe.
 */
import ePub from 'epubjs';
import { state } from './app-state.js';
import { createEventScope, addManagedScrollListener } from './epub-adapter.js';

/** Clean up the current reference file. */
export function destroyReference() {
  const ref = state.reference;
  if (ref.scrollCleanup) {
    ref.scrollCleanup();
    ref.scrollCleanup = null;
  }
  if (ref.rendition) {
    if (ref.eventScope) {
      ref.eventScope.dispose();
      ref.eventScope = null;
    }
    ref.rendition.destroy();
    ref.rendition = null;
  }
  if (ref.book) {
    ref.book.destroy();
    ref.book = null;
  }
  if (ref.pdfUrl) {
    URL.revokeObjectURL(ref.pdfUrl);
    ref.pdfUrl = null;
  }
  ref.fileType = null;
  ref.fileName = null;
}

/**
 * Load a reference file (EPUB or PDF) into the viewer container.
 * @param {File} file - the file to load
 * @param {HTMLElement} viewerEl - container element
 */
export async function loadReference(file, viewerEl) {
  destroyReference();
  viewerEl.innerHTML = '';

  const ext = file.name.split('.').pop().toLowerCase();
  state.reference.fileName = file.name;

  if (ext === 'pdf') {
    await loadReferencePdf(file, viewerEl);
  } else {
    await loadReferenceEpub(file, viewerEl);
  }
}

async function loadReferencePdf(file, viewerEl) {
  state.reference.fileType = 'pdf';
  const url = URL.createObjectURL(file);
  state.reference.pdfUrl = url;

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  viewerEl.appendChild(iframe);
}

async function loadReferenceEpub(file, viewerEl) {
  state.reference.fileType = 'epub';
  const data = await file.arrayBuffer();
  const book = ePub(data);
  state.reference.book = book;

  await book.ready;

  const rendition = book.renderTo(viewerEl, {
    width: '100%',
    height: '100%',
    spread: 'none',
    flow: 'scrolled-doc',
    allowScriptedContent: true,
  });

  state.reference.rendition = rendition;

  // Inject dark-mode styles (read-only, no word highlighting)
  rendition.hooks.content.register((contents) => {
    const doc = contents.document;
    const style = doc.createElement('style');
    style.textContent = `
      *, *::before, *::after {
        background-color: transparent !important;
        border-color: #2a2a3a !important;
      }
      html {
        font-size: 16px !important;
      }
      html, body {
        background: #12121a !important;
        background-color: #12121a !important;
        font-size: 16px !important;
        line-height: 1.6 !important;
      }
      body {
        -webkit-user-select: text;
        user-select: text;
        padding-top: 16px !important;
        padding-bottom: 16px !important;
      }
      body, body * {
        color: #e0dfe6 !important;
      }
      a, a:link, a:visited, a:active {
        color: #a78bfa !important;
        text-decoration: underline;
      }
      img, svg, video, canvas {
        max-width: 100%;
        background-color: transparent !important;
      }
    `;
    doc.head.appendChild(style);
  });

  await rendition.display();

  // Chapter navigation banners for the reference pane
  const container = rendition.manager?.container;
  if (container) {
    container.style.webkitOverflowScrolling = 'touch';
    setupRefBanners(container, viewerEl);
  }
}

function setupRefBanners(container, viewerEl) {
  viewerEl.style.position = 'relative';

  let endBanner = viewerEl.querySelector('.ref-end-banner');
  if (!endBanner) {
    endBanner = document.createElement('div');
    endBanner.className = 'hl-end-banner ref-end-banner';
    endBanner.innerHTML = 'Next chapter &#8594;';
    endBanner.addEventListener('click', () => {
      if (state.reference.rendition) state.reference.rendition.next();
    });
    viewerEl.appendChild(endBanner);
  }

  let startBanner = viewerEl.querySelector('.ref-start-banner');
  if (!startBanner) {
    startBanner = document.createElement('div');
    startBanner.className = 'hl-start-banner ref-start-banner';
    startBanner.innerHTML = '&#8592; Previous chapter';
    startBanner.addEventListener('click', () => {
      if (state.reference.rendition) state.reference.rendition.prev();
    });
    viewerEl.appendChild(startBanner);
  }

  container.style.paddingTop = '36px';
  container.style.paddingBottom = '36px';

  const onScroll = () => {
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
    endBanner.classList.toggle('visible', atBottom);
    const atTop = container.scrollTop <= 5;
    startBanner.classList.toggle('visible', atTop);
  };
  state.reference.scrollCleanup = addManagedScrollListener(container, onScroll);
  onScroll();
}

/** Navigate reference EPUB to next page. */
export function refNextPage() {
  if (!state.reference.rendition) return;
  const container = state.reference.rendition.manager?.container;
  if (container) {
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
    if (!atBottom) {
      container.scrollBy({ top: container.clientHeight - 40, behavior: 'smooth' });
      return;
    }
  }
  state.reference.rendition.next();
}

/** Navigate reference EPUB to previous page. */
export function refPrevPage() {
  if (!state.reference.rendition) return;
  const container = state.reference.rendition.manager?.container;
  if (container) {
    if (container.scrollTop > 5) {
      container.scrollBy({ top: -(container.clientHeight - 40), behavior: 'smooth' });
      return;
    }
  }
  state.reference.rendition.prev();
}

/** Whether a reference file is currently loaded. */
export function isReferenceLoaded() {
  return state.reference.fileType !== null;
}
