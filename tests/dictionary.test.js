/**
 * Domain: Dictionary
 * Subdomain: Response Parsing (Wiktionary, FreeDictV2, Generic), Settings
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROVIDERS,
  loadDictSettings, saveDictSettings,
  getActiveProviderId, getProviderChoices,
  hasDictionary,
} from '../src/dictionary.js';

// ── Subdomain: Wiktionary parser ─────────────────────────────────────

describe('parseWiktionary', () => {
  const parse = PROVIDERS.wiktionary.parse;

  it('parses a valid Wiktionary response', () => {
    const data = {
      en: [{
        partOfSpeech: 'Noun',
        definitions: [
          { definition: 'A small <b>domesticated</b> animal.' },
        ],
      }],
    };
    const result = parse(data, 'en', 'en');
    expect(result).not.toBeNull();
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].partOfSpeech).toBe('Noun');
    expect(result.definitions[0].definition).not.toContain('<b>');
  });

  it('strips HTML tags from definitions', () => {
    const data = {
      en: [{
        partOfSpeech: 'Verb',
        definitions: [
          { definition: 'To <i>perform</i> an <b>action</b>.' },
        ],
      }],
    };
    const result = parse(data, 'en', 'en');
    expect(result.definitions[0].definition).toBe('To perform an action.');
  });

  it('prefers defLang over bookLang', () => {
    const data = {
      en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'English def' }] }],
      es: [{ partOfSpeech: 'Sustantivo', definitions: [{ definition: 'Spanish def' }] }],
    };
    const result = parse(data, 'en', 'es');
    expect(result.definitions[0].definition).toBe('Spanish def');
  });

  it('falls back to bookLang if defLang not available', () => {
    const data = {
      en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'English def' }] }],
    };
    const result = parse(data, 'en', 'es');
    expect(result.definitions[0].definition).toBe('English def');
  });

  it('returns null for empty data', () => {
    expect(parse(null, 'en', 'en')).toBeNull();
    expect(parse({}, 'en', 'en')).toBeNull();
  });

  it('returns null when all definitions are empty HTML', () => {
    const data = {
      en: [{
        partOfSpeech: 'Noun',
        definitions: [{ definition: '<br/>' }],
      }],
    };
    // stripHtml('<br/>') returns '', so this definition is skipped
    const result = parse(data, 'en', 'en');
    expect(result).toBeNull();
  });

  it('limits to 6 definitions', () => {
    const data = {
      en: [{
        partOfSpeech: 'Noun',
        definitions: Array.from({ length: 10 }, (_, i) => ({
          definition: `Def ${i}`,
        })),
      }],
    };
    const result = parse(data, 'en', 'en');
    expect(result.definitions.length).toBeLessThanOrEqual(6);
  });
});

// ── Subdomain: Free Dictionary V2 parser ─────────────────────────────

describe('parseFreeDictV2', () => {
  const parse = PROVIDERS['free-dict'].parse;

  it('parses a valid FreeDictV2 response', () => {
    const data = [{
      word: 'cat',
      phonetic: '/kæt/',
      meanings: [{
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'A small domesticated animal.' },
        ],
      }],
    }];
    const result = parse(data);
    expect(result.word).toBe('cat');
    expect(result.phonetic).toBe('/kæt/');
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].definition).toBe('A small domesticated animal.');
  });

  it('returns null for empty array', () => {
    expect(parse([])).toBeNull();
  });

  it('returns null for non-array', () => {
    expect(parse(null)).toBeNull();
    expect(parse('string')).toBeNull();
  });

  it('returns null when no definitions exist', () => {
    const data = [{ word: 'test', meanings: [{ partOfSpeech: 'noun', definitions: [] }] }];
    expect(parse(data)).toBeNull();
  });

  it('filters out undefined definitions', () => {
    const data = [{
      word: 'test',
      meanings: [{
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'A valid definition.' },
          { definition: undefined },
          { },
        ],
      }],
    }];
    const result = parse(data);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].definition).toBe('A valid definition.');
  });

  it('defaults missing phonetic to empty string', () => {
    const data = [{
      word: 'test',
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A test.' }] }],
    }];
    const result = parse(data);
    expect(result.phonetic).toBe('');
  });

  it('defaults missing partOfSpeech to empty string', () => {
    const data = [{
      word: 'test',
      meanings: [{ definitions: [{ definition: 'A test.' }] }],
    }];
    const result = parse(data);
    expect(result.definitions[0].partOfSpeech).toBe('');
  });
});

// ── Subdomain: Provider configuration ────────────────────────────────

describe('provider configuration', () => {
  it('has wiktionary and free-dict as built-in providers', () => {
    expect(PROVIDERS.wiktionary).toBeDefined();
    expect(PROVIDERS['free-dict']).toBeDefined();
  });

  it('each provider has required properties', () => {
    for (const provider of Object.values(PROVIDERS)) {
      expect(provider).toHaveProperty('id');
      expect(provider).toHaveProperty('name');
      expect(provider).toHaveProperty('buildUrl');
      expect(provider).toHaveProperty('parse');
      expect(typeof provider.buildUrl).toBe('function');
      expect(typeof provider.parse).toBe('function');
    }
  });

  it('getProviderChoices returns all providers', () => {
    const choices = getProviderChoices();
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(choices.find(c => c.id === 'wiktionary')).toBeDefined();
    expect(choices.find(c => c.id === 'free-dict')).toBeDefined();
  });
});

// ── Subdomain: Settings persistence ──────────────────────────────────

describe('dictionary settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads empty settings by default', () => {
    const settings = loadDictSettings();
    expect(settings).toEqual({});
  });

  it('saves and loads settings', () => {
    saveDictSettings({ en: { provider: 'wiktionary' } });
    const settings = loadDictSettings();
    expect(settings.en.provider).toBe('wiktionary');
  });

  it('getActiveProviderId returns default when no override', () => {
    const id = getActiveProviderId('en');
    expect(id).toBe('free-dict'); // English defaults to free-dict
  });

  it('getActiveProviderId returns default wiktionary for non-english', () => {
    const id = getActiveProviderId('es');
    expect(id).toBe('wiktionary');
  });

  it('getActiveProviderId respects user override', () => {
    saveDictSettings({ en: { provider: 'wiktionary' } });
    expect(getActiveProviderId('en')).toBe('wiktionary');
  });

  it('hasDictionary returns true for all languages with defaults', () => {
    expect(hasDictionary('en')).toBe(true);
    expect(hasDictionary('es')).toBe(true);
    expect(hasDictionary('fr')).toBe(true);
  });
});
