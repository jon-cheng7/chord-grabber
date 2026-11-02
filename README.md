# Charts

Chord sheets re-rendered for a phone: chords over lyrics that wrap without losing their place. Built to sit in the Code lab on joncheng.ca.

Songs come in three ways, all ending up on this site:

- **iPhone Shortcut** (the main way in): share a chord page to the Shortcut. It fetches the page on the phone, copies it and opens this site on a LOAD SONG screen. Nothing passes through a server.
- **Bookmarklet** (computers): drag the button on the home page to the bookmarks bar, then click it on a chord page. It takes the page as it stands plus a fresh copy from the server, opens this site in a new tab and passes them over with `postMessage`. If the page cuts the new tab off from its opener, the song is also on the clipboard and the tab shows LOAD SONG.
- **Paste** a chord sheet by hand (plain chords-over-lyrics, or Ultimate Guitar `[ch]` markup).
- **Paste** a whole page's HTML works too.
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
src/main.ts      routes: home, load screen, song; hash imports
src/home.ts      home: Shortcut or bookmark setup and how-to, paste, saved songs
src/bookmarklet.ts  the desktop bookmarklet and the tab handoff
src/extract.ts   any chord page's HTML → the song, without the page around it
src/ug.ts        Ultimate Guitar page data → title, artist, key, capo, sheet
src/parse.ts     sheet text → sections, chord lines, lyric lines with chords placed
src/chord.ts     chord symbol recognition
src/render.ts    parsed lines → DOM
src/store.ts     saved songs and text size, on the device
```

## Finding the song in a page

Every way in hands over a whole page, and `extract.ts` picks the song out on this site:

1. Ultimate Guitar keeps the song as data in the page (`.js-store`), so that's read directly.
2. Nav, footers, comments, forms, hidden elements and the like are dropped.
3. **Styled chords**: leaves whose text is one chord, grouped by tag and class. The biggest group is the song's chords; the deepest element holding most of them is the song. It's rewritten as `[ch]` markup, one line per `<br>` or per short block holding chords.
4. **Plain chords over lyrics**: `<pre>` blocks and anything with line breaks, scored by chords on chord lines. Needs a few lyric lines too, so a chord legend loses.
5. **Lyrics only**: no chords anywhere, so the biggest run of paragraphs or line breaks.

Then: blank-between-every-line spacing is folded, bare section names (Verse 1, Chorus…) become sections, key comes from a `data-key` or "Key:" on the page, and capo only when the sheet is written in the capo shapes. Title and artist come from `og:title`, minus the site name and "Chords".

`fixtures/` holds saved pages from a few sites; `src/extract.test.ts` checks each one.

## How the sheet wraps

Each lyric line is cut at chord columns, then into words. A chord and the start of its word are one unbreakable unit, and the line wraps between units. On a narrow screen a long line breaks onto the next row with its chords still over the right syllables. A chord a column or two left of its word is moved onto the word.
