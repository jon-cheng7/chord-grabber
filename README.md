# Chord Grabber

Chord sheets re-rendered for a phone: chords over lyrics that wrap without losing their place. Built to sit in the Code lab on joncheng.ca.

Songs come in three ways, all ending up on this site:

- **Paste** a chord sheet (plain chords-over-lyrics, or Ultimate Guitar `[ch]` markup) and tap SHOW, or tap PASTE to read the clipboard.
- **iPhone Shortcut**: share a chord page to the Shortcut. It fetches the page on the phone and opens this site with the sheet in the URL hash, which is never sent to a server. See [SHORTCUT.md](SHORTCUT.md).
- **Saved**: every song opened is kept on the device (localStorage), newest first.

## Run it

```bash
pnpm install
pnpm dev        # also on your network, for testing from the phone
pnpm test       # Node's built-in test runner, needs Node 22.18 or newer
pnpm build      # type-checks, then builds to dist/
```

## How it's laid out

```
src/main.ts      routes: home and song, hash imports
src/ug.ts        Ultimate Guitar page data → title, artist, key, capo, sheet
src/parse.ts     sheet text → sections, chord lines, lyric lines with chords placed
src/chord.ts     chord symbol recognition
src/render.ts    parsed lines → DOM
src/store.ts     saved songs and text size, on the device
```

## How the sheet wraps

Each lyric line is cut at chord columns, then into words. A chord and the start of its word are one unbreakable unit, and the line wraps between units. On a narrow screen a long line breaks onto the next row with its chords still over the right syllables. A chord a column or two left of its word is moved onto the word.
