// Routes: home, the Shortcut's load screen, a song sheet

import './style.css';
import { receive } from './bookmarklet.ts';
import {
    renderHome,
    renderLoad,
    renderReceiving,
    type HomeActions,
} from './home.ts';
import { closeLibrary } from './library.ts';
import { parseSheet } from './parse.ts';
import { readShared } from './share.ts';
import { leave, renderSong } from './song.ts';
import {
    markConnected,
    save,
    setArrangement,
    setEdits,
    setShift,
    song,
    type Saved,
} from './store.ts';
import { extractSong, looksLikeHtml } from './extract.ts';
import { readUltimateGuitar, type SongSource } from './ug.ts';

const app = document.querySelector<HTMLElement>('#cg-app');

const page = (html: string): Document =>
    new DOMParser().parseFromString(html, 'text/html');

/** a whole page, UG data, or plain chords over lyrics */
function fromText(text: string, pageTitle = ''): SongSource | null {
    if (!text.trim()) return null;
    if (looksLikeHtml(text)) return extractSong(page(text));
    const ug = readUltimateGuitar(text);
    if (ug) return ug;
    // "Song Chords by Artist | Site" → "Song Chords by Artist"
    const title = pageTitle.split(/\s+[|–—-]\s+/)[0]?.trim();
    return {
        title: title || 'Pasted song',
        artist: '',
        key: null,
        capo: null,
        sheet: text,
        url: null,
    };
}

/** lines with chords on them */
const chordLines = (source: SongSource): number =>
    parseSheet(source.sheet).filter(
        (l) => l.kind === 'chords' || (l.kind === 'lyric' && l.chords),
    ).length;

/** bookmarklet: UG's data is only in the served page, some sites hide theirs live */
function fromPages(
    live: string,
    served: string,
    url: string,
): SongSource | null {
    const docs = [live, served].filter(Boolean).map((html) => page(html));
    const store = docs.find((d) => d.querySelector('.js-store'));
    const ug = store && extractSong(store, url);
    if (ug) return ug;
    const found = docs
        .map((doc) => extractSong(doc, url))
        .filter((s): s is SongSource => s !== null);
    // most chords wins, live first on a tie
    return found.reduce<SongSource | null>(
        (best, s) => (!best || chordLines(s) > chordLines(best) ? s : best),
        null,
    );
}

function open(source: SongSource): void {
    const saved = save(source);
    // from the load screen, back should skip it
    if (location.hash === '#clip' || location.hash === '#receive') {
        history.replaceState(null, '', `#song=${saved.id}`);
        route();
    } else {
        location.hash = `song=${saved.id}`;
    }
}

const actions: HomeActions = {
    async pasteClipboard() {
        if (!navigator.clipboard?.readText) return 'blocked';
        let text: string;
        try {
            text = await navigator.clipboard.readText();
        } catch {
            return 'blocked';
        }
        const source = fromText(text);
        if (source) open(source);
        return source ? 'loaded' : 'empty';
    },
    showText(text) {
        const source = fromText(text);
        if (source) open(source);
        return source !== null;
    },
};

function showHome(notice?: string): void {
    if (!app) return;
    document.title = 'Charts';
    app.dataset.view = 'home';
    renderHome(app, actions, notice);
}

function showLoad(): void {
    if (!app) return;
    document.title = 'Charts';
    app.dataset.view = 'load';
    renderLoad(app, actions);
}

function showSong(s: Saved): void {
    if (app) renderSong(app, s);
}

function route(): void {
    leave();
    closeLibrary();
    const hash = location.hash.slice(1);
    // a share link: the song itself, compressed
    if (hash.startsWith('s=')) {
        void readShared(hash.slice(2)).then((got) => {
            if (!got) {
                showHome('That share link is broken or cut short.');
                return;
            }
            const saved = save(got.source);
            setShift(saved.id, got.shift);
            setEdits(saved.id, got.edits);
            setArrangement(saved.id, got.arrangement);
            history.replaceState(null, '', `#song=${saved.id}`);
            showSong({
                ...saved,
                shift: got.shift,
                edits: got.edits,
                arrangement: got.arrangement,
            });
        });
        return;
    }
    // from the Shortcut: page data rides in the hash, never sent to a server
    if (hash.startsWith('ug=') || hash.startsWith('text=')) {
        markConnected();
        let text = '';
        try {
            text = decodeURIComponent(hash.slice(hash.indexOf('=') + 1));
        } catch {
            showHome('That link was cut short. Try sharing the page again.');
            return;
        }
        const source = fromText(text);
        if (source) {
            const saved = save(source);
            history.replaceState(null, '', `#song=${saved.id}`);
            showSong(saved);
        } else {
            showHome('Couldn’t find a chord sheet in that page.');
        }
        return;
    }
    if (hash === 'clip') {
        markConnected();
        showLoad();
        return;
    }
    // from the bookmarklet: the opener tab posts the page over
    if (hash === 'receive') {
        markConnected();
        if (!app) return;
        app.dataset.view = 'load';
        renderReceiving(app);
        void receive().then((got) => {
            const source = got && fromPages(got.data, got.page, got.url);
            if (source) open(source);
            // cut off from the opener: the bookmarklet copied it too
            else showLoad();
        });
        return;
    }
    if (hash.startsWith('song=')) {
        const found = song(hash.slice(5));
        if (found) {
            showSong(found);
            return;
        }
    }
    showHome();
}

window.addEventListener('hashchange', route);
route();
