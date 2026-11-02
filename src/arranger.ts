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

    // drag by the handle. Nothing moves in the DOM until the drop: the row
    // follows the finger, the others slide a slot to make room
    let body: HTMLElement;
    const drag = (li: HTMLLIElement, handle: HTMLElement): void => {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            e.preventDefault();
            const rows = [...list.children] as HTMLElement[];
            const from = rows.indexOf(li);
            if (from < 0) return;
            handle.setPointerCapture(e.pointerId);
            const tops = rows.map((r) => r.offsetTop);
            const slot =
                rows.length > 1
                    ? (tops[1] ?? 0) - (tops[0] ?? 0)
                    : li.offsetHeight;
            const startY = e.clientY;
            const startScroll = body.scrollTop;
            let to = from;
            let lastY = e.clientY;
            li.classList.add('cg-dragging');
            list.classList.add('cg-sorting');

            const place = (): void => {
                const dy = lastY - startY + body.scrollTop - startScroll;
                const min = -from * slot;
                const max = (rows.length - 1 - from) * slot;
                const y = Math.min(max, Math.max(min, dy));
                li.style.transform = `translateY(${y}px)`;
                to = Math.round(from + y / slot);
                rows.forEach((r, i) => {
                    if (r === li) return;
                    let shift = 0;
                    if (from < to && i > from && i <= to) shift = -slot;
                    if (from > to && i < from && i >= to) shift = slot;
                    r.style.transform = shift ? `translateY(${shift}px)` : '';
                });
            };
            // near the panel's edges, keep scrolling while held
            let timer = 0;
            const edge = (): void => {
                const area = body.getBoundingClientRect();
                const speed =
                    lastY < area.top + 48
                        ? -6
                        : lastY > area.bottom - 48
                          ? 6
                          : 0;
                if (speed) {
                    body.scrollTop += speed;
                    place();
                }
                timer = requestAnimationFrame(edge);
            };
            timer = requestAnimationFrame(edge);

            const move = (ev: PointerEvent): void => {
                lastY = ev.clientY;
                place();
            };
            const end = (): void => {
                cancelAnimationFrame(timer);
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                const settle = (): void => {
                    // reorder for real, then drop the offsets without a jump
                    list.classList.remove('cg-sorting');
                    for (const r of rows) r.style.transform = '';
                    const target = rows[to];
                    if (to !== from && target)
                        if (to > from) target.after(li);
                        else target.before(li);
                    li.classList.remove('cg-dragging');
                    sync();
                };
                const y = (to - from) * slot;
                const run = li.animate(
                    [
                        { transform: li.style.transform || 'none' },
                        { transform: `translateY(${y}px)` },
                    ],
                    { duration: MS, easing: EASE },
                );
                li.style.transform = `translateY(${y}px)`;
                run.addEventListener('finish', settle);
                run.addEventListener('cancel', settle);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
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
    body = el('div', 'cg-chooser-list');
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
