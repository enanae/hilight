/**
 * Contract tests for the epub adapter layer.
 *
 * These tests verify the adapter against REAL library behavior (event-emitter)
 * rather than mocks, ensuring the API contract is correct. This is the key
 * difference from the rest of the test suite — these catch the exact class
 * of bugs that mocked tests miss.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventScope, addManagedScrollListener, getActiveDocument, loadSectionForScan } from '../src/epub-adapter.js';

// ── Real event-emitter tests ──────────────────────────────────────────

// Import the REAL event-emitter library (same one epubjs uses)
// to verify our adapter's dispose() calls .off() correctly.
import EventEmitter from 'event-emitter';

describe('createEventScope (real event-emitter)', () => {
  it('registers handlers via .on() that receive events', () => {
    const emitter = EventEmitter({});
    const scope = createEventScope(emitter);
    const handler = vi.fn();

    scope.on('test', handler);
    emitter.emit('test', 'data');

    expect(handler).toHaveBeenCalledWith('data');
  });

  it('dispose() removes all handlers without throwing', () => {
    const emitter = EventEmitter({});
    const scope = createEventScope(emitter);
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    scope.on('touchstart', handler1);
    scope.on('click', handler2);

    // This is the critical test — the old code called .off('touchstart')
    // without a handler, which threw TypeError from valid-callable.js
    expect(() => scope.dispose()).not.toThrow();

    // Events should no longer fire after dispose
    emitter.emit('touchstart', {});
    emitter.emit('click', {});
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('dispose() is safe to call multiple times', () => {
    const emitter = EventEmitter({});
    const scope = createEventScope(emitter);
    scope.on('test', vi.fn());

    expect(() => {
      scope.dispose();
      scope.dispose();
    }).not.toThrow();
  });

  it('dispose() handles already-destroyed emitters gracefully', () => {
    const emitter = EventEmitter({});
    const scope = createEventScope(emitter);
    scope.on('test', vi.fn());

    // Simulate partial destruction (epubjs may clear internal state)
    delete emitter.__ee__;

    expect(() => scope.dispose()).not.toThrow();
  });
});

// ── addManagedScrollListener ──────────────────────────────────────────

describe('addManagedScrollListener', () => {
  it('adds a scroll listener and returns a disposer', () => {
    const container = document.createElement('div');
    const handler = vi.fn();

    const dispose = addManagedScrollListener(container, handler);

    // Simulate scroll
    container.dispatchEvent(new Event('scroll'));
    expect(handler).toHaveBeenCalledTimes(1);

    // Dispose should remove the listener
    dispose();
    container.dispatchEvent(new Event('scroll'));
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });
});

// ── getActiveDocument ─────────────────────────────────────────────────

describe('getActiveDocument', () => {
  it('returns null for null/undefined rendition', () => {
    expect(getActiveDocument(null)).toBeNull();
    expect(getActiveDocument(undefined)).toBeNull();
  });

  it('returns null when no manager', () => {
    expect(getActiveDocument({})).toBeNull();
    expect(getActiveDocument({ manager: null })).toBeNull();
  });

  it('returns null when views is empty', () => {
    const rendition = { manager: { views: { _views: [] } } };
    expect(getActiveDocument(rendition)).toBeNull();
  });

  it('returns the document of the last view', () => {
    const doc = document.implementation.createHTMLDocument('test');
    const rendition = {
      manager: {
        views: { _views: [{ document: doc }] },
      },
    };
    expect(getActiveDocument(rendition)).toBe(doc);
  });

  it('returns last view when multiple views exist', () => {
    const doc1 = document.implementation.createHTMLDocument('first');
    const doc2 = document.implementation.createHTMLDocument('second');
    const rendition = {
      manager: {
        views: { _views: [{ document: doc1 }, { document: doc2 }] },
      },
    };
    expect(getActiveDocument(rendition)).toBe(doc2);
  });
});

// ── loadSectionForScan ────────────────────────────────────────────────

describe('loadSectionForScan', () => {
  it('returns document and body from section after load', async () => {
    // Simulate what real epubjs does: section.load() stores xml.documentElement
    // as contents, and xml as section.document
    const xmlDoc = document.implementation.createHTMLDocument('test');
    xmlDoc.body.innerHTML = '<p>Hello world</p>';

    const mockSection = {
      load: vi.fn(async () => {
        // Real section.load() stores the document internally
        mockSection.document = xmlDoc;
        return xmlDoc.documentElement; // returns <html> element, NOT Document
      }),
      unload: vi.fn(),
    };

    const mockBook = {
      spine: {
        get: vi.fn(() => mockSection),
      },
      load: vi.fn(),
    };

    const result = await loadSectionForScan(mockBook, 0);

    // document should be the actual Document (has .createTreeWalker)
    expect(result.document).toBe(xmlDoc);
    expect(typeof result.document.createTreeWalker).toBe('function');

    // body should be the body element
    expect(result.body).toBe(xmlDoc.body);
    expect(result.body.textContent).toContain('Hello world');

    // unload should work
    result.unload();
    expect(mockSection.unload).toHaveBeenCalled();
  });

  it('falls back to documentElement when body is null', async () => {
    // XML documents may not have .body
    const xmlDoc = document.implementation.createDocument(null, 'root');
    const root = xmlDoc.documentElement;
    root.appendChild(xmlDoc.createTextNode('some text'));

    const mockSection = {
      load: vi.fn(async () => {
        mockSection.document = xmlDoc;
        return root;
      }),
      unload: vi.fn(),
    };

    const mockBook = {
      spine: { get: vi.fn(() => mockSection) },
      load: vi.fn(),
    };

    const result = await loadSectionForScan(mockBook, 0);

    // body should fall back to documentElement
    expect(result.body).toBe(root);
  });

  it('falls back to contents when document is undefined', async () => {
    // Edge case: section.document is not set after load
    const fakeElement = document.createElement('div');
    fakeElement.innerHTML = '<p>content</p>';

    const mockSection = {
      load: vi.fn(async () => {
        // Don't set mockSection.document (simulates unexpected behavior)
        return fakeElement;
      }),
      unload: vi.fn(),
    };

    const mockBook = {
      spine: { get: vi.fn(() => mockSection) },
      load: vi.fn(),
    };

    const result = await loadSectionForScan(mockBook, 0);

    // Should fall back to contents (the returned element)
    expect(result.body).toBe(fakeElement);
  });
});
