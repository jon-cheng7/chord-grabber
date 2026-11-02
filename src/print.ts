// Print: one sheet of letter paper if it'll fit, two if it won't

import type { SongSource } from './ug.ts';

// letter less half-inch margins, in CSS px; a little spare so it never spills
const PAGE_W = 7.5 * 96;
const PAGE_H = 9.8 * 96;
// biggest first: one column, then two, shrinking
const TRIES: [cols: number, px: number][] = [
    [1, 15],
    [1, 14],
    [1, 13],
    [2, 13],
    [2, 12],
    [2, 11],
    [2, 10],
    [2, 9],
];
// doesn't fit: two pages at a readable size
const FALLBACK: [number, number] = [2, 11];

function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function printSong(
    song: SongSource,
    sheet: DocumentFragment,
    key: string,
): void {
    document.querySelector('.cg-print')?.remove();
    const page = el('div', 'cg-print cg-print-measure');
    const head = el('header', 'cg-print-head');
    head.append(el('h1', 'cg-print-title', song.title));
    const sub = [song.artist, key].filter(Boolean).join(' · ');
    if (sub) head.append(el('p', 'cg-print-sub', sub));
    const body = el('div', 'cg-sheet cg-print-sheet');
    body.append(sheet);
    page.append(head, body);
    page.style.width = `${PAGE_W}px`;
    document.body.append(page);

    // lay it out at paper size on screen, off to the side
    body.style.height = `${PAGE_H - head.offsetHeight}px`;
    const set = ([cols, px]: [number, number]): void => {
        page.style.setProperty('--cg-print-cols', String(cols));
        page.style.setProperty('--cg-size', `${px}px`);
    };
    // overflow shows up as extra columns off to the right
    const fits = (): boolean => body.scrollWidth <= body.clientWidth + 1;
    const fit = TRIES.find((t) => {
        set(t);
        return fits();
    });
    if (!fit) {
        set(FALLBACK);
        body.style.height = '';
    }
    page.classList.remove('cg-print-measure');
    page.style.width = '';

    // kept until the next print: iOS fires afterprint before it renders
    window.print();
}
