// Toasts: a short note at the bottom, sometimes with one action

import { popIn, popOut } from './animate.ts';

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

let lastToast: HTMLElement | null = null;

export function toast(
    text: string,
    action?: { label: string; run: () => void },
): void {
    if (lastToast) {
        const old = lastToast;
        popOut(old, () => old.remove());
    }
    const note = el('div', 'cg-toast');
    note.append(el('span', 'cg-toast-text', text));
    if (action) {
        const act = el('button', 'cg-toast-action', action.label);
        act.type = 'button';
        act.addEventListener('click', () => {
            popOut(note, () => note.remove());
            action.run();
        });
        note.append(act);
    }
    document.body.append(note);
    lastToast = note;
    popIn(note);
    window.setTimeout(
        () => popOut(note, () => note.remove()),
        action ? 4000 : 1800,
    );
}
