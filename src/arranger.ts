// Arrange panel: tap sections in, drag them around, DONE builds the sheet

import { popIn, popOut } from './animate.ts';
import type { Section } from './arrange.ts';

export interface ArrangerOptions {
    library: Section[];
    /** what's showing now */
    order: string[];
    /** the sheet's own order */
    original: string[];
    done: (order: string[]) => void;
}

const MS = 180;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

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

/** rows slide from where they were to where they are */
function flip(list: HTMLElement, move: () => void, skip?: Element): void {
    const rows = [...list.children] as HTMLElement[];
    const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
    move();
    for (const r of rows) {
        if (r === skip || !r.isConnected) continue;
        const dy = (before.get(r) ?? 0) - r.getBoundingClientRect().top;
        if (dy)
            r.animate(
                [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
                { duration: MS, easing: EASE },
            );
    }
}

let open: HTMLElement[] = [];

export function closeArranger(): void {
    const nodes = open;
    open = [];
    for (const node of nodes) popOut(node, () => node.remove());
}

export function openArranger(o: ArrangerOptions): void {
    closeArranger();
    const byId = new Map(o.library.map((s) => [s.id, s]));
    const shade = el('div', 'cg-shade');
    shade.addEventListener('click', closeArranger);
    const box = el('div', 'cg-chooser cg-arranger');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Arrange the song');

    const head = el('div', 'cg-chooser-head');
    head.append(
        el('p', 'cg-chooser-title', 'Arrange'),
        button('×', closeArranger, 'cg-icon'),
    );
    const strip = el('p', 'cg-arrange-strip');

    // the sections, tap to add to the end
    const chips = el('div', 'cg-chips');
    for (const s of o.library) {
        const chip = button('', () => add(s.id, true), 'cg-chip cg-section-chip');
        chip.append(
            el('span', 'cg-chip-name', s.short),
            el('span', 'cg-chip-why', s.label),
        );
        chips.append(chip);
    }

    const list = el('ol', 'cg-arrange-list');
    const empty = el('p', 'cg-arrange-empty', 'Tap a section above to add it.');

    const order = (): string[] =>
        [...list.children].map((r) => (r as HTMLElement).dataset.id ?? '');
    const sync = (): void => {
        const ids = order();
        strip.textContent = ids.map((id) => byId.get(id)?.short).join('  ');
        empty.hidden = ids.length > 0;
        done.disabled = !ids.length;
    };

    const row = (id: string): HTMLLIElement => {
        const s = byId.get(id);
        const li = el('li', 'cg-arrange-row');
        li.dataset.id = id;
        const handle = el('span', 'cg-arrange-handle', '⋮⋮');
        handle.setAttribute('aria-hidden', 'true');
        const names = el('span', 'cg-arrange-names');
        names.append(
            el('span', 'cg-arrange-short', s?.short ?? '?'),
            el('span', 'cg-arrange-label', s?.label ?? ''),
        );
        const drop = button(
            '×',
            () => {
                const h = li.getBoundingClientRect().height;
                const run = li.animate(
                    [
                        { opacity: 1, height: `${h}px` },
                        { opacity: 0, height: '0px', marginBottom: '0px' },
                    ],
                    { duration: MS, easing: EASE },
                );
                run.addEventListener('finish', () => {
                    li.remove();
                    sync();
                });
            },
            'cg-icon cg-arrange-drop',
        );
        drop.setAttribute('aria-label', `Leave out ${s?.label ?? ''}`);
        li.append(handle, names, drop);
        drag(li, handle);
        return li;
    };

    const add = (id: string, animate: boolean): void => {
        const li = row(id);
        list.append(li);
        if (animate) {
            li.animate(
                [
                    { opacity: 0, transform: 'translateY(8px)' },
                    { opacity: 1, transform: 'none' },
                ],
                { duration: MS, easing: EASE },
            );
            li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        sync();
    };

    // drag by the handle; the others slide out of the way
    const drag = (li: HTMLLIElement, handle: HTMLElement): void => {
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            li.classList.add('cg-dragging');
            let lastY = e.clientY;
            let offset = 0;
            const moveTo = (y: number): void => {
                offset += y - lastY;
                lastY = y;
                li.style.transform = `translateY(${offset}px)`;
                const mid = li.getBoundingClientRect().top + li.offsetHeight / 2;
                const prev = li.previousElementSibling as HTMLElement | null;
                const next = li.nextElementSibling as HTMLElement | null;
                const swap = (other: HTMLElement, after: boolean): void => {
                    const before = li.getBoundingClientRect().top - offset;
                    flip(
                        list,
                        () =>
                            after
                                ? other.after(li)
                                : other.before(li),
                        li,
                    );
                    // keep the row under the finger after it moved in the list
                    const now = li.getBoundingClientRect().top - offset;
                    offset -= now - before;
                    li.style.transform = `translateY(${offset}px)`;
                };
                if (prev) {
                    const r = prev.getBoundingClientRect();
                    if (mid < r.top + r.height / 2) swap(prev, false);
                }
                if (next) {
                    const r = next.getBoundingClientRect();
                    if (mid > r.top + r.height / 2) swap(next, true);
                }
                // near the panel's edges, scroll it
                const area = body.getBoundingClientRect();
                if (y < area.top + 40) body.scrollTop -= 8;
                else if (y > area.bottom - 40) body.scrollTop += 8;
            };
            const move = (ev: PointerEvent): void => moveTo(ev.clientY);
            const end = (): void => {
                handle.removeEventListener('pointermove', move);
                li.animate(
                    [
                        { transform: `translateY(${offset}px)` },
                        { transform: 'none' },
                    ],
                    { duration: MS, easing: EASE },
                );
                li.style.transform = '';
                li.classList.remove('cg-dragging');
                sync();
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end, { once: true });
            handle.addEventListener('pointercancel', end, { once: true });
        });
    };

    const foot = el('div', 'cg-chooser-foot');
    const reset = button('ORIGINAL', () => {
        flip(list, () => {
            list.replaceChildren();
            for (const id of o.original) add(id, false);
        });
        sync();
    });
    const done = button(
        'DONE',
        () => {
            o.done(order());
            closeArranger();
        },
        'cg-btn cg-btn-primary',
    );
    foot.append(reset, done);

    // head and buttons stay put; only the middle scrolls
    const body = el('div', 'cg-chooser-list');
    body.append(
        el('p', 'cg-pop-label', 'SECTIONS · TAP TO ADD'),
        chips,
        el('p', 'cg-pop-label', 'ORDER · DRAG TO MOVE'),
        list,
        empty,
    );
    box.append(head, strip, body, foot);
    for (const id of o.order) add(id, false);
    sync();

    document.body.append(shade, box);
    open = [shade, box];
    popIn(shade);
    popIn(box);
}
