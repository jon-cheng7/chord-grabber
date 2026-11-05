// Song view: the sheet, key, and the song menu

import { popIn, popOut, slideClosed, slideOpen } from './animate.ts';
import {
    SOUNDS,
    holdChord,
    playChords,
    resetVoicing,
    setSound,
    stopHeld,
    type Sound,
} from './audio.ts';
import { findSections } from './arrange.ts';
import { closeEditor, openEditor, sheetText } from './editor.ts';
import { closeArranger, openArranger } from './arranger.ts';
import { closeChooser, openChooser, type ChoiceGroup } from './chooser.ts';
import { chordAt, spots, type Edit } from './edits.ts';
import type { OptionGroup } from './engine/index.ts';
import { exportSong } from './files.ts';
import {
    keyDistance,
    numberChord,
    shiftKey,
    simplifyChord,
    transposeChord,
    usesFlats,
} from './music/theory.ts';
import { parseSheet, type Line } from './parse.ts';
import { printSong } from './print.ts';
import type { MelodyPanel, StylePanel } from './lab/site.ts';
import { toast } from './toast.ts';
import {
    passingGaps,
    say,
    sheetHarmony,
    sheetKey,
    type Gap,
    type SheetHarmony,
} from './reharm.ts';
import { renderSheet } from './render.ts';
import {
    buildView,
    compact,
    type Compact,
    type Step,
    type View as SheetView,
} from './view.ts';
import { makeLink, sendLink } from './share.ts';
import {
    pref,
    setArrangement,
    setEdits,
    setFret,
    updateSheet,
    setPref,
    setShift,
    setTextSize,
    textSize,
    type Saved,
} from './store.ts';
import { numberLines, simplifyLines, transposeLines } from './transpose.ts';

// still in the works, so dev only: reharm, and sing along with playback to collect melody takes
const REHARM = import.meta.env.DEV;
const lab = import.meta.env.DEV ? () => import('./lab/site.ts') : null;

const MIN_SIZE = 12;
const MAX_SIZE = 30;

type View = 'scroll' | 'pages';

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

interface Snap {
    why: string;
    sheet: string;
    shift: number;
    edits: Edit[];
    order: string[] | null;
    at: number;
}

let kept: { id: string; past: Snap[]; future: Snap[] } | null = null;

function history(id: string): { past: Snap[]; future: Snap[] } {
    if (kept?.id !== id) kept = { id, past: [], future: [] };
    return kept;
}

// screen stays on while a song is open
let lock: WakeLockSentinel | null = null;
let wanted = false;

async function wake(): Promise<void> {
    if (!wanted || lock || !('wakeLock' in navigator)) return;
    try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
    } catch {
        // low battery or not allowed: the screen just sleeps
    }
}

document.addEventListener('visibilitychange', () => {
    // the lock drops whenever the tab is hidden
    if (document.visibilityState === 'visible') void wake();
});

let leaveSong: (() => void) | null = null;

/** call before showing anything else */
export function leave(): void {
    wanted = false;
    void lock?.release();
    lock = null;
    leaveSong?.();
    leaveSong = null;
    document.querySelector('.cg-print')?.remove();
}

