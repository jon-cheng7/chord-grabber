// Reharm chooser: a sheet from the bottom with suggestions and a typed chord

import { popIn, popOut } from './animate.ts';
import { isChord } from './chord.ts';
import type { OptionGroup } from './reharm.ts';

export interface ChooserOptions {
    title: string;
    /** what's there now, as shown */
    current: string | null;
    groups: OptionGroup[];
    hear: (chord: string) => void;
    choose: (chord: string) => void;
    /** back to what the sheet had */
    revert?: () => void;
    remove?: () => void;
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

let open: HTMLElement | null = null;

export function closeChooser(): void {
    const node = open;
    open = null;
    if (node) popOut(node, () => node.remove());
}

export function openChooser(o: ChooserOptions): void {
    closeChooser();
    const box = el('div', 'cg-chooser');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', o.title);
    let current = o.current;

    const head = el('div', 'cg-chooser-head');
    head.append(el('p', 'cg-chooser-title', o.title));
    head.append(button('×', closeChooser, 'cg-icon'));
    box.append(head);

    const chips: HTMLButtonElement[] = [];
    const mark = (): void => {
        for (const c of chips)
            c.classList.toggle('cg-on', c.dataset.chord === current);
    };
    const pick = (chord: string): void => {
        current = chord;
        o.hear(chord);
        o.choose(chord);
        mark();
    };

    const list = el('div', 'cg-chooser-list');
    for (const g of o.groups) {
        list.append(el('p', 'cg-pop-label', g.label));
        const row = el('div', 'cg-chips');
        for (const opt of g.options) {
            const chip = button('', () => pick(opt.chord), 'cg-chip');
            chip.dataset.chord = opt.chord;
            chip.append(
                el('span', 'cg-chip-name', opt.chord),
                el('span', 'cg-chip-why', opt.why),
            );
            chips.push(chip);
            row.append(chip);
        }
        list.append(row);
    }
    box.append(list);

    // any chord, typed
    const typed = el('form', 'cg-typed');
    const input = el('input', 'cg-typed-input');
    input.placeholder = 'Type a chord, e.g. F#m7';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const use = el('button', 'cg-btn cg-btn-primary', 'USE');
    use.type = 'submit';
    typed.append(input, use);
    typed.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
        if (!isChord(text)) {
            input.classList.add('cg-bad');
            input.setCustomValidity('Not a chord');
            input.reportValidity();
            return;
        }
        input.classList.remove('cg-bad');
        input.setCustomValidity('');
        pick(text);
    });
    input.addEventListener('input', () => {
        input.classList.remove('cg-bad');
        input.setCustomValidity('');
    });
    box.append(typed);

    const foot = el('div', 'cg-chooser-foot');
    if (o.revert)
        foot.append(
            button('ORIGINAL', () => {
                o.revert?.();
                closeChooser();
            }),
        );
    if (o.remove)
        foot.append(
            button('REMOVE', () => {
                o.remove?.();
                closeChooser();
            }),
        );
    foot.append(button('DONE', closeChooser, 'cg-btn cg-btn-primary'));
    box.append(foot);

    document.body.append(box);
    open = box;
    mark();
    popIn(box);
}
