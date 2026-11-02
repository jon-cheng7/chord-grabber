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