export function renderSong(app: HTMLElement, s: Saved): void {
    leave();
    wanted = true;
    void wake();
    document.title = `${s.title} · Charts`;
    app.replaceChildren();
    app.dataset.view = 'song';
    app.style.setProperty('--cg-size', `${textSize()}px`);

    const lines = parseSheet(s.sheet);
    // the key as written, never as heard with a capo
    const written = sheetKey(s.key, lines, s.capo);
    let shift = s.shift ?? 0;
    let capo = s.fret ?? 0;
    let simple = pref<boolean>('cg-simple', false);
    let numbers = pref<boolean>('cg-numbers', false);
    let view = pref<View>('cg-view', 'scroll');
    let reharm = REHARM && pref<boolean>('cg-reharm', false);
    let instrument = pref<Sound>('cg-sound', 'keys');
    if (!(instrument in SOUNDS)) instrument = 'keys';
    setSound(instrument);
    let edits: Edit[] = s.edits ?? [];
    // undo and redo outlive a redraw of this song, not a visit to another
    const hist = history(s.id);
    // edits are kept in the written key, so transposing moves them too
    const writtenFlats = written ? usesFlats(written, 0) : false;
    /** semitones from the sheet to what's drawn: the key, less the capo */
    const look = (): number => shift - capo;
    const flatsNow = (): boolean =>
        written ? usesFlats(written, look()) : false;
    const show = (name: string): string =>
        transposeChord(name, look(), flatsNow());
    const store = (name: string): string =>
        transposeChord(name, -look(), writtenFlats);
    /** a drawn chord back up by the capo, to play */
    const sound = (name: string): string =>
        transposeChord(name, capo, flatsNow());

    // arrangement: the sheet's sections in your order, null for as written
    const sections = findSections(lines);
    const arrangeable = sections.library.length >= 2;
    let order: string[] | null = s.arrangement ?? null;
    /** arranged and reharmed; repeats written out so each can be reharmed */
    const current = (): SheetView =>
        buildView(
            lines,
            arrangeable ? sections : null,
            order ?? sections.order,
            edits,
        );
    // what each chord is doing: worked out only when reharm asks, once per redraw
    let harmony: SheetHarmony | null = null;
    const reading = (): SheetHarmony =>
        (harmony ??= sheetHarmony(
            current(),
            arrangeable ? sections : null,
            written,
            writtenFlats,
            edits,
        ));
    // reharm shows the chords as they are, to edit them
    const simpleNow = (): boolean => simple && !reharm;
    const numbersNow = (): boolean => numbers && !reharm && written !== null;
    const display = (ls: readonly Line[]): readonly Line[] => {
        const moved = transposeLines(ls, look(), flatsNow());
        const plain = simpleNow() ? simplifyLines(moved) : moved;
        return numbersNow() && written
            ? numberLines(plain, shiftKey(written, look()))
            : plain;
    };
    /** a chord name as drawn now */
    const drawn = (name: string): string =>
        simpleNow() ? simplifyChord(show(name)) : show(name);
    /** how a chord is written on screen now: a name or a number */
    const label = (name: string): string =>
        numbersNow() && written
            ? numberChord(drawn(name), shiftKey(written, look()))
            : drawn(name);
    const shown = (): readonly Line[] => display(current().lines);
    /** a chord's place as drawn: row:piece */
    const shownAt = (target: Element): string | null =>
        target.closest('.cg-chord')?.closest<HTMLElement>('[data-at]')?.dataset
            .at ?? null;
    const parseAt = (at: string | undefined): [number, number] => {
        const [row = 0, piece = 0] = (at ?? '').split(':').map(Number);
        return [row, piece];
    };

    const keyLabel = (): string => {
        const sign = shift > 0 ? '+' : '−';
        const offset = shift ? ` ${sign}${Math.abs(shift)}` : '';
        const sounds = written
            ? `KEY ${shift ? shiftKey(written, shift) : written}${offset}`
            : `KEY${offset || ' —'}`;
        return capo ? `${sounds} · CAPO ${capo}` : sounds;
    };

    // top bar: back, titles, share, menu
    const bar = el('header', 'cg-bar');
    const back = el('a', 'cg-icon', '←');
    back.href = '#';
    back.setAttribute('aria-label', 'Back');
    const titles = el('div', 'cg-titles');
    titles.append(
        el('h1', 'cg-title', s.title),
        el('p', 'cg-artist', s.artist),
    );
    const playBtn = button(
        '',
        () => (stepping ? stopStep() : startStep()),
        'cg-icon',
    );
    playBtn.title = 'Play from the top of the screen, or tap any chord';
    playBtn.innerHTML = PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play the chords');
    const shareBtn = button('', () => openPop(sharePop, shareBtn), 'cg-icon');
    shareBtn.innerHTML = SHARE_ICON;
    shareBtn.setAttribute('aria-label', 'Share or print');
    const menuBtn = button('', () => openPop(menuPop, menuBtn), 'cg-icon');
    menuBtn.innerHTML = MENU_ICON;
    menuBtn.setAttribute('aria-label', 'Song options');

    const sharePop = popover([
        {
            items: [
                {
                    label: 'Share link',
                    pick: () => {
                        if (!link) {
                            toast('One moment…');
                            return;
                        }
                        void sendLink(link, `${s.title} · Charts`).then(
                            (how) => {
                                if (how === 'copied') toast('Link copied');
                                if (how === 'failed') toast('Couldn’t share');
                            },
                        );
                    },
                },
                {
                    label: 'Export file',
                    pick: () => void exportSong(s.id),
                },
                {
                    label: 'Print',
                    pick: () =>
                        // like playback: each section once, the order on top
                        printSong(
                            s,
                            renderSheet(display(compact(current()).lines)),
                            keyLabel(),
                            arrangeable
                                ? `ORDER  ${orderTags().join('  ')}`
                                : '',
                        ),
                },
            ],
        },
    ]);
    const menuPop = popover([
        {
            label: 'CHORDS',
            items: [
                {
                    label: 'Simplify chords',
                    on: () => simple,
                    pick: () => {
                        simple = !simple;
                        setPref('cg-simple', simple);
                        draw();
                    },
                },
                {
                    label: 'Capo',
                    on: () => capo > 0,
                    pick: () => {
                        fillCapos();
                        only(capos);
                        slideOpen(capos);
                        settle();
                    },
                },
                {
                    label: 'Numerals',
                    on: () => numbers,
                    pick: () => {
                        numbers = !numbers;
                        setPref('cg-numbers', numbers);
                        if (numbers && !written) toast('No key to count from');
                        draw();
                    },
                },
            ],
        },
        {
            label: 'PLAYBACK',
            items: [
                {
                    label: 'Sound',
                    pick: () => {
                        fillSounds();
                        only(sounds);
                        if (sounds.hidden) slideOpen(sounds);
                        else slideClosed(sounds);
                        settle();
                    },
                },
            ],
        },
        {
            label: 'SONG',
            items: [
                {
                    label: 'Edit lyrics & chords',
                    pick: () => editSheet(),
                },
            ],
        },
        {
            label: 'VIEW',
            items: [
                {
                    label: 'Scroll view',
                    on: () => view === 'scroll',
                    pick: () => setView('scroll'),
                },
                {
                    label: 'Page view',
                    on: () => view === 'pages',
                    pick: () => setView('pages'),
                },
            ],
        },
    ]);
    bar.append(back, titles, playBtn, shareBtn, menuBtn, sharePop, menuPop);
    const setView = (next: View): void => {
        view = next;
        setPref('cg-view', view);
        layout();
    };

    // key row: transpose, then text size
    const keyText = el('span', 'cg-key');
    // reharm sits right under the key, on or off at a glance
    const tools = el('div', 'cg-tools');
    const reharmBtn = button(
        '',
        () => {
            reharm = !reharm;
            setPref('cg-reharm', reharm);
            if (reharm && stepping) stopStep();
            if (!reharm) closeChooser();
            draw();
        },
        'cg-reharm-btn',
    );
    reharmBtn.innerHTML = `${SPARK_ICON}<span>REHARM</span>`;
    reharmBtn.hidden = !REHARM;
    const hint = el('p', 'cg-tools-hint');
    const clear = button(
        'CLEAR',
        () => {
            saveEdits([], 'Cleared reharm');
            toastUndo('Reharm cleared');
        },
        'cg-tools-clear',
    );
    const undoBtn = button('', () => undo(), 'cg-icon cg-history');
    undoBtn.innerHTML = UNDO_ICON;
    undoBtn.setAttribute('aria-label', 'Undo');
    const redoBtn = button('', () => redo(), 'cg-icon cg-history');
    redoBtn.innerHTML = REDO_ICON;
    redoBtn.setAttribute('aria-label', 'Redo');
    const historyBox = el('div', 'cg-history-box');
    historyBox.append(undoBtn, redoBtn);
    tools.append(reharmBtn, hint, clear, historyBox);
    const syncHistory = (): void => {
        undoBtn.disabled = !hist.past.length;
        redoBtn.disabled = !hist.future.length;
        undoBtn.title = hist.past.length
            ? `Undo ${hist.past[hist.past.length - 1]!.why.toLowerCase()}`
            : 'Nothing to undo';
        redoBtn.title = hist.future.length
            ? `Redo ${hist.future[hist.future.length - 1]!.why.toLowerCase()}`
            : 'Nothing to redo';
        // out of the way until there's something to undo
        historyBox.hidden = !hist.past.length && !hist.future.length;
        // without reharm the row is only for undo and a shared song's changes
        tools.hidden = !REHARM && historyBox.hidden && !edits.length;
    };

    // the arrangement, always in view; tap to change it
    const orderBar = button('', () => openOrder(), 'cg-order');
    orderBar.setAttribute('aria-label', 'Arrange the song');
    orderBar.hidden = !arrangeable;
    /** short names in order; * marks a time round that's been reharmed */
    const orderTags = (): string[] => {
        const blocks = current().blocks;
        const first = new Map<string, string>();
        for (const b of blocks) if (!first.has(b.id)) first.set(b.id, b.sig);
        return blocks.map((b) => {
            const short =
                sections.library.find((x) => x.id === b.id)?.short ?? '?';
            return first.get(b.id) === b.sig ? short : `${short}*`;
        });
    };
    const syncOrder = (playing = -1): void => {
        orderBar.replaceChildren(
            el('span', 'cg-order-label', order ? 'ARRANGED' : 'ORDER'),
            ...orderTags().map((short, i) => {
                const tag = el('span', 'cg-order-tag', short);
                if (i === playing) tag.classList.add('cg-on');
                return tag;
            }),
            el('span', 'cg-order-edit', 'EDIT'),
        );
    };
    const openOrder = (): void =>
        openArranger({
            library: sections.library,
            order: order ?? sections.order,
            original: sections.order,
            done: (next) => {
                const same = next.join() === sections.order.join();
                if ((same ? null : next)?.join() === order?.join()) return;
                record('Arrangement');
                order = same ? null : next;
                setArrangement(s.id, order);
                if (stepping) stopStep();
                draw();
                relink();
                toastUndo(same ? 'Back to the original order' : 'Arranged');
            },
        });
    // reharm, history and the order stay pinned under the bar
    const dock = el('div', 'cg-dock');
    dock.append(tools, orderBar);
    let stuck = false;
    /** pinned, the dock folds to one row; its margin keeps the sheet still */
    const pin = (): void => {
        const now = key.getBoundingClientRect().bottom < bar.offsetHeight;
        if (now === stuck) return;
        stuck = now;
        const tall = dock.getBoundingClientRect().height;
        dock.classList.toggle('cg-stuck', stuck);
        dock.style.marginBottom = stuck
            ? `${tall - dock.getBoundingClientRect().height}px`
            : '';
    };
    const syncTools = (): void => {
        reharmBtn.classList.toggle('cg-on', reharm);
        reharmBtn.setAttribute('aria-pressed', String(reharm));
        hint.textContent = reharm
            ? 'Tap a chord to change it · + adds a passing chord'
            : edits.length
              ? `${edits.length} change${edits.length > 1 ? 's' : ''}`
              : '';
        clear.hidden = !edits.length;
    };
    const key = el('div', 'cg-transpose');
    const middle = button(
        '',
        () => {
            if (!written) return;
            if (picker.hidden) fillPicker(true);
            only(picker);
            if (picker.hidden) slideOpen(picker);
            else slideClosed(picker);
            settle();
        },
        'cg-key-btn',
    );
    middle.append(keyText);
    middle.setAttribute('aria-label', 'Pick a key');
    const setSize = (px: number): void => {
        const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, px));
        app.style.setProperty('--cg-size', `${next}px`);
        setTextSize(next);
        layout();
    };
    const sizes = el('div', 'cg-sizes');
    sizes.append(
        button('A−', () => setSize(textSize() - 1), 'cg-icon cg-icon-small'),
        button('A+', () => setSize(textSize() + 1), 'cg-icon'),
    );
    key.append(
        button('♭', () => move(-1), 'cg-icon'),
        middle,
        button('♯', () => move(1), 'cg-icon'),
        sizes,
    );

    // every key, chromatic from C, original marked
    const picker = el('div', 'cg-keys');
    picker.hidden = true;
    const fillPicker = (force = false): void => {
        if (!written || (picker.hidden && !force)) return;
        const minorKey = /m$/.test(shiftKey(written, 0));
        picker.replaceChildren(
            ...Array.from({ length: 12 }, (_, i) => {
                const name = shiftKey(minorKey ? 'Cm' : 'C', i);
                const to = keyDistance(written, name);
                const pick = button(
                    name,
                    () => {
                        move(to - shift);
                        slideClosed(picker);
                        settle();
                    },
                    'cg-key',
                );
                if (to === 0) pick.classList.add('cg-key-home');
                if ((to - shift) % 12 === 0) pick.classList.add('cg-key-on');
                return pick;
            }),
        );
    };

    // capo: same sound, easier shapes; each fret shows the key you'd play in
    const capos = el('div', 'cg-keys cg-capos');
    capos.hidden = true;
    const fillCapos = (): void =>
        capos.replaceChildren(
            ...Array.from({ length: 8 }, (_, fret) => {
                const pick = button(
                    fret ? String(fret) : 'NONE',
                    () => {
                        capo = fret;
                        setFret(s.id, capo);
                        slideClosed(capos);
                        draw();
                        settle();
                    },
                    'cg-key',
                );
                if (written)
                    pick.append(
                        el(
                            'span',
                            'cg-key-sub',
                            shiftKey(written, shift - fret),
                        ),
                    );
                if (fret === capo) pick.classList.add('cg-key-on');
                return pick;
            }),
        );

    // sounds: a mood each; picking one plays the key's chord in it
    const sounds = el('div', 'cg-keys cg-sounds');
    sounds.hidden = true;
    const fillSounds = (): void =>
        sounds.replaceChildren(
            ...(Object.keys(SOUNDS) as Sound[]).map((id) => {
                const pick = button(
                    SOUNDS[id].label,
                    () => {
                        instrument = id;
                        setSound(id);
                        setPref('cg-sound', id);
                        fillSounds();
                        if (stepping) go(cursor);
                        else if (written) playChords([sound(show(written))]);
                    },
                    'cg-key',
                );
                pick.append(el('span', 'cg-key-sub', SOUNDS[id].mood));
                if (id === instrument) pick.classList.add('cg-key-on');
                return pick;
            }),
        );
    /** one panel under the key at a time */
    const only = (keep: HTMLElement): void => {
        for (const p of [picker, capos, sounds])
            if (p !== keep && !p.hidden) slideClosed(p);
    };

    // sheet, scrolled or in pages
    const sheet = el('article', 'cg-sheet');
    const pager = el('div', 'cg-pager');
    const count = el('span', 'cg-pager-count');
    const prev = button(
        '‹',
        () => goTo(pageIndex - 1),
        'cg-icon cg-page-arrow',
    );
    const next = button(
        '›',
        () => goTo(pageIndex + 1),
        'cg-icon cg-page-arrow',
    );
    prev.setAttribute('aria-label', 'Previous page');
    next.setAttribute('aria-label', 'Next page');
    pager.append(prev, count, next);
    let pageIndex = 0;
    const pageCount = (): number =>
        Math.max(1, Math.round(sheet.scrollWidth / step()));
    const step = (): number =>
        sheet.clientWidth +
        parseFloat(getComputedStyle(sheet).columnGap || '0');
    const goTo = (n: number, smooth = true): void => {
        pageIndex = Math.min(pageCount() - 1, Math.max(0, n));
        sheet.scrollTo({
            left: pageIndex * step(),
            behavior: smooth ? 'smooth' : 'instant',
        });
        count.textContent = `${pageIndex + 1} / ${pageCount()}`;
        prev.disabled = pageIndex === 0;
        next.disabled = pageIndex === pageCount() - 1;
    };
    const layout = (): void => {
        const paged = view === 'pages';
        sheet.classList.toggle('cg-paged', paged);
        pager.hidden = !paged;
        if (!paged) {
            sheet.style.height = '';
            return;
        }
        window.scrollTo(0, 0);
        const top = sheet.getBoundingClientRect().top;
        const below =
            pager.offsetHeight + 16 + (stepping ? stepBar.offsetHeight : 0);
        sheet.style.height = `${Math.max(200, innerHeight - top - below)}px`;
        goTo(pageIndex, false);
    };
    let startX = 0;
    let startY = 0;
    sheet.addEventListener(
        'touchstart',
        (e) => {
            startX = e.touches[0]?.clientX ?? 0;
            startY = e.touches[0]?.clientY ?? 0;
        },
        { passive: true },
    );
    sheet.addEventListener('touchend', (e) => {
        if (view !== 'pages') return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))
            goTo(pageIndex + (dx < 0 ? 1 : -1));
    });
    sheet.addEventListener('click', (e) => {
        if (stepping) {
            tapStep(e.target as Element);
            return;
        }
        if (reharm && tapReharm(e.target as Element)) return;
        // tapping a chord plays from there
        const at = shownAt(e.target as Element);
        if (!reharm && at) {
            startStep(at);
            return;
        }
        if (view !== 'pages') return;
        // edge taps turn the page too
        const x = e.clientX / innerWidth;
        if (x > 0.75) goTo(pageIndex + 1);
        else if (x < 0.25) goTo(pageIndex - 1);
    });
    const keys = (e: KeyboardEvent): void => {
        // a text field keeps its own keys: backspace, space, undo
        if ((e.target as Element | null)?.closest('input, textarea')) return;
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }
        if (mod && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
            return;
        }
        if (stepping) {
            // pedals send these too
            if ([' ', 'ArrowRight', 'PageDown', 'Enter'].includes(e.key)) {
                e.preventDefault();
                go(cursor + 1);
            } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
                e.preventDefault();
                go(cursor - 1);
            } else if (e.key === 'Escape') stopStep();
            return;
        }
        if (view !== 'pages') return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(pageIndex + 1);
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(pageIndex - 1);
    };
    const resize = (): void => layout();
    // pages refit once a panel has finished moving
    const settle = (): void => {
        if (view === 'pages') window.setTimeout(layout, 260);
    };
    addEventListener('keydown', keys);
    addEventListener('resize', resize);
    addEventListener('scroll', pin, { passive: true });
    leaveSong = () => {
        closeArranger();
        closeEditor();
        stopHeld();
        melody?.remove();
        melody = null;
        styles?.remove();
        styles = null;
        app.classList.remove('cg-has-stepbar');
        stepBar.remove();
        closeChooser();
        removeEventListener('keydown', keys);
        removeEventListener('resize', resize);
        removeEventListener('scroll', pin);
    };

    // playing draws each different section once and jumps back for repeats
    let packed: Compact | null = null;
    const draw = (): void => {
        harmony = null;
        packed = stepping ? compact(current()) : null;
        sheet.replaceChildren(
            renderSheet(packed ? display(packed.lines) : shown()),
        );
        sheet.classList.toggle('cg-reharm', reharm);
        syncTools();
        syncHistory();
        syncOrder(stepping ? (steps()[cursor]?.block ?? -1) : -1);
        if (reharm && !stepping) decorate();
        if (stepping) mark();
        keyText.textContent = keyLabel();
        fillPicker();
        if (!capos.hidden) fillCapos();
        if (view === 'pages') layout();
    };
    // reharm: tappable chords, edits marked, passing-chord gaps
    const saveEdits = (next: Edit[], why = 'Reharm'): void => {
        record(why);
        edits = next;
        setEdits(s.id, edits);
        draw();
        relink();
    };
    /** edits with one more chord set at row:piece, for this time round */
    const withAt = (
        list: Edit[],
        v: SheetView,
        at: { row: number; piece: number; chord: string | null },
    ): Edit[] => {
        const { row, piece, chord } = at;
        const line = v.origin[row] ?? -1;
        if (line < 0) return list;
        const occ = v.occ[row] ?? 0;
        const original = chordAt(v.raw, row, piece);
        const here = (e: Edit): boolean => e.line === line && e.piece === piece;
        const rest = list.filter((e) => !(here(e) && e.occ === occ));
        const everyTime = rest.some((e) => here(e) && e.occ === undefined);
        // back to the sheet's own chord: no edit needed
        if (chord === original && !everyTime) return rest;
        return [
            ...rest,
            original === null
                ? { line, piece, chord, occ, added: true }
                : { line, piece, chord, occ },
        ];
    };
    const setAt = (row: number, piece: number, chord: string | null) =>
        saveEdits(withAt(edits, current(), { row, piece, chord }));
    /** a pick and the chords that follow it: one change, one undo */
    const setMany = (
        changes: { row: number; piece: number; chord: string }[],
    ): void => {
        const v = current();
        saveEdits(
            changes.reduce((list, c) => withAt(list, v, c), edits),
            'Reharm move',
        );
    };
    const neighbours = (
        row: number,
        piece: number,
    ): [string | null, string | null] => {
        const all = spots(current().lines);
        const earlier = (x: { line: number; piece: number }): boolean =>
            x.line < row || (x.line === row && x.piece < piece);
        const before = all.filter(earlier).pop();
        const after = all.find(
            (x) => !earlier(x) && (x.line !== row || x.piece !== piece),
        );
        return [before?.chord ?? null, after?.chord ?? null];
    };
    /** heard where it sits: the chord before, then it, then the chord after */
    const inPlace = (before: string | null, after: string | null) => {
        const around = (c: string | null): void =>
            playChords(
                [before && show(before), c, after && show(after)]
                    .filter((x): x is string => !!x)
                    .map(sound),
            );
        return { hear: (c: string) => around(c), asIs: around };
    };
    /** the engine's options as the reader sees them */
    const showGroups = (groups: OptionGroup[]): ChoiceGroup[] =>
        groups.map((g) => ({
            label: g.label,
            options: g.options.map((o) => ({
                chord: show(o.chord),
                why: say(o.why, show),
            })),
        }));
    let gaps: Gap[] = [];
    const slotAt = (row: number, piece: number): Element | null => {
        const node = sheet.querySelector(`[data-at="${row}:${piece}"]`);
        if (!node) return null;
        // a lyric word's chord slot, or the spot itself in a chord line
        return node.classList.contains('cg-chord') ||
            node.classList.contains('cg-filler')
            ? node
            : node.querySelector('.cg-chord');
    };
    const decorate = (): void => {
        const v = current();
        // compare against the sheet as written: changed, added, removed
        const was = new Map(
            spots(v.raw).map((x) => [`${x.line}:${x.piece}`, x.chord]),
        );
        const now = new Map(
            spots(v.lines).map((x) => [`${x.line}:${x.piece}`, x.chord]),
        );
        for (const [at, chord] of now) {
            const before = was.get(at);
            if (before === chord) continue;
            const [row, piece] = parseAt(at);
            slotAt(row, piece)?.classList.add(
                before ? 'cg-chord-edited' : 'cg-chord-added',
            );
        }
        for (const [at, chord] of was) {
            if (now.has(at)) continue;
            const [row, piece] = parseAt(at);
            const slot = slotAt(row, piece);
            if (!slot || slot.textContent) continue;
            const ghost = el('button', 'cg-ghost', show(chord));
            ghost.type = 'button';
            ghost.dataset.at = at;
            ghost.setAttribute('aria-label', `Bring back ${show(chord)}`);
            slot.append(ghost);
        }
        gaps = passingGaps(v.lines, reading());
        for (const g of gaps) {
            const slot = slotAt(g.line, g.piece);
            if (!slot || slot.textContent) continue;
            const plus = el('button', 'cg-gap', '+');
            plus.type = 'button';
            plus.dataset.gap = `${g.line}:${g.piece}`;
            plus.setAttribute('aria-label', `Passing chord into ${show(g.to)}`);
            slot.append(plus);
        }
    };
    const tapReharm = (target: Element): boolean => {
        const v = current();
        // a removed chord, shown faintly: tap to bring it back
        const ghost = target.closest<HTMLElement>('.cg-ghost');
        if (ghost) {
            const [row, piece] = parseAt(ghost.dataset.at);
            const original = chordAt(v.raw, row, piece);
            if (original) {
                const [before, after] = neighbours(row, piece);
                setAt(row, piece, original);
                inPlace(before, after).hear(show(original));
            }
            return true;
        }
        const plus = target.closest<HTMLElement>('.cg-gap');
        if (plus) {
            const [row, piece] = parseAt(plus.dataset.gap);
            const g = gaps.find((x) => x.line === row && x.piece === piece);
            if (!g) return true;
            const around = inPlace(g.from, g.to);
            openChooser({
                title: `Passing chord: ${show(g.from)} → ${show(g.to)}`,
                current: null,
                groups: showGroups([{ label: 'TRY', options: g.options }]),
                hear: around.hear,
                compare: () => around.asIs(null),
                choose: (c) => setAt(row, piece, store(c)),
            });
            return true;
        }
        const node = target
            .closest('.cg-chord, .cg-words, .cg-plain')
            ?.closest<HTMLElement>('[data-at]');
        if (!node) return false;
        const [row, piece] = parseAt(node.dataset.at);
        const now = chordAt(v.lines, row, piece);
        if (!now) {
            // a bare word: your own chord only, no suggestions
            const word = node.textContent?.trim();
            if (!word) return false;
            const around = inPlace(...neighbours(row, piece));
            openChooser({
                title: `Add a chord on “${word}”`,
                current: null,
                groups: [],
                hear: around.hear,
                compare: () => around.asIs(null),
                choose: (c) => setAt(row, piece, store(c)),
            });
            return true;
        }
        const original = chordAt(v.raw, row, piece);
        const h = reading();
        const id = h.id(row, piece);
        const here = h.engine.read(id);
        // an added chord stays a passing chord: only passing options
        const [before, after] = neighbours(row, piece);
        const around = inPlace(before, after);
        const pass =
            original === null && before && after
                ? h.engine.between(before, after, id)
                : null;
        const source = original ?? now;
        const homeKey = written && shiftKey(written, 0);
        openChooser({
            title: pass
                ? `Passing chord: ${show(before!)} → ${show(after!)}`
                : `Replace ${show(now)}`,
            current: show(now),
            reading: here?.numeral
                ? here.key === homeKey
                    ? here.numeral
                    : `${here.numeral} in ${show(here.key)}`
                : undefined,
            groups: showGroups(
                pass
                    ? [{ label: 'TRY', options: pass.options }]
                    : h.engine.suggest(id, source),
            ),
            hear: around.hear,
            compare: () => around.asIs(show(now)),
            choose: (c) => setAt(row, piece, store(c)),
            follow: (c) => {
                const chord = store(c);
                if (pass || !h.engine.reaches(id, source, chord)) return [];
                return h.engine.followUps(id, chord).map((w) => ({
                    label: w.name,
                    why: say(w.why, show),
                    chords: w.window.map(show).join(' → '),
                    hear: () => playChords(w.window.map((x) => sound(show(x)))),
                    apply: () =>
                        setMany([
                            { row, piece, chord },
                            ...w.changes.flatMap((x) => {
                                const at = h.place(x.id);
                                return at ? [{ ...at, chord: x.chord }] : [];
                            }),
                        ]),
                }));
            },
            revert:
                original && original !== now
                    ? () => setAt(row, piece, original)
                    : undefined,
            remove: () => setAt(row, piece, null),
        });
        return true;
    };

    // step mode: one chord at a time, tap or pedal for the next
    let stepping = false;
    let cursor = 0;
    // a melody take: the pop-out arms it, play records, pause ends it; tapped: the step last marked
    let melody: MelodyPanel | null = null;
    let tapped = -1;
    // style A/B: two whole-song reharms, a passage of each heard, you pick
    let styles: StylePanel | null = null;
    void lab?.().then((m) => {
        if (!app.contains(sheet)) return;
        melody = m.melodyPanel(() => ({
            song: s.title,
            key: written ? shiftKey(written, shift) : undefined,
        }));
        styles = m.stylePanel({
            title: s.title,
            song: () => reading().song,
            show,
            hear: (chords) =>
                playChords(
                    chords.map((c) => sound(show(c))),
                    1.6,
                ),
            apply: (changes) => {
                const h = reading();
                setMany(
                    changes.flatMap((c) => {
                        const at = h.place(c.id);
                        return at ? [{ ...at, chord: c.chord }] : [];
                    }),
                );
            },
        });
    });
    const stepBar = el('div', 'cg-stepbar');
    stepBar.hidden = true;
    const nowName = el('span', 'cg-step-now');
    const nextName = el('span', 'cg-step-next');
    const names = el('div', 'cg-step-names');
    names.append(nowName, nextName);
    stepBar.append(
        button('◀', () => go(cursor - 1), 'cg-icon'),
        names,
        button('▶', () => go(cursor + 1), 'cg-icon'),
        button('■', () => stopStep(), 'cg-icon'),
    );
    const steps = (): Step[] => packed?.steps ?? [];
    const nodeAt = (row: number, piece: number): Element | null => {
        const node = sheet.querySelector(`[data-at="${row}:${piece}"]`);
        return node?.classList.contains('cg-chord')
            ? node
            : (node?.querySelector('.cg-chord') ?? null);
    };
    const mark = (): void => {
        sheet.querySelector('.cg-now')?.classList.remove('cg-now');
        const at = steps()[cursor];
        if (at) nodeAt(at.row, at.piece)?.classList.add('cg-now');
    };
    const follow = (node: Element): void => {
        if (view === 'pages') {
            const left =
                node.getBoundingClientRect().left -
                sheet.getBoundingClientRect().left +
                sheet.scrollLeft;
            const page = Math.floor(left / step());
            if (page !== pageIndex) goTo(page);
            return;
        }
        const r = node.getBoundingClientRect();
        if (r.top < innerHeight * 0.25 || r.bottom > innerHeight * 0.7)
            node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const go = (i: number): void => {
        const list = steps();
        if (!list.length) return;
        cursor = Math.min(list.length - 1, Math.max(0, i));
        const at = list[cursor]!;
        holdChord(sound(drawn(at.chord)));
        if (cursor !== tapped) {
            melody?.tap(sound(drawn(at.chord)));
            tapped = cursor;
        }
        mark();
        syncOrder(at.block);
        nowName.textContent = label(at.chord);
        const after = list[cursor + 1];
        nextName.textContent = after ? `then ${label(after.chord)}` : 'end';
        const node = nodeAt(at.row, at.piece);
        if (node) follow(node);
    };
    /** at: a chord's row:piece in the full sheet, else the first on screen */
    const startStep = (at?: string): void => {
        if (melody?.armed()) {
            const m = melody;
            void m.begin().then((ok) => {
                if (ok) startStep(at);
            });
            return;
        }
        tapped = -1;
        const from =
            at ??
            [...sheet.querySelectorAll<HTMLElement>('[data-at]')].find((n) => {
                const r = n.getBoundingClientRect();
                return (
                    n.querySelector('.cg-chord')?.textContent?.trim() &&
                    r.top > 0 &&
                    r.left >= 0 &&
                    r.right <= innerWidth
                );
            })?.dataset.at;
        stepping = true;
        closeChooser();
        resetVoicing();
        playBtn.innerHTML = STOP_ICON;
        playBtn.setAttribute('aria-label', 'Stop playing');
        sheet.classList.add('cg-stepping');
        popIn(stepBar);
        app.classList.add('cg-has-stepbar');
        draw();
        const [row, piece] = parseAt(from);
        const first = from
            ? steps().findIndex((x) => x.src === row && x.piece === piece)
            : 0;
        go(Math.max(0, first));
    };
    const stopStep = (): void => {
        const at = steps()[cursor];
        stepping = false;
        stopHeld();
        melody?.end();
        playBtn.innerHTML = PLAY_ICON;
        playBtn.setAttribute('aria-label', 'Play the chords');
        sheet.classList.remove('cg-stepping');
        draw();
        // back in the full sheet, at the copy that was playing
        if (at) {
            const node = sheet.querySelector(
                `[data-at="${at.src}:${at.piece}"]`,
            );
            if (node) follow(node);
        }
        popOut(stepBar, () => {
            app.classList.remove('cg-has-stepbar');
            if (view === 'pages') layout();
        });
    };
    /** a chord jumps there (its next time round), anywhere else is next */
    const tapStep = (target: Element): void => {
        const at = shownAt(target);
        if (at) {
            const [row, piece] = parseAt(at);
            const list = steps();
            const hits = list
                .map((x, i) => (x.row === row && x.piece === piece ? i : -1))
                .filter((i) => i >= 0);
            const i = hits.find((x) => x > cursor) ?? hits[0];
            if (i !== undefined) {
                go(i);
                return;
            }
        }
        go(cursor + 1);
    };

    const snap = (why: string): Snap => ({
        why,
        sheet: s.sheet,
        shift,
        edits,
        order,
        at: Date.now(),
    });
    /** before a change: remember how it was */
    function record(why: string, merge = false): void {
        const last = hist.past[hist.past.length - 1];
        if (merge && last?.why === why && Date.now() - last.at < 2000) {
            last.at = Date.now();
            return;
        }
        hist.past.push(snap(why));
        if (hist.past.length > 60) hist.past.shift();
        hist.future = [];
    }
    const restore = (to: Snap): void => {
        if (to.sheet !== s.sheet) {
            const updated = updateSheet(s.id, to.sheet, to.edits, to.order);
            setShift(s.id, to.shift);
            if (updated) renderSong(app, { ...updated, shift: to.shift });
            return;
        }
        shift = to.shift;
        edits = to.edits;
        order = to.order;
        setShift(s.id, shift);
        setEdits(s.id, edits);
        setArrangement(s.id, order);
        if (stepping) stopStep();
        closeChooser();
        draw();
        relink();
    };
    function undo(): void {
        const to = hist.past.pop();
        if (!to) return;
        hist.future.push(snap(to.why));
        restore(to);
        toast(`Undid ${to.why.toLowerCase()}`);
    }
    function redo(): void {
        const to = hist.future.pop();
        if (!to) return;
        hist.past.push(snap(to.why));
        restore(to);
        toast(`Redid ${to.why.toLowerCase()}`);
    }
    /** a change worth a second chance: the message carries an undo */
    const toastUndo = (text: string): void =>
        toast(text, { label: 'UNDO', run: undo });

    const editSheet = (): void => {
        if (stepping) stopStep();
        closeChooser();
        openEditor({
            text: sheetText(lines),
            save: (text) => {
                const next = parseSheet(text);
                // keep reharm on lines that didn't change; sections must still exist
                const same = (i: number): boolean =>
                    JSON.stringify(lines[i]) === JSON.stringify(next[i]);
                const kept = edits.filter((e) => same(e.line));
                const ids = new Set(
                    findSections(next).library.map((x) => x.id),
                );
                const keepOrder = order?.every((id) => ids.has(id))
                    ? order
                    : null;
                record('Lyrics');
                const updated = updateSheet(s.id, text, kept, keepOrder);
                if (updated) renderSong(app, updated);
                toastUndo('Lyrics saved');
            },
        });
    };

    let link = '';
    const relink = (): void => {
        link = '';
        const at = shift;
        void makeLink(s, at, edits, order).then((made) => {
            if (at === shift) link = made;
        });
    };
    const move = (by: number): void => {
        // a run of key taps undoes as one
        record('Key', true);
        const next = shift + by;
        // a full octave round is the original
        shift = Math.abs(next) >= 12 ? 0 : next;
        setShift(s.id, shift);
        draw();
        relink();
    };

    app.append(bar, key, dock, picker, capos, sounds, sheet, pager, stepBar);
    draw();
    relink();
    layout();
    if (view === 'scroll') window.scrollTo(0, 0);
}

