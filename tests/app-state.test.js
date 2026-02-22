/**
 * Domain: Centralized App State
 *
 * Tests that the state object has correct initial values and that
 * resetState() properly restores all fields to their defaults.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { state, resetState } from '../src/app-state.js';

beforeEach(() => {
  resetState();
});

describe('initial state', () => {
  it('has default language set to en', () => {
    expect(state.currentLanguage).toBe('en');
    expect(state.defLanguage).toBe('en');
  });

  it('has null book lifecycle fields', () => {
    expect(state.currentBook).toBeNull();
    expect(state.currentRendition).toBeNull();
    expect(state.currentBookId).toBeNull();
    expect(state.currentOnStatsUpdate).toBeNull();
  });

  it('has zero languageVersion', () => {
    expect(state.languageVersion).toBe(0);
  });

  it('has null cache fields', () => {
    expect(state.cachedBookWords).toBeNull();
    expect(state.cachedBookId).toBeNull();
    expect(state.cachedBookLang).toBeNull();
  });

  it('has popupActive set to false', () => {
    expect(state.popupActive).toBe(false);
  });

  it('has empty vocab sub-state', () => {
    expect(state.vocab.panelEl).toBeNull();
    expect(state.vocab.displayWords).toEqual([]);
    expect(state.vocab.dbWords).toEqual([]);
    expect(state.vocab.bookWordSet).toBeNull();
    expect(state.vocab.bookScanInProgress).toBe(false);
    expect(state.vocab.activeFilter).toBe('all');
    expect(state.vocab.inBookOnly).toBe(false);
    expect(state.vocab.lastBookId).toBeNull();
    expect(state.vocab.searchQuery).toBe('');
    expect(state.vocab.onStatsUpdate).toBeNull();
    expect(state.vocab.iframeDocGetter).toBeNull();
    expect(state.vocab.openInProgress).toBe(false);
  });
});

describe('resetState', () => {
  it('restores all fields after mutation', () => {
    // Mutate everything
    state.currentLanguage = 'fr';
    state.defLanguage = 'de';
    state.currentBook = { fake: true };
    state.currentRendition = { fake: true };
    state.currentBookId = 'book-123';
    state.currentOnStatsUpdate = () => {};
    state.languageVersion = 42;
    state.cachedBookWords = new Set(['word']);
    state.cachedBookId = 'cached-id';
    state.cachedBookLang = 'es';
    state.popupActive = true;
    state.vocab.panelEl = document.createElement('div');
    state.vocab.displayWords = [{ word: 'test', level: 1 }];
    state.vocab.dbWords = [{ word: 'test', level: 1 }];
    state.vocab.bookWordSet = new Set(['test']);
    state.vocab.bookScanInProgress = true;
    state.vocab.activeFilter = 2;
    state.vocab.inBookOnly = true;
    state.vocab.lastBookId = 'last-book';
    state.vocab.searchQuery = 'hello';
    state.vocab.onStatsUpdate = () => {};
    state.vocab.iframeDocGetter = () => null;
    state.vocab.openInProgress = true;

    resetState();

    // Verify all restored
    expect(state.currentLanguage).toBe('en');
    expect(state.defLanguage).toBe('en');
    expect(state.currentBook).toBeNull();
    expect(state.currentRendition).toBeNull();
    expect(state.currentBookId).toBeNull();
    expect(state.currentOnStatsUpdate).toBeNull();
    expect(state.languageVersion).toBe(0);
    expect(state.cachedBookWords).toBeNull();
    expect(state.cachedBookId).toBeNull();
    expect(state.cachedBookLang).toBeNull();
    expect(state.popupActive).toBe(false);
    expect(state.vocab.panelEl).toBeNull();
    expect(state.vocab.displayWords).toEqual([]);
    expect(state.vocab.dbWords).toEqual([]);
    expect(state.vocab.bookWordSet).toBeNull();
    expect(state.vocab.bookScanInProgress).toBe(false);
    expect(state.vocab.activeFilter).toBe('all');
    expect(state.vocab.inBookOnly).toBe(false);
    expect(state.vocab.lastBookId).toBeNull();
    expect(state.vocab.searchQuery).toBe('');
    expect(state.vocab.onStatsUpdate).toBeNull();
    expect(state.vocab.iframeDocGetter).toBeNull();
    expect(state.vocab.openInProgress).toBe(false);
  });
});
