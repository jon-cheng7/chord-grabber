// Chord shapes on the sheet: hold a chord (touch) or rest the mouse on it to see how it's
// played; a panel of every chord in the song, with a search for any other. A tap still plays

import { popIn, popOut } from './animate.ts';
import { isChord } from './music/chord.ts';
import { diagram, shapeOf, type Shape } from './shapes.ts';
import { pref, setPref } from './store.ts';
import { toast } from './toast.ts';

// a touch held this long is a look, not a tap
const HOLD = 450;
// and one that wanders this far is a scroll
const WANDER = 10;
// the mouse resting on a chord this long
const REST = 350;
// moving off gives this long to reach the card
const LINGER = 250;

export interface Fingers {
    /** true for the tap that ends a hold: it shouldn't also play */
    swallow(): boolean;
    /** the chords as drawn changed: key, capo, simplify */
    refresh(): void;
    openPanel(): void;
    remove(): void;
}

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

const lefty = (): boolean => pref<boolean>('cg-lefty', false);

/** a chord's diagram, with its other positions a tap away */
function card(
    shape: Shape,
    hear: (name: string) => void,
    big = false,
): HTMLElement {
    const box = el('div', big ? 'cg-shape-card cg-shape-big' : 'cg-shape-card');
    let at = 0;
    const draw = (): void => {
        const p = shape.positions[at]!;
        const count = shape.positions.length;
        const name = button(
            shape.name,
            () => hear(shape.name),
            'cg-shape-name',
        );
        name.title = 'Hear it';
        const head = el('div', 'cg-shape-head');
        head.append(name);
        if (count > 1) {
            const step = (by: number) => (): void => {
                at = (at + by + count) % count;
                draw();
            };
            const nav = el('div', 'cg-shape-nav');
            const back = button('‹', step(-1), 'cg-shape-step');
            back.setAttribute('aria-label', 'Previous shape');
            const next = button('›', step(1), 'cg-shape-step');
            next.setAttribute('aria-label', 'Next shape');
            nav.append(
                back,
                el('span', 'cg-shape-count', `${at + 1}/${count}`),
                next,
            );
            head.append(nav);
        }
        const art = el('div', 'cg-shape-art');
        art.innerHTML = diagram(p, lefty());
        art.setAttribute(
            'aria-label',
            `${shape.name}, shape ${at + 1} of ${count}`,
        );
        box.replaceChildren(head, art);
        const notes = [
            shape.instead && `shown as ${shape.instead}`,
            shape.bass && `bass ${shape.bass}`,
        ].filter(Boolean);
        if (notes.length)
            box.append(el('p', 'cg-shape-note', notes.join(' · ')));
    };
    draw();
    return box;
}

