// Parsed lines → DOM that wraps without losing chord positions

import type { Line, Piece } from './parse.ts';

function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** at: line:piece, so reharm can find a chord's place */
function piece(p: Piece, at: string): HTMLElement {
    const node = el('span', 'cg-piece');
    node.dataset.at = at;
    // empty chord keeps the row height so lyrics line up
    node.append(
        el('span', 'cg-chord', p.chord ?? ''),
        el('span', 'cg-words', p.text),
    );
    if (p.chord) node.dataset.chord = '';
    return node;
}

/**
 * origin: each line's place in the unarranged sheet, which data-at uses,
 * while data-row counts lines as shown
 */
export function renderSheet(
    lines: readonly Line[],
    origin?: readonly number[],
): DocumentFragment {
    const out = document.createDocumentFragment();
    lines.forEach((line, row) => {
        const i = origin?.[row] ?? row;
        switch (line.kind) {
            case 'section':
                out.append(el('h2', 'cg-section', line.label));
                break;
            case 'blank':
                out.append(el('div', 'cg-blank'));
                break;
            case 'tab':
                out.append(el('pre', 'cg-tab', line.text));
                break;
            case 'chords': {
                const box = el('div', 'cg-line cg-line-chords');
                box.dataset.row = String(row);
                line.items.forEach((item, k) => {
                    const node = item.chord
                        ? el('span', 'cg-chord', item.chord)
                        : el('span', 'cg-filler', item.text);
                    node.dataset.at = `${i}:${k}`;
                    box.append(node);
                });
                out.append(box);
                break;
            }
            case 'lyric': {
                const box = el(
                    'div',
                    line.chords ? 'cg-line cg-line-paired' : 'cg-line',
                );
                box.dataset.row = String(row);
                let k = 0;
                for (const unit of line.units) {
                    const group = el('span', 'cg-unit');
                    for (const p of unit) {
                        const at = `${i}:${k++}`;
                        if (line.chords) {
                            group.append(piece(p, at));
                            continue;
                        }
                        // no chords on the line: words still have a place
                        const word = el('span', 'cg-plain', p.text);
                        word.dataset.at = at;
                        group.append(word);
                    }
                    box.append(group);
                }
                out.append(box);
                break;
            }
        }
    });
    return out;
}
