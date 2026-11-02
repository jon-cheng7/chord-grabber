// Routes: home, the Shortcut's load screen, a song sheet

import './style.css';
import { receive } from './bookmarklet.ts';
import {
    renderHome,
    renderLoad,
    renderReceiving,
    type HomeActions,
} from './home.ts';
import { parseSheet } from './parse.ts';
import { renderSheet } from './render.ts';
import {
    markConnected,
    save,
    setTextSize,
    song,
    textSize,
    type Saved,
} from './store.ts';
import { readUltimateGuitar, type SongSource } from './ug.ts';

const MIN_SIZE = 12;
const MAX_SIZE = 30;

const app = document.querySelector<HTMLElement>('#cg-app');

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(
    text: string,
    onClick: () => void,
    className = 'cg-btn',
): HTMLButtonElement {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

/** UG data first, then plain chords over lyrics */
function fromText(text: string, pageTitle = ''): SongSource | null {
    if (!text.trim()) return null;
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
        try {
            const source = fromText(await navigator.clipboard.readText());
            if (source) open(source);
            return source !== null;
        } catch {
            return false;
        }
    },
    showText(text) {
        const source = fromText(text);
        if (source) open(source);
        return source !== null;
    },
};

function showHome(notice?: string): void {
    if (!app) return;
    document.title = 'Chord Grabber';
    app.dataset.view = 'home';
    renderHome(app, actions, notice);
}

function showLoad(): void {
    if (!app) return;
    document.title = 'Chord Grabber';
    app.dataset.view = 'load';
    renderLoad(app, actions);
}

function showSong(s: Saved): void {
    if (!app) return;
    document.title = `${s.title} · Chord Grabber`;
    app.replaceChildren();
    app.dataset.view = 'song';

    const bar = el('header', 'cg-bar');
    const back = el('a', 'cg-icon', '←');
    back.href = '#';
    back.setAttribute('aria-label', 'Back');
    const titles = el('div', 'cg-titles');
    titles.append(
        el('h1', 'cg-title', s.title),
        el('p', 'cg-artist', s.artist),
    );
    const size = el('div', 'cg-size');
    const setSize = (px: number): void => {
        const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, px));
        app.style.setProperty('--cg-size', `${next}px`);
        setTextSize(next);
    };
    size.append(
        button('A−', () => setSize(textSize() - 1), 'cg-icon'),
        button('A+', () => setSize(textSize() + 1), 'cg-icon'),
    );
    bar.append(back, titles, size);

    const meta = el('p', 'cg-meta');
    const bits = [s.key && `KEY ${s.key}`, s.capo && `CAPO ${s.capo}`].filter(
        Boolean,
    );
    meta.textContent = bits.join(' · ');

    const sheet = el('article', 'cg-sheet');
    sheet.append(renderSheet(parseSheet(s.sheet)));

    app.append(bar);
    if (bits.length) app.append(meta);
    app.append(sheet);
    app.style.setProperty('--cg-size', `${textSize()}px`);
    window.scrollTo(0, 0);
}

function route(): void {
    const hash = location.hash.slice(1);
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
            const source = got && fromText(got.data, got.title);
            if (source) open({ ...source, url: source.url ?? got.url });
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
