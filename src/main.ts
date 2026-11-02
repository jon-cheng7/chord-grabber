// Routes: home (paste, saved songs) and a song sheet

import './style.css';
import { parseSheet } from './parse.ts';
import { renderSheet } from './render.ts';
import {
    remove,
    save,
    setTextSize,
    song,
    songs,
    textSize,
    type Saved,
} from './store.ts';
import { readUltimateGuitar, type SongSource } from './ug.ts';

/** iCloud link to the iPhone Shortcut, once it exists */
const SHORTCUT_URL = '';
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
function fromText(text: string): SongSource | null {
    if (!text.trim()) return null;
    const ug = readUltimateGuitar(text);
    if (ug) return ug;
    return {
        title: 'Pasted song',
        artist: '',
        key: null,
        capo: null,
        sheet: text,
        url: null,
    };
}

function open(source: SongSource): void {
    const saved = save(source);
    location.hash = `song=${saved.id}`;
}

function showHome(notice?: string): void {
    if (!app) return;
    document.title = 'Chord Grabber';
    app.replaceChildren();
    app.dataset.view = 'home';

    const head = el('header', 'cg-home-head');
    head.append(el('h1', 'cg-brand', 'CHORD GRABBER'));
    app.append(head);

    if (notice) app.append(el('p', 'cg-notice', notice));

    const box = el('section', 'cg-paste');
    const area = el('textarea', 'cg-paste-area');
    area.placeholder = 'Paste a chord sheet here';
    area.rows = 6;
    area.spellcheck = false;
    area.autocapitalize = 'off';
    const actions = el('div', 'cg-paste-actions');
    const fromClipboard = button('PASTE', () => {
        void navigator.clipboard
            ?.readText()
            .then((text) => {
                const source = fromText(text);
                if (source) open(source);
                else area.focus();
            })
            .catch(() => area.focus());
    });
    fromClipboard.classList.add('cg-btn-primary');
    const show = button('SHOW', () => {
        const source = fromText(area.value);
        if (source) open(source);
    });
    actions.append(fromClipboard, show);
    box.append(area, actions);
    app.append(box);

    const list = songs();
    if (list.length) {
        const section = el('section', 'cg-recent');
        section.append(el('h2', 'cg-label', 'SAVED'));
        const ul = el('ul', 'cg-recent-list');
        for (const s of list) {
            const li = el('li', 'cg-recent-item');
            const link = el('a', 'cg-recent-link');
            link.href = `#song=${s.id}`;
            link.append(
                el('span', 'cg-recent-title', s.title),
                el('span', 'cg-recent-artist', s.artist),
            );
            const del = button(
                '×',
                () => {
                    remove(s.id);
                    li.remove();
                },
                'cg-icon',
            );
            del.setAttribute('aria-label', `Remove ${s.title}`);
            li.append(link, del);
            ul.append(li);
        }
        section.append(ul);
        app.append(section);
    }

    if (SHORTCUT_URL) {
        const tip = el('section', 'cg-shortcut');
        tip.append(el('h2', 'cg-label', 'IPHONE'));
        tip.append(
            el(
                'p',
                'cg-hint',
                'Add the Shortcut, then share any chord page to “Chord Grabber”.',
            ),
        );
        const add = el('a', 'cg-btn', 'ADD SHORTCUT');
        add.href = SHORTCUT_URL;
        tip.append(add);
        app.append(tip);
    }
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
        showHome('Tap PASTE to load the song from the Shortcut.');
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