const SPARK_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';
const UNDO_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const REDO_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';
const PLAY_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const STOP_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const SHARE_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const MENU_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

interface Item {
    label: string;
    /** a check when true; plain action when absent */
    on?: () => boolean;
    pick: () => void;
}

interface Group {
    label?: string;
    items: Item[];
}

/** a small menu card under the bar; picking anything closes it */
function popover(groups: Group[]): HTMLDivElement {
    const pop = el('div', 'cg-pop');
    pop.hidden = true;
    pop.setAttribute('role', 'menu');
    const refresh: (() => void)[] = [];
    for (const group of groups) {
        const section = el('div', 'cg-pop-group');
        if (group.label) section.append(el('p', 'cg-pop-label', group.label));
        for (const item of group.items) {
            const row = button(
                '',
                () => {
                    item.pick();
                    popOut(pop);
                },
                'cg-pop-item',
            );
            row.setAttribute('role', item.on ? 'menuitemcheckbox' : 'menuitem');
            const check = el('span', 'cg-pop-check', '✓');
            row.append(el('span', 'cg-pop-text', item.label), check);
            if (item.on) {
                const on = item.on;
                refresh.push(() => {
                    check.hidden = !on();
                    row.setAttribute('aria-checked', String(on()));
                });
            } else check.hidden = true;
            section.append(row);
        }
        pop.append(section);
    }
    pop.addEventListener('cg-open', () => refresh.forEach((r) => r()));
    return pop;
}

let openNow: HTMLElement | null = null;

function openPop(pop: HTMLElement, from: HTMLElement): void {
    if (openNow && openNow !== pop) popOut(openNow);
    if (!pop.hidden) {
        popOut(pop);
        return;
    }
    pop.dispatchEvent(new Event('cg-open'));
    popIn(pop);
    openNow = pop;
    // tap anywhere else closes it
    const away = (e: PointerEvent): void => {
        const t = e.target as Node;
        if (pop.contains(t) || from.contains(t)) return;
        popOut(pop);
        document.removeEventListener('pointerdown', away);
    };
    document.addEventListener('pointerdown', away);
    pop.addEventListener(
        'cg-closed',
        () => document.removeEventListener('pointerdown', away),
        { once: true },
    );
}
