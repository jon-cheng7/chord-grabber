# The iPhone Shortcut

Share a chord page → **Chord Grabber**. The Shortcut fetches the page on the phone, pulls out the song data and opens the site with it after the `#`.

`APP` below is the site address: `https://chord-grabber.joncheng.ca` once it's deployed. While testing, use the Network address `pnpm dev` prints (`http://192.168.x.x:5173`), with the phone on the same Wi-Fi.

## Build it

In the Shortcuts app, tap **+**, name it **Chord Grabber**, then add these actions in order:

1. **Get URLs from Input**, input: _Shortcut Input_.
2. **Get Contents of URL**, URL: _URLs_.
   If the page comes back as a "checking your browser" page later on, open _Show More_ → _Headers_, add `User-Agent` with a Safari value such as
   `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`.
3. **Get Text from Input**, input: _Contents of URL_.
4. **Match Text**, pattern: `data-content="([^"]*)"`, in: _Text_.
5. **Get Group from Matched Text**: _Group At Index_ `1` in _Matches_.
6. **URL Encode**: _Group_.
7. **Text**: `APP/#ug=` followed by the _URL Encoded Text_ variable.
8. **Open URLs**: _Text_.

Then open the Shortcut's settings (the ⓘ or the name menu, depending on iOS version):

- turn on **Show in Share Sheet**;
- set **Receive** to _URLs_ and _Safari web pages_ only;
- **If there's no input**: _Get Clipboard_ (so it also works on a copied link).

## Try it

Open a chord page in Safari → Share → **Chord Grabber**. The song should open on the site and show up under SAVED.

## If the song is too long for a URL

Very long pages can exceed what Open URLs will pass. Swap steps 6–8 for:

6. **Copy to Clipboard**: _Group_.
7. **Open URLs**: `APP/#clip`.

The site then asks for one tap on PASTE (iOS needs a tap before a page can read the clipboard).

## Share it

In Shortcuts, long-press **Chord Grabber** → **Share** → **Copy iCloud Link**. Put that link in `SHORTCUT_URL` at the top of `src/main.ts` and an ADD SHORTCUT button appears on the home screen.
