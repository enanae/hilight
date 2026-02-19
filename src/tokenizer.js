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
 */
function tokenizeFallback(text) {
  // Match word-like sequences across many scripts, or single non-word chars / whitespace
  const pattern =
    /([\p{L}\p{M}\p{N}]+)|(\s+)|([^\p{L}\p{M}\p{N}\s])/gu;

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
 * Normalize a word for storage: lowercase, trim.
 * For CJK/Hangul, no lowercasing is needed but we still trim.
 */
export function normalizeWord(word) {
  return word.toLowerCase().trim();
}
