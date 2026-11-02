// Edit lyrics and chords: the sheet as plain chords over lyrics

import { popIn, popOut } from './animate.ts';
import type { Line } from './parse.ts';

/** parsed lines back to text anyone can edit: chords above their words */
export function sheetText(lines: readonly Line[]): string {
    const out: string[] = [];
    for (const line of lines) {
        if (line.kind === 'section') out.push(`[${line.label}]`);
        else if (line.kind === 'blank') out.push('');
        else if (line.kind === 'tab') out.push(line.text);
        else if (line.kind === 'chords')
            out.push(
                line.items
                    .map((p) => p.chord ?? p.text)
                    .filter(Boolean)
                    .join(' '),
            );
        else if (!line.chords)
            out.push(
                line.units
                    .flat()
                    .map((p) => p.text)
                    .join('')
                    .trimEnd(),
            );
        else {
            let chords = '';
            let words = '';
            for (const p of line.units.flat()) {
                if (p.chord) {
                    // a long chord pushes the next one along
                    const at = chords
                        ? Math.max(words.length, chords.length + 1)
                        : words.length;
                    chords = chords.padEnd(at) + p.chord;
                }
                words += p.text;
            }
            out.push(chords.trimEnd(), words.trimEnd());
        }
    }
    return out.join('\n');
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

let shut: (() => void) | null = null;

/** leaving the song: no editor left over the next page */
export function closeEditor(): void {
    shut?.();
}

export function openEditor(o: {
    text: string;
    save: (text: string) => void;
}): void {
    const box = el('div', 'cg-editor');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Edit lyrics and chords');
    const close = (): void => {
        shut = null;
        document.documentElement.classList.remove('cg-locked');
        popOut(box, () => box.remove());
    };

    const area = el('textarea', 'cg-editor-text');
    area.value = o.text;
    area.spellcheck = false;
    area.autocapitalize = 'off';
    area.wrap = 'off';

    const save = button(
        'SAVE',
        () => {
            o.save(area.value);
            close();
        },
        'cg-btn cg-btn-primary',
    );
    save.disabled = true;
    area.addEventListener('input', () => {
        save.disabled = area.value === o.text;
    });

    const head = el('div', 'cg-editor-head');
    head.append(
        button('CANCEL', close),
        el('p', 'cg-chooser-title', 'Edit lyrics & chords'),
        save,
    );
    const help = el(
        'p',
        'cg-editor-help',
        'Chords go on the line above their words. Section names in [brackets]. Written in the original key.',
    );
    box.append(head, help, area);
    // the song behind mustn't scroll while selection handles are dragged
    document.documentElement.classList.add('cg-locked');
    shut = close;
    document.body.append(box);
    popIn(box);
    area.focus({ preventScroll: true });
}
