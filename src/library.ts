// Library on home: collections, saved songs, files in and out

import { collapse, popIn, popOut, rise, sheetIn, sheetOut } from './animate.ts';
import { exportCollection, exportSong, importFiles } from './files.ts';
import { songKey } from './key.ts';
import { parseSheet } from './parse.ts';
import {
    addCollection,
    collections,
    remove,
    removeCollection,
    renameCollection,
    restore,
    restoreCollection,
    setInCollection,
    song,
    songs,
    type Collection,
    type Saved,
} from './store.ts';
import { toast } from './toast.ts';

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

const plural = (n: number, word: string): string =>
    `${n} ${word}${n === 1 ? '' : 's'}`;

// keys take a parse each
const keys = new Map<string, string>();
const keyOf = (s: Saved): string => {
    let k = keys.get(s.id);
    if (k === undefined) {
        k =
            songKey(s.key, parseSheet(s.sheet), s.capo) ??
            s.title.slice(0, 1).toUpperCase();
        keys.set(s.id, k);
    }
    return k;
};

const collection = (id: string): Collection | null =>
    collections().find((c) => c.id === id) ?? null;

const inside = (c: Collection): Saved[] =>
    c.songs.map((x) => song(x)).filter((s): s is Saved => s !== null);

/** tile, title, artist: a song as a link */
function songLink(s: Saved, onOpen?: () => void): HTMLAnchorElement {
    const link = el('a', 'cg-recent-link');
    link.href = `#song=${s.id}`;
    if (onOpen) link.addEventListener('click', onOpen);
    const words = el('span', 'cg-recent-words');
    words.append(
        el('span', 'cg-recent-title', s.title),
        el('span', 'cg-recent-artist', s.artist || '—'),
    );
    link.append(el('span', 'cg-tile', keyOf(s)), words);
    return link;
}

interface Sheet {
    title: HTMLElement;
    sub: HTMLElement;
    head: HTMLElement;
    list: HTMLElement;
    foot: HTMLElement;
    close: () => void;
}

let closeOpen: (() => void) | null = null;

/** a bottom sheet; one at a time */
function sheet(title: string, sub = ''): Sheet {
    closeOpen?.();
    const shade = el('div', 'cg-shade');
    const box = el('div', 'cg-chooser cg-lib-sheet');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', title);
    const head = el('div', 'cg-chooser-head');
    const titles = el('div', 'cg-chooser-titles');
    const name = el('p', 'cg-chooser-title', title);
    const note = el('p', 'cg-chooser-now', sub);
    titles.append(name, note);
    const list = el('div', 'cg-chooser-list');
    const foot = el('div', 'cg-chooser-foot');
    const esc = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') close();
    };
    const close = (): void => {
        if (closeOpen !== close) return;
        closeOpen = null;
        removeEventListener('keydown', esc);
        popOut(shade, () => shade.remove());
        sheetOut(box, () => box.remove());
    };
    head.append(titles, button('×', close, 'cg-icon'));
    box.append(head, list, foot);
    shade.addEventListener('click', close);
    addEventListener('keydown', esc);
    document.body.append(shade, box);
    popIn(shade);
    sheetIn(box);
    closeOpen = close;
    return { title: name, sub: note, head, list, foot, close };
}

/** leaving home: no sheet left floating over a song */
export function closeLibrary(): void {
    closeOpen?.();
}

/** a row that switches on and off with a check */
function checkRow(
    label: string,
    on: boolean,
    flip: (on: boolean) => void,
): HTMLButtonElement {
    const row = button(
        '',
        () => {
            on = !on;
            row.classList.toggle('cg-on', on);
            row.setAttribute('aria-pressed', String(on));
            flip(on);
        },
        'cg-check-row',
    );
    row.classList.toggle('cg-on', on);
    row.setAttribute('aria-pressed', String(on));
    row.append(el('span', 'cg-check-label', label), el('span', 'cg-check'));
    return row;
}

/** a name field; Enter or the button keeps it */
function nameField(
    value: string,
    keep: (name: string) => void,
): { input: HTMLInputElement; go: HTMLButtonElement } {
    const input = el('input', 'cg-typed-input');
    input.value = value;
    input.placeholder = 'Sunday set, Acoustic, Learning…';
    input.maxLength = 40;
    input.enterKeyHint = 'done';
    const go = button(
        'SAVE',
        () => {
            const name = input.value.trim();
            if (name) keep(name);
        },
        'cg-btn cg-btn-primary',
    );
    const sync = (): void => {
        go.disabled = !input.value.trim();
    };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !go.disabled) go.click();
    });
    sync();
    return { input, go };
}

