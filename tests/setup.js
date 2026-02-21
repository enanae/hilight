/**
 * Global test setup.
 * Provides fake IndexedDB and CSS.escape polyfill for jsdom.
 */
import 'fake-indexeddb/auto';

// jsdom doesn't implement CSS.escape — polyfill it for tests
if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = {};
}
if (typeof globalThis.CSS.escape !== 'function') {
  globalThis.CSS.escape = (str) =>
    String(str).replace(/([^\w-])/g, '\\$1');
}
