/**
 * epubjs Adapter Layer
 *
 * Isolates all direct epubjs interaction behind a clean interface.
 * The rest of the app imports from here instead of using epubjs internals.
 *
 * This prevents an entire class of bugs:
 * - section.load() returns xml.documentElement (Element), not a Document.
 *   loadSectionForScan() correctly exposes both document and body.
 * - rendition.off() requires the original listener reference (event-emitter
 *   library throws TypeError via valid-callable.js if it's missing).
 *   createEventScope() stores references and disposes them properly.
 * - Scroll listeners on the epubjs container accumulate across book loads.
 *   addManagedScrollListener() returns a disposer.
 * - Accessing rendition.manager.views._views is undocumented internal API.
 *   getActiveDocument() centralizes this access.
 */

/**
 * Load a spine section for scanning (word extraction).
 *
 * epubjs's section.load() resolves with xml.documentElement (an Element),
 * NOT the Document. The actual Document is stored on section.document
 * after load completes. This function exposes both correctly.
 *
 * @param {object} book - epubjs Book instance
 * @param {number} sectionIndex - spine item index
 * @returns {Promise<{document: Document, body: Element, unload: Function}>}
 */
export async function loadSectionForScan(book, sectionIndex) {
  const section = book.spine.get(sectionIndex);
  const contents = await section.load(book.load.bind(book));

  // section.document is the actual XML Document (has .createTreeWalker)
  // contents is xml.documentElement (the root <html> Element)
  const doc = section.document;
  const body = doc?.body || doc?.documentElement || contents;

  return {
    document: doc,
    body,
    unload: () => section.unload(),
  };
}

/**
 * Create a managed event scope for a rendition.
 *
 * epubjs uses the event-emitter library which requires the original listener
 * reference for .off(). This scope stores all registered handlers and
 * disposes them cleanly.
 *
 * @param {object} rendition - epubjs Rendition instance
 * @returns {{on: Function, dispose: Function}}
 */
export function createEventScope(rendition) {
  const handlers = [];

  return {
    on(event, handler) {
      rendition.on(event, handler);
      handlers.push({ event, handler });
    },
    dispose() {
      for (const { event, handler } of handlers) {
        try {
          rendition.off(event, handler);
        } catch (_) {
          // Rendition may already be partially destroyed
        }
      }
      handlers.length = 0;
    },
  };
}

/**
 * Add a scroll listener that can be cleanly removed.
 *
 * @param {HTMLElement} container - scroll container
 * @param {Function} handler - scroll handler
 * @returns {Function} disposer that removes the listener
 */
export function addManagedScrollListener(container, handler) {
  container.addEventListener('scroll', handler, { passive: true });
  return () => container.removeEventListener('scroll', handler);
}

/**
 * Get the active iframe document from a rendition.
 *
 * Centralizes access to the undocumented rendition.manager.views._views
 * internal. Returns the document of the last (most recent) view.
 *
 * @param {object} rendition - epubjs Rendition instance
 * @returns {Document|null}
 */
export function getActiveDocument(rendition) {
  if (!rendition?.manager) return null;
  const views = rendition.manager.views;
  if (views && views._views && views._views.length > 0) {
    const view = views._views[views._views.length - 1];
    return view?.document || null;
  }
  return null;
}
