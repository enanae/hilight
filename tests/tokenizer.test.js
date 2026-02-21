/**
 * Domain: Language Processing
 * Subdomain: Tokenization, Normalization, Locale Mapping
 */
import { describe, it, expect } from 'vitest';
import { tokenize, normalizeWord, langToLocale } from '../src/tokenizer.js';

// ── Subdomain: tokenize() ────────────────────────────────────────────

describe('tokenize', () => {
  describe('basic word splitting', () => {
    it('splits simple English text into words and non-words', () => {
      const segs = tokenize('hello world', 'en');
      const words = segs.filter(s => s.isWord);
      const nonWords = segs.filter(s => !s.isWord);
      expect(words.map(s => s.text)).toEqual(['hello', 'world']);
      expect(nonWords.length).toBeGreaterThan(0);
    });

    it('handles punctuation as non-word segments', () => {
      const segs = tokenize('hello, world!', 'en');
      const words = segs.filter(s => s.isWord).map(s => s.text);
      expect(words).toEqual(['hello', 'world']);
    });

    it('returns empty array for empty string', () => {
      const segs = tokenize('', 'en');
      expect(segs).toEqual([]);
    });

    it('handles whitespace-only text', () => {
      const segs = tokenize('   ', 'en');
      const words = segs.filter(s => s.isWord);
      expect(words).toEqual([]);
    });
  });

  describe('multi-language support', () => {
    it('tokenizes French text with accented characters', () => {
      const segs = tokenize('café résumé', 'fr');
      const words = segs.filter(s => s.isWord).map(s => s.text);
      expect(words).toEqual(['café', 'résumé']);
    });

    it('tokenizes German text with umlauts', () => {
      const segs = tokenize('über Straße', 'de');
      const words = segs.filter(s => s.isWord).map(s => s.text);
      expect(words).toEqual(['über', 'Straße']);
    });

    it('tokenizes text with numbers', () => {
      const segs = tokenize('test123 abc', 'en');
      const words = segs.filter(s => s.isWord).map(s => s.text);
      expect(words).toContain('test123');
    });
  });

  describe('reconstruction', () => {
    it('concatenated segments reproduce the original text', () => {
      const text = 'Hello, world! How are you?';
      const segs = tokenize(text, 'en');
      const reconstructed = segs.map(s => s.text).join('');
      expect(reconstructed).toBe(text);
    });

    it('preserves whitespace in reconstruction', () => {
      const text = 'word1   word2\tword3';
      const segs = tokenize(text, 'en');
      const reconstructed = segs.map(s => s.text).join('');
      expect(reconstructed).toBe(text);
    });
  });
});

// ── Subdomain: normalizeWord() ───────────────────────────────────────

describe('normalizeWord', () => {
  describe('lowercasing', () => {
    it('lowercases ASCII text', () => {
      expect(normalizeWord('Hello', 'en')).toBe('hello');
    });

    it('lowercases accented characters', () => {
      expect(normalizeWord('Café', 'fr')).toBe('café');
    });

    it('handles already-lowercase text', () => {
      expect(normalizeWord('hello', 'en')).toBe('hello');
    });
  });

  describe('NFC normalization', () => {
    it('normalizes decomposed unicode to composed form', () => {
      // e + combining acute accent → é
      const decomposed = 'e\u0301';
      const result = normalizeWord(decomposed, 'fr');
      expect(result).toBe('é');
    });
  });

  describe('trimming', () => {
    it('trims whitespace', () => {
      expect(normalizeWord('  hello  ', 'en')).toBe('hello');
    });
  });

  describe('locale-aware behavior', () => {
    it('falls back to generic lowercase without locale', () => {
      expect(normalizeWord('HELLO', null)).toBe('hello');
    });
  });
});

// ── Subdomain: langToLocale() ────────────────────────────────────────

describe('langToLocale', () => {
  it('maps known language codes to locale strings', () => {
    expect(langToLocale('en')).toBe('en');
    expect(langToLocale('es')).toBe('es');
    expect(langToLocale('fr')).toBe('fr');
    expect(langToLocale('de')).toBe('de');
    expect(langToLocale('ja')).toBe('ja');
    expect(langToLocale('zh')).toBe('zh');
    expect(langToLocale('ko')).toBe('ko');
    expect(langToLocale('ar')).toBe('ar');
  });

  it('passes through unknown language codes unchanged', () => {
    expect(langToLocale('xx')).toBe('xx');
    expect(langToLocale('tlh')).toBe('tlh');
  });
});
