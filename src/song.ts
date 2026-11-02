// Song view: the sheet, key, and the song menu

import { popIn, popOut, slideClosed, slideOpen } from './animate.ts';
import { holdChord, playChords, resetVoicing, stopHeld } from './audio.ts';
import { findSections } from './arrange.ts';
import { openEditor, sheetText } from './editor.ts';
import { closeArranger, openArranger } from './arranger.ts';
import { closeChooser, openChooser } from './chooser.ts';
import { parseSheet, type Line } from './parse.ts';
import { printSong } from './print.ts';
import {
    chordAt,
    passing,
    passingGaps,
    spots,
    suggestFor,
    type Edit,
    type OptionGroup,
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
    updateSheet,
    setPref,
    setShift,
    setTextSize,
    textSize,
    type Saved,
} from './store.ts';
import {
    firstChord,
    keyDistance,
    shiftKey,
    simplifyChord,
    simplifyLines,
    transposeChord,
    transposeLines,
    usesFlats,
} from './transpose.ts';

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
    document.title = `${s.title} · Chord Grabber`;
    app.replaceChildren();
    app.dataset.view = 'song';
    app.style.setProperty('--cg-size', `${textSize()}px`);

    const lines = parseSheet(s.sheet);
    // spelling follows the chords as written, not as heard
    const written =
        (s.key && s.capo ? shiftKey(s.key, -s.capo) : s.key) ??
        firstChord(lines);
    const home = s.key ?? written;
    let shift = s.shift ?? 0;
    let simple = pref<boolean>('cg-simple', false);
    let view = pref<View>('cg-view', 'scroll');
    let reharm = pref<boolean>('cg-reharm', false);
    let edits: Edit[] = s.edits ?? [];
    // edits are kept in the written key, so transposing moves them too
    const writtenFlats = written ? usesFlats(written, 0) : false;
    const flatsNow = (): boolean =>
        written ? usesFlats(written, shift) : false;
    const show = (name: string): string =>
        transposeChord(name, shift, flatsNow());
    const store = (name: string): string =>
        transposeChord(name, -shift, writtenFlats);

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
    const display = (ls: readonly Line[]): readonly Line[] => {
        const moved = transposeLines(ls, shift, flatsNow());
        // reharm shows the chords as they are, to edit them
        return simple && !reharm ? simplifyLines(moved) : moved;
    };
    /** a chord name as it sounds now */
    const heard = (name: string): string =>
        simple && !reharm ? simplifyChord(show(name)) : show(name);
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
        return [
            s.key
                ? `KEY ${shift ? shiftKey(s.key, shift) : s.key}${offset}`
                : `KEY${offset || ' —'}`,
            s.capo && `CAPO ${s.capo}`,
        ]
            .filter(Boolean)
            .join(' · ');
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
                        void sendLink(link, `${s.title} · Chord Grabber`).then(
                            (how) => {
                                if (how === 'copied') toast('Link copied');
                                if (how === 'failed') toast('Couldn’t share');
                            },
                        );
                    },
                },
                {
                    label: 'Print',
                    pick: () =>
                        printSong(s, renderSheet(shown()), keyLabel()),
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
    const hint = el('p', 'cg-tools-hint');
    const clear = button(
        'CLEAR',
        () => {
            saveEdits([]);
            toast('Back to the original');
        },
        'cg-tools-clear',
    );
    tools.append(reharmBtn, hint, clear);

    // the arrangement, always in view; tap to change it
    const orderBar = button('', () => openOrder(), 'cg-order');
    orderBar.setAttribute('aria-label', 'Arrange the song');
    orderBar.hidden = !arrangeable;
    const syncOrder = (playing = -1): void => {
        const ids = order ?? sections.order;
        orderBar.replaceChildren(
            el('span', 'cg-order-label', order ? 'ARRANGED' : 'ORDER'),
            ...ids.map((id, i) => {
                const tag = el(
                    'span',
                    'cg-order-tag',
                    sections.library.find((x) => x.id === id)?.short ?? '?',
                );
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
                order = same ? null : next;
                setArrangement(s.id, order);
                if (stepping) stopStep();
                draw();
                relink();
                toast(same ? 'Back to the original order' : 'Arranged');
            },
        });
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
            if (!home) return;
            if (picker.hidden) fillPicker(true);
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
        if (!home || (picker.hidden && !force)) return;
        const minorKey = /m$/.test(shiftKey(home, 0));
        picker.replaceChildren(
            ...Array.from({ length: 12 }, (_, i) => {
                const name = shiftKey(minorKey ? 'Cm' : 'C', i);
                const to = keyDistance(home, name);
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

    // sheet, scrolled or in pages
    const sheet = el('article', 'cg-sheet');
    const pager = el('div', 'cg-pager');
    const count = el('span', 'cg-pager-count');
    const prev = button('‹', () => goTo(pageIndex - 1), 'cg-icon cg-page-arrow');
    const next = button('›', () => goTo(pageIndex + 1), 'cg-icon cg-page-arrow');
    prev.setAttribute('aria-label', 'Previous page');
    next.setAttribute('aria-label', 'Next page');
    pager.append(prev, count, next);
    let pageIndex = 0;
    const pageCount = (): number =>
        Math.max(1, Math.round(sheet.scrollWidth / step()));
    const step = (): number =>
        sheet.clientWidth + parseFloat(getComputedStyle(sheet).columnGap || '0');
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
    leaveSong = () => {
        closeArranger();
        stopHeld();
        app.classList.remove('cg-has-stepbar');
        stepBar.remove();
        closeChooser();
        removeEventListener('keydown', keys);
        removeEventListener('resize', resize);
    };

    // playing draws each different section once and jumps back for repeats
    let packed: Compact | null = null;
    const draw = (): void => {
        packed = stepping ? compact(current()) : null;
        sheet.replaceChildren(
            renderSheet(packed ? display(packed.lines) : shown()),
        );
        sheet.classList.toggle('cg-reharm', reharm);
        syncTools();
        syncOrder(stepping ? (steps()[cursor]?.block ?? -1) : -1);
        if (reharm && !stepping) decorate();
        if (stepping) mark();
        keyText.textContent = keyLabel();
        fillPicker();
        if (view === 'pages') layout();
    };
    // reharm: tappable chords, edits marked, passing-chord gaps
    const saveEdits = (next: Edit[]): void => {
        edits = next;
        setEdits(s.id, edits);
        draw();
        relink();
    };
    /** row:piece as drawn; the edit belongs to that time round the section */
    const setAt = (row: number, piece: number, chord: string | null) => {
        const v = current();
        const line = v.origin[row] ?? -1;
        if (line < 0) return;
        const occ = v.occ[row] ?? 0;
        const original = chordAt(v.raw, row, piece);
        const here = (e: Edit): boolean =>
            e.line === line && e.piece === piece;
        const rest = edits.filter((e) => !(here(e) && e.occ === occ));
        const everyTime = rest.some((e) => here(e) && e.occ === undefined);
        // back to the sheet's own chord: no edit needed
        if (chord === original && !everyTime) saveEdits(rest);
        else
            saveEdits([
                ...rest,
                original === null
                    ? { line, piece, chord, occ, added: true }
                    : { line, piece, chord, occ },
            ]);
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
    const showGroups = (groups: OptionGroup[]): OptionGroup[] =>
        groups.map((g) => ({
            ...g,
            options: g.options.map((o) => ({ ...o, chord: show(o.chord) })),
        }));
    let gaps: ReturnType<typeof passingGaps> = [];
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
        gaps = passingGaps(v.lines, written, writtenFlats);
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
                setAt(row, piece, original);
                playChords([show(original)]);
            }
            return true;
        }
        const plus = target.closest<HTMLElement>('.cg-gap');
        if (plus) {
            const [row, piece] = parseAt(plus.dataset.gap);
            const g = gaps.find((x) => x.line === row && x.piece === piece);
            if (!g) return true;
            openChooser({
                title: `Passing chord: ${show(g.from)} → ${show(g.to)}`,
                current: null,
                groups: showGroups([{ label: 'TRY', options: g.options }]),
                hear: (c) => playChords([c]),
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
            openChooser({
                title: `Add a chord on “${word}”`,
                current: null,
                groups: [],
                hear: (c) => playChords([c]),
                choose: (c) => setAt(row, piece, store(c)),
            });
            return true;
        }
        const original = chordAt(v.raw, row, piece);
        // an added chord stays a passing chord: only passing options
        const [before, after] = neighbours(row, piece);
        const pass =
            original === null && before && after
                ? passing(before, after, written, writtenFlats)
                : null;
        openChooser({
            title: pass
                ? `Passing chord: ${show(before!)} → ${show(after!)}`
                : `Replace ${show(now)}`,
            current: show(now),
            groups: showGroups(
                pass
                    ? [{ label: 'TRY', options: pass.options }]
                    : // from the sheet's own chord, so edits don't drift ever further
                      suggestFor(original ?? now, written, writtenFlats),
            ),
            hear: (c) => playChords([c]),
            choose: (c) => setAt(row, piece, store(c)),
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
        holdChord(heard(at.chord));
        mark();
        syncOrder(at.block);
        nowName.textContent = heard(at.chord);
        const after = list[cursor + 1];
        nextName.textContent = after ? `then ${heard(after.chord)}` : 'end';
        const node = nodeAt(at.row, at.piece);
        if (node) follow(node);
    };
    /** at: a chord's row:piece in the full sheet, else the first on screen */
    const startStep = (at?: string): void => {
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
        playBtn.innerHTML = PLAY_ICON;
        playBtn.setAttribute('aria-label', 'Play the chords');
        sheet.classList.remove('cg-stepping');
        draw();
        // back in the full sheet, at the copy that was playing
        if (at) {
            const node = sheet.querySelector(`[data-at="${at.src}:${at.piece}"]`);
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

    const editSheet = (): void =>
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
                const updated = updateSheet(s.id, text, kept, keepOrder);
                if (updated) renderSong(app, updated);
                toast('Saved');
            },
        });

    let link = '';
    const relink = (): void => {
        link = '';
        const at = shift;
        void makeLink(s, at, edits, order).then((made) => {
            if (at === shift) link = made;
        });
    };
    const move = (by: number): void => {
        const next = shift + by;
        // a full octave round is the original
        shift = Math.abs(next) >= 12 ? 0 : next;
        setShift(s.id, shift);
        draw();
        relink();
    };

    app.append(bar, key, tools, orderBar, picker, sheet, pager, stepBar);
    draw();
    relink();
    layout();
    if (view === 'scroll') window.scrollTo(0, 0);
}


const SPARK_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';
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

function toast(text: string): void {
    const note = el('p', 'cg-toast', text);
    document.body.append(note);
    popIn(note);
    window.setTimeout(() => popOut(note, () => note.remove()), 1800);
}
