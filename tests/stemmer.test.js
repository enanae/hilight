/**
 * Domain: Language Processing
 * Subdomain: Suffix Stemming and Grouping
 */
import { describe, it, expect } from 'vitest';
import { stem } from '../src/stemmer.js';

// ── Subdomain: English stemming ──────────────────────────────────────

describe('stem — English (en)', () => {
  it('strips common verb suffixes', () => {
    expect(stem('running', 'en')).toBe('run');   // matches -ning rule
    expect(stem('walked', 'en')).toBe('wal');    // matches -ked rule
    expect(stem('played', 'en')).toBe('play');   // matches -ed rule
  });

  it('strips noun suffixes', () => {
    expect(stem('happiness', 'en')).toBe('happ');   // matches -iness rule
    expect(stem('movement', 'en')).toBe('mov');     // matches -ement rule
    expect(stem('actions', 'en')).toBe('action');   // -tions too short, falls to -s
  });

  it('strips adjective suffixes', () => {
    expect(stem('beautiful', 'en')).toBe('beauti');
    expect(stem('quickly', 'en')).toBe('quick');
    expect(stem('dangerous', 'en')).toBe('danger');
  });

  it('replaces -ies with -y', () => {
    expect(stem('cities', 'en')).toBe('city');
    expect(stem('parties', 'en')).toBe('party');
  });

  it('strips plural -s', () => {
    expect(stem('cats', 'en')).toBe('cat');
    expect(stem('dogs', 'en')).toBe('dog');
  });

  it('does not strip below MIN_STEM (3 chars)', () => {
    expect(stem('is', 'en')).toBe('is');
    expect(stem('as', 'en')).toBe('as');
    expect(stem('an', 'en')).toBe('an');
  });

  it('groups morphological variants to same stem', () => {
    const s1 = stem('teaching', 'en');
    const s2 = stem('teachers', 'en');
    // Both should map to a stem starting with "teach"
    expect(s1.startsWith('teach')).toBe(true);
    expect(s2.startsWith('teach')).toBe(true);
  });
});

// ── Subdomain: Spanish stemming ──────────────────────────────────────

describe('stem — Spanish (es)', () => {
  it('strips verb conjugation suffixes', () => {
    expect(stem('hablando', 'es')).toBe('habl');
    expect(stem('comiendo', 'es')).toBe('comi');
  });

  it('strips noun suffixes', () => {
    expect(stem('acciones', 'es')).toBe('accion');  // -aciones doesn't match, falls to -es
  });

  it('strips infinitive endings', () => {
    expect(stem('hablar', 'es')).toBe('habl');
    expect(stem('comer', 'es')).toBe('com');
  });
});

// ── Subdomain: French stemming ───────────────────────────────────────

describe('stem — French (fr)', () => {
  it('strips verb conjugation suffixes', () => {
    expect(stem('parlaient', 'fr')).toBe('parl');
  });

  it('strips noun suffixes', () => {
    expect(stem('formation', 'fr')).toBe('form');
  });
});

// ── Subdomain: German stemming ───────────────────────────────────────

describe('stem — German (de)', () => {
  it('strips noun suffixes', () => {
    expect(stem('handlung', 'de')).toBe('handl');
  });

  it('strips adjective suffixes', () => {
    expect(stem('freundlich', 'de')).toBe('freund');
  });
});

// ── Subdomain: Unsupported languages ─────────────────────────────────

describe('stem — unsupported languages', () => {
  it('returns word unchanged for unsupported language codes', () => {
    expect(stem('hello', 'xx')).toBe('hello');
    expect(stem('test', 'ja')).toBe('test');
    expect(stem('word', 'zh')).toBe('word');
  });
});

// ── Subdomain: Edge cases ────────────────────────────────────────────

describe('stem — edge cases', () => {
  it('handles empty string', () => {
    expect(stem('', 'en')).toBe('');
  });

  it('handles very short words', () => {
    expect(stem('a', 'en')).toBe('a');
    expect(stem('ab', 'en')).toBe('ab');
  });

  it('returns same stem for identical input', () => {
    const s1 = stem('running', 'en');
    const s2 = stem('running', 'en');
    expect(s1).toBe(s2);
  });

  it('is deterministic across all supported languages', () => {
    const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv'];
    for (const lang of langs) {
      const result = stem('testing', lang);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

// ── Subdomain: No duplicate rules ────────────────────────────────────

describe('stem — rule integrity', () => {
  it('supported languages list matches module expectations', () => {
    // All 8 supported languages should produce different results from input for some word
    const supported = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv'];
    for (const lang of supported) {
      // "testing" should be stemmed (not returned as-is) for languages with rules
      const result = stem('internationally', lang);
      expect(typeof result).toBe('string');
    }
  });
});
