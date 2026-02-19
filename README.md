# hilight

Free, open-source epub vocabulary builder. Upload an epub, and every word is highlighted. Click words to mark them as **learning** or **known** — your vocabulary is saved locally per language. Like LingQ, but free and self-hosted.

## Features

- **Upload any epub** — drag and drop or browse to open
- **Click-to-learn** — cycle each word: unknown (yellow) → learning (blue) → known (invisible) → ...
- **Dictionary popups** — auto-lookup definitions when you click a new word (English built-in, custom API for any language)
- **Multi-language** — separate vocabularies per language, with proper word segmentation for CJK, Korean, Arabic, Thai, and other non-Latin scripts (uses `Intl.Segmenter`)
- **Export / import** — save your vocabulary as JSON, load it on another device
- **100% client-side** — no server, no account, all data stays in your browser (IndexedDB)
- **GitHub Pages ready** — deploy for free as a static site

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173/hilight/` and drop an epub file.

A test epub with English, Spanish, Korean, Arabic, and Chinese samples is available at `public/test-multilingual.epub`.

## Deploy to GitHub Pages

Push to `main` and the GitHub Actions workflow will build and deploy automatically. Make sure GitHub Pages is set to deploy from **GitHub Actions** in your repo settings.

Your site will be at `https://<username>.github.io/hilight/`.

## Dictionary setup

English uses the free [dictionaryapi.dev](https://dictionaryapi.dev/) by default. For other languages, click the gear icon and enter a dictionary API URL template with `{word}` as the placeholder:

```
https://api.example.com/lookup/{word}
```

The API should return JSON. Hilight will try to parse common response formats automatically.

## How it works

1. **Tokenizer** — splits text into words using `Intl.Segmenter` (handles Chinese word boundaries, Korean, Arabic, etc.) with a regex fallback for older browsers
2. **Highlighter** — wraps each word in a clickable `<span>` colored by knowledge level
3. **Vocab store** — IndexedDB keyed by `(language, word)` with levels: 0=unknown, 1=learning, 2=known
4. **Epub reader** — uses [epub.js](https://github.com/futurepress/epub.js) to render inside an iframe, then hooks into each rendered page to tokenize and highlight

## License

MIT
