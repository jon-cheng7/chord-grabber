// Open and close animations for panels and <details>

const MS = 220;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const height = (el: Element): number => el.getBoundingClientRect().height;

const still = (): boolean =>
    matchMedia('(prefers-reduced-motion: reduce)').matches;

function grow(el: HTMLElement, from: number, to: number): Animation {
    el.style.overflow = 'hidden';
    el.style.boxSizing = 'border-box';
    const run = el.animate(
        [
            { height: `${from}px`, opacity: from < to ? 0.4 : 1 },
            { height: `${to}px`, opacity: from < to ? 1 : 0.4 },
        ],
        { duration: still() ? 0 : MS, easing: EASE },
    );
    const done = (): void => {
        el.style.overflow = '';
        el.style.boxSizing = '';
    };
    run.addEventListener('finish', done);
    run.addEventListener('cancel', done);
    return run;
}

export function slideOpen(el: HTMLElement): void {
    el.hidden = false;
    grow(el, 0, height(el));
}

export function slideClosed(el: HTMLElement): void {
    if (el.hidden) return;
    grow(el, height(el), 0).addEventListener('finish', () => {
        el.hidden = true;
    });
}

/** <details> that open and close smoothly instead of snapping */
export function smoothDetails(root: ParentNode): void {
    for (const details of root.querySelectorAll('details')) {
        const summary = details.querySelector(':scope > summary');
        if (!(summary instanceof HTMLElement)) continue;
        summary.addEventListener('click', (e) => {
            e.preventDefault();
            // measure both states before a frame is drawn
            const wasOpen = details.open;
            const before = height(details);
            details.open = !wasOpen;
            const after = height(details);
            details.open = true;
            const run = grow(details, before, after);
            if (wasOpen)
                run.addEventListener('finish', () => (details.open = false));
        });
    }
}

/** menus and toasts: fade and drop in, fade and lift out */
export function popIn(el: HTMLElement): void {
    el.hidden = false;
    el.animate(
        [
            { opacity: 0, transform: 'translateY(-6px) scale(0.98)' },
            { opacity: 1, transform: 'none' },
        ],
        { duration: still() ? 0 : 160, easing: EASE },
    );
}

export function popOut(el: HTMLElement, then?: () => void): void {
    if (el.hidden) return;
    const run = el.animate(
        [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(-6px) scale(0.98)' },
        ],
        { duration: still() ? 0 : 120, easing: EASE },
    );
    run.addEventListener('finish', () => {
        el.hidden = true;
        el.dispatchEvent(new Event('cg-closed'));
        then?.();
    });
}

/** bottom sheets: up from the edge, back down */
export function sheetIn(el: HTMLElement): void {
    el.hidden = false;
    el.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], {
        duration: still() ? 0 : 280,
        easing: EASE,
    });
}

export function sheetOut(el: HTMLElement, then?: () => void): void {
    const run = el.animate(
        [{ transform: 'none' }, { transform: 'translateY(100%)' }],
        { duration: still() ? 0 : 200, easing: 'cubic-bezier(0.3, 0, 1, 1)' },
    );
    run.addEventListener('finish', () => {
        el.hidden = true;
        then?.();
    });
}

/** rows and cards arriving, one after another */
export function rise(el: HTMLElement, i = 0): void {
    el.animate(
        [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'none' },
        ],
        {
            duration: still() ? 0 : 240,
            delay: still() ? 0 : Math.min(i, 12) * 30,
            easing: EASE,
            fill: 'backwards',
        },
    );
}

/** a row folds away, then goes */
export function collapse(el: HTMLElement, then?: () => void): void {
    grow(el, height(el), 0).addEventListener('finish', () => {
        el.remove();
        then?.();
    });
}