export function library(): HTMLElement {
    // sheets may have been edited since home was last up
    keys.clear();
    const section = el('section', 'cg-library');
    const picker = el('input', 'cg-file');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.multiple = true;
    picker.hidden = true;

    const take = (files: Iterable<File>): void => {
        const before = new Set([
            ...songs().map((s) => s.id),
            ...collections().map((c) => c.id),
        ]);
        void importFiles(files).then((got) => {
            const parts = [
                got.songs && plural(got.songs, 'song'),
                got.collections && plural(got.collections, 'collection'),
            ].filter(Boolean);
            toast(
                parts.length
                    ? `Imported ${parts.join(' · ')}`
                    : got.skipped
                      ? 'Not a Charts file'
                      : 'Nothing to import',
            );
            const fresh = new Set(
                [
                    ...songs().map((s) => s.id),
                    ...collections().map((c) => c.id),
                ].filter((id) => !before.has(id)),
            );
            draw(fresh);
        });
    };
    picker.addEventListener('change', () => {
        if (picker.files?.length) take([...picker.files]);
        picker.value = '';
    });
    // computers can drop files straight on
    section.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        section.classList.add('cg-dropping');
    });
    section.addEventListener('dragleave', (e) => {
        if (!section.contains(e.relatedTarget as Node | null))
            section.classList.remove('cg-dropping');
    });
    section.addEventListener('drop', (e) => {
        e.preventDefault();
        section.classList.remove('cg-dropping');
        if (e.dataTransfer?.files.length) take([...e.dataTransfer.files]);
    });

    /** fresh: ids that just arrived, to bring in with a rise */
    const draw = (fresh = new Set<string>()): void => {
        const all = songs();
        const sets = collections();
        const head = el('div', 'cg-library-head');
        const importBtn = button(
            '',
            () => picker.click(),
            'cg-btn cg-btn-small',
        );
        importBtn.innerHTML = `${IMPORT_ICON}<span>IMPORT</span>`;
        importBtn.title = 'Songs or collections exported from Charts';
        head.append(el('h2', 'cg-label', 'LIBRARY'), importBtn);
        section.replaceChildren(head, picker);

        if (!all.length && !sets.length) {
            section.append(
                el(
                    'p',
                    'cg-library-empty',
                    'Nothing saved yet. Load a song, or import a file you exported before.',
                ),
            );
            return;
        }

        // collections: a shelf of cards, new one first
        section.append(
            el(
                'h3',
                'cg-label cg-library-sub',
                sets.length ? `COLLECTIONS · ${sets.length}` : 'COLLECTIONS',
            ),
        );
        const shelf = el('div', 'cg-shelf');
        const make = button(
            '',
            () => newCollection(),
            'cg-shelf-card cg-shelf-new',
        );
        make.append(
            el('span', 'cg-shelf-plus', '+'),
            el('span', 'cg-shelf-name', 'New collection'),
        );
        shelf.append(make);
        sets.forEach((c, i) => {
            const card = button(
                '',
                () => openCollection(c.id),
                'cg-shelf-card',
            );
            card.dataset.collection = c.id;
            const list = inside(c);
            const tiles = el('span', 'cg-shelf-tiles');
            for (const s of list.slice(0, 3))
                tiles.append(el('span', 'cg-tile', keyOf(s)));
            if (!list.length)
                tiles.append(el('span', 'cg-tile cg-tile-empty', '♪'));
            card.append(
                tiles,
                el('span', 'cg-shelf-name', c.name),
                el('span', 'cg-shelf-count', plural(list.length, 'song')),
            );
            shelf.append(card);
            if (fresh.has(c.id)) rise(card, i);
        });
        section.append(shelf);

        if (!all.length) return;
        section.append(
            el('h3', 'cg-label cg-library-sub', `SAVED · ${all.length}`),
        );
        const ul = el('ul', 'cg-recent-list');
        let n = 0;
        for (const s of all) {
            const li = el('li', 'cg-recent-item');
            li.dataset.song = s.id;
            const more = button('', () => openSong(s.id), 'cg-icon');
            more.innerHTML = MORE_ICON;
            more.setAttribute('aria-label', `${s.title}: collections, export`);
            li.append(songLink(s), more);
            ul.append(li);
            if (fresh.has(s.id)) rise(li, n++);
        }
        section.append(ul);
    };

    const newCollection = (then?: (c: Collection) => void): void => {
        const box = sheet(
            'New collection',
            'Group songs for a set, a gig, practice',
        );
        const { input, go } = nameField('', (name) => {
            const c = addCollection(name);
            box.close();
            draw(new Set([c.id]));
            if (then) then(c);
            else openCollection(c.id, true);
        });
        go.textContent = 'CREATE';
        box.list.append(el('p', 'cg-pop-label', 'NAME'), input);
        box.foot.append(go);
        input.focus();
    };

    /** a song's own sheet: which collections, export, remove */
    const openSong = (id: string): void => {
        const s = song(id);
        if (!s) return;
        const box = sheet(s.title, s.artist);
        const fill = (): void => {
            box.list.replaceChildren(el('p', 'cg-pop-label', 'IN COLLECTIONS'));
            collections().forEach((c, i) => {
                const row = checkRow(c.name, c.songs.includes(id), (on) => {
                    setInCollection(c.id, id, on);
                    draw();
                });
                box.list.append(row);
                rise(row, i);
            });
            const add = button(
                '+ New collection',
                () =>
                    newCollection((c) => {
                        setInCollection(c.id, id, true);
                        draw();
                        openSong(id);
                    }),
                'cg-check-row cg-check-new',
            );
            box.list.append(add);
        };
        fill();
        const drop = button(
            'REMOVE',
            () => {
                box.close();
                const kept = collections().filter((c) => c.songs.includes(id));
                const row = section.querySelector<HTMLElement>(
                    `[data-song="${id}"]`,
                );
                const gone = (): void => {
                    remove(id);
                    draw();
                    toast(`Removed ${s.title}`, {
                        label: 'UNDO',
                        run: () => {
                            restore(s);
                            for (const c of kept)
                                setInCollection(c.id, id, true);
                            draw(new Set([id]));
                        },
                    });
                };
                if (row) collapse(row, gone);
                else gone();
            },
            'cg-btn cg-btn-quiet',
        );
        const out = button(
            'EXPORT',
            () => void exportSong(id),
            'cg-btn cg-btn-primary',
        );
        box.foot.append(drop, out);
    };

    /** a collection's sheet: its songs, or every song to pick from */
    const openCollection = (id: string, adding = false): void => {
        const c = collection(id);
        if (!c) return;
        const box = sheet(c.name);
        const count = (): void => {
            const now = collection(id);
            box.sub.textContent = plural(now ? inside(now).length : 0, 'song');
        };
        const fill = (): void => {
            const now = collection(id);
            if (!now) return;
            count();
            box.list.classList.toggle('cg-adding', adding);
            if (adding) {
                box.list.replaceChildren(
                    el('p', 'cg-pop-label', 'TAP TO ADD OR TAKE OUT'),
                );
                songs().forEach((s, i) => {
                    const row = checkRow(
                        s.title,
                        now.songs.includes(s.id),
                        (on) => {
                            setInCollection(id, s.id, on);
                            count();
                            draw();
                        },
                    );
                    box.list.append(row);
                    rise(row, i);
                });
                if (!songs().length)
                    box.list.append(
                        el(
                            'p',
                            'cg-library-empty',
                            'No saved songs to add yet.',
                        ),
                    );
                return;
            }
            const list = inside(now);
            box.list.replaceChildren();
            const ul = el('ul', 'cg-recent-list');
            list.forEach((s, i) => {
                const li = el('li', 'cg-recent-item');
                const out = button(
                    '−',
                    () => {
                        setInCollection(id, s.id, false);
                        collapse(li, () => {
                            count();
                            draw();
                            if (!ul.children.length) fill();
                        });
                    },
                    'cg-icon',
                );
                out.setAttribute('aria-label', `Take ${s.title} out`);
                li.append(songLink(s, box.close), out);
                ul.append(li);
                rise(li, i);
            });
            if (list.length) box.list.append(ul);
            else
                box.list.append(
                    el('p', 'cg-library-empty', 'No songs in here yet.'),
                );
        };
        const toggle = button(
            '',
            () => {
                adding = !adding;
                toggle.textContent = adding ? 'DONE' : 'ADD SONGS';
                toggle.classList.toggle('cg-btn-primary', adding);
                fill();
            },
            'cg-btn',
        );
        toggle.textContent = adding ? 'DONE' : 'ADD SONGS';
        toggle.classList.toggle('cg-btn-primary', adding);

        const rename = button('RENAME', () => {
            const now = collection(id);
            if (!now) return;
            const input = el('input', 'cg-typed-input cg-rename');
            input.value = now.name;
            input.maxLength = 40;
            input.enterKeyHint = 'done';
            const keep = (): void => {
                const name = input.value.trim();
                if (name && name !== now.name) {
                    renameCollection(id, name);
                    draw();
                }
                box.title.textContent = name || now.name;
                input.replaceWith(box.title);
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
            });
            input.addEventListener('blur', keep, { once: true });
            box.title.replaceWith(input);
            popIn(input);
            input.focus();
            input.select();
        });
        const drop = button(
            'DELETE',
            () => {
                const was = collection(id);
                box.close();
                const card = section.querySelector<HTMLElement>(
                    `[data-collection="${id}"]`,
                );
                const gone = (): void => {
                    removeCollection(id);
                    draw();
                    if (!was) return;
                    toast(`Deleted ${was.name}`, {
                        label: 'UNDO',
                        run: () => {
                            restoreCollection(was);
                            draw(new Set([id]));
                        },
                    });
                };
                if (card) fold(card, gone);
                else gone();
            },
            'cg-btn cg-btn-quiet',
        );
        const out = button('EXPORT', () => void exportCollection(id), 'cg-btn');
        box.foot.append(drop, rename, out, toggle);
        fill();
    };

    draw();
    return section;
}

/** a card shrinks sideways out of the shelf */
function fold(card: HTMLElement, then: () => void): void {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = card.animate(
        [
            { opacity: 1, transform: 'none', width: `${card.offsetWidth}px` },
            {
                opacity: 0,
                transform: 'scale(0.9)',
                width: '0px',
                marginRight: '-0.6rem',
            },
        ],
        { duration: still ? 0 : 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
    run.addEventListener('finish', then);
}

const IMPORT_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const MORE_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
