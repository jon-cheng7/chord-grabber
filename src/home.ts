// Home: what it is, the Shortcut setup, paste, saved songs

import { smoothDetails } from './animate.ts';
import { songKey } from './key.ts';
import { parseSheet } from './parse.ts';
import { renderSheet } from './render.ts';
import { MAC, bookmarkletHref, browser, type Browser } from './bookmarklet.ts';
import { connected, remove, songs } from './store.ts';

export interface HomeActions {
    /** blocked: no clipboard access here, e.g. plain http */
    pasteClipboard(): Promise<'loaded' | 'empty' | 'blocked'>;
    showText(text: string): boolean;
}

/** iCloud link to the iPhone Shortcut */
export const SHORTCUT_URL =
    'https://www.icloud.com/shortcuts/75275afaee72489b956b9ee887c6bf76';

const SAMPLE =
    'Am            F         C\nAny chord sheet, sized for your phone';

const IOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as a Mac
    (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(navigator.userAgent);

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

function hero(): HTMLElement {
    const section = el('header', 'cg-hero');
    section.append(el('p', 'cg-brand', 'CHORD GRABBER'));
    section.append(
        el('h1', 'cg-hero-title', 'Chord sheets, made for your phone.'),
    );
    const demo = el('div', 'cg-hero-demo cg-sheet');
    demo.append(renderSheet(parseSheet(SAMPLE)));
    section.append(demo);
    return section;
}

function steps(items: [string, string][]): HTMLElement {
    const list = el('ol', 'cg-steps');
    items.forEach(([title, detail], i) => {
        const li = el('li', 'cg-step');
        li.append(el('span', 'cg-step-n', String(i + 1)));
        const body = el('div', 'cg-step-body');
        body.append(el('strong', 'cg-step-title', title));
        if (detail) body.append(el('span', 'cg-step-detail', detail));
        li.append(body);
        list.append(li);
    });
    return list;
}

const HOW: [string, string][] = [
    ['Find the song in Safari', ''],
    ['Share it to Chord Grabber', 'Share button → Chord Grabber in the list.'],
    ['Tap LOAD SONG here', 'iOS asks once more: tap Paste.'],
];

function setup(): HTMLElement {
    const card = el('section', 'cg-card cg-setup');
    card.append(el('span', 'cg-badge', 'REQUIRED · ONE-TIME SETUP'));
    card.append(el('h2', 'cg-card-title', 'Add the Shortcut'));
    card.append(
        el(
            'p',
            'cg-card-text',
            'Songs reach this page through a Shortcut in Safari’s share button. Without it there’s no way in except pasting by hand.',
        ),
    );
    if (SHORTCUT_URL) {
        const add = el(
            'a',
            'cg-btn cg-btn-primary cg-btn-wide',
            'ADD SHORTCUT',
        );
        add.href = SHORTCUT_URL;
        card.append(add);
        card.append(
            el(
                'p',
                'cg-card-note',
                'Opens the Shortcuts app. Tap Add Shortcut, then come back.',
            ),
        );
    } else {
        card.append(
            el('p', 'cg-card-note', 'The Shortcut link isn’t published yet.'),
        );
    }
    card.append(el('h3', 'cg-label', 'THEN, EVERY TIME'));
    card.append(steps(HOW));
    return card;
}

function ready(): HTMLElement {
    const card = el('section', 'cg-card cg-ready');
    const head = el('div', 'cg-ready-head');
    head.append(
        el('span', 'cg-dot'),
        el('span', 'cg-label', 'SHORTCUT CONNECTED'),
    );
    card.append(head);
    card.append(steps(HOW));
    if (SHORTCUT_URL) {
        const again = el('details', 'cg-fallback');
        again.append(el('summary', 'cg-link', 'Lost the Shortcut?'));
        const add = el(
            'a',
            'cg-btn cg-btn-primary cg-btn-wide',
            'ADD SHORTCUT',
        );
        add.href = SHORTCUT_URL;
        again.append(
            el(
                'p',
                'cg-card-note',
                'Delete the old one first if it’s still there. This one has the latest version.',
            ),
            add,
        );
        card.append(again);
    }
    return card;
}

function android(): HTMLElement {
    const card = el('section', 'cg-card cg-unsupported');
    card.append(el('span', 'cg-badge cg-badge-muted', 'NOT SUPPORTED YET'));
    card.append(el('h2', 'cg-card-title', 'Android isn’t supported'));
    card.append(
        el(
            'p',
            'cg-card-text',
            'Songs get here through an iPhone Shortcut, and Android has no equivalent built in. You can still paste a sheet by hand below.',
        ),
    );
    return card;
}

const BAR: Record<Browser, string> = {
    chrome: 'bookmarks bar',
    edge: 'favorites bar',
    firefox: 'bookmarks toolbar',
    safari: 'Favorites Bar',
    opera: 'bookmarks bar',
    other: 'bookmarks bar',
};

const KEYS = MAC ? '⌘ Shift B' : 'Ctrl Shift B';

function showBar(b: Browser): string {
    if (b === 'opera')
        return 'Show the bookmarks bar: Settings → Browser → Show bookmarks bar.';
    if (b === 'other')
        return 'Show your bookmarks bar from the browser’s View or Bookmarks menu.';
    return `Show your ${BAR[b]}: press ${KEYS}.`;
}

const BLOCKED: Partial<Record<Browser, string>> = {
    firefox:
        'If Firefox says it blocked a pop-up, click Allow in the bar at the top of the chord page.',
    safari: 'If nothing opens, go to Safari → Settings → Websites → Pop-up Windows and allow the chord site.',
};

/** the bar steps, the button to drag, and the copy fallback */
function install(b: Browser): HTMLElement[] {
    const mark = el('a', 'cg-bookmark', '♪ Chord Grabber');
    mark.href = bookmarkletHref();
    mark.draggable = true;
    mark.addEventListener('click', (e) => {
        // only useful once it's in the bookmarks bar
        e.preventDefault();
        mark.textContent = 'Drag me, don’t click me';
        window.setTimeout(() => (mark.textContent = '♪ Chord Grabber'), 1800);
    });
    return [
        steps([
            [showBar(b), ''],
            [`Drag this button onto the ${BAR[b]}:`, ''],
        ]),
        mark,
        copyFallback(),
    ];
}

function computer(): HTMLElement {
    const b = browser();
    const card = el('section', connected() ? 'cg-card' : 'cg-card cg-setup');
    if (connected()) {
        const head = el('div', 'cg-ready-head');
        head.append(
            el('span', 'cg-dot'),
            el('span', 'cg-label', 'BOOKMARK CONNECTED'),
        );
        card.append(head);
    } else {
        card.append(el('span', 'cg-badge', 'REQUIRED · ONE-TIME SETUP'));
        card.append(el('h2', 'cg-card-title', 'Add the bookmark'));
        card.append(
            el(
                'p',
                'cg-card-text',
                'Songs reach this page through a bookmark you click on the chord site. It reads the song from that page and opens it here.',
            ),
        );
        card.append(...install(b));
        card.append(el('h3', 'cg-label', 'THEN, EVERY TIME'));
    }
    card.append(
        steps([
            ['Open the song’s chord page', 'Most chord sites work.'],
            [`Click Chord Grabber in your ${BAR[b]}`, BLOCKED[b] ?? ''],
            [
                'It opens here in a new tab',
                'If it asks, click LOAD SONG and allow paste.',
            ],
        ]),
    );
    if (connected()) {
        const again = el('details', 'cg-fallback');
        again.append(el('summary', 'cg-link', 'Lost the bookmark?'));
        again.append(
            el(
                'p',
                'cg-card-note',
                'Delete the old one first if it’s still there. This one has the latest version.',
            ),
            ...install(b),
        );
        card.append(again);
    }
    return card;
}

/** can't drag: copy the code into a hand-made bookmark */
function copyFallback(): HTMLElement {
    const box = el('details', 'cg-fallback');
    box.append(el('summary', 'cg-link', 'Can’t drag it?'));
    box.append(
        steps([
            [
                MAC
                    ? 'Bookmark any page with ⌘ D'
                    : 'Bookmark any page with Ctrl D',
                '',
            ],
            ['Edit that bookmark', 'Name it Chord Grabber.'],
            ['Paste the code as its URL', ''],
        ]),
    );
    const copy = button('COPY CODE', () => {
        void navigator.clipboard
            .writeText(bookmarkletHref())
            .then(() => (copy.textContent = 'COPIED'))
            .catch(() => (copy.textContent = 'COPY FAILED'));
    });
    box.append(copy);
    return box;
}

function paste(actions: HomeActions, open: boolean): HTMLElement {
    const box = el('details', 'cg-card cg-paste');
    box.open = open;
    box.append(el('summary', 'cg-paste-summary', 'Paste a sheet by hand'));
    const area = el('textarea', 'cg-paste-area');
    area.placeholder = 'Chords over lyrics, or [ch] markup';
    area.rows = 6;
    area.spellcheck = false;
    area.autocapitalize = 'off';
    const row = el('div', 'cg-paste-actions');
    const clip = button('CLIPBOARD', () => {
        void actions.pasteClipboard().then((got) => {
            if (got !== 'loaded') area.focus();
        });
    });
    const show = button('SHOW', () => {
        if (!actions.showText(area.value)) area.focus();
    });
    show.classList.add('cg-btn-primary');
    row.append(clip, show);
    box.append(area, row);
    return box;
}

function saved(): HTMLElement | null {
    const list = songs();
    if (!list.length) return null;
    const section = el('section', 'cg-recent');
    section.append(el('h2', 'cg-label', `SAVED · ${list.length}`));
    const ul = el('ul', 'cg-recent-list');
    for (const s of list) {
        const li = el('li', 'cg-recent-item');
        const link = el('a', 'cg-recent-link');
        link.href = `#song=${s.id}`;
        const tile = el(
            'span',
            'cg-tile',
            songKey(s.key, parseSheet(s.sheet), s.capo) ??
                s.title.slice(0, 1).toUpperCase(),
        );
        const words = el('span', 'cg-recent-words');
        words.append(
            el('span', 'cg-recent-title', s.title),
            el('span', 'cg-recent-artist', s.artist || '—'),
        );
        link.append(tile, words);
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
    return section;
}

/** bookmarklet handoff in progress */
export function renderReceiving(root: HTMLElement): void {
    const card = el('section', 'cg-load');
    card.append(el('p', 'cg-brand', 'CHORD GRABBER'));
    card.append(el('h1', 'cg-load-title', 'Fetching the song…'));
    root.replaceChildren(card);
}

export function renderHome(
    root: HTMLElement,
    actions: HomeActions,
    notice?: string,
): void {
    root.replaceChildren(hero());
    if (notice) root.append(el('p', 'cg-notice', notice));
    if (IOS) root.append(connected() ? ready() : setup());
    else root.append(ANDROID ? android() : computer());
    root.append(paste(actions, !IOS));
    const list = saved();
    if (list) root.append(list);
    smoothDetails(root);
}

/** the Shortcut or bookmarklet opened us: one big tap to read the clipboard */
export function renderLoad(root: HTMLElement, actions: HomeActions): void {
    const card = el('section', 'cg-load');
    card.append(el('p', 'cg-brand', 'CHORD GRABBER'));
    card.append(el('h1', 'cg-load-title', 'Your song is ready'));
    const hint = el(
        'p',
        'cg-card-note',
        IOS
            ? 'iOS will ask once more: tap Paste.'
            : 'Your browser may ask to allow paste.',
    );
    // long-press paste works where the clipboard API doesn't
    const box = el('textarea', 'cg-paste-area cg-load-paste');
    box.placeholder = IOS ? 'Tap and hold here, then Paste' : 'Paste here';
    box.rows = 3;
    box.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text') ?? '';
        e.preventDefault();
        if (!actions.showText(text))
            hint.textContent =
                'Nothing usable on the clipboard. Try again from the chord page.';
    });
    const manual = (): void => {
        go.replaceWith(box);
        hint.textContent = 'This page can’t read the clipboard itself.';
        box.focus();
    };
    const go = button(
        'LOAD SONG',
        () => {
            void actions.pasteClipboard().then((got) => {
                if (got === 'blocked') manual();
                else if (got === 'empty')
                    hint.textContent =
                        'Nothing usable on the clipboard. Try again from the chord page.';
            });
        },
        'cg-btn cg-btn-primary cg-btn-big',
    );
    const home = el('a', 'cg-link', 'Back to Chord Grabber');
    home.href = '#';
    card.append(go, hint, home);
    root.replaceChildren(card);
    if (!navigator.clipboard?.readText) manual();
}
