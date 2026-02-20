/**
 * Word tokenizer with non-Latin alphabet support.
 * Uses Intl.Segmenter where available (modern browsers), falls back to
 * regex-based splitting that handles CJK, Arabic, Hangul, etc.
 */

/**
 * Tokenize text into an array of segments.
 * Each segment is { text: string, isWord: boolean }.
 * Whitespace and punctuation are non-word segments.
 */
export function tokenize(text, locale = 'en') {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return tokenizeWithSegmenter(text, locale);
  }
  return tokenizeFallback(text);
}

function tokenizeWithSegmenter(text, locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  const segments = [];
  for (const seg of segmenter.segment(text)) {
    segments.push({
      text: seg.segment,
      isWord: seg.isWordLike === true,
    });
  }
  return segments;
}

/**
 * Regex fallback: splits on word boundaries.
 * Handles Latin, Cyrillic, Greek, Arabic, Hebrew, Hangul, CJK, Thai, Devanagari, etc.
 * Includes apostrophes (' and \u2019) within words so French/Italian contractions
 * like "l'homme" and "dell'arte" are kept as single tokens.
 */
function tokenizeFallback(text) {
  // Word = letters/marks/numbers, optionally containing internal apostrophes
  // followed by more letters (e.g. l'homme, don't, dell'arte).
  const pattern =
    /([\p{L}\p{M}\p{N}]+(?:['\u2019][\p{L}\p{M}\p{N}]+)*)|(\s+)|([^\p{L}\p{M}\p{N}\s])/gu;

  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isWord: false });
    }
    segments.push({
      text: match[0],
      isWord: !!match[1], // first capture group = word-like
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isWord: false });
  }
  return segments;
}

/**
 * Normalize a word for storage: NFC normalize, locale-aware lowercase, trim.
 * NFC normalization ensures that e.g. é (composed) matches é (decomposed).
 * Locale-aware lowercase handles Turkish İ→i correctly.
 */
export function normalizeWord(word, locale) {
  const normalized = word.normalize('NFC');
  return locale
    ? normalized.toLocaleLowerCase(locale).trim()
    : normalized.toLowerCase().trim();
}