export function fingers(o: {
    sheet: HTMLElement;
    /** the chord at a spot on the sheet, as drawn */
    nameAt(chord: Element): string | null;
    /** every chord in the song as drawn, first seen first */
    chords(): string[];
    hear(name: string): void;
}): Fingers {
    const chordOf = (target: EventTarget | null): Element | null => {
        const node =
            target instanceof Element ? target.closest('.cg-chord') : null;
        return node?.textContent?.trim() ? node : null;
    };

    /* ---------- the card by a chord ---------- */

    const peek = el('div', 'cg-peek');
    peek.hidden = true;
    peek.setAttribute('role', 'dialog');
    let anchor: Element | null = null;
    let leaving = 0;

    const place = (): void => {
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        const w = peek.offsetWidth;
        const h = peek.offsetHeight;
        const left = Math.min(
            innerWidth - w - 8,
            Math.max(8, r.left + r.width / 2 - w / 2),
        );
        // above the chord if it fits, else below
        const top = r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8;
        peek.style.left = `${left}px`;
        peek.style.top = `${top}px`;
    };

    const show = async (chord: Element): Promise<void> => {
        const name = o.nameAt(chord);
        if (!name) return;
        anchor = chord;
        const shape = await shapeOf(name);
        // moved on while the shapes loaded
        if (anchor !== chord) return;
        if (!shape) {
            hide();
            return;
        }
        peek.replaceChildren(card(shape, o.hear));
        const fresh = peek.hidden;
        peek.hidden = false;
        place();
        if (fresh) popIn(peek);
    };

    const hide = (): void => {
        anchor = null;
        window.clearTimeout(leaving);
        if (!peek.hidden) popOut(peek, () => (peek.hidden = true));
    };
    const hideSoon = (): void => {
        window.clearTimeout(leaving);
        leaving = window.setTimeout(hide, LINGER);
    };
    peek.addEventListener('pointerenter', () => window.clearTimeout(leaving));
    peek.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') hideSoon();
    });

    /* touch: hold a chord */
    let holding = 0;
    let from: { x: number; y: number } | null = null;
    let held = false;
    const cancelHold = (): void => {
        window.clearTimeout(holding);
        from = null;
    };
    const down = (e: PointerEvent): void => {
        held = false;
        if (e.pointerType === 'mouse') return;
        const chord = chordOf(e.target);
        if (!chord) return;
        from = { x: e.clientX, y: e.clientY };
        holding = window.setTimeout(() => {
            held = true;
            from = null;
            navigator.vibrate?.(10);
            void show(chord);
        }, HOLD);
    };
    const move = (e: PointerEvent): void => {
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > WANDER)
            cancelHold();
    };
    // the phone's own long-press menu would cover the card
    const menu = (e: Event): void => {
        if (chordOf(e.target)) e.preventDefault();
    };

    /* mouse: rest on a chord */
    let resting = 0;
    let over: Element | null = null;
    const enter = (e: PointerEvent): void => {
        if (e.pointerType !== 'mouse') return;
        const chord = chordOf(e.target);
        if (!chord || chord === over) return;
        over = chord;
        window.clearTimeout(resting);
        window.clearTimeout(leaving);
        resting = window.setTimeout(() => void show(chord), REST);
    };
    const leave = (e: PointerEvent): void => {
        if (e.pointerType !== 'mouse') return;
        const chord = chordOf(e.target);
        if (!chord || chord !== over) return;
        if (e.relatedTarget instanceof Node && chord.contains(e.relatedTarget))
            return;
        over = null;
        window.clearTimeout(resting);
        hideSoon();
    };

    /* anywhere else: away it goes */
    const outside = (e: PointerEvent): void => {
        if (peek.hidden) return;
        const t = e.target as Node;
        if (peek.contains(t) || (anchor && anchor.contains(t))) return;
        hide();
    };
    const keys = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') hide();
    };

    o.sheet.addEventListener('pointerdown', down);
    o.sheet.addEventListener('pointermove', move);
    o.sheet.addEventListener('pointerup', cancelHold);
    o.sheet.addEventListener('pointercancel', cancelHold);
    o.sheet.addEventListener('contextmenu', menu);
    o.sheet.addEventListener('pointerover', enter);
    o.sheet.addEventListener('pointerout', leave);
    document.addEventListener('pointerdown', outside, true);
    addEventListener('keydown', keys);
    addEventListener('scroll', hide, { passive: true });
    document.body.append(peek);

    // said once per device, the way this device would do it
    if (!pref<boolean>('cg-shapes-told', false)) {
        setPref('cg-shapes-told', true);
        window.setTimeout(
            () =>
                toast(
                    matchMedia('(hover: hover)').matches
                        ? 'Rest the mouse on a chord to see how to play it'
                        : 'Hold a chord to see how to play it',
                ),
            1200,
        );
    }

    /* ---------- the panel: every chord, and a search ---------- */

    const panel = el('aside', 'cg-shapes');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Chord shapes');
    const head = el('div', 'cg-shapes-head');
    const flip = el('label', 'toggle cg-shapes-lefty');
    const flipBox = el('input', '');
    flipBox.type = 'checkbox';
    flipBox.checked = lefty();
    flip.append(flipBox, ' Left-handed');
    head.append(
        el('p', 'cg-shapes-title', 'Chord shapes'),
        flip,
        button('×', () => closePanel(), 'cg-icon'),
    );
    const search = el('input', 'cg-typed-input cg-shapes-search');
    search.placeholder = 'Any chord, e.g. F#m7b5';
    search.autocapitalize = 'off';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.enterKeyHint = 'search';
    const found = el('div', 'cg-shapes-found');
    const list = el('div', 'cg-shapes-list');
    panel.append(head, search, found, list);
    document.body.append(panel);

    // each fill replaces the last; a slow one that's been overtaken is dropped
    let filling = 0;
    const fill = async (): Promise<void> => {
        const run = ++filling;
        const names = o.chords();
        const shapes = await Promise.all(names.map(shapeOf));
        if (run !== filling) return;
        list.replaceChildren(
            ...shapes.flatMap((s) => (s ? [card(s, o.hear)] : [])),
        );
        if (!list.childElementCount)
            list.append(el('p', 'cg-shapes-empty', 'No chords in this song'));
    };
    let looking = 0;
    const look = async (): Promise<void> => {
        const run = ++looking;
        const text = search.value.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
        if (!text) {
            found.replaceChildren();
            return;
        }
        const shape = isChord(text) ? await shapeOf(text) : null;
        if (run !== looking) return;
        found.replaceChildren(
            shape
                ? card(shape, o.hear, true)
                : el('p', 'cg-shapes-empty', 'Not a chord yet'),
        );
    };
    search.addEventListener('input', () => void look());
    flipBox.addEventListener('change', () => {
        setPref('cg-lefty', flipBox.checked);
        void fill();
        void look();
    });

    const openPanel = (): void => {
        if (!panel.hidden) return;
        panel.hidden = false;
        popIn(panel);
        void fill();
    };
    const closePanel = (): void => {
        popOut(panel, () => (panel.hidden = true));
    };

    return {
        swallow: () => {
            if (!held) return false;
            held = false;
            return true;
        },
        refresh: () => {
            if (!panel.hidden) void fill();
            hide();
        },
        openPanel,
        remove: () => {
            o.sheet.removeEventListener('pointerdown', down);
            o.sheet.removeEventListener('pointermove', move);
            o.sheet.removeEventListener('pointerup', cancelHold);
            o.sheet.removeEventListener('pointercancel', cancelHold);
            o.sheet.removeEventListener('contextmenu', menu);
            o.sheet.removeEventListener('pointerover', enter);
            o.sheet.removeEventListener('pointerout', leave);
            document.removeEventListener('pointerdown', outside, true);
            removeEventListener('keydown', keys);
            removeEventListener('scroll', hide);
            window.clearTimeout(holding);
            window.clearTimeout(resting);
            window.clearTimeout(leaving);
            peek.remove();
            panel.remove();
        },
    };
}
